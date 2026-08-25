/**
 * The one place a first-time user reliably lands when nothing is configured:
 * the loading screen, stuck on a red error line.
 *
 * Before the setup console existed that line said "GOOGLE_MAPS_API_KEY not
 * found. Set it as an environment variable." — accurate, and a dead end. This
 * module turns the boot failure into a destination, so the answer to the error
 * is one click away instead of a search through the README.
 *
 * It stays pure and DOM-free so `src/main.js` keeps its single job of wiring,
 * and so the copy can be asserted without a browser.
 */

import { providerForVariable } from './providerCatalog.js';

/** Where the setup console lives. */
export const SETUP_PATH = '/setup';

/**
 * Build the guidance for a failed bootstrap, when one is warranted.
 *
 * Only a missing-credential failure earns a link — pointing a WebGL crash or a
 * network fault at the key console would be a confident wrong answer, so
 * anything unrecognized returns null and the caller keeps its plain message.
 *
 * @param {unknown} error - Whatever `init()` threw.
 * @returns {{message: string, href: string, linkLabel: string, variable: string}|null}
 */
export function bootstrapKeyNotice(error) {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const match = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(text);
  if (!match) return null;

  const variable = match[1];
  const provider = providerForVariable(variable);
  if (!provider) return null;
  if (!/not found|not set|missing|required/i.test(text)) return null;

  return {
    variable,
    message: `${provider.name} is not configured, so there is no planet to draw.`,
    href: SETUP_PATH,
    linkLabel: 'Open setup — get the key',
  };
}

export default bootstrapKeyNotice;
