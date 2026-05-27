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

// 2026-02-18 (v2.1.18) — Custom pino logger that intercepts libsignal's
// `Bad MAC` and `No matching sessions found` errors at the WARN level and
// triggers a session wipe + force-assert on the offending JID.
//
// Background: when a customer device rotates its identity key (e.g. they
// re-installed WhatsApp, switched devices, or our local session record
// drifted from theirs), our libsignal copy cannot decrypt their inbound
// messages. Baileys eventually recovers via prekey-bundle exchange — but
// that recovery requires the customer to retry SEVERAL times and can take
// 5-10 minutes (observed in prod). Meanwhile every send WE attempt to that
// JID also goes out with the stale session, producing "Aguardando
// mensagem" on the customer's screen.
//
// libsignal does NOT emit these errors via a public event — they bubble
// up via the pino logger as level=50 entries. We intercept them by
// wrapping pino's write stream and pattern-matching the message body. On
// match, we extract the JID and flag it for an immediate session wipe +
// fresh prekey bundle fetch. The next inbound or outbound to that JID
// will rebuild from scratch.
const sessionErrorJids = new Set();
function noteSessionError(rawObj) {
  try {
    // The error object passed by Baileys/libsignal has shape:
    //   {key: {remoteJid, senderPn, fromMe, id}, err: {type:'SessionError'...}}
    const jid =
      rawObj?.key?.remoteJid ||
      rawObj?.remoteJid ||
      rawObj?.jid ||
      null;
    if (jid) sessionErrorJids.add(jid);
    // ALSO add the senderPn variant — for @lid messages, the actual phone
    // JID may differ from the @lid JID and we should wipe both records.
    const senderPn = rawObj?.key?.senderPn || rawObj?.senderPn;
    if (senderPn) sessionErrorJids.add(senderPn);
  } catch (_) { /* defensive — never let logging break the app */ }
}
const _pinoStream = {
  write(chunk) {
    try {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      // Cheap substring match before bothering to JSON.parse.
      if (s.indexOf('SessionError') !== -1
          || s.indexOf('Bad MAC') !== -1
          || s.indexOf('No matching sessions') !== -1
          || s.indexOf('failed to decrypt') !== -1) {
        try {
          const obj = JSON.parse(s);
          noteSessionError(obj);
        } catch (_) {
          // Plain text log — still useful for the substring detection
          // above; we just don't have a JID to extract.
        }
      }
    } catch (_) {}
    // Always forward to stdout so the original logs remain visible.
    process.stdout.write(chunk);
  },
};
const logger = pino({ level: 'warn' }, _pinoStream);

// Sweep flagged JIDs every 8s. For each one, wipe the local Signal session
// record across ALL connected instances so the next exchange rebuilds
// from a fresh prekey bundle. Conservative: max 5 wipes per cycle to
// avoid hammering the WA server when there's a burst.
setInterval(async () => {
  if (sessionErrorJids.size === 0) return;
  const toProcess = Array.from(sessionErrorJids).slice(0, 5);
  for (const jid of toProcess) sessionErrorJids.delete(jid);
  for (const [instanceId, inst] of Object.entries(connections)) {
    if (!inst?.sock || inst.status !== 'connected') continue;
    for (const jid of toProcess) {
      try {
        await inst.sock.authState.keys.set({ session: { [jid]: null } });
        jidNeedsForceAssert.add(jid);
        console.warn(
          `[${instanceId}] [SESSION-HEAL] wiped local session for ${jid} ` +
          `(libsignal reported Bad MAC / No matching sessions) — next ` +
          `exchange will rebuild from fresh prekey bundle`
        );
      } catch (e) {
        console.warn(
          `[${instanceId}] [SESSION-HEAL] wipe failed for ${jid}: ${e.message}`
        );
      }
    }
  }
}, 8 * 1000);
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

// 2026-02-17 (v2.1.15) — CRITICAL: NodeCache used as msgRetryCounterCache for
// Baileys. Without this, Baileys cannot track which messages were already
// retried — the retry-receipt protocol that normally CURES "Aguardando
// mensagem" silently breaks because Baileys can't tell if the recipient is
// asking for a fresh re-encryption or hitting the wrong message id.
// 5 min TTL is the Baileys-recommended value for retry counters.
const NodeCache = require('node-cache');
const msgRetryCounterCache = new NodeCache({ stdTTL: 60 * 5, useClones: false });
// Same for group metadata so group retry receipts are handled correctly.
const groupMetadataCache = new NodeCache({ stdTTL: 60 * 5, useClones: false });
// Map<jid, timestamp> — last successful sendMessage per JID. Used by the
// assertSessions stale-detection heuristic (2026-02-15 (G2)). When a JID
// hasn't been talked to in >12h, we proactively re-fetch the prekey bundle
// to avoid the "Aguardando mensagem" placeholder caused by stale sessions.
const jidLastSentAt = new Map();
const JID_LAST_SENT_MAX = 5000;  // cap memory; evict oldest if exceeded
const SENT_STORE_MAX = 2000;

// 2026-02-17 (v2.1.12) — JIDs whose last send was reported as failed via
// `messages.update` (status=1). On the next send to such a JID we ALWAYS
// force-refetch the prekey bundle. Cleared when the next send succeeds or
// when a delivered/read receipt arrives. Solves the "Aguardando mensagem"
// pattern reported in prod where a recipient device rotates keys between
// our sends — our session is technically valid but the recipient cannot
// decrypt anymore.
const jidNeedsForceAssert = new Set();

// ────────────────────────────────────────────────────────────────────────
// 2026-02-18 (v2.1.17) — AUTO-RECOVERY for "Aguardando mensagem" stuck
// deliveries.
//
// 2026-05-26 (v2.1.18) — Re-send no longer fires on simple timeout; now
// requires REAL failure signal (messages.update status=0 ERROR).
//
// 2026-05-27 (v2.1.19) — Expanded re-send trigger to also catch the
// "Aguardando mensagem" decryption-failure case. WhatsApp does NOT emit
// status=0 when the recipient's Signal session is corrupted — it emits
// retry-receipts asking for re-encryption. We now also re-send when:
//   • we have an outbound msgId WITHOUT DELIVERY_ACK for > STUCK_TIMEOUT_MS,
//   • AND the recipient has been ACTIVE (we received an inbound from them
//     OR they appeared on presence updates) in the last RECIPIENT_ONLINE_MS.
// If they appear OFFLINE (no recent activity, no presence) we let the
// entry decay silently — that's the "client is offline / has bad signal"
// case where re-sending would duplicate.
//
// Standard Baileys WAMessageStatus enum (verified at runtime against
// proto.WebMessageInfo.Status on 2026-02-18 / Baileys 6.7.21):
//   ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5
// Anything ≥3 means the recipient device received and decrypted the
// ciphertext — at which point we are safe and the entry is dropped.
const pendingDeliveries = new Map(); // outbound msgId -> tracking entry
const STUCK_TIMEOUT_MS = 90 * 1000;   // 2026-05-27: 90s (was 60s)
const MAX_AUTO_RETRIES = 1;            // single retry is enough
const STUCK_CHECK_INTERVAL_MS = 15 * 1000;
const PENDING_DELIVERIES_MAX = 1000;  // cap memory
// 2026-05-27 — Janela em que consideramos o destinatario "online".
// Recebemos inbound dele ou presence update? entao ele esta acordado,
// re-send eh seguro contra duplicatas (cliente esta vendo "Aguardando").
const RECIPIENT_ONLINE_MS = 5 * 60 * 1000;
const recipientLastSeen = new Map(); // `${instanceId}|${jid}` -> ts
function markRecipientSeen(instanceId, jid) {
  if (!instanceId || !jid) return;
  recipientLastSeen.set(`${instanceId}|${jid}`, Date.now());
  // Cap memory
  if (recipientLastSeen.size > 5000) {
    const it = recipientLastSeen.keys();
    recipientLastSeen.delete(it.next().value);
  }
}
function isRecipientLikelyOnline(instanceId, jid) {
  const ts = recipientLastSeen.get(`${instanceId}|${jid}`);
  if (!ts) return false;
  return (Date.now() - ts) <= RECIPIENT_ONLINE_MS;
}

function trackOutboundForRecovery(instanceId, jid, msgId, text) {
  if (!msgId) return;
  // Cap memory: evict oldest entries when overflowing.
  if (pendingDeliveries.size >= PENDING_DELIVERIES_MAX) {
    const it = pendingDeliveries.keys();
    pendingDeliveries.delete(it.next().value);
  }
  pendingDeliveries.set(msgId, {
    instanceId, jid, text,
    sentAt: Date.now(),
    retries: 0,
    msgId,
    // 2026-05-26 — Re-send no longer fires on simple timeout. Set to true
    // only when `messages.update` reports status=ERROR (0). See
    // messages.update handler.
    needsResend: false,
  });
}

setInterval(async () => {
  const now = Date.now();
  for (const [msgId, info] of pendingDeliveries.entries()) {
    const age = now - info.sentAt;
    // 2026-05-27 (v2.1.19) — Three exit/retry paths:
    //   A) Real failure signal raised (status=0 ERROR) → re-send.
    //   B) Stuck >STUCK_TIMEOUT_MS AND recipient is likely online (we got
    //      inbound from them recently) → "Aguardando mensagem" case →
    //      wipe Signal session + re-send.
    //   C) Stuck >STUCK_TIMEOUT_MS, no failure signal AND recipient seems
    //      offline → decay silently (no duplicate).
    const recipientOnline = isRecipientLikelyOnline(info.instanceId, info.jid);
    const stale = age >= STUCK_TIMEOUT_MS;
    const shouldResend = info.needsResend || (stale && recipientOnline);
    if (stale && !shouldResend) {
      pendingDeliveries.delete(msgId);
      continue;
    }
    if (!shouldResend) continue;
    if (info.retries >= MAX_AUTO_RETRIES) {
      console.error(
        `[${info.instanceId}] [AUTO-RECOVERY] giving up msgId=${msgId} ` +
        `jid=${info.jid} after ${info.retries} retries`
      );
      pendingDeliveries.delete(msgId);
      continue;
    }
    const inst = connections[info.instanceId];
    if (!inst?.sock || inst.status !== 'connected') continue;
    info.retries += 1;
    info.sentAt = Date.now();
    info.needsResend = false;
    const trigger = info.needsResend ? 'ERROR_SIGNAL' : (recipientOnline ? 'ONLINE_NOACK' : 'TIMEOUT');
    console.warn(
      `[${info.instanceId}] [AUTO-RECOVERY] msgId=${msgId} jid=${info.jid} ` +
      `trigger=${trigger}; wiping session + re-sending ` +
      `(retry #${info.retries}/${MAX_AUTO_RETRIES})`
    );
    try {
      // 1. Wipe local Signal session record for the JID.
      await inst.sock.authState.keys.set({
        session: { [info.jid]: null },
      });
      // 2. Mark for force-assert. The next assertSessions call WILL fetch
      // a fresh pre-key bundle because the local session is gone.
      jidNeedsForceAssert.add(info.jid);
      try {
        await inst.sock.assertSessions([info.jid], true);
      } catch (e2) {
        console.warn(
          `[${info.instanceId}] [AUTO-RECOVERY] assertSessions warmup ` +
          `failed (will still try send): ${e2.message}`
        );
      }
      // 3. Re-send the original text.
      const sent = await inst.sock.sendMessage(
        info.jid,
        { text: info.text, linkPreview: false },
      );
      if (sent?.key?.id) {
        const newId = sent.key.id;
        // Move tracking under the new msgId so the next round catches it
        // if it also gets stuck.
        pendingDeliveries.delete(msgId);
        pendingDeliveries.set(newId, {
          ...info,
          msgId: newId,
          sentAt: Date.now(),
        });
        rememberSent(info.jid, newId, { conversation: info.text });
        jidLastSentAt.set(info.jid, Date.now());
        console.log(
          `[${info.instanceId}] [AUTO-RECOVERY] re-sent as ${newId} ` +
          `(retry #${info.retries})`
        );
        // Fire-and-forget notification so the SA log shows the recovery.
        axios.post(`${FASTAPI_URL}/api/channels/webhook/auto-recovery`, {
          instance_id: info.instanceId,
          jid: info.jid,
          original_msg_id: msgId,
          new_msg_id: newId,
          retry: info.retries,
        }, { timeout: 5000 }).catch(() => {});
      } else {
        console.warn(
          `[${info.instanceId}] [AUTO-RECOVERY] re-send produced no key.id ` +
          `(msgId=${msgId})`
        );
      }
    } catch (e) {
      console.error(
        `[${info.instanceId}] [AUTO-RECOVERY] retry failed for msgId=${msgId} ` +
        `jid=${info.jid}: ${e.message}`
      );
    }
  }
}, STUCK_CHECK_INTERVAL_MS);

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

// ── Pre-key refill watchdog (v2.1.12) ───────────────────────────────────────
// Every 30 minutes, ask Baileys to upload more pre-keys to the WhatsApp
// server if needed. Pre-keys are the one-time public keys WhatsApp uses to
// bootstrap an E2E session with a brand-new contact. Each new outbound
// session consumes ONE pre-key — and Baileys ships with only 30 by default.
// On busy bots (broadcasting, billing reminders, first-contact flows), they
// exhaust within hours. When that happens, the recipient's device receives
// a ciphertext it cannot decrypt and renders "Aguardando mensagem".
// uploadPreKeysToServerIfRequired is idempotent and cheap: only uploads if
// remaining count is below threshold (~20).
const PREKEY_REFILL_INTERVAL_MS = 30 * 60 * 1000;
setInterval(async () => {
  for (const [instanceId, inst] of Object.entries(connections)) {
    if (!inst || inst.status !== 'connected' || !inst.sock) continue;
    try {
      if (typeof inst.sock.uploadPreKeysToServerIfRequired === 'function') {
        await inst.sock.uploadPreKeysToServerIfRequired();
        // No log on noop — only log on actual upload happening, but we
        // cannot tell easily without intercepting. Keep silent in steady
        // state.
      } else if (typeof inst.sock.uploadPreKeys === 'function') {
        await inst.sock.uploadPreKeys();
      }
    } catch (e) {
      console.warn(`[${instanceId}] [PREKEY] periodic upload failed:`, e.message);
    }
  }
}, PREKEY_REFILL_INTERVAL_MS);



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
    // 2026-02-17 (v2.1.15) — Pass NodeCache-based retry counter so Baileys'
    // retry-receipt protocol actually works. Without this, every undecrypted
    // message on the recipient stays as "Aguardando mensagem" forever.
    msgRetryCounterCache,
    // Group metadata cache — required for retries inside groups (and used
    // generally by Baileys to avoid extra round-trips on each group send).
    cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid),
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

      // 2026-02-17 (v2.1.12) — Replenish pre-keys 30s after connect.
      // Baileys ships with 30 prekeys; each new outbound session consumes
      // one. On busy accounts they exhaust and new sessions cannot be
      // established, producing "Aguardando mensagem" on the recipient.
      // Baileys' helper uploads more only when needed.
      setTimeout(async () => {
        try {
          if (typeof sock.uploadPreKeysToServerIfRequired === 'function') {
            await sock.uploadPreKeysToServerIfRequired();
            console.log(`[${instanceId}] [PREKEY] initial upload-if-required ok`);
          } else if (typeof sock.uploadPreKeys === 'function') {
            await sock.uploadPreKeys();
            console.log(`[${instanceId}] [PREKEY] initial upload ok (fallback)`);
          }
        } catch (e) {
          console.warn(`[${instanceId}] [PREKEY] initial upload failed:`, e.message);
        }
      }, 30000);

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
      // 2026-05-27 (v2.1.19) — Marca destinatario como "online" para o
      // auto-recovery saber que vale a pena re-enviar mensagem stuck.
      markRecipientSeen(instanceId, id);
      await axios.post(`${FASTAPI_URL}/api/channels/webhook/presence`, {
        instance_id: instanceId, phone, presence,
      }, { timeout: 5000 }).catch(() => {});
    } catch (_) {}
  });

  // Forward read receipts / delivery acks. Baileys WAMessageStatus enum
  // (verified at runtime against proto.WebMessageInfo.Status on Baileys
  // 6.7.21):
  //   0 = ERROR, 1 = PENDING, 2 = SERVER_ACK, 3 = DELIVERY_ACK,
  //   4 = READ, 5 = PLAYED
  // We forward the status name AS-IS so the backend can react (e.g. mark
  // a flow_send_log row as actually delivered). We also use the same
  // signal to dismiss outbound deliveries from the auto-recovery
  // watchlist (anything ≥ DELIVERY_ACK means the recipient device
  // decrypted the ciphertext successfully).
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        const num = u.update?.status;
        if (num === undefined || num === null) continue;
        const map = {
          0: 'failed',
          1: 'pending',
          2: 'server_ack',
          3: 'delivered',
          4: 'read',
          5: 'played',
        };
        const status = map[num];
        if (!status) continue;
        const jid = u.key?.remoteJid;
        const wamId = u.key?.id;
        // 2026-02-17 (v2.1.12) — Track failed sends per JID. Next send to
        // this JID will force-refetch the prekey bundle. Clear the flag
        // on healthy receipts (delivered/read/played).
        if (jid) {
          if (num === 0 /* ERROR */) {
            jidNeedsForceAssert.add(jid);
            console.warn(`[${instanceId}] [STALE FIX] flagged ${jid} for force-assert (msg status=ERROR)`);
            // 2026-05-26 (v2.1.18) — Raise needsResend so the next recovery
            // tick re-sends this specific msgId. Real failure signal —
            // distinct from a slow DELIVERY_ACK (was over-triggering and
            // causing duplicates in prod).
            if (wamId && pendingDeliveries.has(wamId)) {
              const entry = pendingDeliveries.get(wamId);
              entry.needsResend = true;
            }
          } else if (num >= 3 /* DELIVERY_ACK or higher */) {
            jidNeedsForceAssert.delete(jid);
          }
        }
        // 2026-02-18 (v2.1.17) — Drop the message from the auto-recovery
        // watchlist as soon as the recipient device received it. Anything
        // ≥ DELIVERY_ACK proves the ciphertext decrypted successfully.
        if (wamId && num >= 3 && pendingDeliveries.has(wamId)) {
          pendingDeliveries.delete(wamId);
        }
        await axios.post(`${FASTAPI_URL}/api/channels/webhook/message-status`, {
          instance_id: instanceId, message_id: wamId, status,
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

      // 2026-02-17 (v2.1.14) — When customer device sends us a message, their
      // Signal session may have advanced its ratchet state (rotating chain key
      // or even prekey if it's a new chat). If we then encrypt a reply using
      // our OLD view of the session, the recipient cannot decrypt → "Aguardando
      // mensagem". Mark the JID for force-assert so the very next outbound
      // send refreshes the prekey bundle and rebuilds the session record.
      // This is cheaper than asserting on every send and surgically fixes the
      // exact post-inbound stale-session window observed in prod (gap 2 min).
      if (!fromMe && remoteJid && !isGroup) {
        jidNeedsForceAssert.add(remoteJid);
        // 2026-05-27 (v2.1.19) — Cliente acabou de enviar inbound → esta
        // online. Auto-recovery vai re-enviar mensagens stuck (Aguardando
        // mensagem) para esse JID com confianca.
        markRecipientSeen(instanceId, remoteJid);
      }

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
    //
    // 2026-02-17 (v2.1.13) — REVERTED v2.1.12's "always force" to a smart
    // heuristic. force=true is a network round-trip to WA (5-10s sometimes).
    // Doing it on EVERY send pushed multi-message flows past the backend's
    // 15s timeout, triggering false-positive auto-restarts that broke the
    // very flows we were trying to protect. New strategy:
    //   1. force=false warmup (cheap, idempotent).
    //   2. force=true ONLY when JID is "suspicious":
    //      • Never sent before (no entry in jidLastSentAt) → first contact
    //      • Idle > 1h (was 12h in v2.1.10 — kept short so prod issues
    //        like 5h gap are still covered)
    //      • Explicitly flagged by messages.update status=1 (failed_jid_recovery)
    //   3. Otherwise rely on Baileys' session cache (cheap, ~50ms).
    const lastSeen = jidLastSentAt.get(targetJid);
    const idleMs = lastSeen ? Date.now() - lastSeen : Infinity;
    const isStale = !lastSeen || idleMs > (60 * 60 * 1000);  // 1h
    const wasFlagged = jidNeedsForceAssert.has(targetJid);
    try {
      try { await instance.sock.assertSessions([targetJid], false); } catch (_) {}
      if (isStale || wasFlagged) {
        try {
          await instance.sock.assertSessions([targetJid], true);
          if (wasFlagged) {
            console.log(`[${req.params.id}] [STALE FIX] force-assert recovered flagged JID ${targetJid}`);
            jidNeedsForceAssert.delete(targetJid);
          }
        } catch (e2) {
          console.warn(`[${req.params.id}] force-assertSessions failed (jid=${targetJid}, stale=${isStale}, flagged=${wasFlagged}):`, e2.message);
        }
      }
    } catch (e) {
      console.warn(`[${req.params.id}] assertSessions warmup failed for ${targetJid}:`, e.message);
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
      // 2026-02-18 (v2.1.17) — Add to auto-recovery watchlist. If the
      // recipient's device fails to decrypt our ciphertext (the classic
      // "Aguardando mensagem" symptom), the message will never reach
      // DELIVERY_ACK. The interval at the top of this file picks it up,
      // wipes the session, and re-sends automatically.
      trackOutboundForRecovery(req.params.id, targetJid, sent.key.id, message);
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

// 2026-02-17 (v2.1.16) — Nuclear-option session reset per JID. When a customer
// reports recurring "Aguardando mensagem" that does NOT clear via the normal
// retry-receipt protocol, the operator can wipe the Signal session record
// for that JID. The next send will force a fresh prekey bundle exchange and
// rebuild the session from scratch. Use this sparingly — every reset costs
// one fresh prekey from the WA server.
app.post('/instances/:id/reset-session/:jid', async (req, res) => {
  const inst = connections[req.params.id];
  if (!inst?.sock) {
    return res.status(404).json({ ok: false, error: 'instance not connected' });
  }
  // Normalize JID: accept raw phone digits OR full JID.
  let jid = decodeURIComponent(req.params.jid || '');
  if (jid && !jid.includes('@')) {
    jid = jid.replace(/\D/g, '') + '@s.whatsapp.net';
  }
  if (!jid) {
    return res.status(400).json({ ok: false, error: 'jid required' });
  }
  try {
    // Delete the session record. Baileys' key store interprets `null` as a
    // delete signal. We also pass identity-keys=null so the next handshake
    // re-fetches the public identity from the WA server (covers cases where
    // the recipient rotated their identity-key without our knowledge).
    await inst.sock.authState.keys.set({
      session: { [jid]: null },
      'pre-key': {},
    });
    // Mark for force-assert so the immediate next send re-fetches the prekey
    // bundle and rebuilds the session. Without this flag, smart-stale logic
    // might skip the force step if it considers the JID "fresh".
    jidNeedsForceAssert.add(jid);
    // Drop any cached "last sent at" so we don't accidentally treat this
    // freshly-reset JID as recent.
    jidLastSentAt.delete(jid);
    console.log(`[${req.params.id}] [SESSION RESET] cleared session for ${jid} — next send will rebuild`);
    return res.json({ ok: true, jid, message: 'session cleared; next send will rebuild' });
  } catch (e) {
    console.warn(`[${req.params.id}] reset-session failed for ${jid}:`, e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});



// ──────────────────────────────────────────────────────────────────────
// 2026-02-18 — Edit / Delete (revoke) message endpoints
// ──────────────────────────────────────────────────────────────────────
// Baileys exposes these via the 5th arg of `sendMessage`:
//   edit:        sendMessage(jid, { text: "novo texto", edit: msgKey })
//   delete (revoke for everyone): sendMessage(jid, { delete: msgKey })
//
// Body for BOTH endpoints:
//   { phone: "5562999...", message_id: "WA-MSG-ID", from_me: true|false }
//
// `from_me` MUST reflect the original send direction (true if WE sent it).
// For deletes, WhatsApp only allows the SENDER to revoke a message — so
// you can only revoke messages WE sent (from_me=true).
// ──────────────────────────────────────────────────────────────────────
app.post('/instances/:id/edit-message', async (req, res) => {
  const inst = connections[req.params.id];
  if (!inst?.sock || inst.status !== 'connected') {
    return res.status(404).json({ ok: false, error: 'instance not connected' });
  }
  const { phone, message_id, new_text } = req.body || {};
  if (!phone || !message_id || !new_text) {
    return res.status(400).json({ ok: false, error: 'phone, message_id and new_text required' });
  }
  let jid = String(phone).includes('@')
    ? phone
    : (String(phone).replace(/\D/g, '') + '@s.whatsapp.net');
  // We are the sender of the message we want to edit (only OUR sends can
  // be edited — WhatsApp enforces this server-side).
  const msgKey = { remoteJid: jid, fromMe: true, id: message_id };
  try {
    const result = await inst.sock.sendMessage(jid, {
      text: new_text,
      edit: msgKey,
    });
    console.log(`[${req.params.id}] [EDIT] ${message_id} -> "${new_text.slice(0,40)}..."`);
    return res.json({
      ok: true,
      message_id,
      new_text,
      result_id: result?.key?.id || null,
    });
  } catch (e) {
    console.warn(`[${req.params.id}] edit-message failed:`, e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/instances/:id/delete-message', async (req, res) => {
  const inst = connections[req.params.id];
  if (!inst?.sock || inst.status !== 'connected') {
    return res.status(404).json({ ok: false, error: 'instance not connected' });
  }
  const { phone, message_id } = req.body || {};
  if (!phone || !message_id) {
    return res.status(400).json({ ok: false, error: 'phone and message_id required' });
  }
  let jid = String(phone).includes('@')
    ? phone
    : (String(phone).replace(/\D/g, '') + '@s.whatsapp.net');
  // Only OUR sent messages can be revoked-for-everyone. WhatsApp also has
  // a server-enforced time window (~2h after send); past that, the recipient
  // device may refuse to delete locally.
  const msgKey = { remoteJid: jid, fromMe: true, id: message_id };
  try {
    await inst.sock.sendMessage(jid, { delete: msgKey });
    console.log(`[${req.params.id}] [DELETE] revoked ${message_id} for ${jid}`);
    return res.json({ ok: true, message_id });
  } catch (e) {
    console.warn(`[${req.params.id}] delete-message failed:`, e.message);
    return res.status(500).json({ ok: false, error: e.message });
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
    version: 'v2.1.18',
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
    version: 'v2.1.18',
    built_at: '2026-02-18',
    features: {
      sent_message_store: true,
      multi_message_types: true,
      presence_forwarder: true,
      ack_forwarder: true,
      contacts_endpoint: true,
      notify_and_append: true,
      long_ts_coercion: true,
      jid_normalization: true,
      soft_restart: true,
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
      sent_cache_ttl_7d: true,
      smart_stale_session_force_assert: true,
      prekey_periodic_upload: true,
      failed_jid_recovery: true,
      force_assert_on_inbound: true,
      msg_retry_counter_cache: true,
      cached_group_metadata: true,
      manual_session_reset: true,
      // v2.1.17 — auto-recovery: messages stuck without DELIVERY_ACK
      // (recipient "Aguardando mensagem") trigger an automatic
      // session wipe + re-send within ~25s. No operator action needed.
      auto_recovery_stuck_delivery: true,
      // v2.1.17 — fixed WAMessageStatus enum mapping (was off-by-one;
      // PENDING was being treated as 'failed', flagging every send for
      // force-assert).
      wa_message_status_enum_fixed: true,
      // v2.1.18 — session-heal: detects libsignal Bad MAC / SessionError
      // on INBOUND decryption failures and proactively wipes the local
      // session for the offending JID so the next exchange rebuilds
      // from a fresh prekey bundle. Cuts "Aguardando mensagem" recovery
      // from 5-10 minutes to seconds.
      session_heal_inbound: true,
      // v2.1.18 — bumped Baileys to 6.7.22 to patch the zero-day
      // message-spoofing vulnerability in 6.7.21.
      baileys_6_7_22_security_patch: true,
    },
    fastapi_url: FASTAPI_URL,
  });
});

app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Service running on port ${PORT}`);
});
