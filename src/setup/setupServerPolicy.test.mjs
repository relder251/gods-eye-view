import assert from 'node:assert/strict';
import test from 'node:test';

import { writableVariableNames } from './providerCatalog.js';
import {
  MIN_LENGTH_FOR_TAIL,
  describeVariable,
  isLoopbackAddress,
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
