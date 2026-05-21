const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

// Audio conversion to OGG/Opus — required for WhatsApp PTT bubbles to play
// on the destination phone. MediaRecorder in Chrome/Firefox produces
// webm/opus (or audio/webm), and WhatsApp can't decode that even when we
// label it as audio/ogg. ffmpeg-static bundles the ffmpeg binary so this
// works on Render without a system ffmpeg install.
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

function convertToOggOpus(inputBuffer) {
  return new Promise((resolve, reject) => {
    const { Readable, PassThrough } = require('stream');
    const inputStream = Readable.from(inputBuffer);
    const outChunks = [];
    const out = new PassThrough();
    out.on('data', (c) => outChunks.push(c));
    out.on('end', () => resolve(Buffer.concat(outChunks)));
    out.on('error', reject);
    ffmpeg(inputStream)
      .audioCodec('libopus')
      .audioBitrate('48k')
      .audioChannels(1)
      .audioFrequency(48000)
      .format('ogg')
      .on('error', reject)
      .pipe(out, { end: true });
  });
}

const app = express();
app.use(cors());
// Generous body-size limits — quote PDFs with letterhead images can
// easily reach 5-15 MB after base64 encoding. Express default of 100KB
// was rejecting them with "413 Payload Too Large".
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
//
// PERSISTENCE: previously we kept this on the local disk (`sent-cache.json`)
// but in production the WhatsApp service runs on a host with ephemeral
// storage (Render/Heroku-style) — every deploy wiped the cache and any
// retry that arrived right after lost the original payload, producing the
// "Aguardando mensagem" placeholder on the recipient's phone. We now
// asynchronously POST every send to the FASTAPI backend, which persists
// it to MongoDB with a 24h TTL. On `getMessage` miss we GET back from the
// backend before returning the empty fallback.
const sentMessageStore = {};
// Map<jid, timestamp> — last successful sendMessage per JID. Used by the
// assertSessions stale-detection heuristic (2026-02-15 (G2)). When a JID
// hasn't been talked to in >12h, we proactively re-fetch the prekey bundle
// to avoid the "Aguardando mensagem" placeholder caused by stale sessions.
const jidLastSentAt = new Map();
const JID_LAST_SENT_MAX = 5000;  // cap memory; evict oldest if exceeded
const SENT_STORE_MAX = 2000;

async function persistSentToBackend(jid, msgId, message) {
  try {
    await axios.post(
      `${FASTAPI_URL}/api/internal/wa-cache/sent`,
      { jid, msg_id: msgId, message },
      { timeout: 5000, headers: { 'X-Internal-Token': process.env.INTERNAL_TOKEN || 'agentcrm-internal' } },
    );
  } catch (e) {
    // Backend down or net glitch — we still have the in-memory copy, so
    // this is best-effort. Only the post-deploy retry window is at risk.
    if (e.response?.status !== 404) {
      console.warn('[sent-cache] backend persist failed:', e.message);
    }
  }
}

async function fetchSentFromBackend(jid, msgId) {
  try {
    const r = await axios.get(
      `${FASTAPI_URL}/api/internal/wa-cache/sent`,
      {
        params: { jid, msg_id: msgId },
        timeout: 5000,
        headers: { 'X-Internal-Token': process.env.INTERNAL_TOKEN || 'agentcrm-internal' },
      },
    );
    return r.data?.message || null;
  } catch (_) {
    return null;
  }
}

function rememberSent(jid, msgId, message) {
  if (!msgId || !message) return;
  const keys = [msgId];
  if (jid) keys.push(`${jid}:${msgId}`);
  for (const k of keys) sentMessageStore[k] = message;
  // Fire-and-forget MongoDB persistence (does not block the send path).
  persistSentToBackend(jid, msgId, message);
  const all = Object.keys(sentMessageStore);
  if (all.length > SENT_STORE_MAX) {
    // Evict oldest 200 entries to keep memory bounded
    for (let i = 0; i < 200 && i < all.length; i++) delete sentMessageStore[all[i]];
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

// ----------------------------------------------------------------------
// Pending LID queue + periodic background resolver.
//
// When a brand-new contact (privacy-on) sends the first message, NONE of
// the synchronous resolution sources work — Baileys hasn't synced the
// contact yet. We register the LID in `pendingLids` and a background job
// retries every 30s, calling `sock.onWhatsApp(lidJid)` and
// `signalRepository.lidMapping.getPNForLID(lidJid)`. The moment it
// resolves, we fire `/api/channels/webhook/lid-resolved` which auto-
// promotes/merges the ticket on the backend side. Removes the manual
// "Informar telefone" friction reported by the user.
//
// pendingLids[instanceId] = { 'XXX@lid': { addedAt, attempts, lastAttempt } }
// ----------------------------------------------------------------------
const pendingLids = {};
function queueLid(instanceId, lidJid) {
  if (!instanceId || !lidJid || !lidJid.endsWith('@lid')) return;
  if (!pendingLids[instanceId]) pendingLids[instanceId] = {};
  if (pendingLids[instanceId][lidJid]) return;
  pendingLids[instanceId][lidJid] = { addedAt: Date.now(), attempts: 0, lastAttempt: 0 };
}
function unqueueLid(instanceId, lidJid) {
  if (pendingLids[instanceId]) delete pendingLids[instanceId][lidJid];
}

async function tryResolveLid(instance, instanceId, lidJid) {
  // Run all resolution strategies in order — return real-phone digits or null.
  // Order is from CHEAPEST (cache) to MOST EXPENSIVE (server roundtrips).
  const sock = instance?.sock;
  if (!sock || instance.status !== 'connected') return null;

  // 1. Cached map (operator already sent a message that mapped LID -> phone)
  let resolved = lookupPhoneForLid(instanceId, lidJid);
  if (resolved) return { phone: resolved, source: 'persistent_map' };

  // 2. signalRepository.lidMapping.getPNForLID  (Baileys 6.7+ async API)
  try {
    const map = sock.signalRepository?.lidMapping;
    if (map?.getPNForLID) {
      const pnJid = await map.getPNForLID(lidJid);
      if (pnJid && typeof pnJid === 'string') {
        const digits = pnJid.replace(/@(s\.whatsapp\.net|lid|c\.us)$/, '');
        if (digits && digits !== lidJid.replace('@lid','')) {
          rememberLidForPhone(instanceId, lidJid, digits);
          return { phone: digits, source: 'signal_repository' };
        }
      }
    }
  } catch (_) {}

  // 3. onWhatsApp probe — asks the WA server directly. Sometimes returns
  //    a `jid` field with the @s.whatsapp.net address even for opaque LIDs.
  try {
    const result = await sock.onWhatsApp(lidJid);
    if (Array.isArray(result)) {
      for (const r of result) {
        const candidateJid = r?.jid || r?.lid;
        if (candidateJid && candidateJid.endsWith('@s.whatsapp.net')) {
          const digits = candidateJid.replace('@s.whatsapp.net', '');
          rememberLidForPhone(instanceId, lidJid, digits);
          return { phone: digits, source: 'onWhatsApp_probe' };
        }
      }
    }
  } catch (_) {}

  // 4. profilePictureUrl probe — touching the contact often forces the
  //    WhatsApp server to push a roster sync (which populates senderPn on
  //    the next incoming) and may leak the real JID via a redirect.
  try {
    await sock.profilePictureUrl(lidJid, 'image').catch(() => null);
  } catch (_) {}

  // 5. fetchStatus probe — same effect as profilePictureUrl: triggers a
  //    contact resolution roundtrip on the server side.
  try {
    await sock.fetchStatus(lidJid).catch(() => null);
  } catch (_) {}

  // 6. getBusinessProfile — for business accounts the response carries
  //    the verified phone number even when the standard JID is opaque.
  try {
    const profile = await sock.getBusinessProfile?.(lidJid);
    if (profile && (profile.wid || profile.jid)) {
      const candidate = (profile.wid || profile.jid).toString();
      if (candidate.endsWith('@s.whatsapp.net')) {
        const digits = candidate.replace('@s.whatsapp.net', '');
        rememberLidForPhone(instanceId, lidJid, digits);
        return { phone: digits, source: 'business_profile' };
      }
    }
  } catch (_) {}

  // 7. store.contacts cross-reference (after the probes above, the store
  //    may have been populated with the new contact)
  try {
    const contacts = sock.contacts || sock.store?.contacts || {};
    for (const [jid, c] of Object.entries(contacts)) {
      if (jid.endsWith('@s.whatsapp.net') && (c?.lid === lidJid || c?.id === lidJid)) {
        const digits = jid.replace('@s.whatsapp.net', '');
        rememberLidForPhone(instanceId, lidJid, digits);
        return { phone: digits, source: 'store_contacts' };
      }
    }
  } catch (_) {}

  // 8. Last try: signalRepository.lidMapping AGAIN after the probes —
  //    often the cache was populated by the side effects above.
  try {
    const map = sock.signalRepository?.lidMapping;
    if (map?.getPNForLID) {
      const pnJid = await map.getPNForLID(lidJid);
      if (pnJid && typeof pnJid === 'string') {
        const digits = pnJid.replace(/@(s\.whatsapp\.net|lid|c\.us)$/, '');
        if (digits && digits !== lidJid.replace('@lid','')) {
          rememberLidForPhone(instanceId, lidJid, digits);
          return { phone: digits, source: 'signal_repository_after_probe' };
        }
      }
    }
  } catch (_) {}

  return null;
}

async function notifyBackendLidResolved(instanceId, lidJid, phone, source) {
  try {
    await axios.post(`${FASTAPI_URL}/api/channels/webhook/lid-resolved`, {
      instance_id: instanceId,
      lid_jid: lidJid,
      phone,
      source,
    }, { timeout: 5000 });
    console.log(`[${instanceId}] LID ${lidJid} -> ${phone} (via ${source}) - backend notified`);
  } catch (e) {
    console.warn(`[${instanceId}] notify backend lid-resolved failed: ${e.message}`);
  }
}

// Background sweep: every 30s, retry pending LIDs on each connected instance.
// Stop trying after 30 attempts (~15min) to avoid forever-pending entries
// for LIDs that WhatsApp will never expose.
setInterval(async () => {
  for (const [instanceId, pending] of Object.entries(pendingLids)) {
    const inst = connections[instanceId];
    if (!inst || inst.status !== 'connected') continue;
    for (const [lidJid, meta] of Object.entries(pending)) {
      meta.attempts += 1;
      meta.lastAttempt = Date.now();
      if (meta.attempts > 30) { delete pending[lidJid]; continue; }
      const result = await tryResolveLid(inst, instanceId, lidJid);
      if (result?.phone) {
        unqueueLid(instanceId, lidJid);
        notifyBackendLidResolved(instanceId, lidJid, result.phone, `bg_retry_${result.source}`);
      }
    }
  }
}, 30000);

// ── Connection watchdog ─────────────────────────────────────────────────────
// Every 90s, sweep every instance flagged as 'connected' and verify the
// underlying WebSocket is actually alive. Sometimes Baileys' internal
// keepalive misses a TCP-level FIN (e.g. proxy/CDN silently drops the
// connection) and we end up holding a "zombie" socket — status=connected
// but no messages flow through. The user sees: "WhatsApp ligado, mas o
// fluxo parou de responder". This watchdog detects that and forces a
// fresh reconnect.
//
// Strategy:
//   1. Check sock.ws.readyState (1 = OPEN). If not OPEN -> reconnect.
//   2. If no inbound activity for 5+ minutes, send a no-op presence
//      subscribe to ourselves. If that throws -> reconnect.
const ACTIVITY_STALE_MS = 5 * 60 * 1000;    // 5 minutes of silence
const WATCHDOG_INTERVAL_MS = 90 * 1000;     // sweep every 90s
setInterval(async () => {
  for (const [instanceId, inst] of Object.entries(connections)) {
    if (!inst || inst.status !== 'connected' || !inst.sock) continue;
    const sock = inst.sock;
    // 1) Hard liveness check — WebSocket layer
    try {
      const readyState = sock.ws?.readyState ?? sock.ws?.socket?.readyState;
      if (readyState !== undefined && readyState !== 1) {
        console.warn(`[${instanceId}] watchdog: ws.readyState=${readyState} (not OPEN) — forcing reconnect`);
        inst.status = 'disconnected';
        inst.lastError = 'watchdog: zombie socket';
        createConnection(instanceId).catch(e => console.error(`[${instanceId}] watchdog reconnect failed:`, e.message));
        continue;
      }
    } catch (e) { /* ignore */ }

    // 2) Soft liveness check — only if we haven't seen any inbound activity
    // for a while, ping ourselves with a presence subscribe. Cheap operation
    // that exercises the encrypted send path.
    const idle = Date.now() - (inst.lastActivityAt || 0);
    if (idle > ACTIVITY_STALE_MS) {
      try {
        const selfJid = sock.user?.id;
        if (selfJid && typeof sock.sendPresenceUpdate === 'function') {
          await sock.sendPresenceUpdate('available');
          inst.lastActivityAt = Date.now();
        }
      } catch (e) {
        console.warn(`[${instanceId}] watchdog: presence-ping failed (${e.message}) — forcing reconnect`);
        inst.status = 'disconnected';
        inst.lastError = `watchdog ping: ${e.message}`;
        createConnection(instanceId).catch(err => console.error(`[${instanceId}] watchdog reconnect failed:`, err.message));
      }
    }
  }
}, WATCHDOG_INTERVAL_MS);

// Ensure auth directory
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function createConnection(instanceId) {
  const authDir = path.join(AUTH_DIR, instanceId);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  // ── Cleanup any prior socket for this instance BEFORE creating a new one.
  // Without this, every reconnect leaves the previous socket's event
  // listeners alive in memory (messages.upsert fires twice, presence.update
  // double-forwards, etc.) and slowly eats RAM until the worker is OOM-killed
  // by Render — which the user perceives as "fluxos param".
  const existingInstance = connections[instanceId];
  const previousAttempts = existingInstance?.reconnectAttempts || 0;
  if (existingInstance?.sock) {
    try {
      existingInstance.sock.ev.removeAllListeners?.();
      if (typeof existingInstance.sock.end === 'function') {
        existingInstance.sock.end(undefined);
      } else if (typeof existingInstance.sock.ws?.close === 'function') {
        existingInstance.sock.ws.close();
      }
    } catch (e) {
      console.warn(`[${instanceId}] old-socket cleanup warn: ${e.message}`);
    }
  }

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
    // outbound payload we cached at send-time. If not in memory (e.g.
    // service was redeployed since the original send), we fall through to
    // the backend cache (MongoDB) before giving up. Returning
    // `{conversation:''}` is what produces the "Aguardando mensagem"
    // placeholder on the recipient's phone — so we treat it as a hard
    // last-resort.
    getMessage: async (key) => {
      const cached = recallSent(key?.remoteJid, key?.id);
      if (cached) return cached;
      // Backend fallback (Mongo-backed, survives deploys)
      const fromBackend = await fetchSentFromBackend(key?.remoteJid, key?.id);
      if (fromBackend) {
        // Repopulate the local cache so subsequent retries don't pay the
        // network round-trip.
        sentMessageStore[key?.id] = fromBackend;
        if (key?.remoteJid) sentMessageStore[`${key.remoteJid}:${key.id}`] = fromBackend;
        return fromBackend;
      }
      console.warn(`[getMessage] cache miss jid=${key?.remoteJid} id=${key?.id} — returning empty conversation (recipient may see Aguardando)`);
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
    reconnectAttempts: previousAttempts,
    lastActivityAt: Date.now(),
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
        // Exponential backoff: 5s, 10s, 20s, 40s, 80s, 160s, capped at 5min.
        // This prevents hammering WA servers when they are throttling us
        // (which would otherwise cause IP-level bans).
        instance.reconnectAttempts = (instance.reconnectAttempts || 0) + 1;
        const attempt = instance.reconnectAttempts;
        const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 5 * 60 * 1000);
        console.log(`[${instanceId}] Reconnecting (attempt #${attempt}) in ${Math.round(delayMs / 1000)}s...`);
        setTimeout(() => {
          // Verify the instance was not explicitly disconnected by an
          // operator in the meantime (DELETE /instances/:id sets to undefined).
          if (connections[instanceId] && connections[instanceId].status !== 'connected') {
            createConnection(instanceId).catch(e => console.error(`[${instanceId}] reconnect failed:`, e.message));
          }
        }, delayMs);
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
      instance.reconnectAttempts = 0;  // reset backoff after a healthy connect
      instance.lastActivityAt = Date.now();
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
    instance.lastActivityAt = Date.now();
    for (const msg of messages) {
      // fromMe === true means the operator sent this message from the
      // linked device (cellphone WhatsApp app, WhatsApp Web, etc). We
      // MUST forward these so the system reflects the same conversation
      // state as the phone. The webhook handler stores them as outgoing.
      const fromMe = !!msg.key.fromMe;
      const remoteJid = msg.key.remoteJid || '';
      const isGroup = remoteJid.endsWith('@g.us');
      // Skip status broadcasts and newsletters; groups are forwarded so the
      // backend can decide (per-company setting) whether to surface them.
      if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) continue;

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
      let lidResolvedSource = null;
      let groupJid = null;
      let groupSubject = null;
      if (isGroup) {
        // For group messages, remoteJid is the GROUP jid; the sender is in
        // `participant`. We surface group conversations to the backend as a
        // separate ticket type (channel=whatsapp_group).
        groupJid = remoteJid;
        const partJid = msg.key.participant || msg.key.participantPn || '';
        realJid = partJid || remoteJid;
        try {
          const meta = await instance.groupMetadata(groupJid);
          groupSubject = meta?.subject || null;
        } catch (e) { /* best-effort */ }
      } else if (remoteJid.endsWith('@lid')) {
        // Try Baileys' built-in fields first (these are SYNCHRONOUS / free)
        realJid = msg.key.senderPn
               || msg.key.participantPn
               || msg.key.remoteJidAlt
               || msg.key.participant
               || null;
        if (realJid) lidResolvedSource = 'baileys_key_field';
        // Fall back to the multi-strategy resolver (cache, signal_repository,
        // onWhatsApp probe, store contacts). Returns null if NOTHING worked.
        if (!realJid) {
          const r = await tryResolveLid(instance, instanceId, remoteJid);
          if (r?.phone) {
            realJid = `${r.phone}@s.whatsapp.net`;
            lidResolvedSource = r.source;
          }
        }
        if (!realJid) {
          // STILL unresolved on first arrival — register the LID for the
          // background retry loop. Many LIDs only resolve after a few
          // exchanges (Baileys lazily syncs the contact record). We'll keep
          // probing every 30s and notify the backend the moment WA exposes
          // the real PN.
          queueLid(instanceId, remoteJid);
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
            console.warn(`[${instanceId}] UNRESOLVED_LID payload=${JSON.stringify(dbg)} — queued for bg retry`);
          } catch (_) {
            console.warn(`[${instanceId}] unresolved @lid: ${remoteJid} — queued for bg retry`);
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
      let mediaKind = null;
      let mediaMimetype = null;
      let mediaFilename = null;
      if (!text) {
        if (m.imageMessage) { text = '[Imagem]'; mediaKind = 'image'; mediaMimetype = m.imageMessage.mimetype; }
        else if (m.videoMessage) { text = '[Video]'; mediaKind = 'video'; mediaMimetype = m.videoMessage.mimetype; }
        else if (m.audioMessage) { text = '[Audio]'; mediaKind = 'audio'; mediaMimetype = m.audioMessage.mimetype; }
        else if (m.stickerMessage) { text = '[Figurinha]'; mediaKind = 'sticker'; mediaMimetype = m.stickerMessage.mimetype; }
        else if (m.documentMessage) {
          text = `[Documento] ${m.documentMessage.fileName || ''}`.trim();
          mediaKind = 'document';
          mediaMimetype = m.documentMessage.mimetype;
          mediaFilename = m.documentMessage.fileName || null;
        }
        else if (m.locationMessage) text = '[Localizacao]';
        else if (m.contactMessage) text = `[Contato] ${m.contactMessage.displayName || ''}`.trim();
      } else {
        // Caption case — also tag the kind so the frontend can render an
        // inline player / thumbnail alongside the caption text.
        if (m.imageMessage) { mediaKind = 'image'; mediaMimetype = m.imageMessage.mimetype; }
        else if (m.videoMessage) { mediaKind = 'video'; mediaMimetype = m.videoMessage.mimetype; }
        else if (m.documentMessage) {
          mediaKind = 'document';
          mediaMimetype = m.documentMessage.mimetype;
          mediaFilename = m.documentMessage.fileName || null;
        }
      }
      if (!text) continue;

      // Download media bytes when present so the agent can actually play /
      // view it in the chat (WhatsApp encrypts media; Baileys handles the
      // decryption transparently via downloadMediaMessage). Size-capped at
      // 15 MB to protect the webhook round-trip; larger files keep the text
      // placeholder but skip the base64 payload.
      let mediaB64 = null;
      if (mediaKind && mediaKind !== 'sticker') {
        try {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          if (buf && buf.length && buf.length <= 15 * 1024 * 1024) {
            mediaB64 = buf.toString('base64');
          } else if (buf) {
            console.log(`[${instanceId}] media too large (${buf.length} bytes), skipping download`);
          }
        } catch (e) {
          console.error(`[${instanceId}] media download failed for ${mediaKind}: ${e.message}`);
        }
      }

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
          media_kind: mediaKind,
          media_mimetype: mediaMimetype,
          media_filename: mediaFilename,
          media_base64: mediaB64,
          from_me: fromMe,  // true when operator sent it from the linked phone
          is_group: isGroup,
          group_jid: groupJid,
          group_subject: groupSubject,
        }, { timeout: 30000, maxBodyLength: 50 * 1024 * 1024, maxContentLength: 50 * 1024 * 1024 });
        console.log(`[${instanceId}] ✓ webhook sent phone=${phone} ${fromMe ? '[FROM_ME]' : '[IN]'} text="${text.slice(0, 40)}"${mediaKind ? ' media='+mediaKind : ''} -> ${resp.status}`);
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

    // CRITICAL: force a pre-key bundle exchange BEFORE the first sendMessage
    // to a brand-new contact. Without this, the recipient's WhatsApp shows
    // "Aguardando mensagem. Essa ação pode levar alguns instantes." (the
    // pre-key ciphertext arrived but the keys weren't yet established).
    // 2026-02-15 (G2) — Two-stage approach:
    //   1. Try force=false (cheap, idempotent — preserves existing session)
    //   2. If it throws OR the JID has not been talked to in >12h (probable
    //      stale session), retry with force=true to refetch the prekey
    //      bundle and rebuild the session. This catches the recurring
    //      "Aguardando mensagem" bug reported on production where the
    //      recipient opens a long-stale chat — the session our side has
    //      is technically valid but the recipient's device rotated keys.
    const lastSeen = jidLastSentAt.get(targetJid);
    const isStale = !lastSeen || (Date.now() - lastSeen) > (12 * 60 * 60 * 1000); // 12h
    try {
      await instance.sock.assertSessions([targetJid], false);
      if (isStale) {
        // Force re-bundle on stale contacts. WA rarely rate-limits this.
        try {
          await instance.sock.assertSessions([targetJid], true);
          console.log(`[${req.params.id}] [STALE FIX] force-assertSessions ok for ${targetJid} (idle=${lastSeen ? Math.round((Date.now() - lastSeen) / 1000 / 60) + 'min' : 'never'})`);
        } catch (e2) {
          console.warn(`[${req.params.id}] [STALE FIX] force-assertSessions retry failed for ${targetJid}:`, e2.message);
        }
      }
    } catch (e) {
      console.warn(`[${req.params.id}] assertSessions failed for ${targetJid} (force=false):`, e.message);
      // Fallback: force=true. Worth the round-trip if the soft one threw.
      try { await instance.sock.assertSessions([targetJid], true); }
      catch (e2) { console.warn(`[${req.params.id}] force-assertSessions also failed:`, e2.message); }
    }

    // disabling link preview avoids some WA edge cases where the server
    // rejects text-only messages for certain contacts ("aguardando...")
    const payload = { text: message, linkPreview: false };
    const sent = await instance.sock.sendMessage(targetJid, payload);
    if (sent?.key?.id) {
      // ALWAYS cache the original conversation text — the {conversation:
      // message} fallback is what saves us when the WA server later asks
      // Baileys (via `getMessage`) to resend after a decryption failure on
      // the recipient. If the cache is empty there, the recipient ends up
      // stuck on the "Aguardando mensagem" placeholder forever.
      rememberSent(targetJid, sent.key.id, { conversation: message });
      // Track last-sent timestamp for the stale-detection heuristic in
      // assertSessions (2026-02-15 (G2)).
      jidLastSentAt.set(targetJid, Date.now());
      if (jidLastSentAt.size > JID_LAST_SENT_MAX) {
        // Evict the oldest entries — Map preserves insertion order so
        // delete from .keys() iterator (oldest first).
        const overflow = jidLastSentAt.size - JID_LAST_SENT_MAX;
        const it = jidLastSentAt.keys();
        for (let i = 0; i < overflow; i++) jidLastSentAt.delete(it.next().value);
      }
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

// Send an interactive message — either buttons (≤3) or a list (sections w/ rows).
// Baileys supports both via `templateMessage` (buttons) and `listMessage` (list).
//
// Body:
//   {
//     phone: "5511999...",
//     mode: "buttons" | "list",         // required
//     header: "Selecione um contrato:", // optional header text
//     body: "Texto principal",           // main message body
//     footer: "Suporte 8ip",             // optional footer
//     // For buttons (max 3):
//     buttons: [{ id, title }],
//     // For list:
//     button_label: "Ver opções",        // CTA text on the list expander
//     sections: [{ title, rows: [{ id, title, description }] }],
//   }
app.post('/instances/:id/send-interactive', async (req, res) => {
  const instance = connections[req.params.id];
  if (!instance?.sock || instance.status !== 'connected') {
    return res.status(503).json({ success: false, error: 'instance not connected' });
  }
  try {
    const { phone, mode, header, body, footer, buttons, button_label, sections } = req.body;
    const targetJid = `${(phone || '').replace(/\D/g, '')}@s.whatsapp.net`;
    let payload;
    if (mode === 'buttons') {
      const list = (buttons || []).slice(0, 3).map(b => ({
        buttonId: String(b.id || b.value || b.title).slice(0, 256),
        buttonText: { displayText: String(b.title || b.label || b.id).slice(0, 20) },
        type: 1,
      }));
      payload = {
        text: body || '',
        footer: footer || '',
        buttons: list,
        headerType: 1,
      };
    } else if (mode === 'list') {
      payload = {
        text: body || '',
        footer: footer || '',
        title: header || '',
        buttonText: (button_label || 'Selecionar').slice(0, 20),
        sections: (sections || []).map(s => ({
          title: String(s.title || '').slice(0, 24),
          rows: (s.rows || []).slice(0, 10).map(r => ({
            rowId: String(r.id || r.value).slice(0, 256),
            title: String(r.title || r.label).slice(0, 24),
            description: r.description ? String(r.description).slice(0, 72) : undefined,
          })),
        })),
      };
    } else {
      return res.status(400).json({ success: false, error: 'mode must be "buttons" or "list"' });
    }
    const sent = await instance.sock.sendMessage(targetJid, payload);
    res.json({ success: true, jid: targetJid, message_id: sent?.key?.id });
  } catch (e) {
    console.error(`[${req.params.id}] send-interactive error:`, e.message);
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
    const isAudio = (mimetype || '').startsWith('audio/');
    const isVideo = (mimetype || '').startsWith('video/');
    let payload;
    if (isImage) {
      payload = { image: buffer, caption: caption || '', mimetype: mimetype || 'image/png' };
    } else if (isAudio) {
      // Force the audio bytes into OGG/Opus before forwarding to WA.
      // Without this, MediaRecorder-produced webm/opus blobs are
      // rejected by the receiving phone with "audio not available".
      let audioBuf = buffer;
      try {
        audioBuf = await convertToOggOpus(buffer);
      } catch (convErr) {
        console.error(`[${req.params.id}] audio convert failed, sending raw:`, convErr.message);
      }
      payload = { audio: audioBuf, mimetype: 'audio/ogg; codecs=opus', ptt: true };
    } else if (isVideo) {
      payload = { video: buffer, caption: caption || '', mimetype: mimetype || 'video/mp4' };
    } else {
      payload = {
        document: buffer,
        mimetype: mimetype || 'application/octet-stream',
        fileName: filename || 'file.bin',
        caption: caption || '',
      };
    }

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



// On-demand LID resolution probe. Called by the backend (typically from the
// "Tentar resolver agora" button on the LID-pending banner) when the
// operator wants to force one more attempt without waiting for the 30s
// background sweep. Returns {resolved: bool, phone, source} so the UI can
// show a useful toast.
app.post('/instances/:id/resolve-lid', async (req, res) => {
  const instance = connections[req.params.id];
  if (!instance?.sock || instance.status !== 'connected') {
    return res.status(400).json({ resolved: false, error: 'Not connected' });
  }
  let { lid_jid } = req.body || {};
  if (!lid_jid) return res.status(400).json({ resolved: false, error: 'lid_jid required' });
  if (!lid_jid.endsWith('@lid')) lid_jid = lid_jid + '@lid';
  try {
    const r = await tryResolveLid(instance, req.params.id, lid_jid);
    if (r?.phone) {
      // Notify backend so the ticket auto-merges using existing logic
      notifyBackendLidResolved(req.params.id, lid_jid, r.phone, `manual_probe_${r.source}`);
      return res.json({ resolved: true, phone: r.phone, source: r.source });
    }
    return res.json({ resolved: false, error: 'WhatsApp ainda nao expoe o numero real desse contato. Tente novamente apos uma resposta dele.' });
  } catch (e) {
    res.status(500).json({ resolved: false, error: e.message });
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

// 2026-02-16 (Q) — Soft restart: close the WebSocket and recreate the socket
// from the SAME on-disk auth (multi-file auth state). Unlike /disconnect,
// this DOES NOT delete the auth folder, so the user does NOT need to
// re-scan the QR. Used by:
//   - Backend's auto-detection of zombie sockets after N consecutive send
//     failures (flow_engine._bump_send_failure).
//   - Manual button "Forcar reconexao" in the operator UI.
app.post('/instances/:id/restart', async (req, res) => {
  const id = req.params.id;
  const instance = connections[id];
  if (instance && instance.sock) {
    try {
      // Best-effort close — ignore errors; we just want to drop the socket.
      try { instance.sock.ws?.close?.(); } catch (_) {}
      try { instance.sock.end?.(new Error('manual_restart')); } catch (_) {}
    } catch (_) {}
  }
  // Wipe the in-memory entry but keep AUTH_DIR/<id> intact.
  delete connections[id];
  try {
    // createConnection is the same helper used by the /connect endpoint —
    // it reads the persisted auth and re-creates the Baileys socket.
    await createConnection(id);
    return res.json({ status: 'restarted' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
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
    version: 'v2.1.11',
    details: Object.values(connections).map(c => ({
      id: c.id,
      status: c.status,
      reconnect_attempts: c.reconnectAttempts || 0,
      idle_ms: c.lastActivityAt ? Date.now() - c.lastActivityAt : null,
    })),
  });
});

// Explicit version endpoint so backend can verify which patches are live
app.get('/version', (req, res) => {
  res.json({
    version: 'v2.1.11',
    built_at: '2026-02-16',
    features: {
      sent_message_store: true,       // anti blank message fix
      multi_message_types: true,      // captions, buttons, lists
      presence_forwarder: true,       // typing indicator
      ack_forwarder: true,            // read receipts (double check blue)
      contacts_endpoint: true,        // import contacts
      notify_and_append: true,        // both upsert types
      long_ts_coercion: true,         // Long -> Number
      jid_normalization: true,        // @s.whatsapp.net vs @lid
      soft_restart: true,             // /restart endpoint (2026-02-16 Q)
      crash_guard: true,
      conflict_backoff: true,
      lid_senderpn_resolver: true,
      phone_shadow_fix: true,
      lid_jid_passthrough: true,
      lid_resolved_webhook: true,
      lid_active_resolver: true,
      lid_background_retry: true,
      lid_manual_probe_endpoint: true,
      lid_baileys_upgrade_6_7_21: true,
      lid_extra_probes_business_status: true,
      lid_double_signal_lookup: true,
      reconnect_exponential_backoff: true,
      old_socket_cleanup: true,
      zombie_socket_watchdog: true,
      stale_session_force_assert: true,        // v2.1.10 — re-bundle prekey for JIDs idle >12h
      sent_cache_ttl_7d: true,                 // v2.1.10 — backend cache TTL 24h -> 7d
    },
    fastapi_url: FASTAPI_URL,
  });
});

app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Service running on port ${PORT}`);
});
