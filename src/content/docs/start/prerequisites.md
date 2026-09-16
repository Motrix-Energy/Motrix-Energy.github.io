---
title: Prerequisites
description: What you need to run, view, deploy or develop Motrix — and the two Windows-specific rules to set up before your first diff.
---

What you need depends on which seat you are in. The short version: Python 3.12+ for the
runtime, Node 22+ only if you develop the viewer, Docker only if you deploy, and hardware
never — the entire development and backtesting story runs on replayed files.

## At a glance

| You want to | You need |
|---|---|
| Run the [quickstart](/start/quickstart/) and backtest algorithms | Python 3.12+ |
| Look at a run in the viewer | Nothing — download one `index.html` and double-click it |
| Develop the viewer | Node 22+ (22.12+ recommended) |
| Deploy to a site | Docker with Compose |
| Connect real hardware | The hardware — and nothing else new; see [connecting real hardware](/operate/hardware/) |

## Python 3.12 or newer

Motrix Edge requires Python **3.12+**. This is a hard floor, not a recommendation: the
code uses `typing.override` (and PEP 701 f-strings), and `typing.override` does not exist
before 3.12. On 3.11 the failure is immediate and unambiguous —
`from typing import override` raises `ImportError` while `main.py`'s own imports load
(the device registry uses it), before any of your configuration is even read. Nothing
degrades gracefully, which is the honest failure mode: better one clear import error than
an EMS that half-works.

Check what you have:

```bash
python --version
```

The base [`requirements.txt`](https://github.com/Motrix-Energy/motrix-edge/blob/main/requirements.txt)
is deliberately small. Optional features carry their own requirements files —
`requirements-api.txt` for the REST API, `requirements-modbus.txt`,
`requirements-homeassistant.txt`, `requirements-lora.txt` — and none of them belongs in a
minimal install: an MQTT-and-CSV site should not install a web framework. A missing extra
is one clean per-entry skip at startup, and the EMS runs on without it.

## Node 22 or newer — viewer development only

You do not need Node to *use* Motrix Edge View: it is published as a single `index.html`
you download and double-click. Node **22+** is only for developing it — `npm ci`,
`npm run dev`, the test suite. Vite prefers 22.12+ and warns below that; the warning is
harmless.

## Docker — deployment only

Docker (with Compose) is how a site deployment runs: the EMS container, and optional
profiles for a broker, monitoring, and the gated viewer. Nothing in development requires
it — every test and every backtest runs directly on your machine. See
[Docker and compose profiles](/operate/docker/).

## No hardware, ever

Development never requires a meter, a switch, a broker, or a network. The `pseudo`
connector replays a timestamped CSV through the same code paths live hardware would take,
and the shipped [golden fixture](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/README.md)
gives you three simulated devices and a working algorithm out of the box. Real hardware is
an operations concern, not a development one — and even then, a captured run can be
replayed as a backtest. See [time, replay and determinism](/architecture/time-and-replay/).

## Working on Windows

Motrix Edge works on Windows, but two properties of the repository are easy to trip over
if your tooling is left on its defaults. Configure both **before your first diff**, not
after.

### Line endings: the CSV contract is CRLF, and the fixtures are bytes

The storage contract fixes the CSV line terminator as **CRLF on every platform** —
`csv_file` hands the terminator to Python's `csv` module rather than using `os.linesep`,
so output written on Linux and on Windows is byte-identical. The committed fixture in
`examples/auto_toggle/expected/` is the **actual bytes** of a real run, and
`tests/test_storage_contract.py` compares against it byte-for-byte.

That is why Edge's CI runs on ubuntu only, and why that is the point of the job rather
than an arbitrary default: if git were allowed to normalise the fixtures to LF, the suite
would pass on your Windows checkout and fail on Linux CI — having "corrected" the one
property the fixture exists to pin. The repository's
[`.gitattributes`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.gitattributes)
therefore marks `examples/**` as binary (`-text`), regardless of your `core.autocrlf`
setting.

:::caution[Check your checkout before trusting a diff]
`core.autocrlf=true` is a common global default on Windows. The `.gitattributes` rules
protect `examples/` from it, but only in a checkout that has them — a stale clone, a
copy made outside git, or an editor configured to "fix" line endings on save can still
mangle the fixtures. If `python examples/generate.py --check` reports drift you did not
cause, or a diff claims an entire fixture changed, suspect line endings first. See
[troubleshooting](/operate/troubleshooting/).
:::

### Tabs, in Python and JSON alike

Both repositories indent with **tabs** — in Python, in TypeScript, and in JSON. It is a stated
rule on both sides
([Edge](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#style),
[View](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#style)),
and there is deliberately no formatter in either workflow: a reformat would bury every real
change in whitespace. That puts the burden on your editor settings instead. Before your
first change, configure your editor to insert tabs for `.py`, `.ts` and `.json` files in these
repositories — an `.editorconfig`-aware editor, or a per-workspace override, does it once.

A diff whose every line changed is a diff nobody can review; the tab rule exists so that
never happens.

## Where next

With Python 3.12+ in place, the [quickstart](/start/quickstart/) gives you a complete EMS
run in about a second.
