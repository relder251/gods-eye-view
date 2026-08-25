/**
 * The catalog of every external account God's Eye View can use, and exactly
 * where to go to get its credential.
 *
 * This file is the single source of truth behind the `/setup` console. It is
 * deliberately pure data plus small selectors: the page renders it, the unit
 * tests assert it against `.env.example`, and the dev-server write endpoint
 * uses `writableVariableNames()` as its allowlist. Adding a keyed provider
 * means adding one record here — nothing else in the setup flow needs to know.
 *
 * Three facts about a provider drive everything the console shows:
 *  - `tier` — what it costs: 'metered' (billing account), 'free' (register and
 *    paste), or 'none' (no account at all; those layers are not listed here).
 *  - `requirement` — 'required' (the app will not start without it),
 *    'recommended' (a layer stays dark without it), or 'optional' (a limit is
 *    raised, but the layer already works).
 *  - `exposure` — 'client' means the value is compiled into the browser bundle
 *    by design and MUST be restricted at the provider; 'server' means the dev
 *    server brokers it and the browser never sees it (see SECURITY.md).
 *
 * Link accuracy is the whole point of this page, so every URL here is the
 * narrowest page that actually issues or manages the credential, not a
 * marketing homepage. Provider consoles move; a wrong link is a bug.
 */

/** Cost tiers, in the order the console groups them. */
export const TIERS = Object.freeze(['metered', 'free']);

/** How badly the app wants a credential, strongest first. */
export const REQUIREMENTS = Object.freeze(['required', 'recommended', 'optional']);

/**
 * Every provider record. Order is presentation order: required first, then
 * what most visibly changes the globe, then the allowance-raising extras.
 */
export const PROVIDERS = Object.freeze([
  {
    id: 'google-maps',
    name: 'Google Maps Platform',
    tier: 'metered',
    requirement: 'required',
    exposure: 'client',
    summary: 'The photorealistic 3D planet. Without this key the app refuses to boot.',
    unlocks: [
      'Photorealistic 3D Tiles — the globe itself (Map Tiles API)',
      'Place search and voice fly-to (Geocoding API)',
      'Voice scene context and "what is this?" (Places API New)',
      'Street View fallback frames when a CCTV feed is down (Street View Static API)',
    ],
    vars: [{ name: 'GOOGLE_MAPS_API_KEY', label: 'API key', placeholder: 'AIza…' }],
    keychain: [{ service: 'google-maps-api', account: 'api-key' }],
    primaryAction: { label: 'Open Google Cloud Console', url: 'https://console.cloud.google.com/' },
    steps: Object.freeze([
      { text: 'Create or select a Google Cloud project.', url: 'https://console.cloud.google.com/projectcreate', urlLabel: 'New project' },
      { text: 'Attach a billing account — Map Tiles will not serve without one.', url: 'https://console.cloud.google.com/billing', urlLabel: 'Billing' },
      { text: 'Enable the Map Tiles API. This is the one that draws the world.', url: 'https://console.cloud.google.com/apis/library/tile.googleapis.com', urlLabel: 'Enable Map Tiles' },
      { text: 'Enable the Geocoding API so search and voice fly-to can resolve places.', url: 'https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com', urlLabel: 'Enable Geocoding' },
      { text: 'Enable the Places API (New) for voice scene context.', url: 'https://console.cloud.google.com/apis/library/places.googleapis.com', urlLabel: 'Enable Places' },
      { text: 'Enable the Street View Static API for CCTV fallback frames.', url: 'https://console.cloud.google.com/apis/library/street-view-image-backend.googleapis.com', urlLabel: 'Enable Street View' },
      { text: 'Create an API key under Credentials, then copy it.', url: 'https://console.cloud.google.com/apis/credentials', urlLabel: 'Credentials' },
      { text: 'Restrict the key to those four APIs, and set a budget alert before you explore for an afternoon.', url: 'https://console.cloud.google.com/billing/budgets', urlLabel: 'Budgets & alerts' },
    ]),
    links: Object.freeze([
      { kind: 'pricing', label: 'Current Maps pricing', url: 'https://developers.google.com/maps/billing-and-pricing/pricing' },
      { kind: 'docs', label: 'Map Tiles API docs', url: 'https://developers.google.com/maps/documentation/tile' },
      { kind: 'security', label: 'How to restrict a key', url: 'https://developers.google.com/maps/api-security-best-practices' },
      { kind: 'quota', label: 'Per-API quotas', url: 'https://console.cloud.google.com/apis/dashboard' },
    ]),
    cost: 'Metered. Map Tiles bills by session; current prices and free-usage caps vary by billing region — read the pricing page before a long session.',
    notes: Object.freeze([
      'This key is compiled into the browser bundle by design and is visible in devtools. Restrict it at Google rather than trying to hide it.',
      'An HTTP-referrer restriction only covers the browser calls (tiles, geocoding). The Places and Street View calls are made by the dev server and carry no referrer, so a referrer-only restriction will 403 them. Restricting by API is the setting that fits how this app uses the key.',
    ]),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tier: 'metered',
    requirement: 'recommended',
    exposure: 'server',
    summary: 'Voice control and the AI HUD summary. Everything else runs without it — the mic button just reports that voice is unavailable.',
    unlocks: [
      'GEV MIC — the Realtime voice agent and its 28 tools',
      'Voice annotation, routing, and analyst queries against live layers',
      'The five-word AI HUD summary that regenerates as you move',
    ],
    vars: [{ name: 'OPENAI_API_KEY', label: 'Secret key', placeholder: 'sk-…' }],
    keychain: [{ service: 'openai-api', account: 'api-key' }],
    primaryAction: { label: 'Create a secret key', url: 'https://platform.openai.com/api-keys' },
    steps: Object.freeze([
      { text: 'Sign in to the OpenAI developer platform.', url: 'https://platform.openai.com/', urlLabel: 'platform.openai.com' },
      { text: 'Add credit — Realtime audio is prepaid usage, not part of a ChatGPT subscription.', url: 'https://platform.openai.com/settings/organization/billing/overview', urlLabel: 'Billing' },
      { text: 'Create a secret key and copy it once — the platform will not show it again.', url: 'https://platform.openai.com/api-keys', urlLabel: 'API keys' },
      { text: 'Set a monthly usage limit. This is the real billing backstop; the in-app cap is not one.', url: 'https://platform.openai.com/settings/organization/limits', urlLabel: 'Usage limits' },
    ]),
    links: Object.freeze([
      { kind: 'pricing', label: 'Current API pricing', url: 'https://openai.com/api/pricing/' },
      { kind: 'docs', label: 'Realtime API guide', url: 'https://platform.openai.com/docs/guides/realtime' },
      { kind: 'quota', label: 'Usage dashboard', url: 'https://platform.openai.com/usage' },
    ]),
    cost: 'Metered per audio minute and model. The app shows a live session estimate, warns at $2, and caps a session at $5 — a provider-side usage limit is still the only hard stop.',
    notes: Object.freeze([
      'The key never reaches the browser. The client fetches a short-lived ephemeral session token from /api/realtime/token.',
      'A cheaper mini voice tier is available from the GEV MIC panel; both model ids are overridable in .env.',
    ]),
  },
  {
    id: 'aisstream',
    name: 'AISStream',
    tier: 'free',
    requirement: 'recommended',
    exposure: 'server',
    summary: 'Live global ship positions. A two-minute signup, and the Live Vessels layer is empty without it.',
    unlocks: ['Live Vessels — thousands of ships worldwide, with tactical cards and wake trails'],
    vars: [{ name: 'AISSTREAM_API_KEY', label: 'API key', placeholder: 'your AISStream key' }],
    keychain: [{ service: 'aisstream-api', account: 'api-key' }],
    primaryAction: { label: 'Create an API key', url: 'https://aisstream.io/apikeys' },
    steps: Object.freeze([
      { text: 'Create an account — email and password, no card.', url: 'https://aisstream.io/authenticate', urlLabel: 'Sign up' },
      { text: 'Generate an API key and copy it.', url: 'https://aisstream.io/apikeys', urlLabel: 'API keys' },
    ]),
    links: Object.freeze([
      { kind: 'docs', label: 'AISStream documentation', url: 'https://aisstream.io/documentation' },
    ]),
    cost: 'No cost at time of writing. Terrestrial AIS only — vessels go quiet mid-ocean, which is the feed, not a bug.',
    notes: Object.freeze([
      'The server holds the AISStream websocket and the browser polls the same-origin /api/ais-live cache, so the key stays server-side.',
    ]),
  },
  {
    id: 'nasa-firms',
    name: 'NASA FIRMS',
    tier: 'free',
    requirement: 'recommended',
    exposure: 'server',
    summary: 'Live active-fire detections. The layer reports KEY REQUIRED until this is set.',
    unlocks: ['Active Fires — trailing 24h VIIRS/MODIS detections, with fire-to-camera handoff'],
    vars: [{ name: 'FIRMS_MAP_KEY', label: 'MAP_KEY', placeholder: 'your FIRMS MAP_KEY' }],
    keychain: [{ service: 'firms-map', account: 'map-key' }],
    primaryAction: { label: 'Request a MAP_KEY', url: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/' },
    steps: Object.freeze([
      { text: 'Enter your email on the FIRMS MAP_KEY page — the key is issued immediately.', url: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/', urlLabel: 'Get MAP_KEY' },
    ]),
    links: Object.freeze([
      { kind: 'docs', label: 'FIRMS area API docs', url: 'https://firms.modaps.eosdis.nasa.gov/api/area/' },
      { kind: 'terms', label: 'FIRMS / EOSDIS', url: 'https://earthdata.nasa.gov/firms' },
    ]),
    cost: 'Free, with a transaction allowance per key. The proxy caches and reports its remaining transactions.',
    notes: Object.freeze([
      'NASA asks that you acknowledge FIRMS when you publish anything built on it — the wording is in DATA_SOURCES.md.',
    ]),
  },
  {
    id: 'tomtom',
    name: 'TomTom',
    tier: 'free',
    requirement: 'recommended',
    exposure: 'server',
    summary: 'Turns the traffic layer from an approximate simulation into real congestion.',
    unlocks: ['Traffic — live flow tiles, so street-level dots color to actual jams below ~8 km'],
    vars: [{ name: 'TOMTOM_API_KEY', label: 'API key', placeholder: 'your TomTom key' }],
    keychain: [{ service: 'tomtom-api', account: 'api-key' }],
    primaryAction: { label: 'Get a TomTom API key', url: 'https://developer.tomtom.com/how-to-get-tomtom-api-key' },
    steps: Object.freeze([
      { text: 'Register for a TomTom developer account.', url: 'https://developer.tomtom.com/', urlLabel: 'developer.tomtom.com' },
      { text: 'Follow the key walkthrough — a default app and key are created for you.', url: 'https://developer.tomtom.com/how-to-get-tomtom-api-key', urlLabel: 'How to get a key' },
      { text: 'Copy the key from your dashboard.', url: 'https://developer.tomtom.com/user/me/apps', urlLabel: 'My apps' },
    ]),
    links: Object.freeze([
      { kind: 'docs', label: 'Traffic API', url: 'https://developer.tomtom.com/products/traffic-api' },
      { kind: 'pricing', label: 'Current allowance and pricing', url: 'https://developer.tomtom.com/pricing' },
    ]),
    cost: 'Freemium — check the current daily tile allowance for your account. The proxy holds its own soft daily budget (TOMTOM_DAILY_TILE_BUDGET, default 40000) and serves cached tiles past it.',
    notes: Object.freeze([
      'Keyless the traffic layer still works: it runs a labeled simulation with hardcoded per-road-class speeds.',
      'Attribution "Traffic flow data © TomTom" is registered automatically once live mode activates.',
    ]),
  },
  {
    id: 'cesium-ion',
    name: 'Cesium ion',
    tier: 'free',
    requirement: 'optional',
    exposure: 'client',
    summary: 'Adds the Bing world-imagery map stacks and Cesium World Terrain alongside Google 3D and OSM.',
    unlocks: ['Map Stack — Bing aerial imagery stacks', 'Cesium World Terrain'],
    vars: [{ name: 'CESIUM_ION_TOKEN', label: 'Access token', placeholder: 'eyJ…' }],
    keychain: [{ service: 'cesium-ion', account: 'token' }],
    primaryAction: { label: 'Create an access token', url: 'https://ion.cesium.com/tokens' },
    steps: Object.freeze([
      { text: 'Create a Cesium ion account.', url: 'https://ion.cesium.com/signup', urlLabel: 'Sign up' },
      { text: 'Create a token scoped to assets:read only, and add URL restrictions for anything you host.', url: 'https://ion.cesium.com/tokens', urlLabel: 'Access tokens' },
    ]),
    links: Object.freeze([
      { kind: 'pricing', label: 'Plans and permitted use', url: 'https://cesium.com/platform/cesium-ion/pricing/' },
      { kind: 'docs', label: 'ion access tokens', url: 'https://cesium.com/learn/ion/cesium-ion-access-tokens/' },
    ]),
    cost: 'Free tier available; plan restrictions differ by use. Verify the terms that apply to your deployment.',
    notes: Object.freeze([
      'This token is compiled into the browser bundle by design. Use a public assets:read token with URL restrictions — never a token that can write to your ion assets.',
      'Without it, the Google 3D and OSM map stacks still work; only the Bing stacks are withheld, with an explanation in the map tray.',
    ]),
  },
  {
    id: 'opensky',
    name: 'OpenSky Network',
    tier: 'free',
    requirement: 'optional',
    exposure: 'server',
    summary: 'More flight-polling credits. Flights already work anonymously — this just buys a faster, steadier refresh.',
    unlocks: ['Live Flights — a higher OpenSky credit allowance, so the snapshot refreshes more often'],
    vars: [
      { name: 'OPENSKY_CLIENT_ID', label: 'OAuth client id', placeholder: 'your client id' },
      { name: 'OPENSKY_CLIENT_SECRET', label: 'OAuth client secret', placeholder: 'your client secret' },
    ],
    keychain: [
      { service: 'opensky-network', account: 'client_id' },
      { service: 'opensky-network', account: 'client_secret' },
    ],
    primaryAction: { label: 'Open your OpenSky account', url: 'https://opensky-network.org/my-opensky/account' },
    steps: Object.freeze([
      { text: 'Create a free OpenSky Network account.', url: 'https://opensky-network.org/', urlLabel: 'opensky-network.org' },
      { text: 'In your account dashboard, create an API client and download its credentials JSON.', url: 'https://opensky-network.org/my-opensky/account', urlLabel: 'Account' },
      { text: 'Paste the client id and secret below, or import the JSON: ./scripts/opensky-import-client.sh /path/to/credentials.json' },
    ]),
    links: Object.freeze([
      { kind: 'docs', label: 'OpenSky REST API', url: 'https://openskynetwork.github.io/opensky-api/rest.html' },
      { kind: 'terms', label: 'Non-commercial research/education licence', url: 'https://opensky-network.org/about/terms-of-use' },
    ]),
    cost: 'Free for non-commercial research and education. Read the terms before any other use.',
    notes: Object.freeze([
      'Set OPENSKY_AUTH_MODE=anon to skip auth entirely — rate limited, but the flights layer still fills the sky.',
      'Legacy basic auth (OPENSKY_USERNAME / OPENSKY_PASSWORD) still works with OPENSKY_AUTH_MODE=basic, but OpenSky is moving away from it.',
    ]),
  },
  {
    id: 'launch-library',
    name: 'Launch Library 2 — The Space Devs',
    tier: 'free',
    requirement: 'optional',
    exposure: 'server',
    summary: 'Raises the space-missions request allowance. The layer already works without a token.',
    unlocks: ['Space Missions — a higher request allowance than the 15 calls/hour anonymous limit'],
    vars: [{ name: 'LL2_API_TOKEN', label: 'API token', placeholder: 'your LL2 token' }],
    keychain: [],
    primaryAction: { label: 'About the Launch Library API', url: 'https://thespacedevs.com/llapi' },
    steps: Object.freeze([
      { text: 'Read the API overview — anonymous access is 15 requests/hour and needs no account.', url: 'https://thespacedevs.com/llapi', urlLabel: 'Launch Library API' },
      { text: 'A higher rate is issued to supporter accounts; the token is shown with your account.', url: 'https://www.patreon.com/TheSpaceDevs', urlLabel: 'The Space Devs' },
    ]),
    links: Object.freeze([
      { kind: 'docs', label: 'LL2 v2.3 API docs', url: 'https://ll.thespacedevs.com/docs/' },
      { kind: 'terms', label: 'The Space Devs terms of use', url: 'https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md#terms-of-use' },
    ]),
    cost: 'Free at 15 requests/hour without a token. The proxy caches the feed for 15 minutes, which is sized for that limit.',
    notes: Object.freeze([
      'Sent as an Authorization: Token header, server-side only.',
    ]),
  },
  {
    id: 'tfl',
    name: 'Transport for London Open Data',
    tier: 'free',
    requirement: 'optional',
    exposure: 'server',
    summary: 'Raises the JamCams catalog rate limit. London cameras already load without it.',
    unlocks: ['CCTV Mesh — a higher rate limit on the TfL JamCams camera list'],
    vars: [{ name: 'TFL_APP_KEY', label: 'App key', placeholder: 'your TfL primary key' }],
    keychain: [],
    primaryAction: { label: 'Open the TfL API portal', url: 'https://api-portal.tfl.gov.uk/' },
    steps: Object.freeze([
      { text: 'Register on the TfL API portal.', url: 'https://api-portal.tfl.gov.uk/', urlLabel: 'API portal' },
      { text: 'Subscribe to a product, then copy the primary key from your profile.', url: 'https://api-portal.tfl.gov.uk/profile', urlLabel: 'Profile' },
    ]),
    links: Object.freeze([
      { kind: 'terms', label: 'TfL Open Data terms (attribution required)', url: 'https://tfl.gov.uk/info-for/open-data-users/' },
    ]),
    cost: 'Free. Only the camera-list endpoint is rate limited; the frames come from a public bucket that is not.',
    notes: Object.freeze([
      'Attribution is mandatory for TfL data and is registered in-app automatically: "Powered by TfL Open Data".',
      'The 15-minute source cache already keeps list requests far below the anonymous limit, so this is genuinely optional.',
    ]),
  },
]);

/** Providers with no account at all — shown so the console can be honest about how much is free. */
export const KEYLESS_LAYERS = Object.freeze([
  { name: 'Live Flights', source: 'OpenSky (anonymous) + adsb.lol' },
  { name: 'Military Flights', source: 'adsb.lol' },
  { name: 'Satellites', source: 'CelesTrak' },
  { name: 'Earthquakes', source: 'USGS' },
  { name: 'CCTV Mesh', source: 'Austin · Caltrans · TfL open data' },
  { name: 'Radio', source: 'Radio Browser' },
  { name: 'Bikeshare', source: 'GBFS' },
  { name: 'Space Missions', source: 'Launch Library 2' },
  { name: 'Mapped Installations', source: 'OpenStreetMap' },
  { name: 'Traffic (simulated)', source: 'OpenStreetMap road network' },
  { name: 'Datacenters · Dams · Submarine Cables', source: 'Bundled snapshots' },
]);

/** Look up one provider record by id. */
export function providerById(id, providers = PROVIDERS) {
  return providers.find((provider) => provider.id === id) || null;
}

/** Find the provider that owns an environment variable name. */
export function providerForVariable(name, providers = PROVIDERS) {
  const wanted = String(name || '');
  return providers.find((provider) => provider.vars.some((v) => v.name === wanted)) || null;
}

/**
 * Every environment variable the console may write, in catalog order.
 *
 * The dev-server write endpoint uses this as its allowlist, so a name absent
 * from the catalog cannot be written into `.env` no matter what a request asks
 * for. Keeping the allowlist derived from the rendered catalog means the two
 * can never drift apart.
 */
export function writableVariableNames(providers = PROVIDERS) {
  return providers.flatMap((provider) => provider.vars.map((v) => v.name));
}

/** Providers the app cannot start without. */
export function requiredProviders(providers = PROVIDERS) {
  return providers.filter((provider) => provider.requirement === 'required');
}

/**
 * Group providers for display: required, then the ones that light up a dark
 * layer, then the ones that only raise a limit. Within a group, catalog order
 * holds — it is already sorted by how much the globe changes.
 */
export function groupedProviders(providers = PROVIDERS) {
  return REQUIREMENTS.map((requirement) => ({
    requirement,
    providers: providers.filter((provider) => provider.requirement === requirement),
  })).filter((group) => group.providers.length > 0);
}

/** Human label for a cost tier. */
export function tierLabel(tier) {
  if (tier === 'metered') return 'METERED';
  if (tier === 'free') return 'FREE KEY';
  return 'NO KEY';
}

/** Human label for how much the app wants a credential. */
export function requirementLabel(requirement) {
  if (requirement === 'required') return 'REQUIRED';
  if (requirement === 'recommended') return 'RECOMMENDED';
  return 'OPTIONAL';
}

export default PROVIDERS;
