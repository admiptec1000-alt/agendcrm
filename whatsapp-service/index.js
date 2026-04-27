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
// server resends an EMPTY message to the recipient — classic Baileys pitfall
// when getMessage returns {conversation:''}).
// We store by msgId alone AND by jid:msgId so retries succeed regardless of
// which JID format Baileys passes back (@s.whatsapp.net vs @lid).
const sentMessageStore = {};
const SENT_STORE_MAX = 1000;
function rememberSent(jid, msgId, message) {
  if (!msgId || !message) return;
  const keys = [msgId];
  if (jid) keys.push(`${jid}:${msgId}`);
  for (const k of keys) sentMessageStore[k] = message;
  const all = Object.keys(sentMessageStore);
  if (all.length > SENT_STORE_MAX) {
    // Evict oldest 100 entries to keep memory bounded
    for (let i = 0; i < 100 && i < all.length; i++) delete sentMessageStore[all[i]];
  }
}
function recallSent(jid, msgId) {
  if (!msgId) return null;
  return sentMessageStore[`${jid}:${msgId}`] || sentMessageStore[msgId] || null;
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

  // Forward presence updates (typing/recording) so the UI can show
  // "digitando..." and similar indicators in real time.
  sock.ev.on('presence.update', async ({ id, presences }) => {
    try {
      if (!id || id.endsWith('@g.us') || id === 'status@broadcast') return;
      const phone = id.replace('@s.whatsapp.net', '');
      const p = presences?.[id] || Object.values(presences || {})[0];
      if (!p) return;
      const presence = p.lastKnownPresence || 'available';
      await axios.post(`${FASTAPI_URL}/api/channels/webhook/presence`, {
        instance_id: instanceId, phone, presence,
      }, { timeout: 5000 }).catch(() => {});
    } catch (_) {}
  });

  // Forward read receipts / delivery acks (Baileys status numbers:
  // 1=error, 2=pending, 3=sent, 4=delivered, 5=read, 6=played)
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        const num = u.update?.status;
        if (num === undefined || num === null) continue;
        const map = { 1: 'failed', 2: 'pending', 3: 'sent', 4: 'delivered', 5: 'read', 6: 'played' };
        const status = map[num];
        if (!status) continue;
        await axios.post(`${FASTAPI_URL}/api/channels/webhook/message-status`, {
          instance_id: instanceId, message_id: u.key?.id, status,
        }, { timeout: 5000 }).catch(() => {});
      } catch (_) {}
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Capture both 'notify' (real-time push) and 'append' (background sync)
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const remoteJid = msg.key.remoteJid || '';
      // Skip groups and status broadcasts (focus on 1-on-1 DMs for CRM)
      if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) continue;

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

      const phone = remoteJid.replace(/@(s\.whatsapp\.net|lid|c\.us)$/, '');
      const pushName = msg.pushName || '';
      // Coerce Baileys Long timestamp into a plain int for JSON serialization
      let ts = msg.messageTimestamp;
      if (ts && typeof ts === 'object' && typeof ts.toNumber === 'function') ts = ts.toNumber();
      else if (typeof ts !== 'number') ts = Number(ts) || 0;

      try {
        const resp = await axios.post(`${FASTAPI_URL}/api/channels/webhook/message`, {
          instance_id: instanceId,
          phone,
          name: pushName,
          message: text,
          message_id: msg.key.id,
          timestamp: ts,
        }, { timeout: 10000 });
        console.log(`[${instanceId}] ✓ webhook sent phone=${phone} text="${text.slice(0, 40)}" -> ${resp.status}`);
      } catch (e) {
        console.error(`[${instanceId}] ✗ webhook FAILED (${FASTAPI_URL}): ${e.message} — check FASTAPI_URL env var on Render!`);
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

    // Pre-send: ensure we're presence-subscribed (idempotent in Baileys)
    try { await instance.sock.presenceSubscribe(targetJid); } catch (_) {}
    try { await instance.sock.sendPresenceUpdate('composing', targetJid); } catch (_) {}

    // disabling link preview avoids some WA edge cases where the server
    // rejects text-only messages for certain contacts ("aguardando...")
    const payload = { text: message, linkPreview: false };
    const sent = await instance.sock.sendMessage(targetJid, payload);
    if (sent?.key?.id) {
      rememberSent(targetJid, sent.key.id, sent.message || { conversation: message });
    }
    // Reset to paused so the recipient does not see "typing" forever
    try { await instance.sock.sendPresenceUpdate('paused', targetJid); } catch (_) {}
    res.json({ success: true, jid: targetJid, message_id: sent?.key?.id });
  } catch (e) {
    console.error(`[${req.params.id}] send error:`, e.message, e.stack?.split('\n')[1]);
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
  res.json({
    status: 'ok',
    instances: Object.keys(connections).length,
    version: 'v2.1.0',
  });
});

// Explicit version endpoint so backend can verify which patches are live
app.get('/version', (req, res) => {
  res.json({
    version: 'v2.1.0',
    built_at: '2026-04-27',
    features: {
      sent_message_store: true,       // anti blank message fix
      multi_message_types: true,      // captions, buttons, lists
      presence_forwarder: true,       // typing indicator
      ack_forwarder: true,            // read receipts (double check blue)
      contacts_endpoint: true,        // import contacts
      notify_and_append: true,        // both upsert types
      long_ts_coercion: true,         // Long -> Number
      jid_normalization: true,        // @s.whatsapp.net vs @lid
    },
    fastapi_url: FASTAPI_URL,
  });
});

app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Service running on port ${PORT}`);
});
