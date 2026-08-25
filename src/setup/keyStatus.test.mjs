import assert from 'node:assert/strict';
import test from 'node:test';

import { PROVIDERS, providerById } from './providerCatalog.js';
import {
  activeValueSource,
  maskedValue,
  providerState,
  providerStateLabel,
  readinessSummary,
  resolveVariableState,
  restartAdvice,
  variableStateDetail,
  variableStateLabel,
} from './keyStatus.js';

/** Build a status map where every named variable is active. */
function allActive(names) {
  return Object.fromEntries(names.map((name) => [name, { state: 'active' }]));
}

const EVERY_VARIABLE = PROVIDERS.flatMap((provider) => provider.vars.map((v) => v.name));

test('a value present in both the file and the process is simply active', () => {
  assert.equal(
    resolveVariableState({ processSet: true, fileSet: true, valuesMatch: true }),
    'active',
  );
  assert.equal(
    activeValueSource({ processSet: true, fileSet: true, valuesMatch: true }),
    'dotenv',
  );
});

test('a value only the process has is active, and reported as coming from the environment', () => {
  // The macOS launcher pulls from the Keychain and exports it; there is no file
  // entry, and nothing is wrong.
  assert.equal(resolveVariableState({ processSet: true }), 'active');
  assert.equal(activeValueSource({ processSet: true }), 'environment');
});

test('a value only the file has is pending, not active', () => {
  // This is the state right after the console writes a new key: the running
  // server has not loaded it, so calling it active would be a lie.
  assert.equal(resolveVariableState({ fileSet: true }), 'pending');
  assert.equal(activeValueSource({ fileSet: true }), null);
});

test('a file value the process disagrees with is a conflict, not a success', () => {
  // The trap this whole module exists for: vite.config.js fills process.env
  // only where it is undefined, so an exported shell value — or a value loaded
  // before the file changed — keeps winning, and the edit does nothing.
  const observation = { processSet: true, fileSet: true, valuesMatch: false };
  assert.equal(resolveVariableState(observation), 'conflict');
  assert.equal(activeValueSource(observation), 'environment');
  const detail = variableStateDetail('conflict', 'OPENAI_API_KEY');
  assert.match(detail, /OPENAI_API_KEY/);
  assert.match(detail, /shell|Keychain/i);
  assert.match(detail, /start it again|restart/i);
});

test('nothing anywhere is missing', () => {
  assert.equal(resolveVariableState(), 'missing');
  assert.equal(resolveVariableState({}), 'missing');
  assert.equal(activeValueSource({}), null);
});

test('every state has a badge and an explanation', () => {
  for (const state of ['active', 'pending', 'conflict', 'missing']) {
    assert.ok(variableStateLabel(state).length > 0);
    assert.match(variableStateDetail(state, 'THE_KEY'), /THE_KEY/);
  }
  assert.equal(variableStateLabel('active'), 'ACTIVE');
  assert.equal(variableStateLabel('pending'), 'RESTART TO APPLY');
  assert.equal(variableStateLabel('conflict'), 'OVERRIDDEN');
  assert.equal(variableStateLabel('missing'), 'NOT SET');
});

test('a two-variable provider is not active until both halves are', () => {
  // OpenSky OAuth with only the client id set is not usable, and a green tick
  // over it would send someone hunting for a problem elsewhere.
  const opensky = providerById('opensky');
  assert.equal(providerState(opensky, { OPENSKY_CLIENT_ID: { state: 'active' } }), 'partial');
  assert.equal(providerStateLabel('partial'), 'INCOMPLETE');
  assert.equal(
    providerState(opensky, {
      OPENSKY_CLIENT_ID: { state: 'active' },
      OPENSKY_CLIENT_SECRET: { state: 'active' },
    }),
    'active',
  );
});

test('a conflict is never hidden behind a sibling that is fine', () => {
  const opensky = providerById('opensky');
  assert.equal(
    providerState(opensky, {
      OPENSKY_CLIENT_ID: { state: 'active' },
      OPENSKY_CLIENT_SECRET: { state: 'conflict' },
    }),
    'conflict',
  );
});

test('an unset provider reports missing, and a saved one reports pending', () => {
  const firms = providerById('nasa-firms');
  assert.equal(providerState(firms, {}), 'missing');
  assert.equal(providerState(firms, { FIRMS_MAP_KEY: { state: 'pending' } }), 'pending');
});

test('readiness leads with the blocking key, whatever else is configured', () => {
  const withoutGoogle = { ...allActive(EVERY_VARIABLE), GOOGLE_MAPS_API_KEY: { state: 'missing' } };
  const summary = readinessSummary(withoutGoogle);
  assert.equal(summary.blocked, true);
  assert.equal(summary.tone, 'blocked');
  assert.match(summary.headline, /will not start/);
  assert.equal(summary.requiredMet, 0);
  assert.equal(summary.requiredTotal, 1);
});

test('readiness counts providers, not variables', () => {
  const summary = readinessSummary(allActive(['GOOGLE_MAPS_API_KEY']));
  assert.equal(summary.blocked, false);
  assert.equal(summary.configured, 1);
  assert.equal(summary.total, PROVIDERS.length);
  assert.equal(summary.tone, 'partial');
  assert.match(summary.headline, /still runs keyless/);
});

test('a fully configured install says so', () => {
  const summary = readinessSummary(allActive(EVERY_VARIABLE));
  assert.equal(summary.configured, PROVIDERS.length);
  assert.equal(summary.tone, 'complete');
  assert.match(summary.headline, /Full sensor suite/);
});

test('an empty install is blocked, not merely incomplete', () => {
  const summary = readinessSummary({});
  assert.equal(summary.blocked, true);
  assert.equal(summary.configured, 0);
});

test('restart advice separates what will apply from what will not', () => {
  const advice = restartAdvice({
    OPENAI_API_KEY: { state: 'pending' },
    TOMTOM_API_KEY: { state: 'conflict' },
    FIRMS_MAP_KEY: { state: 'active' },
    AISSTREAM_API_KEY: { state: 'missing' },
  });
  assert.equal(advice.needed, true);
  assert.deepEqual(advice.pending, ['OPENAI_API_KEY']);
  assert.deepEqual(advice.conflicting, ['TOMTOM_API_KEY']);
});

test('a settled install needs no restart', () => {
  assert.deepEqual(
    restartAdvice({ GOOGLE_MAPS_API_KEY: { state: 'active' }, FIRMS_MAP_KEY: { state: 'missing' } }),
    { needed: false, pending: [], conflicting: [] },
  );
  assert.equal(restartAdvice().needed, false);
});

test('masking shows enough to recognize a key and no more', () => {
  const masked = maskedValue(51, '3f9a');
  assert.match(masked, /3f9a$/);
  assert.doesNotMatch(masked, /[A-Za-z0-9]{5}/);
  // A short value gets no tail at all — four of eight characters is a leak.
  assert.equal(maskedValue(8, 'cdef'), '••••••••');
  assert.equal(maskedValue(0, ''), '');
});
