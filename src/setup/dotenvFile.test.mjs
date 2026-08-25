import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VALUE_LENGTH,
  assertWritableValue,
  decodeDotenvValue,
  dotenvSnippet,
  formatDotenvValue,
  hasControlCharacter,
  parseDotenv,
  upsertDotenv,
} from './dotenvFile.js';

test('an existing assignment is rewritten where it stands', () => {
  // Rewriting in place is what keeps the explanatory comment above a key
  // attached to it; appending would orphan every comment in the file.
  const before = ['# Required: Google Maps.', 'GOOGLE_MAPS_API_KEY=old', '', 'PORT=4173', ''].join('\n');
  const result = upsertDotenv(before, { GOOGLE_MAPS_API_KEY: 'new' });
  assert.equal(result.text, '# Required: Google Maps.\nGOOGLE_MAPS_API_KEY=new\n\nPORT=4173\n');
  assert.deepEqual(result.updated, ['GOOGLE_MAPS_API_KEY']);
  assert.deepEqual(result.appended, []);
});

test('a commented-out placeholder is activated rather than duplicated', () => {
  // .env.example ships the optional keys commented out. Saving one should turn
  // that line on, not add a second assignment further down the file.
  const before = [
    '# Optional: NASA FIRMS live active fires.',
    '# https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    '# FIRMS_MAP_KEY=',
    '',
  ].join('\n');
  const result = upsertDotenv(before, { FIRMS_MAP_KEY: 'abc123' });
  assert.deepEqual(result.activated, ['FIRMS_MAP_KEY']);
  assert.deepEqual(result.appended, []);
  assert.match(result.text, /^FIRMS_MAP_KEY=abc123$/m);
  assert.equal((result.text.match(/FIRMS_MAP_KEY=/g) || []).length, 1);
  assert.ok(result.text.includes('# Optional: NASA FIRMS live active fires.'));
});

test('a live assignment wins over a commented one for the same name', () => {
  const before = ['# TOMTOM_API_KEY=', 'TOMTOM_API_KEY=live', ''].join('\n');
  const result = upsertDotenv(before, { TOMTOM_API_KEY: 'next' });
  assert.deepEqual(result.updated, ['TOMTOM_API_KEY']);
  assert.deepEqual(result.activated, []);
  assert.equal(result.text, '# TOMTOM_API_KEY=\nTOMTOM_API_KEY=next\n');
});

test('an unknown name is appended once, under one heading', () => {
  const result = upsertDotenv('PORT=4173\n', { LL2_API_TOKEN: 'a', TFL_APP_KEY: 'b' });
  assert.deepEqual(result.appended, ['LL2_API_TOKEN', 'TFL_APP_KEY']);
  assert.equal(
    result.text,
    'PORT=4173\n\n# Added by the God\'s Eye View setup console.\nLL2_API_TOKEN=a\nTFL_APP_KEY=b\n',
  );
});

test('writing into an empty file produces a valid file', () => {
  const result = upsertDotenv('', { OPENAI_API_KEY: 'sk-test' });
  assert.equal(result.text, '# Added by the God\'s Eye View setup console.\nOPENAI_API_KEY=sk-test\n');
  assert.deepEqual(parseDotenv(result.text).get('OPENAI_API_KEY'), 'sk-test');
});

test('an edited file round-trips through the parser', () => {
  const before = '# note\nA=1\n# B=\n';
  const { text } = upsertDotenv(before, { A: 'one', B: 'two', C: 'three' });
  const parsed = parseDotenv(text);
  assert.equal(parsed.get('A'), 'one');
  assert.equal(parsed.get('B'), 'two');
  assert.equal(parsed.get('C'), 'three');
});

test('the parser reports what the file says, comments excluded', () => {
  const parsed = parseDotenv([
    '# HEADER=ignored',
    'PLAIN=value',
    'export EXPORTED=value2',
    'QUOTED="has space"',
    "SINGLE='raw#hash'",
    'TRAILING=value3 # inline comment',
    'EMPTY=',
    'not an assignment',
    '',
  ].join('\n'));
  assert.equal(parsed.get('HEADER'), undefined);
  assert.equal(parsed.get('PLAIN'), 'value');
  assert.equal(parsed.get('EXPORTED'), 'value2');
  assert.equal(parsed.get('QUOTED'), 'has space');
  assert.equal(parsed.get('SINGLE'), 'raw#hash');
  assert.equal(parsed.get('TRAILING'), 'value3');
  assert.equal(parsed.get('EMPTY'), '');
  assert.equal(parsed.size, 6);
});

test('a duplicated name resolves to the last assignment, like dotenv', () => {
  assert.equal(parseDotenv('K=first\nK=second\n').get('K'), 'second');
});

test('values are quoted only when bare text would change their meaning', () => {
  assert.equal(formatDotenvValue('AIzaSyA-1_b2c'), 'AIzaSyA-1_b2c');
  assert.equal(formatDotenvValue('sk-proj-abc/def+ghi='), 'sk-proj-abc/def+ghi=');
  assert.equal(formatDotenvValue('has space'), "'has space'");
  assert.equal(formatDotenvValue('has#hash'), "'has#hash'");
  assert.equal(formatDotenvValue('say "hi"'), '\'say "hi"\'');
  assert.equal(formatDotenvValue("it's here"), '"it\'s here"');
  assert.equal(formatDotenvValue(''), '');
});

test('an awkward value survives the write/read round trip intact', () => {
  // The first version of the writer escaped double quotes as \\" and produced a
  // file dotenv reads back truncated — a silently corrupted key. Single quotes
  // are literal to dotenv, so they are the safe wrapper.
  for (const awkward of ['key with "quotes" # and a hash', 'has space', 'trailing#hash', "it's fine"]) {
    const { text } = upsertDotenv('', { WEIRD: awkward });
    assert.equal(parseDotenv(text).get('WEIRD'), awkward, `round trip failed for ${awkward}`);
  }
});

test('a value that no quoting can represent is refused, not mangled', () => {
  assert.throws(() => formatDotenvValue('both \' and " quotes'), /cannot be written to \.env/);
});

test('a value carrying a line break is refused, not silently split', () => {
  // The reason this check exists: without it one pasted "key" could define
  // extra variables in the user's .env.
  assert.throws(
    () => assertWritableValue('OPENAI_API_KEY', 'sk-good\nEVIL=1'),
    /may not contain a line break/,
  );
  assert.throws(() => upsertDotenv('', { A: 'x\ny' }), /line break/);
});

test('control characters and absurd lengths are refused', () => {
  assert.throws(() => assertWritableValue('A', `bell${String.fromCharCode(7)}`), /control characters/);
  assert.throws(() => assertWritableValue('A', 'x'.repeat(MAX_VALUE_LENGTH + 1)), /longer than/);
  assert.ok(hasControlCharacter(String.fromCharCode(0)));
  assert.ok(hasControlCharacter(String.fromCharCode(0x7f)));
  assert.equal(hasControlCharacter('ordinary-key_123'), false);
});

test('surrounding whitespace from a sloppy paste is trimmed away', () => {
  assert.equal(assertWritableValue('A', '  sk-test  '), 'sk-test');
  const { text } = upsertDotenv('', { OPENAI_API_KEY: '  sk-test  ' });
  assert.equal(parseDotenv(text).get('OPENAI_API_KEY'), 'sk-test');
});

test('an unterminated quote keeps its content instead of vanishing', () => {
  assert.equal(decodeDotenvValue('"unclosed'), 'unclosed');
  assert.equal(decodeDotenvValue('   '), '');
});

test('the copyable snippet skips blanks and quotes what it must', () => {
  assert.equal(
    dotenvSnippet({ OPENAI_API_KEY: 'sk-1', FIRMS_MAP_KEY: '  ', TOMTOM_API_KEY: 'a b' }),
    "OPENAI_API_KEY=sk-1\nTOMTOM_API_KEY='a b'",
  );
  assert.equal(dotenvSnippet({}), '');
});
