import assert from 'node:assert/strict';
import test from 'node:test';

import { SETUP_PATH, bootstrapKeyNotice } from './bootstrapNotice.js';

test('the boot failure a first-time user actually hits becomes a destination', () => {
  // This is verbatim what src/main.js throws with no key configured.
  const notice = bootstrapKeyNotice(
    new Error('GOOGLE_MAPS_API_KEY not found. Set it as an environment variable.'),
  );
  assert.equal(notice.variable, 'GOOGLE_MAPS_API_KEY');
  assert.equal(notice.href, SETUP_PATH);
  assert.match(notice.message, /Google Maps Platform/);
  assert.ok(notice.linkLabel.length > 0);
});

test('a plain string failure is handled the same as an Error', () => {
  assert.equal(
    bootstrapKeyNotice('OPENAI_API_KEY is not set').variable,
    'OPENAI_API_KEY',
  );
});

test('an unrelated failure keeps its own message', () => {
  // Pointing a WebGL crash at the key console would be a confident wrong answer.
  assert.equal(bootstrapKeyNotice(new Error('WebGL context could not be created')), null);
  assert.equal(bootstrapKeyNotice(new Error('Failed to fetch tileset')), null);
  assert.equal(bootstrapKeyNotice(null), null);
  assert.equal(bootstrapKeyNotice(undefined), null);
});

test('a variable the catalog does not own is not claimed', () => {
  assert.equal(bootstrapKeyNotice(new Error('SOME_OTHER_THING not found')), null);
});

test('a known variable mentioned outside a missing-key failure is not claimed', () => {
  assert.equal(
    bootstrapKeyNotice(new Error('GOOGLE_MAPS_API_KEY rejected the tile request')),
    null,
  );
});
