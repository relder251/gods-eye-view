/**
 * The `/setup` console — every account God's Eye View can use, where to get its
 * credential, and whether the running server is actually holding it.
 *
 * The page is rendered entirely from `providerCatalog.js`, so the links, steps,
 * and costs shown here are the ones the unit tests assert. Live status comes
 * from the loopback-only `/api/setup/status` endpoint; when that endpoint is
 * absent — a built copy of this page, or a browser on another machine — the
 * console degrades to its offline half: the same links, the same instructions,
 * and a copyable `.env` block instead of a save button. Nothing here is a
 * dead end.
 *
 * DOM only. Every decision worth asserting lives in the pure modules alongside
 * this one.
 */

import { dotenvSnippet } from './dotenvFile.js';
import {
  KEYLESS_LAYERS,
  PROVIDERS,
  groupedProviders,
  requirementLabel,
  tierLabel,
} from './providerCatalog.js';
import {
  maskedValue,
  providerState,
  providerStateLabel,
  readinessSummary,
  restartAdvice,
  variableStateDetail,
  variableStateLabel,
} from './keyStatus.js';

/** Copy shown above each requirement group. */
const GROUP_COPY = Object.freeze({
  required: {
    title: 'Required to start',
    note: 'Without this the app throws on boot — there is no planet to draw.',
  },
  recommended: {
    title: 'Lights up a dark layer',
    note: 'Each of these turns on something the globe cannot show at all right now.',
  },
  optional: {
    title: 'Raises a limit',
    note: 'These layers already work. A credential only buys a bigger allowance.',
  },
});

const state = {
  /** Latest `/api/setup/status` payload, or null when the endpoint is unreachable. */
  status: null,
  /** True once we know the dev server is not answering — drives offline copy. */
  offline: false,
  filter: 'all',
};

const dom = {};

/** Build an element with attributes and children in one call. */
function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Current per-variable status map, or an empty one before the first probe. */
function variables() {
  return state.status?.variables || {};
}

/** An external link that cannot be used to navigate this page's opener. */
function externalLink(url, label, className) {
  return el('a', { class: className, href: url, target: '_blank', rel: 'noopener noreferrer' }, [label]);
}

function toast(message, tone = '') {
  dom.toast.textContent = message;
  dom.toast.dataset.tone = tone;
  dom.toast.classList.add('visible');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => dom.toast.classList.remove('visible'), 3200);
}

/** Copy text, reporting honestly when the browser refuses. */
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`, 'ok');
  } catch {
    toast('Clipboard blocked — select the text and copy it', 'error');
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** One provider card: what it unlocks, how to get it, and where to paste it. */
function renderCard(provider) {
  const card = el('section', {
    class: 'card',
    'data-provider': provider.id,
    'data-tier': provider.tier,
    'data-required': provider.requirement,
  });

  const badges = el('div', { class: 'card-badges' }, [
    provider.requirement === 'required'
      ? el('span', { class: 'badge badge-required', text: requirementLabel(provider.requirement) })
      : null,
    el('span', { class: `badge badge-tier-${provider.tier}`, text: tierLabel(provider.tier) }),
    el('span', {
      class: 'badge badge-exposure',
      title: provider.exposure === 'client'
        ? 'Compiled into the browser bundle by design — restrict it at the provider'
        : 'Brokered by the dev server; the browser never sees it',
      text: provider.exposure === 'client' ? 'BROWSER-EXPOSED' : 'SERVER-SIDE',
    }),
    el('span', { class: 'badge badge-state', 'data-state': 'unknown', text: '—' }),
  ]);

  card.append(el('div', { class: 'card-head' }, [
    badges,
    el('h3', { text: provider.name }),
    el('p', { class: 'card-summary', text: provider.summary }),
  ]));

  const body = el('div', { class: 'card-body' });

  body.append(el('div', {}, [
    el('div', { class: 'section-label', text: 'What it unlocks' }),
    el('ul', { class: 'unlocks' }, provider.unlocks.map((item) => el('li', { text: item }))),
  ]));

  body.append(el('div', {}, [
    el('div', { class: 'section-label', text: 'How to get it' }),
    el('ol', { class: 'steps' }, provider.steps.map((step) => el('li', {}, [
      el('div', { class: 'step-body' }, [
        el('span', {}, [step.text]),
        step.url ? externalLink(step.url, `${step.urlLabel} ↗`, 'step-link') : null,
      ]),
    ]))),
  ]));

  body.append(el('div', { class: 'links' }, [
    externalLink(provider.primaryAction.url, `${provider.primaryAction.label} ↗`, 'btn btn-primary btn-small'),
    ...provider.links.map((link) => externalLink(link.url, link.label, 'link-pill')),
  ]));

  body.append(el('div', {}, [
    el('p', { class: 'fineprint' }, [el('strong', { text: 'Cost: ' }), provider.cost]),
    ...provider.notes.map((note) => el('p', { class: 'fineprint', text: note })),
  ]));

  const form = el('form', { class: 'card-form', 'data-provider': provider.id });
  for (const variable of provider.vars) {
    const inputId = `input-${variable.name}`;
    form.append(el('div', { class: 'field' }, [
      el('div', { class: 'field-head' }, [
        el('label', { for: inputId, text: variable.name }),
        el('span', { class: 'field-state', 'data-field-state': variable.name, text: '' }),
      ]),
      el('input', {
        id: inputId,
        name: variable.name,
        type: 'password',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        placeholder: variable.placeholder,
        'aria-describedby': `detail-${variable.name}`,
      }),
      el('p', { class: 'var-detail', id: `detail-${variable.name}`, 'data-var-detail': variable.name, text: '' }),
    ]));
  }

  form.append(el('div', { class: 'form-actions' }, [
    el('button', { type: 'submit', class: 'btn btn-primary btn-small', 'data-save': provider.id, text: 'Save to .env' }),
    el('button', { type: 'button', class: 'btn btn-small', 'data-copy-line': provider.id, text: 'Copy .env lines' }),
    el('button', { type: 'button', class: 'btn btn-small', 'data-reveal': provider.id, text: 'Show' }),
  ]));

  form.append(el('p', {
    class: 'form-message',
    role: 'status',
    'aria-live': 'polite',
    'data-message': provider.id,
    text: '',
  }));

  body.append(form);
  card.append(body);
  return card;
}

/** All provider groups, in requirement order. */
function renderGroups() {
  dom.groups.replaceChildren(...groupedProviders().map((group) => {
    const copy = GROUP_COPY[group.requirement];
    return el('section', { class: 'group' }, [
      el('div', { class: 'group-head' }, [
        el('h2', { text: copy.title }),
        el('span', { class: 'group-note', text: copy.note }),
      ]),
      el('div', { class: 'cards' }, group.providers.map(renderCard)),
    ]);
  }));
}

/** The keyless roster, so the page is honest about how much needs nothing. */
function renderFreeFloor() {
  dom.freeFloor.append(
    el('div', { class: 'section-label', text: 'Already running, no account required' }),
    el('p', {
      class: 'fineprint',
      text: `${KEYLESS_LAYERS.length} of the layers on the globe need no key, no signup, and no card. `
        + 'Nothing on this page is required to see them.',
    }),
    el('div', { class: 'free-grid' }, KEYLESS_LAYERS.map((layer) => el('div', {}, [
      layer.name,
      el('span', { text: layer.source }),
    ]))),
  );
}

// ── Live status ─────────────────────────────────────────────────────────────

/** Repaint every status-dependent element from `state.status`. */
function paintStatus() {
  const statuses = variables();
  const summary = readinessSummary(statuses);

  dom.readiness.dataset.tone = state.offline ? 'partial' : summary.tone;
  dom.readinessHeadline.textContent = state.offline
    ? 'Live status unavailable — the checklist below still works.'
    : summary.headline;
  dom.readinessCount.textContent = state.offline
    ? 'OFFLINE MODE'
    : `${summary.configured}/${summary.total} CONFIGURED · REQUIRED ${summary.requiredMet}/${summary.requiredTotal}`;

  dom.meter.replaceChildren(...PROVIDERS.map((provider) => el('span', {
    class: 'meter-seg',
    'data-state': state.offline ? 'unknown' : providerState(provider, statuses),
    title: provider.name,
  })));

  for (const provider of PROVIDERS) {
    const card = dom.groups.querySelector(`[data-provider="${provider.id}"]`);
    if (!card) continue;
    const badge = card.querySelector('.badge-state');
    const resolved = state.offline ? 'unknown' : providerState(provider, statuses);
    card.dataset.state = resolved;
    badge.dataset.state = resolved;
    badge.textContent = state.offline ? 'STATUS UNKNOWN' : providerStateLabel(resolved);

    for (const variable of provider.vars) {
      const status = statuses[variable.name];
      const fieldState = card.querySelector(`[data-field-state="${variable.name}"]`);
      const detail = card.querySelector(`[data-var-detail="${variable.name}"]`);
      if (state.offline || !status) {
        fieldState.textContent = '';
        detail.textContent = '';
        detail.removeAttribute('data-tone');
        continue;
      }
      fieldState.textContent = status.state === 'missing'
        ? variableStateLabel(status.state)
        : `${variableStateLabel(status.state)} · ${maskedValue(status.length, status.tail) || 'set'}`;
      detail.textContent = status.state === 'active' && status.source === 'environment'
        ? 'Loaded from the environment (a shell export or the macOS Keychain launcher), not from .env.'
        : variableStateDetail(status.state, variable.name);
      detail.dataset.tone = { conflict: 'alert', pending: 'warn' }[status.state] || '';
    }
  }

  paintRestartNotice();
  paintExposureNotice();
  applyFilter();
}

/** The banner that explains why a just-saved key is not live yet. */
function paintRestartNotice() {
  const advice = restartAdvice(variables());
  if (state.offline || !advice.needed) {
    dom.restartNotice.hidden = true;
    return;
  }
  dom.restartNotice.hidden = false;
  dom.restartNotice.dataset.tone = advice.conflicting.length ? 'alert' : 'warn';
  dom.restartNotice.replaceChildren(
    el('div', {}, [
      advice.pending.length
        ? el('p', {}, [
          el('strong', { text: 'Restart the dev server. ' }),
          `${advice.pending.join(', ')} ${advice.pending.length === 1 ? 'is' : 'are'} saved in .env but not yet loaded. `,
          'Vite reloads .env on change, but a value the process already holds is never replaced in place — stop it and run ',
          el('code', { text: 'npm run dev' }),
          ' again.',
        ])
        : null,
      advice.conflicting.length
        ? el('p', { style: advice.pending.length ? 'margin-top:8px' : '' }, [
          el('strong', { text: 'Being overridden. ' }),
          `${advice.conflicting.join(', ')} ${advice.conflicting.length === 1 ? 'is' : 'are'} set in .env, but the running server holds a different value and keeps using it. `,
          'Either your shell exports it (check with ',
          el('code', { text: 'env | grep KEY_NAME' }),
          ') or the process started before the file changed. Unset the export, then restart.',
        ])
        : null,
    ]),
  );
}

/** Say plainly when this server is brokering keys to the whole network. */
function paintExposureNotice() {
  if (!state.status?.networkExposed) {
    dom.exposureNotice.hidden = true;
    return;
  }
  dom.exposureNotice.hidden = false;
  dom.exposureNotice.dataset.tone = 'alert';
  dom.exposureNotice.replaceChildren(el('div', {}, [
    el('strong', { text: 'This server is bound to the network. ' }),
    `HOST is ${state.status.host}, so every device that can reach this machine can drive the proxies and spend the quota on every key below. `,
    'This page itself stays loopback-only, but the layers do not. Set provider-side budgets first — see SECURITY.md.',
  ]));
}

/** Ask the dev server what it is holding. Absence is a supported state. */
async function refreshStatus() {
  try {
    const response = await fetch('/api/setup/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(String(response.status));
    state.status = await response.json();
    state.offline = false;
  } catch {
    state.status = null;
    state.offline = true;
  }
  paintStatus();
  paintOfflineHelp();
}

/**
 * Explain the offline half of the page, rather than showing dead controls.
 *
 * Every call sets the enabled state of the save controls outright, in both
 * directions. Only ever disabling them meant a single transient status failure
 * — the dev server is restarting after a save, which it does on every write —
 * left every save button dead for the rest of the page's life: the next
 * successful recheck reported "Status refreshed" and re-enabled nothing.
 */
function paintOfflineHelp() {
  const writeBlocked = !state.offline && state.status && !state.status.canWrite;
  const canSave = !state.offline && !writeBlocked;

  for (const button of dom.groups.querySelectorAll('[data-save]')) {
    button.disabled = !canSave;
    if (canSave) button.removeAttribute('title');
    else button.title = 'Saving needs the local dev server';
  }
  dom.saveAll.hidden = !canSave;
  refreshSnippet();

  dom.offlineNotice.hidden = !(state.offline || writeBlocked);
  if (dom.offlineNotice.hidden) return;
  dom.offlineNotice.dataset.tone = 'warn';
  dom.offlineNotice.replaceChildren(el('div', {}, state.offline
    ? [
      el('strong', { text: 'No dev server on the other end. ' }),
      'Live key status and saving are unavailable — this is what a built copy of the page, or a browser on another machine, sees. ',
      'Everything else works: follow the steps, then paste the generated block into ',
      el('code', { text: '.env' }),
      ' yourself using "Copy .env lines".',
    ]
    : [
      el('strong', { text: 'Saving is disabled. ' }),
      state.status.writeBlockedReason || 'The server declined to write .env.',
      ' Use "Copy .env lines" and edit the file directly.',
    ]));
}

// ── Actions ─────────────────────────────────────────────────────────────────

/** Collect a card's non-empty inputs. */
function formValues(form) {
  const values = {};
  for (const input of form.querySelectorAll('input')) {
    const value = input.value.trim();
    if (value) values[input.name] = value;
  }
  return values;
}

function setMessage(providerId, text, tone = '') {
  const message = dom.groups.querySelector(`[data-message="${providerId}"]`);
  if (!message) return;
  message.textContent = text;
  message.dataset.tone = tone;
}

/**
 * Write values to `.env` and repaint from the status the server returns.
 *
 * Note what happens right after this resolves: writing `.env` makes Vite
 * restart and push a full reload to this page. That is fine for values already
 * on disk — the reloaded page re-reads status and shows the new state — but it
 * discards anything still sitting unsaved in another card, which is why
 * `saveEverythingTyped` exists and why `armUnsavedGuard` catches the rest.
 *
 * @param {Record<string, string>} values
 * @returns {Promise<{seededFromExample: boolean}>}
 */
async function postValues(values) {
  const response = await fetch('/api/setup/env', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
  state.status = payload.status || state.status;
  state.offline = false;
  return payload;
}

/** Copy shown after a successful write, in both save paths. */
function savedMessage(payload) {
  return payload.seededFromExample
    ? 'Saved — .env created from .env.example. Restart the dev server to load it.'
    : 'Saved to .env. Restart the dev server to load it.';
}

/** POST one card's values, then repaint from the status the server returns. */
async function saveProvider(form) {
  const providerId = form.dataset.provider;
  const values = formValues(form);
  if (!Object.keys(values).length) {
    setMessage(providerId, 'Nothing to save — paste a value first.', 'error');
    return;
  }

  const button = form.querySelector('[data-save]');
  button.disabled = true;
  setMessage(providerId, 'Saving…');
  try {
    const payload = await postValues(values);
    // The value is on disk now; leaving it in the box invites a second save and
    // keeps a secret on screen for no reason.
    for (const input of form.querySelectorAll('input')) input.value = '';
    paintStatus();
    refreshSnippet();
    setMessage(providerId, savedMessage(payload), 'ok');
    toast('Written to .env', 'ok');
  } catch (error) {
    setMessage(providerId, error?.message || 'Save failed', 'error');
    toast('Save failed', 'error');
  } finally {
    button.disabled = false;
  }
}

/**
 * Write every value typed across the page in a single request.
 *
 * One write means one Vite restart and one reload, so filling in several
 * providers before saving cannot cost you the ones you had not got to yet.
 */
async function saveEverythingTyped() {
  const values = collectAllTyped();
  const names = Object.keys(values);
  if (!names.length) {
    dom.snippetNote.textContent = 'Nothing typed in yet — paste a key into a card above first.';
    return;
  }
  dom.saveAll.disabled = true;
  try {
    const payload = await postValues(values);
    for (const input of dom.groups.querySelectorAll('input')) input.value = '';
    paintStatus();
    refreshSnippet();
    for (const provider of PROVIDERS) {
      if (provider.vars.some((v) => names.includes(v.name))) {
        setMessage(provider.id, savedMessage(payload), 'ok');
      }
    }
    dom.snippetNote.textContent = `Saved ${names.length} value${names.length === 1 ? '' : 's'} to .env. Restart the dev server to load them.`;
    toast(`Wrote ${names.length} to .env`, 'ok');
  } catch (error) {
    dom.snippetNote.textContent = error?.message || 'Save failed';
    toast('Save failed', 'error');
  } finally {
    dom.saveAll.disabled = false;
  }
}

/** Rebuild the copy-everything block from whatever is currently typed in. */
function collectAllTyped() {
  const values = {};
  for (const form of dom.groups.querySelectorAll('form.card-form')) {
    Object.assign(values, formValues(form));
  }
  return values;
}

function refreshSnippet() {
  const values = collectAllTyped();
  let snippet = '';
  try {
    snippet = dotenvSnippet(values);
  } catch (error) {
    dom.snippet.textContent = '';
    dom.snippetNote.textContent = error?.message || 'One of those values cannot be written to .env.';
    return;
  }
  dom.snippet.textContent = snippet;
  dom.snippetNote.textContent = snippet
    ? 'Paste this into .env at the repository root, then restart the dev server.'
    : 'Paste keys into the cards above and they appear here, ready to copy into .env.';
  dom.copyAll.disabled = !snippet;
  dom.saveAll.disabled = !snippet || state.offline || state.status?.canWrite === false;
  dom.saveAll.hidden = state.offline || state.status?.canWrite === false;
}

function applyFilter() {
  const statuses = variables();
  for (const card of dom.groups.querySelectorAll('.card')) {
    const provider = PROVIDERS.find((candidate) => candidate.id === card.dataset.provider);
    const resolved = state.offline ? 'unknown' : providerState(provider, statuses);
    const visible = state.filter === 'all'
      || (state.filter === 'required' && provider.requirement === 'required')
      || (state.filter === 'free' && provider.tier === 'free')
      || (state.filter === 'metered' && provider.tier === 'metered')
      || (state.filter === 'todo' && resolved !== 'active');
    card.hidden = !visible;
  }
  for (const group of dom.groups.querySelectorAll('.group')) {
    group.hidden = !group.querySelector('.card:not([hidden])');
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Warn before leaving with a credential still typed in but unsaved.
 *
 * The reload this mostly guards against is one the page causes itself: writing
 * `.env` restarts Vite, which pushes a full reload. Anything unsaved in another
 * card would go with it silently.
 */
function armUnsavedGuard() {
  window.addEventListener('beforeunload', (event) => {
    if (!Object.keys(collectAllTyped()).length) return;
    event.preventDefault();
    // Chrome requires a returnValue to show its own generic prompt.
    event.returnValue = '';
  });
}

function wireEvents() {
  dom.groups.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.matches('form.card-form')) saveProvider(event.target);
  });

  dom.groups.addEventListener('input', refreshSnippet);

  dom.groups.addEventListener('click', (event) => {
    const copyTarget = event.target.closest('[data-copy-line]');
    if (copyTarget) {
      const form = copyTarget.closest('form');
      const values = formValues(form);
      if (!Object.keys(values).length) {
        setMessage(form.dataset.provider, 'Paste a value first, then copy.', 'error');
        return;
      }
      copyText(dotenvSnippet(values), '.env lines');
      return;
    }

    const revealTarget = event.target.closest('[data-reveal]');
    if (revealTarget) {
      const inputs = [...revealTarget.closest('form').querySelectorAll('input')];
      const hidden = inputs.some((input) => input.type === 'password');
      for (const input of inputs) input.type = hidden ? 'text' : 'password';
      revealTarget.textContent = hidden ? 'Hide' : 'Show';
    }
  });

  dom.filters.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    for (const other of dom.filters.querySelectorAll('.chip')) {
      other.setAttribute('aria-pressed', String(other === chip));
    }
    applyFilter();
  });

  dom.copyAll.addEventListener('click', () => copyText(dom.snippet.textContent, '.env block'));
  dom.saveAll.addEventListener('click', saveEverythingTyped);
  dom.copyKeychain.addEventListener('click', () => copyText(dom.keychain.textContent, 'Keychain commands'));
  dom.refresh.addEventListener('click', async () => {
    await refreshStatus();
    toast(state.offline ? 'Dev server not reachable' : 'Status refreshed', state.offline ? 'error' : 'ok');
  });
}

/** Every macOS Keychain command the launcher knows how to read back. */
function renderKeychain() {
  const lines = PROVIDERS.flatMap((provider) => (provider.keychain || []).map(
    (entry) => `security add-generic-password -U -s "${entry.service}" -a "${entry.account}" -w`,
  ));
  dom.keychain.textContent = lines.join('\n');
}

function init() {
  Object.assign(dom, {
    groups: document.getElementById('provider-groups'),
    filters: document.getElementById('filters'),
    freeFloor: document.getElementById('free-floor'),
    readiness: document.getElementById('readiness'),
    readinessHeadline: document.getElementById('readiness-headline'),
    readinessCount: document.getElementById('readiness-count'),
    meter: document.getElementById('readiness-meter'),
    restartNotice: document.getElementById('restart-notice'),
    exposureNotice: document.getElementById('exposure-notice'),
    offlineNotice: document.getElementById('offline-notice'),
    snippet: document.getElementById('env-snippet'),
    snippetNote: document.getElementById('env-snippet-note'),
    copyAll: document.getElementById('copy-all'),
    saveAll: document.getElementById('save-all'),
    keychain: document.getElementById('keychain-commands'),
    copyKeychain: document.getElementById('copy-keychain'),
    refresh: document.getElementById('refresh-status'),
    toast: document.getElementById('toast'),
  });

  renderGroups();
  renderFreeFloor();
  renderKeychain();
  refreshSnippet();
  wireEvents();
  armUnsavedGuard();
  paintStatus();
  void refreshStatus();
}

init();
