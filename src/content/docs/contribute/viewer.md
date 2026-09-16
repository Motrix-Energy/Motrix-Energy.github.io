---
title: Contributing to Motrix Edge View
description: Architecture, source layout, load-bearing rules and workflow for contributing to the Motrix Edge View single-file viewer.
---

Motrix Edge View is the other half of the system: a standalone single-page app that shows what a Motrix Edge did — device readings and algorithm decisions on one synchronised timeline — shipped as **one self-contained `index.html`** you can double-click. Contributing to it means working inside a small set of deliberate constraints, and this page is the map of them.

:::note[The normative source is in the repository]
The enforced rules and the step-by-step recipes live in [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md) in motrix-edge-view, next to the code they bind — just as the Edge recipes live in [that repository's own file](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md). This page narrates the reasoning behind them and links each section to its normative counterpart; when the two disagree, the repo wins. The architecture those rules come from is in [`CLAUDE.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CLAUDE.md).
:::

## The standing rule comes first

:::danger[Standing rule — this repository is public]
"Never put a customer name, a site topology, a real address or GPS coordinate, a broker host, a MAC address, a meter serial, or a non-English domain field name in this repository. Sample data uses `p1_meter` / `shelly_plug` / `pseudo_sensor` and the `AutoToggle` algorithm."

Nothing from a real installation belongs in the repository — not a device name, not a field path, not a sample row, not a UI mock-up, not a test fixture. Sites run private algorithms over private data, and a viewer that ships one operator's vocabulary has both leaked it and stopped being generic.
:::

The four-language interface is not an exception to that rule — it sharpens it. `src/i18n/` covers **UI chrome only**: buttons, labels, warnings, the pages' own prose. Device names, algorithm names and field paths are discovered from the data at load time and are never translated, never enumerated and never hardcoded. A non-English string in a catalogue is fine; a non-English string that came from somebody's site is the thing the rule exists to stop.

The rule has teeth in code, too: [`src/core/topology.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/src/core/topology.ts) is a privacy boundary. It reads twelve named paths from a loaded `config.json` and constructs entries field by field — no spread, no `delete`, no denylist — so an EMS option added next year is excluded by default rather than by somebody remembering. Two tests assert that no credential, host, topic or path can reach the parsed document or the rendered DOM. Do not delete them.

## One app, two data sources

Charts, timeline, filters and summary all operate on one normalised stream of `{timestamp, source, kind, payload}`. `FileSource` (PapaParse over the CSVs) and `LiveSource` (polling the REST API) both produce that same stream behind one `DataSource` interface — [`src/sources/data-source.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/src/sources/data-source.ts) is the seam.

This mirrors the EMS's own thesis one level up: an algorithm does not care whether data came from MQTT or a CSV replay, and the viewer should not care whether it came from a file or a socket. When you add a feature, add it against the stream, not against a source — if your change needs to know which source produced an event, that is usually the design telling you it is in the wrong place.

The seam is discovered, not configured: the app fetches `/api/health` on boot. Reachable → offer the live source. Unreachable → file-only, silently. Opened from `file://` the probe simply fails, which is correct, not an error to report — so never add a warning to that path.

Three source-shaped rules follow from what the stream actually carries:

- **The replay input is its own `EventKind`, `'input'`, never folded into `'reading'`.** What the pseudo connector *published* and what the EMS *stored* would otherwise share an actor key and the distinction would be gone — and the distinction is the feature: the EMS writes no row for a rejected payload, so an input with no reading at the same instant is the only evidence one was rejected. The payload cell is never trimmed (a P1 telegram loses its terminating CRLF if you do, and the EMS's own replay reader does not trim it either).
- **The `/decisions` cursor is `seq`, never a timestamp.** The storage format makes timestamps non-monotonic with legal duplicates, and under a `speed: 0` replay every decision in a timestep shares one instant — an inclusive timestamp cursor re-delivers the step every poll and an exclusive one drops all but the first of it. The cursor lives in `LiveFeed`, not `LiveSource`: advancing it is a property of the *request*, and one request feeds every subscriber. And the snapshot dedupe applied to `/devices` must **not** be applied to `/decisions`: that endpoint is an append-only log where byte-identical repeats are real events.
- **A 404 from `/decisions` is not a failure.** An EMS predating the route answers 404, and the viewer must degrade to exactly its old behaviour: stop asking for the session, no warning, no failure count. The UI sentences that describe decisions as file-only switch on state rather than being deleted, because against an older EMS the old sentence is still true. (What live mode means for an *operator* is on [/operate/viewer/](/operate/viewer/).)

## A dataset list, not a source switch

State is N loaded datasets, each with a source, a tag and a colour; one of them may be a live subscription. Nothing downstream may bake in "the current source" — that assumption is a rewrite of the state model to remove later, and the list is what delivers the features that matter: two backtests loaded side by side, a 2013 replay superimposed on a live feed via the t₀-normalised x-axis, and the record → export → reload loop.

Live datasets need three things file ones do not, and all three exist because a subscription is unbounded where a file is finite: a **retention bound**, a **follow mode** (a sliding window that drops out on any manual zoom rather than fighting the user), and **time alignment** between wall-clock ranges that share nothing.

## The layout of `src/`

| Directory | What lives there |
|---|---|
| `src/core/` | Pure logic — no DOM, no uPlot: time parsing, JSON repair, flattening, numeric detection, columnar storage, LTTB downsampling, alignment, axis grouping, merge, filter. This is where the testable logic lives, and where most contributions land |
| `src/sources/` | `data-source.ts` (the seam), `file/` (PapaParse over the CSVs), `live/` (polling the API) |
| `src/state/` | Observable store + `@lit/context`, actions — the dataset *list* |
| `src/components/` | Lit elements only — rendering, no business logic |
| `src/i18n/` | UI chrome in four languages; nothing discovered from data is ever translated |
| `test/fixtures/` | Vendored from the EMS repository's `examples/`. **Tracked, not ignored: it is the interface** |

The stack behind it: Lit (legacy decorators — Vite transpiles with esbuild, which does not implement TC39 standard decorators), uPlot, PapaParse (never with `worker: true` — blob-URL workers are blocked from a `file://` origin), `@lit-labs/virtualizer`, Vite + `vite-plugin-singlefile`, Vitest with `core` (node) and `dom` (jsdom) projects.

*Normative source:* [`CONTRIBUTING.md` — How the app is put together](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#how-the-app-is-put-together).

## Rules that are load-bearing

Each of these exists because something broke, or provably would. Most have a lint rule or a test standing behind them — which is the bar for appearing in [the repository's own list](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#rules-that-are-load-bearing), the normative version of this section.

### Never `Date.parse`, never `new Date(string)`

`new Date("2024-01-15")` is UTC while `new Date("2024-01-15T00:00:00")` is local, and the EMS writes six-digit fractional seconds that fall outside the ES grammar entirely. Use [`src/core/time.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/src/core/time.ts) for all timestamp parsing. ESLint enforces this — the rule is not advisory.

### Nothing that breaks `file://`

No dynamic `import()`, no Web Workers, no external URLs. All three break the deliverable: the viewer's one supported distribution is a single `index.html` opened from disk on a site LAN, where there is no server to fetch a chunk from and no origin to spawn a worker under. This is also why the typeface is vendored as woff2 subsets rather than linked, and why `npm run build` ends in `scripts/check-bundle-size.mjs`, which asserts `dist/` holds exactly one file with no external references — `vite-plugin-singlefile` stops inlining *silently* past its limits, and the failure mode is a viewer that 404s the moment someone opens it offline.

### The big data lives outside the reactive graph

Columns are mutable typed arrays; a `revision` counter drives updates. Never put a 100k-element array behind a proxy or a structural-equality check — the viewer lives in the 5k–100k+ point range, and reactive bookkeeping at that scale is the difference between a chart and a slideshow.

### The flattener is a deliberate second implementation

The flattening and numeric-string rules in `src/core/` reimplement a Python rule (`storage/influxdb.py` in motrix-edge). Two implementations of one rule is acceptable; two that drift silently is not. The rule is stated normatively in the EMS's `docs/storage-format.md`, and `test/fixtures/` is the shared input that keeps both sides honest — which is one more reason the fixtures are tracked. The caveats a consumer must honour are summarised on [/reference/storage-format/](/reference/storage-format/).

### Every `/api` request goes through `api-client.ts`

[`src/sources/live/api-client.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/src/sources/live/api-client.ts) is the only module that knows `/api` exists and the only one that builds an `Authorization` value. It sends `credentials: 'omit'` — that single option is what stops a gated nginx popping the browser's own credential dialogue over the app's sign-in panel, because the Fetch spec only prompts when credentials are included. The gate itself is nginx's, not the app's; the whole authentication doctrine lives on [/architecture/security/](/architecture/security/).

### Text-bearing components subscribe to the locale

Translation is a module singleton, so a component that renders text must subscribe to `s.locale` — one missing `StoreController` means that component keeps its old language with no type error and no warning. [`test/app.dom.test.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/test/app.dom.test.ts) checks every text-bearing surface for exactly this.

### Catalogues use `satisfies`

`satisfies Catalogue`, never a type annotation. Both catch a missing key; only `satisfies` reliably catches an *extra* one, because excess-property checking fires only on a fresh object literal.

### Two rules for live columns

`refreshGap()` is mandatory for live columns, not an optimisation: `alignSeries` holds a value across a foreign timestamp only when `gapMs > 0`, and `gapMs` is set by `seal()`, which only the file source calls — so an unsealed live column makes a multi-series chart render completely blank. And retention measures its window from the dataset's own `tMax`, never the wall clock: under a replay `tMax` is 2013, and a wall-clock cutoff deletes the whole dataset on the first batch.

### The dev proxy and nginx change together

[`vite.config.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/vite.config.ts)'s dev proxy and [`docker/nginx.conf`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/docker/nginx.conf) both strip the `/api` prefix for the same reason — the app never learns an absolute URL. They must change together.

The full set is in the repository's [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#rules-that-are-load-bearing), each entry naming the lint rule or test that enforces it; [`CLAUDE.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CLAUDE.md#rules-that-are-load-bearing) has the architectural reasoning at length. Read one of them before touching `src/core/` or `src/sources/`.

## Brand and visual system

The viewer's design system is called Modernist: flat, architectural, set entirely in Archivo, zero corner radius, 2px rules on major dividers and 1px on control chrome, everything flush left. Nothing floats and nothing is decorated. Four rules bind a contributor:

- **Every colour comes from a token in `index.html`'s `:root`.** No component invents a hex. Readings are teal and decisions amber because those are the mark's two nodes — a reading comes off a node, a decision is the dispatch that leaves it.
- **Every text token clears WCAG AA against all three backgrounds.** A constraint, not an aspiration; check with a calculator before changing one.
- **Primary buttons carry `var(--bg-primary)`, never `#fff`** — white on the brand accent is 1.6:1.
- **Chart marks are not set from those tokens.** `SERIES_COLOURS` and `DATASET_COLOURS` are one validated categorical palette held in two places, deliberately in the same order, sitting inside an OKLCH lightness band for a dark surface. Brand teal itself is far too light to be a 1.5px line on near-black — slot 1 is that hue one ramp step down. Re-validate before changing any of them.

The typeface is vendored, never linked: a `<link>` to Google Fonts would fail the bundle-size check and would silently degrade on an offline site anyway.

*Normative source:* [`CONTRIBUTING.md` — Recipe: add a component](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#recipe-add-a-component) and [Recipe: add a chart or a series](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#recipe-add-a-chart-or-a-series).

## The manual harnesses

`npm test` matches `test/**/*.test.ts`, so anything ending `.manual.ts` is invisible to it on purpose: those files need an EMS answering on `127.0.0.1:8000` and run for minutes, which is not something a normal test run should wait for. Run them deliberately:

```bash
npx vitest run --config vitest.manual.config.ts
```

[`test/live-fill.manual.ts`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/test/live-fill.manual.ts) polls a real EMS for three minutes through the same modules the live source uses and asserts the feed accumulates past the default follow window, that the window has real width, and that a smaller window is strictly narrower than a larger one.

It exists because two bugs hid in exactly the gap it covers, and a browser could not be held open long enough to see either. Retention measured its age window in *data* time, so a replay whose clock runs thousands of times faster than the wall clock was cut to a single event per batch; and the follow window was a duration, so every size it offered was narrower than the gap between two consecutive samples. Both presented as "the chart does not fill". The three window spans being nested and proportional is the property that matters.

*Normative source:* [`CONTRIBUTING.md` — The bar](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#the-bar).

## Fixtures are vendored, and tracked

`test/fixtures/` vendors the EMS's golden fixture from `examples/` in motrix-edge, checksum-verified against the manifest the EMS publishes. It is committed to the repository deliberately — it is the interface between the two repositories, and when it drifts, tests here fail rather than a user's chart quietly going wrong. Re-vendor with:

```bash
npm run fixtures:update
```

That script ([`scripts/update-fixtures.mjs`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/scripts/update-fixtures.mjs)) is one leg of the cross-repo format procedure — the whole loop, including when and why it runs, is on [/contribute/storage-format-changes/](/contribute/storage-format-changes/). Never hand-edit a fixture, and never regenerate one to make a failing test pass.

*Normative source:* [`CONTRIBUTING.md` — Contracts shared with Motrix Edge](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#contracts-shared-with-motrix-edge).

## Workflow

Day to day: `npm run dev` (dev server on 5173, `/api` proxied to a local EMS with no gate in front — the Basic auth lives in the container's nginx), `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` for the single-file output plus the bundle-size check. The contribution bar across both repositories — what must be green before a PR — is on [/contribute/workflow/](/contribute/workflow/), and the repository's own checklist is [`CONTRIBUTING.md` — Before you open the pull request](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#before-you-open-the-pull-request), which the pull request template mirrors.

Two habits from the EMS side carry over unchanged: explain *why* in prose and comments, not just what; and when a rule matters, put a test or a lint behind it rather than a sentence alone.

Both repositories share a [code of conduct](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CODE_OF_CONDUCT.md), and a security issue goes through [`SECURITY.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/SECURITY.md) — privately, never as a public issue or a pull request. What is in scope for the viewer follows from its shape: it is a static file with no backend, so the boundaries that exist are the `file://` one, the `topology.ts` allowlist, and the container's nginx gate. The doctrine behind all three is on [/architecture/security/](/architecture/security/).
