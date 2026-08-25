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
