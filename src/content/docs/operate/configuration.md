---
title: Configuration
description: How one config.json wires connectors, devices, algorithms and storage together, and where every plugin option is documented.
---

A Motrix Edge site is one `config.json`. The file does not tune a monolith — it wires one: every connector, device, algorithm, storage backend and service the process runs is an entry in that file, loaded by name, with no registry to edit and no import to add.

:::note[Canonical source]
This page summarises [`README.md` — "The configuration is the wiring"](https://github.com/Motrix-Energy/motrix-edge/blob/main/README.md#the-configuration-is-the-wiring) and [`config.schema.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/config.schema.json), which are the authority when they disagree.
:::

## The wiring model

The repository's own worked example:

```json
{
	"connectors": [
		{ "name": "broker", "protocol": "mqtt",
			"options": { "host": "${MQTT_HOST}", "port": 1883, "version": "3.1.1" } }
	],
	"devices": [
		{ "name": "shelly_plug", "kind": "shelly_plug",
			"options": {
				"connector_options": { "name": "broker" },
				"listener_options": { "pattern": "shellies/.*", "subscription": "shellies/plug-s/#" },
				"controller_options": { "topic": "shellies/plug-s/relay/0/command" }
			} }
	],
	"algorithms": [
		{ "name": "AutoToggle", "class": "auto_toggle",
			"options": { "delay_seconds": 900, "required_devices": ["shelly_plug"] } }
	],
	"storage": [
		{ "name": "csv", "class": "csv_file", "options": { "output_dir": "data/storage" } }
	]
}
```

Read it top to bottom as a wiring diagram:

- **A connector is declared** under a name (`broker`) and a `protocol` that names the module to load.
- **A device names its connector** — `connector_options.name` is the only link between them. `main.py` groups devices by that name and calls `inject_devices()`, so a connector never looks a device up and a device never constructs a transport.
- **An algorithm requires devices** by name. `required_devices` is a readiness gate, nothing more — inside `main()` the algorithm still selects devices by capability, so the gate and the logic stay independent.
- **Storage is an array** — declare zero backends, or several at once, and `StorageManager` fans every write out with per-backend error isolation.

Order is config order: plugins are instantiated into a list, never a set, so two decisions landing in the same timestep land in the same order on every run.

## Validation is two-layer

`config.schema.json` covers only the document's shape — the arrays, the required `name`/`protocol`/`kind`/`class` keys, the optional top-level `version`, and the `runtime` block. Each entry's `options` object is validated against the schema shipped *next to the plugin it names* (`connectors/mqtt.schema.json`, `devices/p1.schema.json`, …), so adding a plugin never touches the root schema. Schema findings are warnings, never fatal: the real contract is the constructor signature, enforced by `TypeError` at instantiation. The full mechanism, including the naming convention and the kwargs contract, is on [the plugin system](/architecture/plugins/).

## Interpolation happens after validation

`${VAR}` and `${VAR:-default}` resolve from the environment when the config is loaded — so secrets stay out of the file — and they resolve **after** schema validation. Two consequences follow, and both are visible in the shipped schema files:

- An interpolated value is always a string, or `null` when a whole-value token resolves empty. A schema field that can be written as `${VAR}` therefore accepts `"string"` and `"null"` beside its natural type, or validation would reject the very configs interpolation exists for.
- Option coercion never raises. [`api/options.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/options.py) turns those strings into numbers and booleans by **warning and falling back to the default**. The loader contains a `ValueError` escaping a plugin's `__init__` — it logs the traceback and skips that entry — but a skipped entry is a plugin that is simply not there: no readings, no actuator, no service at the port. Losing a whole meter over one mistyped tuning knob is the wrong trade when the option has a perfectly good default.

:::caution
`python main.py` reads `os.environ` directly and loads no dotenv file. If your variables live in `.env`, export them first — the one-liners are on [Docker and compose profiles](/operate/docker/).
:::

## The version key

The optional top-level `version` declares the format of **this file**, not the release that reads it. Nothing else it could mean would be useful: a config cannot know which build will load it, and the file is mounted read-only into the container by design, so a number an operator had to edit on every upgrade would be a liability rather than a signal.

An EMS build understands one config format — `CONFIG_FORMAT_VERSION` in [`config/version.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/config/version.py), currently `1.0.0` — and compares yours against it component by component:

| Declared | What the EMS does |
|---|---|
| Absent, `null` or empty | Nothing. Omitting the key is not a claim, so it draws no verdict, and `Config.version` reads as null. |
| Equal, or any patch difference | Nothing. A patch changes no shape at all. |
| An older minor | Nothing. Minor versions are additive, so this build understands every key an older one can hold. |
| A newer minor | Warns. The file was written against a newer format, and anything it declares that this build's schema does not know is ignored without comment. |
| Either major mismatch | Errors. Across a major version a key can have been renamed or changed meaning, so the file may be read *wrongly* rather than incompletely. |

**None of it is ever fatal**, including a major mismatch — `Config` is built before the shutdown path exists, so an error is the loudest thing the loader can honestly do, and the run continues. There is also no automatic migration, and deliberately so: a migrator would have nowhere to write, and rewriting an operator's wiring unseen is not a thing a system that closes relays should do.

Two smaller rules follow from "it describes the document":

- **`${VAR}` does not belong here.** A document's format is a property of the document, not of the machine reading it, so the key is read from the raw file *before* interpolation — which is what lets the loader name the template in a warning instead of reporting a mysterious null.
- **A plugin's own options are versioned by its `*.schema.json`**, beside the constructor it must stay in lockstep with, and never by this number.

## The runtime block

Supervision and shutdown are tuned by one optional top-level block. These are the defaults — every key is optional and merged over them, so omitting the block entirely keeps exactly this behaviour:

```json
{
	"runtime": {
		"shutdown_timeout_seconds": 10,
		"restart": true,
		"max_restarts": 5,
		"backoff_seconds": 1,
		"max_backoff_seconds": 60
	}
}
```

`shutdown_timeout_seconds` is the shared grace period every worker is joined within on `SIGTERM`/`SIGINT`. The other four are the restart policy: a worker that raises is restarted with exponential backoff starting at `backoff_seconds` and capped at `max_backoff_seconds`; past `max_restarts` it logs CRITICAL and stays down. A worker that *returns* is a clean completion and is never restarted. The reasoning behind that distinction is on [Lifecycle](/architecture/lifecycle/).

## Where the full option reference lives

Deliberately not here. Every plugin that takes options ships a JSON Schema beside its module — about twenty-five `*.schema.json` files across the tree — and each option is documented in place with a `$comment`, next to the constructor it must stay in lockstep with. [`connectors/pseudo.schema.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/pseudo.schema.json) is a good first read. Duplicating those entries on this site would only give them somewhere to drift; the schemas are tested against the constructors, and this page is not.
