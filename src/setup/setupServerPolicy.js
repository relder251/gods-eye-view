/**
 * The rules the `/setup` dev-server endpoints enforce before they read env
 * state or touch the user's `.env`.
 *
 * The console is a key broker's control panel: it reports which credentials
 * exist and can write new ones to disk. That is exactly the surface the rest of
 * this project keeps off the network, so the policy is deliberately narrow and
 * lives here, in a module that can be tested without a server:
 *
 *  - **Loopback only.** The gate is the real socket peer address, never a
 *    header — a forwarded-for value is client-controlled. This holds even when
 *    the operator opts into `HOST=0.0.0.0`, so sharing the globe on a LAN never
 *    shares the key console with it.
 *  - **Same-origin only.** Loopback is necessary and NOT sufficient: the
 *    developer's own browser is a loopback client, so any site they happen to
 *    have open can make it POST here. The same-origin policy stops that page
 *    reading the response, but not sending the request — which is enough to
 *    overwrite a credential with an attacker's own, quietly routing the
 *    developer's usage through the attacker's account. See
 *    `resolveRequestOrigin`.
 *  - **Allowlisted names only.** Only variables the catalog renders can be
 *    written, so a request cannot invent an assignment.
 *  - **No secret ever leaves.** Status reports presence, length, and a short
 *    tail — enough to recognize a key you just pasted, never enough to use one.
 */

import { assertWritableValue } from './dotenvFile.js';
import { activeValueSource, resolveVariableState } from './keyStatus.js';

/** How many trailing characters of a credential the status endpoint may reveal. */
export const REVEALED_TAIL_LENGTH = 4;

/** Below this length nothing is revealed — four of eight characters is a leak. */
export const MIN_LENGTH_FOR_TAIL = 12;

/** Largest write body we will read, before parsing. */
export const MAX_WRITE_BODY_BYTES = 16 * 1024;

/**
 * Whether a socket peer address is this machine.
 *
 * Node reports IPv4 peers over a dual-stack listener in the `::ffff:` mapped
 * form, and the whole `127.0.0.0/8` block is loopback, not just `127.0.0.1`.
 *
 * @param {string|undefined|null} address - `req.socket.remoteAddress`.
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  const text = String(address || '').trim().toLowerCase();
  if (!text) return false;
  const bare = text.startsWith('::ffff:') ? text.slice(7) : text;
  if (bare === '::1' || bare === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 127;
}

/**
 * Describe one environment variable without disclosing its value.
 *
 * Both inputs are read on the server: `processValue` is what the proxies
 * actually use, `fileValue` is what `.env` currently declares. Comparing them
 * here — rather than shipping either to the browser — is what lets the console
 * distinguish "saved, needs a restart" from "saved, but being overridden".
 *
 * @param {Object} [input]
 * @param {string|undefined} [input.processValue] - `process.env[name]`.
 * @param {string|undefined} [input.fileValue] - Value parsed from `.env`.
 * @returns {{state: string, source: string|null, length: number, tail: string,
 *   inFile: boolean, inProcess: boolean}}
 */
export function describeVariable({ processValue, fileValue } = {}) {
  const inProcessValue = String(processValue ?? '');
  const inFileValue = String(fileValue ?? '');
  const processSet = inProcessValue.trim() !== '';
  const fileSet = inFileValue.trim() !== '';
  const valuesMatch = processSet && fileSet && inProcessValue === inFileValue;

  const effective = processSet ? inProcessValue : inFileValue;
  const length = effective.length;
  const tail = length >= MIN_LENGTH_FOR_TAIL ? effective.slice(-REVEALED_TAIL_LENGTH) : '';

  return {
    state: resolveVariableState({ processSet, fileSet, valuesMatch }),
    source: activeValueSource({ processSet, fileSet, valuesMatch }),
    length,
    tail,
    inFile: fileSet,
    inProcess: processSet,
  };
}

/**
 * Reject a request the developer's own browser was made to send by another site.
 *
 * Three checks, of which the first is the one actually carrying the weight:
 *
 *  1. **A JSON content type is required on writes.** `application/json` is not
 *     a CORS-safelisted content type, so a cross-origin `fetch` that sets it
 *     triggers a preflight `OPTIONS`. This server answers no CORS headers, so
 *     that preflight fails and the browser never sends the write at all. The
 *     attack this closes uses `text/plain`, which needs no preflight — so
 *     accepting any content type is what made the endpoint reachable.
 *  2. **A present `Origin` must match the `Host`.** Browsers attach `Origin` to
 *     every cross-origin POST. Command-line clients omit it entirely and are
 *     not the threat here — CSRF requires a browser — so an absent `Origin` is
 *     allowed and `curl` keeps working. A literal `null` origin (sandboxed
 *     frame, `file://`) is refused rather than treated as absent.
 *  3. **A present `Sec-Fetch-Site` must say same-origin.** Redundant with the
 *     above on any current browser, and free.
 *
 * @param {Object} [request]
 * @param {Record<string, string|string[]|undefined>} [request.headers] - Node request headers.
 * @param {boolean} [request.requireJsonBody] - True for endpoints that accept a body.
 * @returns {{ok: boolean, reason: string|null}}
 */
export function resolveRequestOrigin({ headers = {}, requireJsonBody = false } = {}) {
  const header = (name) => {
    const value = headers[name];
    return String(Array.isArray(value) ? value[0] : (value ?? '')).trim();
  };

  if (requireJsonBody) {
    const contentType = header('content-type').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      return { ok: false, reason: 'Content-Type must be application/json.' };
    }
  }

  const site = header('sec-fetch-site').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') {
    return { ok: false, reason: 'Cross-site requests are not accepted.' };
  }

  const origin = header('origin');
  if (origin) {
    const host = header('host');
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || !host || originHost !== host) {
      return { ok: false, reason: 'Cross-origin requests are not accepted.' };
    }
  }

  return { ok: true, reason: null };
}

/**
 * Validate a write request body against the catalog allowlist.
 *
 * An unknown name is refused outright rather than skipped: silently dropping
 * half of a save would leave the console reporting success over a file that
 * never received the key.
 *
 * @param {unknown} payload - Parsed JSON request body.
 * @param {string[]} allowedNames - `writableVariableNames()` from the catalog.
 * @returns {Record<string, string>} The accepted, trimmed values.
 * @throws {Error} With a message safe to return to the caller.
 */
export function sanitizeWriteRequest(payload, allowedNames) {
  const values = payload && typeof payload === 'object' ? payload.values : null;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Expected a {"values": {...}} object');
  }
  const allowed = new Set(allowedNames);
  const entries = Object.entries(values);
  if (!entries.length) throw new Error('No values supplied');

  const accepted = {};
  for (const [name, raw] of entries) {
    if (!allowed.has(name)) throw new Error(`${name} is not a variable this console manages`);
    if (typeof raw !== 'string') throw new Error(`${name} must be a string`);
    accepted[name] = assertWritableValue(name, raw);
  }
  return accepted;
}

/**
 * Whether writing to `.env` is permitted for this request.
 *
 * Loopback is the hard gate. `GEV_SETUP_READONLY=1` is the operator's opt-out
 * for anyone who wants the console's links and status without letting a browser
 * page write files at all.
 *
 * @param {Object} [input]
 * @param {string|undefined} [input.remoteAddress]
 * @param {string|undefined} [input.readonlyFlag] - `process.env.GEV_SETUP_READONLY`.
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function resolveWritePermission({ remoteAddress, readonlyFlag } = {}) {
  if (!isLoopbackAddress(remoteAddress)) {
    return { allowed: false, reason: 'The setup console only answers requests from this machine.' };
  }
  if (String(readonlyFlag || '').trim() === '1') {
    return { allowed: false, reason: 'Writing is disabled by GEV_SETUP_READONLY=1.' };
  }
  return { allowed: true, reason: null };
}

export default describeVariable;
