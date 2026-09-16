---
title: Contribution workflow
description: The cross-repo contributor checklist for Motrix Edge and Motrix Edge View, from checkout to a green pull request.
---

Motrix is two repositories with one bar: **a green test suite is the bar for every contribution**, and both suites are built to clear it fast, offline, and without hardware. This page is the checklist you run before opening a pull request — what to install, what to run, and the two or three rules in each repo that are not obvious until they bite.

Each repository keeps its own normative recipes next to the code. On the Edge side, [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md) has the exact steps for adding a connector, device, storage backend, service or algorithm; on the View side, [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md) has them for a core module, a UI string, a locale, a warning, a live endpoint, a data source, a component and a chart. This site narrates both ([Build your first connector](/contribute/your-first-connector/) is a full walkthrough of the connector one), but when the site and a repo disagree, the repo wins.

## Motrix Edge (Python)

### Set up once

```bash
pip install -r requirements.txt -r requirements-dev.txt
```

`requirements-dev.txt` pulls in every optional extra — fastapi, pymodbus, websocket-client, pyserial — plus pytest, httpx and ruff. That is deliberate: the tests for optional plugins guard themselves with `pytest.importorskip`, so a checkout without the extras still runs green — it just runs *fewer* tests, and tells you which ones with `pytest -rs`. A dev checkout should run all of them.

### The test contract

```bash
pytest
```

The full suite runs in **seconds, with no broker and no hardware**. That is not a happy accident — it is the contract, and your contribution must keep it. A test that needs a live MQTT broker, a serial port, or the network does not belong in the suite; every existing connector test mocks or scripts its transport, and [the recipes](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-connector) name which existing test file to copy for each transport shape.

A test that spawns a second Python interpreter — the storage-contract check runs the real `main.py` in subprocesses — carries the `slow` marker for it. Skip those in a tight dev loop:

```bash
pytest -m "not slow"
```

CI never skips them — the marker exists for your inner loop, not for the gate.

### Lint, and never format

```bash
ruff check .
```

That is the whole linting story, and the word *check* is load-bearing. **Never run a formatter over this tree** — not `ruff format`, not black, not your editor's format-on-save. The codebase indents with tabs and is deliberately unformatted; a reformat would touch most files in the repository and bury every real change in your diff under whitespace. `ruff.toml` opens by saying so, and the config selects only rules that catch dead or wrong code, not style opinions.

### Before touching anything near storage

```bash
python examples/generate.py --check
```

`examples/` holds the golden fixture — the actual bytes the EMS writes, which Motrix Edge View vendors and both test suites compare against. `--check` rebuilds it into a temporary directory and diffs; a non-zero exit means your change moved the published storage format, which is a cross-repo event with [its own procedure](/contribute/storage-format-changes/). Run it before and after any change in `storage/`, and treat an unexpected diff as a stop sign, not a fixture to regenerate.

:::caution[CI runs on Ubuntu only, and that is the point]
The one CI job pins `ubuntu-latest` deliberately: `tests/test_storage_contract.py` compares the fixture's **CRLF bytes exactly**, and `.gitattributes` marks `examples/**` as binary so git cannot normalise the line endings. Let git normalise them and the suite passes on Windows while failing in CI — Ubuntu is the run that catches it. On Windows, set your checkout up as described in [Prerequisites](/start/prerequisites/) before your first clone.
:::

### What Edge CI runs

The [workflow file](https://github.com/Motrix-Energy/motrix-edge/blob/main/.github/workflows/ci.yml) is short enough to hold in your head, and reproducing it locally is exactly the three commands above:

```bash
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
pytest
```

No `-m "not slow"`, no formatter, no coverage gate — and every optional extra installed, because a connector test that `importorskip`s its dependency would otherwise *skip* in CI and report green over an unexercised plugin. If those three commands pass on your machine and your checkout has not normalised the fixture bytes, CI will agree with you.

## Motrix Edge View (TypeScript)

The viewer's normative guide is [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md) in motrix-edge-view — the standing privacy rule, the rules that are load-bearing with the lint or test behind each, and the recipes. What follows is the same bar, in the shape of a checklist.

### Set up once

```bash
npm ci
```

`npm ci`, not `npm install` — the lockfile is the build. Node 22 or newer (22.12+ recommended; Vite warns below that).

### The scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server on 5173, with the `/api` proxy to a local EMS |
| `npm run build` | typecheck, build one self-contained `dist/index.html`, then the single-file check |
| `npm test` | vitest — `core` in node, `dom` in jsdom |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm run fixtures:update` | re-vendor the EMS golden fixture, checksum-verified |

All of typecheck, lint, test and build must pass — CI runs exactly that set on every push.

### The single-file check

`npm run build` ends in `scripts/check-bundle-size.mjs`, which asserts that `dist/` holds **exactly one file, with no external references, under 900 KB**. That check is not decoration. The viewer ships as one `index.html` a user double-clicks on an offline site LAN, and `vite-plugin-singlefile` stops inlining *silently* past its limits — the failure mode is a viewer that 404s the moment someone opens it offline, which is the only way anyone opens it. If your change grows the bundle past the limit, the answer is to shrink the change, not to raise the limit.

### What View CI runs

CI runs typecheck, lint, tests and the build on every push and pull request — the same four scripts from the table, nothing more. Pushing a `v*` tag runs the same gate again and publishes two things from the exact bytes that passed it: `dist/index.html` as the release asset, and the container image to GHCR under the version tag. Releasing is therefore not part of a contribution — a merged PR is done when the four scripts are green.

### The vendored fixture

`test/fixtures/` vendors the EMS repository's golden fixture, checksum-verified against the manifest it publishes. It is tracked, not ignored, because it *is* the interface between the two repositories: when the EMS's output drifts, the viewer's tests fail rather than a user's chart quietly going wrong. If your PR needs a newer fixture, `npm run fixtures:update` re-vendors it — but a fixture that *needs* updating means the storage format moved, and that has [its own cross-repo procedure](/contribute/storage-format-changes/).

The viewer has its own contribution page — [Contributing to Motrix Edge View](/contribute/viewer/) — covering the architecture and the reasoning behind the load-bearing rules (never `Date.parse`, nothing that breaks `file://`, and the rest); the enforced list and the recipes are in the repository's [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md).

## Rules shared by both repositories

- **Green tests are the bar.** Not "mostly green", not "green except the flaky one". Both suites are fast and deterministic precisely so this bar costs nothing to hold.
- **Log through `self.LOGGER`, never `print()`.** The abstract base classes set up a named logger per instance (`ClassName/instance_name`); `print()` bypasses the level filtering, the formatting, and the operator's ability to turn you down. This is [the Edge style rule](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#style), and it applies to every axis.
- **Indentation is tabs, in Python and JSON alike.** Configure your editor before your first edit — [Prerequisites](/start/prerequisites/) has the setup — because a spaces-indented file will fail review on the diff alone.
- **A pull request that adds a plugin also updates the [plugin catalogue](/reference/plugin-catalog/).** The catalogue is one row per shipped plugin across all five axes, and it is the most drift-prone page on this site; keeping it honest is part of shipping the plugin.
- **Privacy is a standing rule, not a review comment.** Both repos are public. No customer names, site topology, broker hosts, serials or real addresses — examples use the shipped vocabulary (`p1_meter`, `shelly_plug`, `pseudo_sensor`, `AutoToggle`). It binds issues and screenshots as much as commits.
- **Conduct and security have their own files, in both repositories.** The [code of conduct](https://github.com/Motrix-Energy/motrix-edge/blob/main/CODE_OF_CONDUCT.md) is Contributor Covenant 2.1; a security issue goes through the repository's `SECURITY.md` and GitHub's private reporting, never a public issue and never a pull request. What is in scope on each side is on [Security model](/architecture/security/).

## Before you open the pull request

The consolidated list, for the day you have both terminals open:

**Motrix Edge**

- [ ] `pytest` green — the full suite, not `-m "not slow"`
- [ ] `ruff check .` clean, and no formatter has touched the tree
- [ ] `python examples/generate.py --check` exits 0, if your change is anywhere near `storage/`
- [ ] New plugin? Schema file shipped, its keys in lockstep with the constructor, and a test file copied from the matching template
- [ ] Optional dependency? Own `requirements-<name>.txt`, a `-r` line in `requirements-dev.txt`, and `pytest.importorskip` before any project import in your tests
- [ ] Tabs everywhere, `self.LOGGER` everywhere

**Motrix Edge View**

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green
- [ ] `npm run build` passes, including the single-file check
- [ ] New or changed UI strings are in all four catalogues, and every text-bearing component subscribes to the locale
- [ ] No component invents a colour, and nothing new reaches off-disk from `file://`

**Both**

- [ ] Nothing from a real installation in any example, fixture or test
- [ ] The [plugin catalogue](/reference/plugin-catalog/) row added or updated, if a plugin changed
- [ ] If the CSV output moved: stop, and read [Changing the storage format](/contribute/storage-format-changes/) before pushing anything

## Where to go next

- Adding a connector: start with [Build your first connector](/contribute/your-first-connector/), then read [Connector patterns and footguns](/contribute/connector-patterns/) before you write the real one.
- Adding a device or capability: [Devices and capabilities](/contribute/devices/).
- Adding an algorithm: [Algorithms](/contribute/algorithms/).
- Adding a storage backend or service: [Storage backends and services](/contribute/storage-and-services/).
- Touching the CSV output in any way: [Changing the storage format](/contribute/storage-format-changes/) first.
