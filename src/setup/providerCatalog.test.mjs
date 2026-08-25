import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  KEYLESS_LAYERS,
  PROVIDERS,
  REQUIREMENTS,
  groupedProviders,
  providerById,
  providerForVariable,
  requirementLabel,
  requiredProviders,
  tierLabel,
  writableVariableNames,
} from './providerCatalog.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_EXAMPLE = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
const VITE_CONFIG = readFileSync(path.join(REPO_ROOT, 'vite.config.js'), 'utf8');

test('every catalogued variable is documented in .env.example', () => {
  // The catalog is what the setup console offers to write; .env.example is what
  // a contributor reads. A variable in one and not the other means the console
  // is offering a key the project never documented, or the reverse.
  for (const name of writableVariableNames()) {
    assert.match(
      ENV_EXAMPLE,
      new RegExp(`^#?\\s*${name}=`, 'm'),
      `${name} is offered by the setup console but absent from .env.example`,
    );
  }
});

test('every catalogued variable is actually read by the server', () => {
  // A key nobody reads is a key nobody should be asked for. Server-side keys
  // are read from `process.env`; the two browser-exposed ones are read from the
  // config factory's `env` snapshot on their way into the `define` block.
  for (const name of writableVariableNames()) {
    assert.ok(
      VITE_CONFIG.includes(`process.env.${name}`) || VITE_CONFIG.includes(`env.${name}`),
      `${name} is offered by the setup console but never read in vite.config.js`,
    );
  }
});

test('provider ids and variable names are unique', () => {
  const ids = PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate provider id');
  const names = writableVariableNames();
  assert.equal(new Set(names).size, names.length, 'duplicate environment variable');
});

test('exactly one provider is required, and it is the one that draws the planet', () => {
  const required = requiredProviders();
  assert.equal(required.length, 1);
  assert.equal(required[0].id, 'google-maps');
});

test('every link is an https URL', () => {
  // These links are the product. A typo here sends someone to a dead page while
  // they are holding a credit card.
  const urls = PROVIDERS.flatMap((provider) => [
    provider.primaryAction.url,
    ...provider.steps.map((step) => step.url).filter(Boolean),
    ...provider.links.map((link) => link.url),
  ]);
  assert.ok(urls.length > 20, 'expected the catalog to carry real destinations');
  for (const url of urls) {
    assert.match(url, /^https:\/\//, `${url} is not an https URL`);
    assert.doesNotMatch(url, /\s/, `${url} contains whitespace`);
  }
});

test('every provider states what it unlocks, what it costs, and where to start', () => {
  for (const provider of PROVIDERS) {
    assert.ok(provider.summary.length > 20, `${provider.id} has no usable summary`);
    assert.ok(provider.unlocks.length > 0, `${provider.id} does not say what it unlocks`);
    assert.ok(provider.cost.length > 20, `${provider.id} does not say what it costs`);
    assert.ok(provider.steps.length > 0, `${provider.id} has no steps`);
    assert.ok(provider.vars.length > 0, `${provider.id} has no variables`);
    assert.ok(REQUIREMENTS.includes(provider.requirement), `${provider.id} has an unknown requirement`);
    assert.ok(['metered', 'free'].includes(provider.tier), `${provider.id} has an unknown tier`);
    assert.ok(['client', 'server'].includes(provider.exposure), `${provider.id} has an unknown exposure`);
  }
});

test('both browser-exposed keys warn that they are browser-exposed', () => {
  // SECURITY.md makes this the one thing a user must understand about these
  // two keys, so the console is not allowed to ship them without the warning.
  const clientExposed = PROVIDERS.filter((provider) => provider.exposure === 'client');
  assert.deepEqual(clientExposed.map((provider) => provider.id), ['google-maps', 'cesium-ion']);
  for (const provider of clientExposed) {
    assert.ok(
      provider.notes.some((note) => /browser bundle/i.test(note) && /restrict/i.test(note)),
      `${provider.id} does not warn that its value reaches the browser`,
    );
  }
});

test('the Google key names every API this app calls with it', () => {
  // Enabling only Map Tiles is the most common half-configuration: the globe
  // renders and then search, voice context, and camera fallbacks quietly fail.
  const google = providerById('google-maps');
  const steps = google.steps.map((step) => step.text).join(' ');
  for (const api of ['Map Tiles', 'Geocoding', 'Places', 'Street View']) {
    assert.ok(steps.includes(api), `the Google steps never mention ${api}`);
  }
  assert.ok(
    google.notes.some((note) => /referrer/i.test(note)),
    'the Google notes omit the referrer-restriction trap for server-side calls',
  );
});

test('a variable resolves back to its provider', () => {
  assert.equal(providerForVariable('OPENSKY_CLIENT_SECRET').id, 'opensky');
  assert.equal(providerForVariable('FIRMS_MAP_KEY').id, 'nasa-firms');
  assert.equal(providerForVariable('NOT_A_KEY'), null);
  assert.equal(providerById('nope'), null);
});

test('grouping keeps catalog order and loses nothing', () => {
  const groups = groupedProviders();
  assert.deepEqual(groups.map((group) => group.requirement), ['required', 'recommended', 'optional']);
  const flattened = groups.flatMap((group) => group.providers.map((provider) => provider.id));
  assert.equal(flattened.length, PROVIDERS.length);
  assert.deepEqual([...flattened].sort(), PROVIDERS.map((provider) => provider.id).sort());
});

test('the keyless roster is listed so the console can be honest about the free floor', () => {
  assert.ok(KEYLESS_LAYERS.length >= 10);
  for (const layer of KEYLESS_LAYERS) {
    assert.ok(layer.name && layer.source, 'a keyless layer is missing its source');
  }
});

test('badge labels cover every tier and requirement', () => {
  assert.equal(tierLabel('metered'), 'METERED');
  assert.equal(tierLabel('free'), 'FREE KEY');
  assert.equal(tierLabel('none'), 'NO KEY');
  assert.equal(requirementLabel('required'), 'REQUIRED');
  assert.equal(requirementLabel('recommended'), 'RECOMMENDED');
  assert.equal(requirementLabel('optional'), 'OPTIONAL');
});
