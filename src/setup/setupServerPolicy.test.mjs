import assert from 'node:assert/strict';
import test from 'node:test';

import { writableVariableNames } from './providerCatalog.js';
import {
  MIN_LENGTH_FOR_TAIL,
  describeVariable,
  isLoopbackAddress,
  resolveRequestOrigin,
  resolveWritePermission,
  sanitizeWriteRequest,
} from './setupServerPolicy.js';

test('loopback covers every form Node actually reports', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  // A dual-stack listener reports IPv4 peers in mapped form.
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('0:0:0:0:0:0:0:1'), true);
  // The whole 127.0.0.0/8 block is loopback, not just .1.
  assert.equal(isLoopbackAddress('127.4.5.6'), true);
});

test('anything reachable from another machine is not loopback', () => {
  // This is the gate that keeps the key console off the LAN even under
  // HOST=0.0.0.0, so a near-miss must not pass.
  for (const address of ['192.168.1.20', '10.0.0.4', '0.0.0.0', '128.0.0.1', '1.127.0.0', 'fe80::1', '', null, undefined]) {
    assert.equal(isLoopbackAddress(address), false, `${address} was treated as loopback`);
  }
});

test('a malformed address is refused rather than parsed loosely', () => {
  assert.equal(isLoopbackAddress('127.0.0.999'), false);
  assert.equal(isLoopbackAddress('127.0.0'), false);
  assert.equal(isLoopbackAddress('127.0.0.1.1'), false);
});

test('a configured key is described without disclosing it', () => {
  const described = describeVariable({ processValue: 'sk-proj-abcdefghijklmnop3f9a' });
  assert.equal(described.state, 'active');
  assert.equal(described.source, 'environment');
  assert.equal(described.tail, '3f9a');
  assert.equal(described.length, 28);
  // The only characters that ever leave the server are the four in the tail.
  assert.equal(JSON.stringify(described).includes('abcdefghij'), false);
});

test('a short value reveals nothing at all', () => {
  const described = describeVariable({ processValue: 'x'.repeat(MIN_LENGTH_FOR_TAIL - 1) });
  assert.equal(described.tail, '');
  assert.equal(described.length, MIN_LENGTH_FOR_TAIL - 1);
});

test('the file and the process are compared, not just counted', () => {
  assert.equal(describeVariable({ processValue: 'same', fileValue: 'same' }).state, 'active');
  assert.equal(describeVariable({ processValue: 'same', fileValue: 'same' }).source, 'dotenv');
  assert.equal(describeVariable({ processValue: 'running', fileValue: 'edited' }).state, 'conflict');
  assert.equal(describeVariable({ fileValue: 'edited' }).state, 'pending');
  assert.equal(describeVariable({}).state, 'missing');
});

test('whitespace-only values count as unset, the way the proxies read them', () => {
  assert.equal(describeVariable({ processValue: '   ' }).state, 'missing');
  assert.equal(describeVariable({ processValue: '', fileValue: '' }).state, 'missing');
});

test('only catalogued variables can be written', () => {
  const allowed = writableVariableNames();
  assert.deepEqual(
    sanitizeWriteRequest({ values: { OPENAI_API_KEY: ' sk-test ' } }, allowed),
    { OPENAI_API_KEY: 'sk-test' },
  );
  assert.throws(
    () => sanitizeWriteRequest({ values: { PATH: '/tmp' } }, allowed),
    /PATH is not a variable this console manages/,
  );
});

test('a request that would smuggle a second assignment is refused', () => {
  assert.throws(
    () => sanitizeWriteRequest({ values: { OPENAI_API_KEY: 'sk\nPATH=/evil' } }, writableVariableNames()),
    /line break/,
  );
});

test('a malformed body is refused with a message, not a stack trace', () => {
  const allowed = writableVariableNames();
  assert.throws(() => sanitizeWriteRequest(null, allowed), /Expected a/);
  assert.throws(() => sanitizeWriteRequest({}, allowed), /Expected a/);
  assert.throws(() => sanitizeWriteRequest({ values: [] }, allowed), /Expected a/);
  assert.throws(() => sanitizeWriteRequest({ values: {} }, allowed), /No values supplied/);
  assert.throws(() => sanitizeWriteRequest({ values: { OPENAI_API_KEY: 42 } }, allowed), /must be a string/);
});

test('clearing a key by saving an empty value is allowed', () => {
  // "I pasted the wrong key" needs an undo that does not involve a text editor.
  assert.deepEqual(
    sanitizeWriteRequest({ values: { TOMTOM_API_KEY: '' } }, writableVariableNames()),
    { TOMTOM_API_KEY: '' },
  );
});

test('writing is permitted from this machine and nowhere else', () => {
  assert.deepEqual(resolveWritePermission({ remoteAddress: '127.0.0.1' }), { allowed: true, reason: null });
  const remote = resolveWritePermission({ remoteAddress: '192.168.1.5' });
  assert.equal(remote.allowed, false);
  assert.match(remote.reason, /only answers requests from this machine/);
});

test('an operator can turn writing off entirely', () => {
  const readonly = resolveWritePermission({ remoteAddress: '127.0.0.1', readonlyFlag: '1' });
  assert.equal(readonly.allowed, false);
  assert.match(readonly.reason, /GEV_SETUP_READONLY/);
  // Any other value leaves writing on, matching how the other opt-in flags read.
  assert.equal(resolveWritePermission({ remoteAddress: '127.0.0.1', readonlyFlag: '0' }).allowed, true);
});

// ── Cross-origin writes ─────────────────────────────────────────────────────
//
// The attack these cover, reproduced against the real endpoint before the fix:
// a developer with the dev server running visits any other site; that site
// POSTs `text/plain` (a CORS "simple request", so no preflight) to
// /api/setup/env; the request arrives from the browser's loopback socket, so
// the loopback gate passes it, and an attacker-chosen OPENAI_API_KEY lands in
// .env. The response is unreadable to the attacker, but that was never the
// point — the developer's usage now runs through the attacker's account.

/** The page's own save request. */
const SAME_ORIGIN_WRITE = {
  headers: {
    'content-type': 'application/json',
    host: 'localhost:4173',
    origin: 'http://localhost:4173',
    'sec-fetch-site': 'same-origin',
  },
  requireJsonBody: true,
};

test("the setup page's own save is accepted", () => {
  assert.deepEqual(resolveRequestOrigin(SAME_ORIGIN_WRITE), { ok: true, reason: null });
});

test('the exact cross-origin write that reached .env is refused', () => {
  const attack = resolveRequestOrigin({
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      host: 'localhost:4173',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
    requireJsonBody: true,
  });
  assert.equal(attack.ok, false);
  assert.match(attack.reason, /application\/json/);
});

test('a non-JSON content type alone is refused on a write', () => {
  // This is the load-bearing check: application/json is not CORS-safelisted,
  // so requiring it forces a preflight that this server never answers.
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    const verdict = resolveRequestOrigin({ headers: { 'content-type': contentType }, requireJsonBody: true });
    assert.equal(verdict.ok, false, `${contentType || '(absent)'} was accepted`);
  }
});

test('a JSON content type with parameters is still JSON', () => {
  assert.equal(
    resolveRequestOrigin({ headers: { 'content-type': 'application/JSON; charset=utf-8' }, requireJsonBody: true }).ok,
    true,
  );
});

test('an origin that does not match the host is refused', () => {
  const verdict = resolveRequestOrigin({
    headers: { 'content-type': 'application/json', host: 'localhost:4173', origin: 'http://localhost:5173' },
    requireJsonBody: true,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /Cross-origin/);
});

test('a null origin — a sandboxed frame or file:// — is refused, not treated as absent', () => {
  const verdict = resolveRequestOrigin({
    headers: { 'content-type': 'application/json', host: 'localhost:4173', origin: 'null' },
    requireJsonBody: true,
  });
  assert.equal(verdict.ok, false);
});

test('cross-site is refused on the strength of Sec-Fetch-Site alone', () => {
  const verdict = resolveRequestOrigin({
    headers: { 'content-type': 'application/json', host: 'localhost:4173', 'sec-fetch-site': 'cross-site' },
    requireJsonBody: true,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /Cross-site/);
  assert.equal(
    resolveRequestOrigin({
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
      requireJsonBody: true,
    }).ok,
    false,
  );
});

test('a command-line client with no browser headers still works', () => {
  // CSRF needs a browser, and browsers always send Origin cross-origin. curl
  // sends neither header, so refusing on absence would break scripting for no
  // security gain.
  assert.equal(
    resolveRequestOrigin({ headers: { 'content-type': 'application/json' }, requireJsonBody: true }).ok,
    true,
  );
  assert.equal(resolveRequestOrigin({ headers: {} }).ok, true);
  assert.equal(resolveRequestOrigin().ok, true);
});

test('the status read is checked for origin but needs no request body', () => {
  // A GET carries no body, so demanding a JSON content type would be wrong.
  assert.equal(resolveRequestOrigin({ headers: { host: 'localhost:4173', origin: 'http://localhost:4173' } }).ok, true);
  assert.equal(resolveRequestOrigin({ headers: { host: 'localhost:4173', origin: 'https://evil.example' } }).ok, false);
});

test('a header arriving as an array is read, not stringified into nonsense', () => {
  assert.equal(
    resolveRequestOrigin({
      headers: { 'content-type': ['application/json'], host: 'localhost:4173', origin: ['http://localhost:4173'] },
      requireJsonBody: true,
    }).ok,
    true,
  );
});
