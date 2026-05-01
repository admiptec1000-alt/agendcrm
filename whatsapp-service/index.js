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

// CRITICAL: Baileys often throws async errors deep inside its internal retry
// logic (e.g. "Connection Closed" 428 while sending a retry request after a
// `No session record` decryption failure on @lid JIDs). Without these
// handlers the entire Node.js process crashes, which on Render triggers a
// full restart + wipes all connections in memory. Swallow them.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message || err, '\n  at:', err?.stack?.split('\n')[1]);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});

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

// ----------------------------------------------------------------------
// LID <-> Phone mapping (per-instance), persisted to disk.
//
// Background: WhatsApp Linked Devices (Web/Desktop/iPad) deliver messages
// with `@lid` JIDs that look like long random numbers (e.g. 250615737372785)
// and DO NOT correspond to the contact's real phone. Baileys is supposed to
// expose the real phone via `key.senderPn`, `key.participantPn`, contact
// `lid` mapping, etc — but in practice these are often empty, so each LID
// reply creates a duplicate ticket on the CRM side.
//
// Workaround: every time the operator successfully sends a message, the
// sendMessage result contains `key.remoteJid` — which is the LID Baileys
// will use for incoming replies from that contact. We persist a map
// { LID -> phone } so when an incoming arrives with @lid, we translate
// back to the real phone BEFORE forwarding to the backend webhook.
// Persisted to disk so the mapping survives restarts/redeploys.
// ----------------------------------------------------------------------
const lidMaps = {}; // instanceId -> { lid: phone }
function lidMapFile(instanceId) {
  return path.join(AUTH_DIR, instanceId, 'lid_phone_map.json');
}
function loadLidMap(instanceId) {
  if (lidMaps[instanceId]) return lidMaps[instanceId];
  try {
    const fp = lidMapFile(instanceId);
    if (fs.existsSync(fp)) lidMaps[instanceId] = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (_) {}
  if (!lidMaps[instanceId]) lidMaps[instanceId] = {};
  return lidMaps[instanceId];
}
function saveLidMap(instanceId) {
  try {
    const fp = lidMapFile(instanceId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(lidMaps[instanceId] || {}));
  } catch (e) { console.warn(`[${instanceId}] lid-map save fail: ${e.message}`); }
}
function rememberLidForPhone(instanceId, lid, phone) {
  if (!instanceId || !lid || !phone) return;
  if (!lid.endsWith('@lid')) return;
  const m = loadLidMap(instanceId);
  const lidKey = lid.replace('@lid', '');
  if (m[lidKey] === phone) return;
  m[lidKey] = phone;
  saveLidMap(instanceId);
}
function lookupPhoneForLid(instanceId, lid) {
  if (!instanceId || !lid) return null;
  const m = loadLidMap(instanceId);
  const lidKey = String(lid).replace('@lid', '').replace('@s.whatsapp.net', '');
  return m[lidKey] || null;
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
      const errMsg = lastDisconnect?.error?.message || 'Connection closed';
      const isConflict = errMsg.includes('conflict') || errMsg.includes('replaced') || statusCode === 440;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !isLoggedOut && !isConflict;
      instance.status = 'disconnected';
      instance.lastError = errMsg;
      console.log(`[${instanceId}] Disconnected: ${errMsg} (status=${statusCode})`);

      if (isConflict) {
        // Another session took over (user opened WhatsApp Web elsewhere, or
        // rapid reconnect caused duplicate socket). Reconnecting immediately
        // would fight the other session forever — wait longer and only retry
        // once. User should close other sessions first.
        console.log(`[${instanceId}] CONFLICT — waiting 60s before single retry (close other WhatsApp Web sessions!)`);
        setTimeout(() => {
          if (connections[instanceId]?.status === 'disconnected') {
            createConnection(instanceId).catch(e => console.error(`[${instanceId}] retry failed:`, e.message));
          }
        }, 60000);
      } else if (shouldReconnect) {
        console.log(`[${instanceId}] Reconnecting in 5s...`);
        setTimeout(() => {
          createConnection(instanceId).catch(e => console.error(`[${instanceId}] reconnect failed:`, e.message));
        }, 5000);
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

      // CRITICAL: Modern WhatsApp uses Linked Device IDs (@lid) for contact
      // identification that DO NOT match the phone number. If we just strip
      // "@lid" we end up with a random internal ID (e.g. 242158913192070)
      // that creates duplicate tickets. Try to resolve the real phone in
      // order of reliability:
      //   1) msg.key.senderPn          (Baileys 6.7+ provides it for @lid chats)
      //   2) msg.key.participantPn     (group-like fallback)
      //   3) msg.key.remoteJidAlt      (legacy alt jid)
      //   4) signalRepository LID->PN mapping (if available)
      //   5) onWhatsApp lookup using stripped LID (asks server)
      //   6) strip @lid as last resort (will still create duplicate)
      let realJid = remoteJid;
      let lidResolvedSource = null;  // for telemetry + auto-merge webhook
      if (remoteJid.endsWith('@lid')) {
        realJid = msg.key.senderPn
               || msg.key.participantPn
               || msg.key.remoteJidAlt
               || msg.key.participant
               || null;
        if (realJid) lidResolvedSource = 'baileys_key_field';
        if (!realJid) {
          try {
            const map = instance.sock?.signalRepository?.lidMapping;
            if (map?.getPNForLID) {
              realJid = await map.getPNForLID(remoteJid);
              if (realJid) lidResolvedSource = 'signal_repository';
            }
          } catch (_) {}
        }
        // Try store contacts (Baileys keeps a contact map populated by chat sync)
        if (!realJid) {
          try {
            const store = instance.sock?.store;
            const contacts = store?.contacts || {};
            const lidId = remoteJid.replace('@lid', '');
            for (const [jid, c] of Object.entries(contacts)) {
              if (c?.lid === remoteJid || c?.lid === lidId) { realJid = jid; lidResolvedSource = 'store_contacts'; break; }
            }
          } catch (_) {}
        }
        // Last-ditch resolution: our own persisted LID->phone map populated
        // every time the operator sent a message. Survives restarts and
        // doesn't depend on Baileys exposing the right field. Single most
        // reliable source for this user's setup.
        if (!realJid) {
          const phoneFromMap = lookupPhoneForLid(instanceId, remoteJid);
          if (phoneFromMap) {
            realJid = `${phoneFromMap}@s.whatsapp.net`;
            lidResolvedSource = 'persistent_map';
            console.log(`[${instanceId}] LID resolved via persistent map: ${remoteJid} -> ${phoneFromMap}`);
          }
        }
        if (!realJid) {
          // Detailed log so operator can inspect the payload format and
          // post the JSON in support if the LID still does not resolve.
          // Stripped to a single line for friendliness with Render log UI.
          try {
            const dbg = {
              remoteJid,
              keyKeys: Object.keys(msg.key || {}),
              senderPn: msg.key?.senderPn,
              participantPn: msg.key?.participantPn,
              remoteJidAlt: msg.key?.remoteJidAlt,
              participant: msg.key?.participant,
              fromMe: msg.key?.fromMe,
              pushName: msg.pushName,
            };
            console.warn(`[${instanceId}] UNRESOLVED_LID payload=${JSON.stringify(dbg)}`);
          } catch (_) {
            console.warn(`[${instanceId}] unresolved @lid: ${remoteJid}`);
          }
          realJid = remoteJid;
        }
      }

      const phone = realJid.replace(/@(s\.whatsapp\.net|lid|c\.us)$/, '');
      const pushName = msg.pushName || '';
      // Preserve the original LID JID (`XXX@lid`) in the webhook payload when
      // we could NOT resolve to a real phone. The backend stores it on the
      // ticket so the operator's outgoing message can be addressed via the
      // LID JID directly (the only thing WhatsApp will accept for hidden-
      // privacy contacts on their first message). When `lid_resolved_source`
      // is non-null, the LID was resolved successfully and `phone` is real.
      const incomingLidJid = remoteJid.endsWith('@lid') ? remoteJid : null;
      // If we DID resolve a LID -> phone in this call, also fire-and-forget
      // a `/webhook/lid-resolved` so the backend can promote any pending
      // ticket from the LID-only state to the real phone (auto-merge).
      if (incomingLidJid && lidResolvedSource && realJid !== remoteJid) {
        rememberLidForPhone(instanceId, incomingLidJid, phone);
        axios.post(`${FASTAPI_URL}/api/channels/webhook/lid-resolved`, {
          instance_id: instanceId,
          lid_jid: incomingLidJid,
          phone,
          source: lidResolvedSource,
        }, { timeout: 5000 }).catch(() => {});
      }

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
          lid_jid: incomingLidJid,  // null unless original was @lid
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

    // Persist LID <-> phone mapping for the @lid fallback in incoming.
    // The phone we just sent to is the SOURCE OF TRUTH; map every LID
    // representation we observe (the targetJid AND the JID baileys returned
    // on the sent message) back to the operator-provided phone.
    try {
      const realDigits = String(phone).replace(/\D/g, '');
      if (targetJid && targetJid.endsWith('@lid')) {
        rememberLidForPhone(req.params.id, targetJid, realDigits);
      }
      const sentJid = sent?.key?.remoteJid;
      if (sentJid && sentJid.endsWith('@lid')) {
        rememberLidForPhone(req.params.id, sentJid, realDigits);
      }
    } catch (_) {}

    // Reset to paused so the recipient does not see "typing" forever
    try { await instance.sock.sendPresenceUpdate('paused', targetJid); } catch (_) {}
    res.json({ success: true, jid: targetJid, message_id: sent?.key?.id });
  } catch (e) {
    console.error(`[${req.params.id}] send error:`, e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Send a media document (PDF, image, etc) as a WhatsApp attachment.
// Accepts payload as base64 in `data_base64` so the FastAPI backend doesn't
// need to host a public URL just to forward the bytes. Uses the same JID
// resolution as /send (onWhatsApp + Brazilian fallbacks) to avoid the +62
// mis-route bug.
app.post('/instances/:id/send-media', async (req, res) => {
  const instance = connections[req.params.id];
  if (!instance?.sock || instance.status !== 'connected') {
    return res.status(400).json({ success: false, error: 'Not connected' });
  }
  const { phone, filename, mimetype, data_base64, caption } = req.body;
  if (!phone || !data_base64) {
    return res.status(400).json({ success: false, error: 'Missing phone or data_base64' });
  }
  try {
    let targetJid = null;
    if (phone && !phone.includes('@')) {
      const candidates = [];
      const digits = String(phone).replace(/\D/g, '');
      candidates.push(digits);
      if (digits.startsWith('55') && digits.length >= 12) candidates.push(digits.slice(2));
      if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) candidates.push('55' + digits);
      if (digits.length === 12 && digits.startsWith('62')) candidates.push('55' + digits);
      if (digits.length === 13 && digits.startsWith('55')) candidates.push(digits.slice(0, 4) + digits.slice(5));
      else if (digits.length === 12 && digits.startsWith('55')) candidates.push(digits.slice(0, 4) + '9' + digits.slice(4));

      const seen = new Set();
      const uniq = candidates.filter(c => c && !seen.has(c) && seen.add(c));
      for (const cand of uniq) {
        try {
          const results = await instance.sock.onWhatsApp(cand);
          if (Array.isArray(results) && results.length > 0) {
            const hit = results.find(r => r?.exists) || results[0];
            if (hit?.jid) { targetJid = hit.jid; break; }
          }
        } catch (e) { /* try next */ }
      }
      if (!targetJid) targetJid = `${uniq[0] || digits}@s.whatsapp.net`;
    } else {
      targetJid = phone;
    }

    const buffer = Buffer.from(data_base64, 'base64');
    const isImage = (mimetype || '').startsWith('image/');
    const payload = isImage
      ? { image: buffer, caption: caption || '', mimetype: mimetype || 'image/png' }
      : {
          document: buffer,
          mimetype: mimetype || 'application/octet-stream',
          fileName: filename || 'file.bin',
          caption: caption || '',
        };

    try { await instance.sock.presenceSubscribe(targetJid); } catch (_) {}
    const sent = await instance.sock.sendMessage(targetJid, payload);
    if (sent?.key?.id) rememberSent(targetJid, sent.key.id, sent.message || {});
    // Persist LID -> phone mapping (see /send for rationale)
    try {
      const realDigits = String(phone).replace(/\D/g, '');
      if (targetJid && targetJid.endsWith('@lid')) rememberLidForPhone(req.params.id, targetJid, realDigits);
      const sentJid = sent?.key?.remoteJid;
      if (sentJid && sentJid.endsWith('@lid')) rememberLidForPhone(req.params.id, sentJid, realDigits);
    } catch (_) {}
    res.json({ success: true, jid: targetJid, message_id: sent?.key?.id, filename: filename || null });
  } catch (e) {
    console.error(`[${req.params.id}] send-media error:`, e.message, e.stack?.split('\n')[1]);
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
    version: 'v2.1.3',
  });
});

// Explicit version endpoint so backend can verify which patches are live
app.get('/version', (req, res) => {
  res.json({
    version: 'v2.1.3',
    built_at: '2026-04-30',
    features: {
      sent_message_store: true,       // anti blank message fix
      multi_message_types: true,      // captions, buttons, lists
      presence_forwarder: true,       // typing indicator
      ack_forwarder: true,            // read receipts (double check blue)
      contacts_endpoint: true,        // import contacts
      notify_and_append: true,        // both upsert types
      long_ts_coercion: true,         // Long -> Number
      jid_normalization: true,        // @s.whatsapp.net vs @lid
      crash_guard: true,              // uncaughtException handler (v2.1.1)
      conflict_backoff: true,         // slow retry on stream:error conflict (v2.1.1)
      lid_senderpn_resolver: true,    // resolve @lid via senderPn/participantPn/remoteJidAlt/lidMapping (v2.1.2)
      phone_shadow_fix: true,         // removed duplicate `const phone` that reverted realJid (v2.1.2)
      lid_jid_passthrough: true,      // pass original @lid JID in webhook for new-contact UX (v2.1.3)
      lid_resolved_webhook: true,     // notify backend when LID is resolved so tickets can auto-merge (v2.1.3)
    },
    fastapi_url: FASTAPI_URL,
  });
});

app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Service running on port ${PORT}`);
});
