# AGENTS.md

This file provides guidance to Codex (claude.ai/code) when working with code in this repository.

## Project Overview

**foliplus** is a pragmatic Folium toolkit that adds interactive map controls (LayerControl, MeasureControl, HeatmapControl, SearchControl, ExportControl, FullscreenControl, ScaleControl, LocateControl) as Python plugins with a full TypeScript/Leaflet runtime.

It's a **dual-stack project**:

- **Python** (`foliplus/control/`) — folium plugin classes that serialize config into JS `CONF` objects via Jinja2 templates, load bundled JS/CSS, and inject a shared header (runtime, locale tables, common CSS) into the HTML `<head>`.
- **TypeScript** (`foliplus/js/**/*.ts`) — Leaflet control implementations that consume the `CONF` config and run in the browser.

## Commands

| Task | Command |
|------|---------|
| Bootstrap env | `make env` (runs `uv venv && uv sync --group dev`) |
| Lint all | `make lint` (pre-commit: ruff, mypy, prettier, codespell) |
| Run all tests | `make test` (build-js-dev + JS tests + Python tests with coverage) |
| Python tests only (unit + browser) | `make test-python` |
| Python tests without browser | `make test-python-fast` (local quick pass) |
| Browser tests only | `make test-browser` (Playwright, auto-skips without playwright installed) |
| JS tests only | `make test-js` (vitest run --coverage) |
| Local fast gate (push before PR) | `make check` (typecheck + changed-file prettier/eslint/ruff + full-tree listener/toolchain guards + changed-file vitest/pytest + changelog/mojibake/dead-barrel scripts; full suite is PR CI's job) |
| JS tests (watch) | `npm run test:watch` |
| Single JS test | `npx vitest run test/js/SearchControl/logic.test.ts` |
| Typecheck TS | `npm run typecheck` |
| Build JS/CSS (minified) | `make build-js` (`npm run build`) |
| Build JS/CSS (unminified, for dev) | `make build-js-dev` (`npm run build:dev`) |
| Build Python package | `make build-python` (`uv build + twine check`) |
| Full release build | `make dist` |
| Build docs | `make html` |
| Clean everything | `make clean` |

> **Always run `make build-js-dev` before running Python tests** — the Python layer reads bundled JS/CSS from `foliplus/dist/`. `make test` and `make test-python` do this automatically.

## Python Side (`foliplus/control/`)

- **`BaseControl`** is the base class for every control. It handles:
  - Shared asset injection into `<head>` (runtime JS, common CSS, locale tables) — deduplicated by `_SHARED_ASSETS_NAME`
  - Config serialization via `_build_config()` → `_config_block` → Jinja2 template
  - Locale resolution via `LocaleConfig`
- Each control subclass declares `_export_fields` (instance attributes serialized into JS `CONF`) and may override `_extra_config()` for render-time data (e.g. LayerControl collects layers from the parent map).
- The Jinja2 template wraps component JS in an IIFE where `map` and `CONF` are free variables.
- `_build_component_template()` is `@cache`d — templates are built once per component name, not per instance.
- Locale JSON files live in `foliplus/locale/<component>/<lang>.json`.
- **Component layout criterion**: a control `>= 300` lines becomes a directory package `foliplus/control/<Name>/` (`__init__.py` + `control.py`, splittable into helper modules); a control `< 300` lines stays a single module `foliplus/control/<Name>.py`. Upgrade a single file to a package once it grows past `~300` lines; package `__init__.py` only re-exports the class (`from .control import <Name>`).

## JavaScript/TypeScript Side (`foliplus/js/`)

### Directory Structure

```
foliplus/js/
├── BaseControl.ts          # Leaflet L.Control base class with auto-unbind listener tracking
├── common/                 # Shared runtime layer: pure utilities + stateful shared engines; engines under common/engine/
│   ├── cache.ts, cssvar.ts, debounce.ts, delicon.ts
│   ├── dom.ts, download.ts, fetch.ts, format.ts, guard.ts
│   ├── icon.ts, locale.ts, log.ts, mapEvent.ts, panel.ts
│   ├── rafLoop.ts, storage.ts, throttle.ts
│   └── engine/             # Stateful shared UI engines (lifecycle/portal/event subscription): dropdown, listbox, schemePicker, form, placement, portalRoot; NOT per-control logic or pure function tools
├── core/                   # Shared domain modules (pure logic)
│   ├── geo/                # CRS detection/transform (coord.ts) + turf geodesic helpers (geo.ts)
│   ├── geocode/            # Pluggable geocode provider layer (type/util/nominatim/photon/
│   │                       #   pelias/registry + mapProvider CRS wrapper + rateLimit) and the
│   │                       #   stateful geocoder singleton (provider-scoped cache & throttle)
│   ├── event/              # EventBus (pub/sub) + event payload types
│   ├── layer/              # LayerRegistry, LayerFactory, PaneManager, LayerAPI, PaneManager
│   ├── component.ts        # Component name registry + ID generation
│   ├── controlEnv.ts       # createControlEnv — runtime guard + hint icon registration
│   ├── hint.ts             # HintManager (per-map) + shared icon registry
│   ├── interaction.ts      # Shared interaction utilities
│   ├── mode.ts             # ModeManager (exclusive mode locking)
│   └── index.ts            # Re-export surface
├── runtime/                # Shared runtime bundle (injected once per map)
│   └── index.ts            # Bootstraps window.foliplus, registers modules
├── {ControlName}/          # Per-component modules (7 controls)
│   ├── index.ts            # Entry point — instantiates L.Control subclass
│   ├── const.ts            # Static configuration constants
│   ├── icon.ts             # SVG icons
│   ├── manager.ts          # Stateful manager instance
│   ├── interaction.ts      # Event handlers
│   ├── ui.ts               # DOM builders (covered by browser tests, not vitest)
│   ├── logic.ts            # Business logic (where applicable)
│   ├── template.ts         # HTML templates (where applicable)
│   └── util.ts             # Helpers
└── type/
    └── global.d.ts         # Global type declarations
```

### Key Architectural Patterns

- **Shared runtime bundling**: `runtime/index.ts` bundles into `foliplus-common.min.js` and is injected once per map. Component bundles **externalize** `#core/*` and `#common/*` imports — they read from `window.foliplus.core.*` and `window.foliplus.common.*` globals instead of inlining the code. This is enforced by `script/build/global-namespace-plugin.mjs` during esbuild.
- **Layer API**: `map.foliplus.LayerAPI` is the public interface other controls use for layer operations (register, find, panes). Access it via `requireLayerAPI(map)` which throws if the API isn't available (e.g. no LayerControl on the map).
- **Event Bus**: Components communicate via semantic events (`LAYER_CHANGE`, `MODE_CHANGE`, etc.) through `map.foliplus.events` — decoupled from raw Leaflet events.
- **Mode Manager**: Exclusive mode locking for controls like MeasureControl (distance vs polygon vs marker modes) and HeatmapControl — `guardBlocked()` checks before allowing a mode switch.
- **Locale**: `createTranslator(conf)` returns `(key) => string`. It merges common + component-specific locale tables, resolves the active language via URL/HTML/browser detection, and falls back to the key itself if no translation exists.
- **Listener tracking**: `BaseControl.ts` provides `listenDOM()` and `listenMap()` which auto-unbind on `onRemove()`. Call these instead of raw `L.DomEvent.on()` / `this._map.on()`.
- **Component entry lifecycle**: each Python control instance renders a fresh IIFE (`BaseControl.py` `_compile_component_template`), so entry-level state is scoped per rendered block — manager lifetime == control instance lifetime, and multi-instance on one page works via this rendering model (hint icon registration is idempotent). Manager creation is **lazy and re-entrant**: entry `index.ts` files define a `createXManager()` factory resolved by a `get m()` getter (`this.manager ??= createXManager()`); `destroy()` nulls the manager so `map.removeControl()` + `map.addControl()` on the same control object rebuilds it cleanly. Heatmap's `initScan` runs from `buildDOM` for the same reason. Never touch `this.m` inside `destroy()` (the getter would re-create the manager) — use `this.manager?.`. Follow this lazy-manager pattern in new controls (SearchControl keeps state on instance fields, no standalone manager class).

### Build Pipeline (`script/build/build.mjs`)

1. **Generate `_shared-registry.ts`** via `script/build/scan-registry.mjs` — auto-discovers which `#common/*` and `#core/*` exports are actually used by component bundles and registers them on `window.foliplus`.
2. **Source transforms** — SVG and HTML strings embedded in `.ts` files are processed via `script/build/compress.mjs` (SVG minification, etc.) at esbuild bundle time via an `onLoad` plugin.
3. **CSS pipeline** — PostCSS with `postcss-nesting` (edition 2021, fully flattened selectors) + `autoprefixer` (driven by `browserslist` in package.json).
4. **esbuild bundle** — each component produces `foliplus-{Name}.min.js` and `foliplus-{Name}.min.css`. Shared entry produces `foliplus-common.min.js` and `foliplus-common.min.css` (common.css + panel.css merged).
5. `--dev` mode: unminified, `keepNames: true` (needed for Python render-string tests that check function names in output).

## Testing Structure

### Python Tests (`test/python/`)

- Verify the **Python ↔ JS bridge**: config serialization, locale injection, CDN deps, shared-resource dedup, CSS class/token presence, Python class behavior.
- **Do NOT assert JS function/variable names** — those belong in vitest or browser tests.
- Browser tests are in classes ending with `Browser` — auto-marked with `pytest.mark.browser` in `conftest.py`. Use `make test-python-fast` to skip them.
- Browser tests use a CDN cache proxy (`_CdnBrowserProxy`) that intercepts and serves Leaflet/jQuery/bootstrap from `/tmp/foliplus-cdn-cache` — tests are network-independent.

### JS Tests (`test/js/`)

- **vitest with jsdom** — environment is jsdom, globals enabled, `CONF` and `map` mocked as `{}` via `vitest.config.mjs` `define`.
- `test/js/setup.ts` provides global mocks: `window.foliplus`, `window.L` (Leaflet), `globalThis.turf` (measurements).
- Use `vi.fn()` in mocks so tests can spy on calls even when module captures them at import time.
- Entry modules (`index.ts`), UI modules (`ui.ts`), and MeasureControl mode subclasses are excluded from coverage — they require full Leaflet runtime and are covered by browser tests.

## Configuration

- **Python deps**: `uv` with dependency-groups (`test`, `doc`, `dev`). Use `uv run` to execute in the project venv. `uv pip` auto-detects venv (may use wrong one); `uv run pip` forces project venv.
- **Node**: 24.x (see `.nvmrc`). `npm` for JS tooling (esbuild, vitest, typescript, postcss).
- **Path aliases**: `#common/*` → `foliplus/js/common/*`, `#core/*` → `foliplus/js/core/*`, `#foliplus/*` → `foliplus/js/*`. Defined in both `package.json` `imports` and esbuild `alias`.
- **Ruff**: only `I` (isort) and `UP` (pyupgrade) rules. Line length 88. Auto-fix enabled.
- **Prettier**: JS/CSS/TS formatting with sort-imports plugin. Config in `.prettierrc.cjs`.

## Working on the Current Branch

Current branch is `feature/search-history-favorites` — work on SearchControl history and favorites functionality. Key files:

- `foliplus/js/SearchControl/logic.ts` — search logic including history management
- `foliplus/js/SearchControl/const.ts` — constants and default config
- `foliplus/js/SearchControl/type.ts` — type definitions
- `foliplus/js/SearchControl/interaction.ts` — event handlers
- `test/js/SearchControl/history.test.ts` — history tests
- `test/js/SearchControl/logic.test.ts` — logic tests
- `foliplus/css/SearchControl.css` — styles

Before committing, run `make test` or at minimum `make test-python-fast` + `make test-js` to ensure the build + all test layers pass (CI runs the full `test-python`/`test-browser` split).

## User Habits (all sessions)

Full source: `.claude/rules/03-USER.md` + `.claude/rules/04-MEMORY.md`. This section is the auto-loaded brief.

### Profile

- Supply-chain / OR-prediction engineer; GIS background; frontend is not their strong suit. They built foliplus for their own work.
- Direct communication. Expects tooling details to be right on the first pass; will correct inaccurate assumptions (especially CI/CD and uv).
- Prefers actionable changes over verbose explanation.
- Frontend/design: agent decides and implements; user only sets direction — do not ask about UI detail.
- Distinguish **decision not to proceed** from **abandonment**; record the former as a decision (example: build-watch #187).

### Hard conventions

| Topic | Rule |
|------|------|
| Python env | `uv run pip` (never bare `uv pip` for venv-targeted installs) |
| CI pinning | Pin in GitHub Actions, not in `pyproject.toml` |
| Actions `if` | Prefer native expression `if:` over shell-level `if` |
| Docs path | Singular `doc`, not `docs` |
| Naming | Scripts and directories are singular (`control/`, `test/js/snippet/`); exceptions: `.github/actions`, `.github/workflows` (GitHub-mandated) and `script/args.mjs` (established CLI-parser name) |
| Worktree | Branch from `origin/main`; never mix another PR's files |
| Force-push | **Do not force-push** (user rule since #269); append commits only |
| Scratch | Put probes in `.foliplus/`; never name them like stdlib (`struct.py`, `inspect.py`) |
| Windows sandbox | `npm install --ignore-scripts` + `node .foliplus/patch-vitest.mjs` + vitest `--pool=threads` |

### Quality bar

- Before commit: `make test` or at least `make test-python-fast` + `make test-js`.
- Verify CSS/interaction with browser computed-style / Playwright, not guesswork.
- Prefer semantic invariants in tests over hardcoded magic numbers.
- `vi.spyOn` must be created **before** the act under test.
- User may re-test and reverse a first diagnosis — treat their measured result as ground truth.

### Memory / logs

- “Logs” means **repo project logs**: `CHANGELOG.md`, `.claude/rules/04-MEMORY.md`, `memory/YYYY-MM-DD.md` — not client auto-memory.
- One fact, one place. Flow: daily notes → `memory/topics/` → `04-MEMORY.md` only when broadly useful.
- CHANGELOG entries aggregate by component; append PR numbers to an existing entry, do not split a new line.
- Roadmap lives in MyAgents task center (`tag=roadmap`); do not grep the repo for “is this feature planned”.
- `memory/` and `.claude/` are not git-tracked; do not expect them in `git log`.
