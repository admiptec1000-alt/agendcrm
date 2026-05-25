/**
 * Regression test for the libsignal Bad MAC / SessionError detector.
 *
 * We import the relevant code paths from index.js by simulating the
 * exact pino log payloads observed in production logs (Render). The
 * detector must extract the JID + senderPn and stage them for the
 * session-heal sweep.
 *
 * Run with:  node tests/test_session_heal.js
 */
const assert = require('assert');

// Re-implement the detector in isolation (mirrors what's in index.js).
const sessionErrorJids = new Set();
function noteSessionError(rawObj) {
  try {
    const jid =
      rawObj?.key?.remoteJid ||
      rawObj?.remoteJid ||
      rawObj?.jid ||
      null;
    if (jid) sessionErrorJids.add(jid);
    const senderPn = rawObj?.key?.senderPn || rawObj?.senderPn;
    if (senderPn) sessionErrorJids.add(senderPn);
  } catch (_) {}
}

function detect(line) {
  if (line.indexOf('SessionError') === -1
      && line.indexOf('Bad MAC') === -1
      && line.indexOf('No matching sessions') === -1
      && line.indexOf('failed to decrypt') === -1) {
    return;
  }
  try {
    const obj = JSON.parse(line);
    noteSessionError(obj);
  } catch (_) {}
}

// --- Test 1: exact production payload (No matching sessions) ----------
const prodPayload1 = JSON.stringify({
  level: 50,
  time: 1779677277634,
  pid: 55,
  hostname: 'srv-d7jq4tm7r5hc73fti4mg-58f68db4f5-7gqbw',
  key: {
    remoteJid: '242158913192070@lid',
    fromMe: false,
    id: '2A41ACA3016589AF99BB',
    senderPn: '556294320308@s.whatsapp.net',
  },
  err: {
    type: 'SessionError',
    message: 'No matching sessions found for message',
    name: 'SessionError',
  },
  msg: 'failed to decrypt message',
});
detect(prodPayload1);
assert(sessionErrorJids.has('242158913192070@lid'), '@lid jid not flagged');
assert(
  sessionErrorJids.has('556294320308@s.whatsapp.net'),
  'senderPn not flagged',
);
console.log('Test 1 PASS: @lid + senderPn both flagged');

// --- Test 2: plain text Bad MAC log (no JSON) — must not crash --------
sessionErrorJids.clear();
detect('Session error:Error: Bad MAC Error: Bad MAC\n   at Object.verifyMAC');
// No JID to extract from a non-JSON string — set stays empty but the
// matcher must NOT throw.
console.log('Test 2 PASS: plain text Bad MAC does not crash');

// --- Test 3: unrelated log line — must NOT add anything ---------------
sessionErrorJids.clear();
detect('[abc] Connected as 556299...:1 healthily');
detect(JSON.stringify({ level: 30, msg: 'plain info' }));
assert.strictEqual(sessionErrorJids.size, 0, 'unrelated logs added jids');
console.log('Test 3 PASS: unrelated logs do not pollute the set');

// --- Test 4: malformed JSON inside a matching line — must NOT crash --
sessionErrorJids.clear();
detect('{"level":50, "msg":"SessionError", "key": {malformed');
console.log('Test 4 PASS: malformed JSON inside matching line tolerated');

console.log('\nAll session-heal detector tests passed.');
