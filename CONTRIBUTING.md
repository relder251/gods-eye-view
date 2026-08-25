# Contributing to God's Eye View

Thanks for being here. God's Eye View is an open foundation for live spatial intelligence in the browser, and it gets better when more people run it, break it, and extend it.

## Getting set up

Use Node.js 24.14.x or 26.x (also enforced by `package.json`).

```bash
git clone https://github.com/bilawalsidhu/gods-eye-view.git
cd gods-eye-view
nvm install 24.14.0
nvm use 24.14.0
npm install
./scripts/dev-fresh.sh        # or: GOOGLE_MAPS_API_KEY="…" npm run dev
```

You need a **Google Maps API key** with the Map Tiles API enabled. The fastest route is the setup console at **`http://localhost:4173/setup`** — it links to the exact page that issues each provider's credential, shows which ones your install is holding, and writes them into `.env` for you (see the [README](README.md#-api-keys)). Most data layers work with no other accounts. On macOS the launcher pulls keys from the Keychain; on any platform you can pass them as env vars or use a `.env` (copy `.env.example`).

Open `http://localhost:4173`. Before sending a PR run `npm run build`, `npm test`, and `npm run test:track` (dev server must be up) — **all three must stay green.**

CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run build` on Node 24 and 26 for every push and pull request. It is deliberately hermetic — no keys, nothing billable — so it passes for a fork PR, which cannot read repository secrets. The browser suites (`test:track`, `qa:map-source-tray`) need a real Google Maps key and spend Map Tiles quota, so they live in `.github/workflows/browser-qa.yml` and run only on manual dispatch. Run those locally before you send the PR.

## Good first contributions

The highest-leverage places to jump in:

- **🌆 Add a CCTV source pack.** Austin is the reference camera source. Adding another city means a clean public camera catalog with coordinates, attribution, and server-registered frame URLs (the proxy only fetches registered URLs — never client-supplied ones, see [SECURITY.md](SECURITY.md)). City packs are the best first lane.
- **🛰️ Add or improve a data layer.** Each layer is one self-contained module in `src/data/<layer>.js` implementing the layer interface (`init/enable/disable/update/destroy/getStats`, optional `getDetectableObjects`/`getStats`). Use an existing layer as a template.
- **🎙️ Extend voice control.** Voice tools are declared server-side (`GEV_REALTIME_TOOLS` in `vite.config.js`) and executed client-side (`src/voice/gevActions.js`). Keep the tool surface tight and the responses honest (confirm only what actually happened).
- **🎨 Add a visual style.** Styles are GLSL post-process shaders in `src/styles/`.
- **🐛 Fix bugs / improve the first-run experience.** See [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

## Architecture in one minute

- **No framework.** Vanilla JS + [CesiumJS](https://cesium.com/platform/cesiumjs/) + [Vite](https://vitejs.dev/).
- **UI lives in `src/ui.js`** (panels, HUD, styles, the control facade). **Layer logic lives in `src/data/<layer>.js`.** Keep them separate.
- **Secrets stay server-side.** Anything needing a private key goes through a Vite proxy in `vite.config.js`. The browser only ever sees the Google Maps key (which you restrict) and ephemeral tokens.
- `docs/CURRENT-STATE.md` is the authoritative runtime reference — read it first.

## Coding style

- ES modules, **2-space indent, single quotes, semicolons.**
- JSDoc on exported/public functions.
- Match the surrounding code — comment density, naming, and idiom.
- Prefer small, reviewable commits. Conventional-commit-style prefixes (`feat:`, `fix:`, `perf:`, `docs:`) are appreciated but not required.

## Pull requests

1. Branch off `main`.
2. Keep `npm run build`, `npm test`, and `npm run test:track` green and avoid new console errors.
3. If you change runtime behavior, update `docs/CURRENT-STATE.md` and `CHANGELOG.md` in the same PR.
4. If you add or change a data source, update [DATA_SOURCES.md](DATA_SOURCES.md) with its license and attribution. **Don't add data you don't have the right to redistribute** — fetch it at runtime instead.
5. Describe what you changed and how you verified it (screenshots welcome for anything visual).

### Branch protection on `main`

This lives in repository settings rather than in the repo, so it is written down here to keep the intent visible and reproducible. Settings -> Branches -> Add branch protection rule (or Settings -> Rules -> Rulesets), pattern `main`:

| Setting | Value |
|---|---|
| Require status checks to pass | on — `Node 24.x` and `Node 26.x` |
| Require a pull request before merging | on |
| Required approvals | **0** while there is a single maintainer |
| Block force pushes | on |
| Restrict deletions | on |
| Do not allow bypassing the above settings | off while there is a single maintainer |

Two of those are easy to get wrong:

- **The required checks are the job names, not the workflow name.** `ci.yml` is named `CI`, but it reports two check runs — `Node 24.x` and `Node 26.x` — one per entry in its Node matrix. Requiring `CI` creates a rule that waits forever on a check that never reports, and blocks every merge. If the matrix in `.github/workflows/ci.yml` changes, the required-check names have to change with it.
- **Required approvals and admin enforcement lock out a solo maintainer.** With one person on the repo, requiring even one approval means nobody can merge anything, and enforcing the rules for administrators removes the escape hatch for a CI outage unrelated to the diff. Turn both on once there is a second maintainer, not before.

"Require branches to be up to date before merging" is a judgement call. It is stricter, but every push to `main` then forces an update and a fresh CI run on every open PR before it can merge.

## Ground rules

- This is a tool for **public** data. Don't add scraping of sources whose terms forbid it, private/paywalled datasets, or anything that misrepresents public-data inference as authoritative intelligence.
- Be decent to each other. Assume good faith, keep it constructive.

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
