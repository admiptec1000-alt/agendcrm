const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const logger = pino({ level: 'warn' });
const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8001';
const PORT = process.env.PORT || process.env.WA_PORT || 3002;
// Allow overriding with AUTH_DIR so operators can point to a persistent disk
// (e.g. /var/data/auth_sessions on Render with a mounted Persistent Disk).
const AUTH_DIR = process.env.AUTH_DIR
  ? path.resolve(process.env.AUTH_DIR)
  : path.join(__dirname, 'auth_sessions');
console.log(`[whatsapp-service] Using AUTH_DIR=${AUTH_DIR}`);
console.log(`[whatsapp-service] Webhook target FASTAPI_URL=${FASTAPI_URL}`);

// Store connections per company
const connections = {};

// In-memory store of recently sent messages so Baileys can satisfy
// retry/decryption requests with the original payload (otherwise the WA
// server resends an EMPTY message to the recipient — a known Baileys
// pitfall when getMessage returns {conversation:''}).
// Keyed by `${jid}:${msgId}`.
const sentMessageStore = {};
const SENT_STORE_MAX = 500;
function rememberSent(jid, msgId, message) {
  if (!jid || !msgId || !message) return;
  const key = `${jid}:${msgId}`;
  sentMessageStore[key] = message;
  const keys = Object.keys(sentMessageStore);
  if (keys.length > SENT_STORE_MAX) {
    delete sentMessageStore[keys[0]];
  }
}
function recallSent(jid, msgId) {
  return sentMessageStore[`${jid}:${msgId}`];
}

// Ensure auth directory
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function createConnection(instanceId) {
  const authDir = path.join(AUTH_DIR, instanceId);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger,
    browser: ['AgentCRM', 'Chrome', '1.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 500,
    // Mark device online on connect so WhatsApp server treats us as active
    // (helps avoid "Aguardando mensagem..." prekey placeholder on recipients)
    markOnlineOnConnect: true,
    syncFullHistory: false,
    // Return the original message body when the WA server requests a retry
    // (otherwise recipients receive an EMPTY message). We look up the
    // outbound payload we cached at send-time.
    getMessage: async (key) => {
      const cached = recallSent(key?.remoteJid, key?.id);
      if (cached) return cached;
      return { conversation: '' };
    },
  });

  const instance = {
    id: instanceId,
    sock,
    qr: null,
    qrBase64: null,
    status: 'connecting',
    user: null,
    lastError: null,
  };

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      instance.qr = qr;
      instance.status = 'waiting_qr';
      try {
        instance.qrBase64 = await QRCode.toDataURL(qr);
      } catch (e) {}
      console.log(`[${instanceId}] QR Code generated`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      instance.status = 'disconnected';
      instance.lastError = lastDisconnect?.error?.message || 'Connection closed';
      console.log(`[${instanceId}] Disconnected: ${instance.lastError}`);

      if (shouldReconnect) {
        console.log(`[${instanceId}] Reconnecting in 5s...`);
        setTimeout(() => createConnection(instanceId), 5000);
      } else {
        // Logged out - clean auth
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
        delete connections[instanceId];
      }
    } else if (connection === 'open') {
      instance.status = 'connected';
      instance.qr = null;
      instance.qrBase64 = null;
      instance.user = sock.user;
      console.log(`[${instanceId}] Connected as ${sock.user?.id}`);

      // Notify FastAPI
      try {
        await axios.post(`${FASTAPI_URL}/api/channels/webhook/connected`, {
          instance_id: instanceId,
          phone: sock.user?.id?.split(':')[0] || '',
          name: sock.user?.name || ''
        });
      } catch (e) {}
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Capture both 'notify' (real-time push) and 'append' (background sync)
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      // Skip status broadcasts and groups (focus on 1-on-1 for CRM)
      const remoteJid = msg.key.remoteJid || '';
      if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

      const m = msg.message || {};
      // Support a variety of message types
      let text = m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || m.documentMessage?.caption
        || m.documentWithCaptionMessage?.message?.documentMessage?.caption
        || m.buttonsResponseMessage?.selectedDisplayText
        || m.listResponseMessage?.title
        || m.templateButtonReplyMessage?.selectedDisplayText
        || '';

      // Provide a placeholder for media-only messages so the agent sees them
      if (!text) {
        if (m.imageMessage) text = '[Imagem]';
        else if (m.videoMessage) text = '[Video]';
        else if (m.audioMessage) text = '[Audio]';
        else if (m.stickerMessage) text = '[Figurinha]';
        else if (m.documentMessage) text = `[Documento] ${m.documentMessage.fileName || ''}`.trim();
        else if (m.locationMessage) text = '[Localizacao]';
        else if (m.contactMessage) text = `[Contato] ${m.contactMessage.displayName || ''}`.trim();
      }
      if (!text) continue;

      const phone = remoteJid.replace('@s.whatsapp.net', '');
      const pushName = msg.pushName || '';
      // Coerce Baileys Long timestamp into a plain int for JSON serialization
      let ts = msg.messageTimestamp;
      if (ts && typeof ts === 'object' && typeof ts.toNumber === 'function') ts = ts.toNumber();
      else if (typeof ts !== 'number') ts = Number(ts) || 0;

      try {
        await axios.post(`${FASTAPI_URL}/api/channels/webhook/message`, {
          instance_id: instanceId,
          phone,
          name: pushName,
          message: text,
          message_id: msg.key.id,
          timestamp: ts,
        }, { timeout: 10000 });
      } catch (e) {
        console.error(`[${instanceId}] Webhook POST failed (${FASTAPI_URL}):`, e.message);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  connections[instanceId] = instance;
  return instance;
}

// === REST API ===

app.post('/instances/:id/connect', async (req, res) => {
  const { id } = req.params;
  try {
    if (connections[id]?.status === 'connected') {
      return res.json({ status: 'already_connected', user: connections[id].user });
    }
    const instance = await createConnection(id);
    res.json({ status: instance.status, message: 'Connecting...' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/instances/:id/qr', (req, res) => {
  const instance = connections[req.params.id];
  if (!instance) return res.json({ qr: null, status: 'not_found' });
  res.json({ qr: instance.qr, qr_base64: instance.qrBase64, status: instance.status });
});

app.get('/instances/:id/status', (req, res) => {
  const instance = connections[req.params.id];
  if (!instance) return res.json({ status: 'disconnected', connected: false });
  res.json({
    status: instance.status,
    connected: instance.status === 'connected',
    user: instance.user,
    lastError: instance.lastError,
  });
});

// Return WhatsApp contacts (from internal Baileys store) so backend can offer
// "Import contacts" UX after a fresh connection. Best-effort: Baileys does not
// expose a guaranteed contacts API — we return whatever we cached.
app.get('/instances/:id/contacts', async (req, res) => {
  const instance = connections[req.params.id];
  if (!instance?.sock || instance.status !== 'connected') {
    return res.status(400).json({ contacts: [], error: 'Not connected' });
  }
  try {
    const store = instance.sock.store;
    const contacts = [];
    // Modern Baileys: contacts on sock itself
    const map = (instance.sock.contacts || (store && store.contacts) || {});
    for (const jid of Object.keys(map)) {
      if (!jid.endsWith('@s.whatsapp.net')) continue; // skip groups/broadcasts
      const c = map[jid] || {};
      contacts.push({
        phone: jid.split('@')[0],
        name: c.name || c.notify || c.verifiedName || '',
      });
    }
    res.json({ contacts });
  } catch (e) {
    res.status(500).json({ contacts: [], error: e.message });
  }
});

app.post('/instances/:id/send', async (req, res) => {
  const instance = connections[req.params.id];
  if (!instance?.sock || instance.status !== 'connected') {
    return res.status(400).json({ success: false, error: 'Not connected' });
  }
  const { phone, message } = req.body;
  try {
    // Resolve the correct JID using onWhatsApp() so WhatsApp accepts the
    // number as registered. This prevents "Aguardando mensagem..." (phantom
    // pre-key placeholder) and the Indonesia +62 mis-interpretation that
    // happens when we send to a malformed/unresolved JID.
    let targetJid = null;
    if (phone && !phone.includes('@')) {
      const candidates = [];
      const digits = String(phone).replace(/\D/g, '');
      // Primary: as provided (normalized Brazilian format)
      candidates.push(digits);
      // Fallback 1: remove leading 55 if present
      if (digits.startsWith('55') && digits.length >= 12) {
        candidates.push(digits.slice(2));
      }
      // Fallback 2: add 55 if not present
      if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
        candidates.push('55' + digits);
      }
      // Fallback 3: 12-digit BR missing the leading 5 (e.g. 5562XXXXXXXXX stripped)
      if (digits.length === 12 && digits.startsWith('62')) {
        candidates.push('55' + digits);
      }
      // Fallback 4: BR 9th digit variants — add/remove the mobile "9"
      if (digits.length === 13 && digits.startsWith('55')) {
        const withoutNine = digits.slice(0, 4) + digits.slice(5);
        candidates.push(withoutNine);
      } else if (digits.length === 12 && digits.startsWith('55')) {
        // Add the 9th digit after DDD
        candidates.push(digits.slice(0, 4) + '9' + digits.slice(4));
      }

      const seen = new Set();
      const uniqueCandidates = candidates.filter(c => {
        if (!c || seen.has(c)) return false;
        seen.add(c);
        return true;
      });

      for (const cand of uniqueCandidates) {
        try {
          const results = await instance.sock.onWhatsApp(cand);
          if (Array.isArray(results) && results.length > 0) {
            const hit = results.find(r => r?.exists) || results[0];
            if (hit?.jid) { targetJid = hit.jid; break; }
          }
        } catch (e) {
          console.warn(`[${req.params.id}] onWhatsApp failed for ${cand}:`, e.message);
        }
      }

      if (!targetJid) {
        // Last resort: use the first candidate with s.whatsapp.net (legacy behavior)
        targetJid = `${uniqueCandidates[0] || digits}@s.whatsapp.net`;
      }
    } else {
      targetJid = phone;
    }

    const payload = { text: message };
    const sent = await instance.sock.sendMessage(targetJid, payload);
    // Cache the original payload so getMessage() can satisfy WhatsApp retry
    // requests (otherwise some recipients receive an empty/blank message).
    if (sent?.key?.id) {
      rememberSent(targetJid, sent.key.id, sent.message || { conversation: message });
    }
    res.json({ success: true, jid: targetJid, message_id: sent?.key?.id });
  } catch (e) {
    console.error(`[${req.params.id}] send error:`, e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/instances/:id/disconnect', async (req, res) => {
  const instance = connections[req.params.id];
  if (!instance?.sock) return res.json({ status: 'already_disconnected' });
  try {
    await instance.sock.logout();
    instance.status = 'disconnected';
    delete connections[req.params.id];
    const authDir = path.join(AUTH_DIR, req.params.id);
    try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
    res.json({ status: 'disconnected' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/instances', (req, res) => {
  const list = Object.values(connections).map(c => ({
    id: c.id, status: c.status, connected: c.status === 'connected',
    user: c.user, hasQR: !!c.qr
  }));
  res.json(list);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', instances: Object.keys(connections).length });
});

app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Service running on port ${PORT}`);
});
