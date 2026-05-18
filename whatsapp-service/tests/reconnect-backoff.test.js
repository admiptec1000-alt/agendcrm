// Lightweight unit test for the v2.1.9 exponential-backoff math used in the
// connection.update => close => shouldReconnect path of index.js.
//
// We don't boot Baileys here — we just replay the formula and assert the
// delay sequence matches the contract written in the source comment:
//   5s, 10s, 20s, 40s, 80s, 160s, 300s (capped at 5min thereafter)
//
// Run with:  cd /app/whatsapp-service && node tests/reconnect-backoff.test.js

const assert = require('assert');

function backoffMsForAttempt(attempt) {
  return Math.min(5000 * Math.pow(2, attempt - 1), 5 * 60 * 1000);
}

const expected = [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000];
const actual = expected.map((_, i) => backoffMsForAttempt(i + 1));

assert.deepStrictEqual(actual, expected, `backoff sequence mismatch: got ${JSON.stringify(actual)}`);

// Sanity: attempt #1 must NEVER be 0 (would cause hot-loop reconnect)
assert.ok(backoffMsForAttempt(1) >= 5000, 'first reconnect must wait at least 5s');

// Sanity: cap at exactly 5 minutes regardless of attempt count
assert.strictEqual(backoffMsForAttempt(50), 300000, 'must cap at 5 minutes');

console.log('✓ reconnect-backoff: all assertions passed');
console.log('  Sequence:', actual.map(ms => `${ms / 1000}s`).join(' → '));
