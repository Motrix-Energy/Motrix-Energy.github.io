---
title: Publishing a plugin
description: How to share a connector, device or algorithm from your own repository — the frozen config value, the layout, the discovery convention, and what an operator is agreeing to when they install one.
---

[The plugin system](/architecture/plugins/) describes how a plugin **loads**. This page describes
where one may come **from**, which is a different question and has a shorter answer than most people
expect: your own repository, no packaging, no pull request, no maintainer in the loop.

A plugin in a vendor sub-directory of an axis loads today, unmodified:

```
connectors/acme/solar.py            class SolarConnector(Connector)
connectors/acme/solar.schema.json
```

```json
{ "name": "roof", "protocol": "acme.solar", "options": { "host": "10.0.0.7" } }
```

*Normative source:* [Publishing a plugin outside this repository](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#publishing-a-plugin-outside-this-repository).

## The config value is frozen

The dot is a directory separator: `acme.solar` is imported from `<axis>/acme/solar.py` and its
options are validated against `<axis>/acme/solar.schema.json`. Everything else about this convention
is reversible in an afternoon. That string is not, because `config.json` is mounted read-only
precisely so that upgrading never asks an operator to rewrite it.

It is deliberately not `community.<vendor>.<name>`. The bare form survives unchanged if plugins ever
move to a separate `sys.path` root, into a `motrix_edge/` package, or into wheels; a hard-coded
`community.` segment would have to be migrated in every deployment that used it.

:::caution[One guard, and it is a regex]
`_PLUGIN_NAME` in `config/config.py` is the only thing standing between a config value and the
filesystem — `importlib.resources.files(...).joinpath(...)` performs no containment check of its own.
It accepts a dotted chain of Python identifiers and refuses everything else: `../etc/passwd`, `a/b`,
`/abs`, `.hidden`, `a..b`. The *import* path needs no such guard, because `import_module` raises
`ModuleNotFoundError` for every hostile name and the loader treats that as a clean per-entry skip.
:::

## Layout, naming and discovery

Name the repository `motrix-edge-<axis>-<name>` and give it the GitHub topic
[`motrix-edge-plugin`](https://github.com/topics/motrix-edge-plugin). That topic is the entire
discovery mechanism — there is no index to be added to and no tier to be granted.

```
motrix-edge-connector-solarvendor/
	connectors/acme/solar.py
	connectors/acme/solar.schema.json
	tests/test_solar.py          # imports api.testing, runs api.conformance
	conftest.py                  # finds a motrix-edge checkout - see below
	LICENSE                      # extensionless
	README.md
```

Keep `LICENSE` extensionless: `.dockerignore` strips `*.md`, so a `LICENSE.md` would be missing from
a locally built image, and the image is a distribution.

## Testing it from your own repository

Test it the way the shipped plugins are tested. The axis-generic doubles and threading harness live
in [`api/testing.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/testing.py) and the
checks in [`api/conformance.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/conformance.py);
both import from anywhere. Run `check_loads` first — it drives the real loader, so it catches the
class-naming and `issubclass` mistakes a schema check cannot see. Neither module is a supported API
yet.

The one piece of scaffolding you need is making those imports resolve, because `motrix-edge` is not a
distribution — there is no `pip install motrix-edge`. An operator does not have this problem: they
copy your directory into a checkout, where everything is simply importable. A test run has to arrange
the same thing temporarily.

:::caution[`sys.path` is not enough, and a second `__init__.py` is worse]
The axis packages are **regular** packages, so `import connectors` resolves to the runtime's copy and
stops — your `connectors/acme/` is unreachable wherever your repository sits on `sys.path`. Shipping
your own `connectors/__init__.py` is the wrong fix: whichever copy wins `sys.path` wins outright, and
a plugin repository that won would make every built-in connector silently unreachable.

Extend the real package's `__path__` instead. That is the local equivalent of the copy an operator
performs.
:::

```python
# conftest.py — put a motrix-edge checkout on sys.path, and make the axis see your vendor directory.
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

CANDIDATES = [
	os.environ.get("MOTRIX_EDGE"),          # what CI sets after cloning
	os.path.join(HERE, "motrix-edge"),
	os.path.join(os.path.dirname(HERE), "motrix-edge"),
]

AXES = ["connectors"]                       # every axis your repository contributes to


def _runtime_root() -> str:
	for candidate in CANDIDATES:
		if candidate and os.path.isfile(os.path.join(candidate, "api", "connector.py")):
			return os.path.abspath(candidate)
	# Fail loudly. A suite that reports zero tests because it could not find the runtime is
	# the exact failure api/conformance.py exists to prevent.
	raise RuntimeError(
		"Could not find a motrix-edge checkout. Set MOTRIX_EDGE, or clone it beside this "
		"repository: git clone --depth 1 https://github.com/Motrix-Energy/motrix-edge"
	)


sys.path.insert(0, _runtime_root())

for _axis in AXES:
	_local = os.path.join(HERE, _axis)
	if os.path.isdir(_local):
		_package = __import__(_axis)
		if _local not in _package.__path__:
			_package.__path__.append(_local)
```

:::danger[What that trick does *not* buy you]
**Imports merge across `__path__`; resources do not.** `importlib.resources.files()` returns the
first portion only, so a schema reached this way is invisible to `Config` — your options would go
unvalidated while everything appears to work. It is the same trap `pkgutil.extend_path` sets.

This never bites an operator, because a copied directory is physically inside the package. It matters
to *you*, and it is exactly why the checks in `api/conformance.py` take a **directory** argument
rather than deriving one from a package name. Use `conformance.axis_directory(...)` and they are
unaffected.
:::

Mind the two package names while you are there. The schema checks look at *your module*, so they take
the **vendor** package (`connectors.acme`). The loader takes the **axis** package (`connectors`) and
appends the config value, which already carries the vendor. Mixing them up produces
`connectors.acme.acme.solar`.

```python
# tests/test_solar.py
import os

from api import conformance
from api.connector import Connector

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRECTORY = conformance.axis_directory(HERE, "connectors.acme")

def test_the_schema_and_the_constructor_agree():
	report = conformance.check_kwargs_lockstep(DIRECTORY, "connectors.acme", "connector")
	assert report.checked, "nothing checked — check the module and class names"
	assert report.ok, report.describe()

def test_the_real_loader_can_construct_it():
	report = conformance.check_loads(
		{"name": "roof", "protocol": "acme.solar", "options": {"host": "10.0.0.7"}},
		"protocol", "connectors", Connector, expected_name_suffix="connector",
	)
	assert report.ok, report.describe()
```

And a CI job, which clones the runtime rather than installing it. The three security settings are
copied from `motrix-edge`'s own workflow: a plugin repository has no reason to be laxer than the
runtime it extends.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

permissions:
  contents: read          # not read/write: no step here publishes anything

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false   # or the token stays in .git/config for the whole job
      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5
        with:
          python-version: '3.12'
      - run: git clone --depth 1 https://github.com/Motrix-Energy/motrix-edge.git "$RUNNER_TEMP/motrix-edge"
      - run: pip install -r "$RUNNER_TEMP/motrix-edge/requirements.txt" pytest ruff
      - run: ruff check .
      - env:
          MOTRIX_EDGE: ${{ runner.temp }}/motrix-edge
        run: pytest
```

Both actions are pinned by commit SHA, not by tag: a tag is mutable, and a compromised action runs
with whatever the job's token can reach. Pin the `motrix-edge` clone to a ref once your plugin
depends on something newer than `main`.

## Installing one

```bash
git clone --depth 1 https://github.com/someone/motrix-edge-connector-solarvendor /tmp/p
cp -r /tmp/p/connectors/acme connectors/
docker compose up -d --build
```

No compose edit, no bind mount, no `PYTHONPATH`, no derived image: compose builds `edge` from
`context: .` and `.dockerignore` excludes no axis directory, so a vendored plugin is already in the
build context. `.gitignore` ignores `<axis>/*/`, so `git status` stays clean and `git pull` never
conflicts with what you copied. The one real gap is a plugin with its own pip dependency; there is no
mechanism for that yet.

Failures are per-entry, as everywhere else: bad options are a startup warning naming the key, a
missing optional dependency is one skipped entry, and a module that raises at import — or calls
`sys.exit()` — is one skipped entry and a traceback.

## The ceiling on a shared algorithm

Worth knowing before you write one, because it is lower than it looks. An algorithm is portable
because it selects devices by capability rather than by class, and the whole capability vocabulary is:

| Capability | What it answers |
|---|---|
| `EnergyMeter.get_total_energy_kwh()` | cumulative imported kWh, and nothing else |
| `Switch` | a marker interface: binary on/off, actuated with a `str` token |
| `MetricSource.get_metrics()` | a `{name: scalar}` view **for storage** — invisible to algorithms |

And `role`, the one hook a generic config-driven device has for saying what a number *means*, is a
closed enum with exactly one member: `energy_import_kwh`.

So a published algorithm can ask a device it has never seen two questions: how many kWh it has
imported in total, and whether it is switchable. No instantaneous power, no state of charge, no
setpoint, no tariff, no forecast, no curtailment limit. Every richer reading a device already parses
flows to storage and cannot be reached from an algorithm. Widening that vocabulary is worth more to
algorithm sharing than any packaging work — but it is a design decision about an energy domain model,
not a distribution one, and nothing on this page changes it.

## If what you are sharing is data, it costs no Python

A new *dialect* of a transport and a new payload layout are both config. Supporting a LoRaWAN network
server that `connectors/lorawan.py` has never heard of costs zero Python, because `profile: "custom"`
takes the topic templates and the downlink envelope from `config.json` — `examples/connectors/lorawan.json`
is the shipped, tested proof. A new Modbus meter is a `registers` array; a new LoRa node is a `fields`
map.

A shared JSON fragment cannot execute, cannot reach a credential and cannot crash the EMS, and you can
review it by reading it. Prefer it whenever it will do.

:::danger[A shared fragment must never contain `${`]
`Config` resolves `${VAR}` anywhere in the document, so a contributed fragment setting
`"unit": "${MQTT_PASSWORD}"` would ride a credential into `device_data.csv`. A profile describes
hardware, not a deployment. Refuse the string on sight.
:::

## What an operator is agreeing to

A community plugin runs **in-process**, in a supervised thread, and there is no sandbox — Python
offers none worth the name. It can actuate any physical device, read every other device's live state
through the `DevicesManager` singleton whether or not one was injected into it, reach a connector's
credentials through a device's deliberately-shared live connector, and write anything it likes to
storage.

The loader's containment changes the blast radius of a *mistake*: one bad plugin is one skipped entry
instead of a dead EMS. It changes nothing about malice, and no review could — the loader executes a
module's top-level code *before* the `issubclass` gate, so anything done at import time has already
happened by the time the entry is rejected. **Containment is for bugs; for malice there is only
provenance.** Know whose repository you copied from, and pin what you copied.

Third-party plugins are not covered by the Supported versions in
[`SECURITY.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/SECURITY.md), and the remedy
available to these maintainers for a bad one is to stop pointing at it and say why — not a patch,
because the code is not theirs to patch.

## Would it be better in the main repository?

Sometimes. A plugin is admitted to `motrix-edge` when it is a **protocol rather than a product**, its
specification is openly published, and it can be tested with no hardware and no network. Those
criteria fit `connectors/` exactly. They fit `devices/` badly, because a device is inherently
product-shaped, so there the bar is the last two criteria plus usefulness beyond one manufacturer's
customers. `services/` is the one axis that cannot be published outside the tree at all today,
because `Service.__init__` is typed against a concrete `Supervisor`.

The full policy, which is the normative one, is in
[`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#publishing-a-plugin-outside-this-repository).
