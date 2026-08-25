/**
 * Turning "is this key configured?" into something a person can act on.
 *
 * The naive answer is a checkmark, and it is wrong often enough to waste an
 * afternoon. Three facts have to be reconciled:
 *
 *  - what the running server actually holds (`process.env`), which is what
 *    every proxy reads;
 *  - what the `.env` file on disk says, which is what the user just edited;
 *  - the fact that `vite.config.js` applies dotenv values only where
 *    `process.env` has no value yet — a shell export or a Keychain-sourced
 *    launcher value silently wins, and so does a value the process picked up
 *    before the file changed.
 *
 * So a variable can be present in the file and still have no effect. This
 * module names that state (`conflict`) instead of showing a green tick over a
 * key that is not being used, and names the ordinary "saved, needs a restart"
 * state (`pending`) separately so the console can tell the user which one they
 * are looking at.
 *
 * Everything here is pure: the dev server computes the three booleans (it is
 * the only side that may see secret values) and the page renders the result.
 */

import { PROVIDERS, requiredProviders } from './providerCatalog.js';

/** Every state a single environment variable can be in, worst first. */
export const VARIABLE_STATES = Object.freeze(['conflict', 'missing', 'pending', 'active']);

/**
 * Classify one variable from what the server observed.
 *
 * @param {Object} [observation]
 * @param {boolean} [observation.processSet] - `process.env` holds a non-empty value.
 * @param {boolean} [observation.fileSet] - The `.env` file declares a non-empty value.
 * @param {boolean} [observation.valuesMatch] - The two are byte-identical.
 * @returns {'active'|'pending'|'conflict'|'missing'}
 */
export function resolveVariableState({ processSet = false, fileSet = false, valuesMatch = false } = {}) {
  if (!processSet && !fileSet) return 'missing';
  // Saved to the file but not yet loaded: the next server start will apply it,
  // because the config hook only fills variables that are still undefined.
  if (!processSet && fileSet) return 'pending';
  // The process is running on a value the file does not agree with. That value
  // keeps winning until the whole process restarts.
  if (processSet && fileSet && !valuesMatch) return 'conflict';
  return 'active';
}

/**
 * Where an active value came from, as far as the server can tell.
 *
 * @param {Object} [observation]
 * @param {boolean} [observation.fileSet]
 * @param {boolean} [observation.valuesMatch]
 * @returns {'dotenv'|'environment'|null} Null when nothing is active.
 */
export function activeValueSource({ processSet = false, fileSet = false, valuesMatch = false } = {}) {
  if (!processSet) return null;
  return fileSet && valuesMatch ? 'dotenv' : 'environment';
}

/** Short badge text for a variable state. */
export function variableStateLabel(state) {
  if (state === 'active') return 'ACTIVE';
  if (state === 'pending') return 'RESTART TO APPLY';
  if (state === 'conflict') return 'OVERRIDDEN';
  return 'NOT SET';
}

/**
 * One sentence explaining a state, and what to do about it.
 *
 * The conflict copy names both causes because the server genuinely cannot tell
 * them apart: an exported shell variable and a value loaded before the file
 * changed look identical from inside the process.
 */
export function variableStateDetail(state, name = 'this variable') {
  if (state === 'active') return `${name} is loaded and in use.`;
  if (state === 'pending') return `${name} is saved in .env but the running server has not loaded it yet. Restart the dev server.`;
  if (state === 'conflict') {
    return `${name} is set in .env, but the running server holds a different value and keeps using it. `
      + 'Either your shell (or the macOS Keychain launcher) exports it, or the process started before the file changed. '
      + 'Stop the dev server and start it again — and unset the shell export if you have one.';
  }
  return `${name} is not set anywhere the server can see it.`;
}

/**
 * Roll a provider's variables up into one state.
 *
 * A provider is only `active` when every variable it needs is active — OpenSky
 * OAuth is useless with just the client id — and otherwise reports the worst
 * state present, so a conflict is never hidden behind a sibling that is fine.
 *
 * @param {{vars: Array<{name: string}>}} provider
 * @param {Record<string, {state: string}>} statuses - Keyed by variable name.
 * @returns {'active'|'pending'|'conflict'|'missing'|'partial'}
 */
export function providerState(provider, statuses = {}) {
  const states = provider.vars.map((v) => statuses[v.name]?.state || 'missing');
  if (states.every((state) => state === 'active')) return 'active';
  if (states.includes('conflict')) return 'conflict';
  if (states.some((state) => state === 'active')) return 'partial';
  if (states.includes('pending')) return 'pending';
  return 'missing';
}

/** Short badge text for a provider-level state. */
export function providerStateLabel(state) {
  if (state === 'partial') return 'INCOMPLETE';
  return variableStateLabel(state);
}

/**
 * Mask a credential for display.
 *
 * The tail is the only part shown, because the one question a person actually
 * asks here is "is that the key I just pasted?" — and four characters answer it
 * without putting the secret back on screen. Short values reveal nothing at all.
 *
 * @param {number} length - Full length of the value.
 * @param {string} tail - Its last few characters.
 * @returns {string} A fixed-width mask, e.g. `••••••••3f9a`.
 */
export function maskedValue(length, tail) {
  const visible = String(tail || '');
  const size = Number(length) || 0;
  if (!size) return '';
  if (!visible || size < 12) return '•'.repeat(Math.min(size, 12));
  return `${'•'.repeat(Math.min(Math.max(size - visible.length, 1), 16))}${visible}`;
}

/**
 * Headline readiness for the top of the console.
 *
 * "Required" is treated separately from the count because the two answer
 * different questions: whether the app will start at all, and how much of the
 * globe is lit up.
 *
 * @param {Record<string, {state: string}>} statuses
 * @param {Array<object>} [providers]
 * @returns {{configured: number, total: number, requiredMet: number, requiredTotal: number,
 *   blocked: boolean, headline: string, tone: 'blocked'|'partial'|'complete'}}
 */
export function readinessSummary(statuses = {}, providers = PROVIDERS) {
  const configured = providers.filter((provider) => providerState(provider, statuses) === 'active').length;
  const required = requiredProviders(providers);
  const requiredMet = required.filter((provider) => providerState(provider, statuses) === 'active').length;
  const blocked = requiredMet < required.length;
  const total = providers.length;

  let headline;
  let tone;
  if (blocked) {
    headline = 'The globe will not start yet — the required key is missing.';
    tone = 'blocked';
  } else if (configured === total) {
    headline = 'Every provider is configured. Full sensor suite online.';
    tone = 'complete';
  } else {
    headline = `${configured} of ${total} providers configured — the rest of the globe still runs keyless.`;
    tone = 'partial';
  }

  return { configured, total, requiredMet, requiredTotal: required.length, blocked, headline, tone };
}

/**
 * Whether anything on the page is waiting on a dev-server restart, and why.
 *
 * @param {Record<string, {state: string}>} statuses
 * @returns {{needed: boolean, pending: string[], conflicting: string[]}}
 */
export function restartAdvice(statuses = {}) {
  const pending = [];
  const conflicting = [];
  for (const [name, status] of Object.entries(statuses)) {
    if (status?.state === 'pending') pending.push(name);
    if (status?.state === 'conflict') conflicting.push(name);
  }
  pending.sort();
  conflicting.sort();
  return { needed: pending.length > 0 || conflicting.length > 0, pending, conflicting };
}

export default readinessSummary;
