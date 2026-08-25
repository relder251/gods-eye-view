/**
 * Minimal, comment-preserving `.env` editing for the `/setup` console.
 *
 * The console writes real keys into the user's `.env`, and that file is
 * hand-authored: it is full of explanatory comments, and the optional keys ship
 * commented out (`# FIRMS_MAP_KEY=`). A naive rewrite would flatten all of that
 * into a bare list of assignments, so every function here edits lines in place
 * and only ever appends when there is nothing to edit.
 *
 * `parseDotenv` reports what the FILE says, which is deliberately not the same
 * question as what `process.env` holds — a shell export or a Keychain value
 * wins over the file, and telling those two apart is what lets the console warn
 * that an edit will not take effect (see keyStatus.js).
 *
 * This is not a general dotenv implementation. It covers the syntax this repo's
 * `.env.example` actually uses: `NAME=value`, an optional `export ` prefix,
 * single- or double-quoted values, `#` comments, and blank lines.
 */

/** Assignment line, with optional `export ` and surrounding whitespace. */
const ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** A commented-out assignment, which `.env.example` uses for optional keys. */
const COMMENTED_ASSIGNMENT_RE = /^(\s*)#\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Longest value we will write. Real credentials are far shorter; this is a guard, not a limit. */
export const MAX_VALUE_LENGTH = 4096;

/**
 * Whether a string contains a C0 control character or DEL.
 *
 * Written as a codepoint scan rather than a character-class regex so this
 * source file stays free of literal control characters itself.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasControlCharacter(text) {
  for (const character of String(text ?? '')) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Strip quotes and inline comments from a raw dotenv right-hand side.
 *
 * An unquoted value ends at a `#`, matching dotenv. A quoted value is taken
 * literally to its closing quote, so a key containing `#` survives as long as
 * the user quoted it.
 *
 * @param {string} raw - Everything after the first `=`.
 * @returns {string} The decoded value.
 */
export function decodeDotenvValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    // dotenv allows a backslash-escaped quote inside the run, so the closing
    // quote is the first one not preceded by a backslash.
    let closing = -1;
    for (let i = 1; i < text.length; i += 1) {
      if (text[i] === '\\') { i += 1; continue; }
      if (text[i] === quote) { closing = i; break; }
    }
    if (closing > 0) {
      const body = text.slice(1, closing);
      // dotenv expands only \n and \r, and only inside double quotes. It does
      // NOT collapse \" or \\, so neither does this — reporting more than
      // dotenv does would make the file/process comparison lie.
      return quote === '"' ? body.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : body;
    }
    // Unterminated quote: treat the rest as literal rather than dropping it.
    return text.slice(1);
  }
  const hash = text.indexOf('#');
  return (hash === -1 ? text : text.slice(0, hash)).trim();
}

/**
 * Read the assignments a `.env` text declares.
 *
 * Later assignments win, which is how dotenv resolves a duplicated name.
 *
 * @param {string} text - Full file contents.
 * @returns {Map<string, string>} Name to decoded value, in first-seen order.
 */
export function parseDotenv(text) {
  const values = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = ASSIGNMENT_RE.exec(line);
    if (!match) continue;
    values.set(match[1], decodeDotenvValue(match[2]));
  }
  return values;
}

/**
 * Render a value for the right-hand side of an assignment.
 *
 * The rule this follows is "write only what dotenv reads back unchanged",
 * because anything else corrupts a key silently:
 *
 *  - plain credentials go in bare, so the file keeps reading like the example
 *    it was copied from;
 *  - anything that would change meaning unquoted (whitespace, `#`, a quote) is
 *    single-quoted, which dotenv treats as fully literal;
 *  - a value containing a single quote falls back to double quotes, which are
 *    safe as long as the value has no backslash or double quote of its own —
 *    dotenv expands `\n` and `\r` inside them and does not honour `\"`.
 *
 * A value that fits none of those is rejected rather than mangled.
 *
 * @param {string} value
 * @returns {string} The literal to write after `=`.
 * @throws {Error} When no representation round-trips.
 */
export function formatDotenvValue(value) {
  const text = String(value ?? '');
  if (text === '') return '';
  if (/^[A-Za-z0-9_@.:/+=~-]+$/.test(text)) return text;
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"') && !text.includes('\\')) return `"${text}"`;
  throw new Error('value mixes quote characters and cannot be written to .env; set it as an environment variable instead');
}

/**
 * Reject a value that cannot be safely written as one assignment line.
 *
 * A newline is the one that matters: it would let a single pasted "key" define
 * additional variables. Length and other control characters are belt-and-braces.
 *
 * @param {string} name - Variable name, for the error message.
 * @param {string} value
 * @returns {string} The accepted value, trimmed of surrounding whitespace.
 * @throws {Error} When the value cannot be written.
 */
export function assertWritableValue(name, value) {
  const text = String(value ?? '');
  if (/[\r\n]/.test(text)) throw new Error(`${name} may not contain a line break`);
  if (hasControlCharacter(text)) throw new Error(`${name} may not contain control characters`);
  if (text.length > MAX_VALUE_LENGTH) {
    throw new Error(`${name} is longer than ${MAX_VALUE_LENGTH} characters`);
  }
  return text.trim();
}

/**
 * Apply values to a `.env` text, editing in place wherever possible.
 *
 * Resolution order for each name:
 *  1. an existing live assignment is rewritten where it stands;
 *  2. otherwise a commented-out placeholder (`# FIRMS_MAP_KEY=`) is activated,
 *     which keeps the key under the explanatory comment block that describes
 *     it in `.env.example`;
 *  3. otherwise the assignment is appended under a single generated heading.
 *
 * @param {string} text - Current file contents (may be empty).
 * @param {Record<string, string>|Map<string, string>} values - Names to values.
 * @returns {{text: string, updated: string[], activated: string[], appended: string[]}}
 *   The new contents and which names took which path.
 */
export function upsertDotenv(text, values) {
  const entries = values instanceof Map ? [...values.entries()] : Object.entries(values || {});
  const pending = new Map(entries.map(([name, value]) => [name, assertWritableValue(name, value)]));
  const lines = String(text ?? '').split('\n');
  const updated = [];
  const activated = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = ASSIGNMENT_RE.exec(lines[i]);
    if (!match || !pending.has(match[1])) continue;
    const name = match[1];
    lines[i] = `${name}=${formatDotenvValue(pending.get(name))}`;
    pending.delete(name);
    updated.push(name);
  }

  for (let i = 0; i < lines.length && pending.size; i += 1) {
    const match = COMMENTED_ASSIGNMENT_RE.exec(lines[i]);
    if (!match || !pending.has(match[2])) continue;
    const name = match[2];
    lines[i] = `${name}=${formatDotenvValue(pending.get(name))}`;
    pending.delete(name);
    activated.push(name);
  }

  const appended = [...pending.keys()];
  if (appended.length) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push("# Added by the God's Eye View setup console.");
    for (const name of appended) lines.push(`${name}=${formatDotenvValue(pending.get(name))}`);
  }

  let next = lines.join('\n');
  if (next && !next.endsWith('\n')) next += '\n';
  return { text: next, updated, activated, appended };
}

/**
 * Build a copyable `.env` snippet for the values a user has entered.
 *
 * This is the fallback path: a built/static deployment has no server to write
 * the file, and some people would simply rather paste it themselves.
 *
 * @param {Record<string, string>|Map<string, string>} values
 * @returns {string} Assignment lines, one per non-empty value.
 */
export function dotenvSnippet(values) {
  const entries = values instanceof Map ? [...values.entries()] : Object.entries(values || {});
  return entries
    .filter(([, value]) => String(value ?? '').trim() !== '')
    .map(([name, value]) => `${name}=${formatDotenvValue(assertWritableValue(name, value))}`)
    .join('\n');
}

export default upsertDotenv;
