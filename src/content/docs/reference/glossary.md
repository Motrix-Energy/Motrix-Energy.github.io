---
title: Glossary
description: The Motrix vocabulary — every load-bearing term in one place, each entry linking to the page that owns it.
---

The terms the two repositories use with precision, in alphabetical order. Each entry ends
with a link to the page where the concept lives in full.

### Algorithm

The actual core of the EMS: the logic that reads devices and decides what to do. An
algorithm consumes devices by capability (`isinstance(device, EnergyMeter)`), never by
concrete class, which is what lets the same `main()` backtest over a CSV replay and run
live over MQTT without changing a line. Algorithms are the one plugin axis that ships no
options schema, by design. See [Recipe: algorithms](/contribute/algorithms/).

### Backtest / replay

Running the EMS against recorded data instead of live hardware, via the pseudo connector.
The replay is deterministic and lockstepped: a slow algorithm slows the backtest rather
than silently skipping timesteps, so a backtest is evidence, not an approximation. See
[Time, replay and determinism](/architecture/time-and-replay/).

### Capability

An abstract interface in `api/capabilities.py` that a device implements and an algorithm
`isinstance`-checks — the contract between the two axes. Three exist today: `EnergyMeter`
(readings in kWh, with `0.0` meaning "well-formed but no kWh register" and `None`
reserved for "configured but unreadable"), `Switch` (a class-level claim of genuine
writability), and `MetricSource` (a device names its own readings when payload structure
carries meaning). See [Recipe: devices and capabilities](/contribute/devices/).

### Committed step clock

One of the replay's two clocks: the timestep the algorithms are processing, committed
after a whole timestep has been dispatched. It is what triggers algorithm steps and what
stamps `algorithm_decisions.csv` — a decision computed while processing T belongs to T
even if the replay has already moved on. See
[Time, replay and determinism](/architecture/time-and-replay/).

### Connector

The plugin that speaks a protocol and owns the devices declared against it. It receives
raw transport data, hands each payload to the right device's `receive()`, and reports the
verdict through `on_device_data_received()`; on the control path, its `send()` carries an
algorithm's command back out. See
[Build your first connector](/contribute/your-first-connector/).

### Connector-shaped liveness

The rule that `main` waits on the connectors only. A service never keeps a finished
replay alive — which is why the REST API is a fifth plugin axis rather than a `Connector`
with stub methods, and why a config with services and no connectors exits immediately,
with a warning saying so. See [Lifecycle](/architecture/lifecycle/).

### Dataset list

The viewer's state model: N loaded datasets — files and at most one live subscription —
each with a source, a tag and a colour, rather than a single "current source" that gets
switched. The list is what delivers side-by-side comparison of two runs and lets a live
feed share a chart with a 2013 replay. See [Using the viewer](/operate/viewer/).

### Device

The plugin that parses one device kind's payloads into `self.data` and exposes
capabilities. Every argument its `receive()` takes is a `str`, by contract: the replay
hands its devices the same strings the live connector would, so the backtest exercises
the production parser. A device that could not use a payload returns `False` rather than
inventing a reading. See [Recipe: devices and capabilities](/contribute/devices/).

### Emulates

The pseudo connector option that makes a replay impersonate another transport: a replay
declaring `emulates: "modbus_tcp"` injects `modbus_tcp` as its devices' protocol, so a
device parses replayed captures exactly as it parses live traffic — capture once, then
backtest on a machine with no hardware and no protocol stack. See
[Connecting real hardware](/operate/hardware/).

### Event clock

The replay's other clock: the moment a reading was produced, advanced before each entry
is dispatched. It is what stamps `device_data.csv`, so a reading is filed against its own
timestep rather than the previous one. See
[Time, replay and determinism](/architecture/time-and-replay/).

### Five plugin axes

The five kinds of plugin the EMS loads from `config.json` by naming convention —
connectors, devices, algorithms, storage backends, services. There is no registry to edit
and no import to add: a new plugin is a new module plus a config entry. See
[The plugin system](/architecture/plugins/).

### Gap

A missing row in the storage output — the EMS writes no row for a rejected payload, so a
stalled meter reads as missing data rather than a flat line. What a gap means, and how
readers must treat one, is stated on [Storage format 1.0](/reference/storage-format/).

### Golden fixture / adversarial fixture

`examples/auto_toggle/expected/` holds the golden fixture: the actual bytes a real EMS
run writes, byte-reproducible, vendored by the viewer and pinned by a contract test on
both sides — it, not any prose, is the interface between the repositories.
`examples/edge_cases/` is the adversarial fixture: authored rows the EMS cannot produce
but a truncating disk or an Excel round-trip can, kept separate so the golden file stays
a statement about what the EMS emits. See
[Changing the storage format](/contribute/storage-format-changes/).

### Kwargs contract

The rule that every key in a config entry's `options` object is passed as a keyword
argument to the plugin's constructor: `actual_class(name, **options)`. Your constructor
signature *is* your options schema — an unknown key raises `TypeError` and the plugin is
skipped with a logged error. See [The plugin system](/architecture/plugins/).

### Lockstep barrier

The synchronisation point in `simulation/clock.py`: after committing a timestep, the
replay blocks until every algorithm has finished processing it. This is why `speed: 0`
means "as fast as the algorithms allow", not "as fast as the file reads", and why a slow
algorithm cannot cause a replay to run ahead and skip timesteps. See
[Time, replay and determinism](/architecture/time-and-replay/).

### Locomotrice / Radisio

Radisio is the company that develops Motrix and holds the copyright; Locomotrice is the
project the Motrix repositories belong to. Both repositories are Apache-2.0. See
[What is Motrix?](/start/what-is-motrix/).

### LoRa vs LoRaWAN

The same radio technology reached two ways, and the choice is not close. `lorawan` talks
to a network server (ChirpStack, The Things Stack, …) that has already abstracted every
gateway and radio — it is MQTT underneath, and needs nothing outside the core. `lora`
drives a radio module wired to this host over a serial port, for point-to-point links
with no network server at all. Both feed the same `lora` / `lora_switch` device. See
[Connecting real hardware](/operate/hardware/).

### Motrix family

The two repositories that share the storage-format contract: **Motrix Edge**, the
local-first runtime, and **Motrix Edge View**, the single-file viewer for its output.
Both ends are pinned to the same storage format version, with one golden fixture vendored
on both sides. See [What is Motrix?](/start/what-is-motrix/).

### Naive vs offset-aware timestamp

A naive timestamp carries no UTC offset; an offset-aware one does. The storage files
routinely hold both in one column — how to read them is stated on
[Storage format 1.0](/reference/storage-format/).

### OBIS / P1

P1 is the consumer port on European smart meters; OBIS codes are the register-naming
scheme its telegrams use. The `p1` device parses OBIS telegrams (with CRC16-ARC
verification) into a payload that is nested and keyed by *position* — which is exactly
why it implements `MetricSource` and re-keys its readings by OBIS code. See
[Recipe: devices and capabilities](/contribute/devices/).

### Pseudo connector

The file-replay connector: it replays a timestamped CSV or JSON file, advances the two
simulation clocks, and blocks on the lockstep barrier. Algorithms cannot tell it from a
live transport — that is the test. With `emulates` it impersonates any other connector's
protocol. See [Time, replay and determinism](/architecture/time-and-replay/).

### Storage format

The versioned contract (currently **1.0**) for the two CSV files the `csv_file` backend
writes — dialect, headers, timestamp semantics, gap semantics. It is normative in
`docs/storage-format.md` in motrix-edge and enforced by a byte-exact fixture test on both
sides of the repository boundary. See [Storage format 1.0](/reference/storage-format/).

### Supervisor / bounded backoff

Every connector, algorithm and service runs in its own supervised daemon thread. A worker
that **raises** is logged with its traceback and restarted with bounded exponential
backoff — past the cap it logs CRITICAL and stays down; a worker that **returns** is a
clean completion and is never restarted. Raise on failure, return when genuinely done.
See [Lifecycle](/architecture/lifecycle/).

### t₀-normalisation

The viewer's alternative x-axis: each dataset is shifted so its own first instant becomes
zero, letting two runs from different years — or a live feed and an old replay, which
share no wall-clock range — superimpose on one chart. See
[Using the viewer](/operate/viewer/).

### Two-layer validation

How configuration is checked: `config.schema.json` covers the document's shape, while
each plugin's options are validated against the schema shipped next to that plugin
(`connectors/mqtt.schema.json`, `devices/p1.schema.json`, …). Warnings, never fatal — and
adding a plugin never touches the root schema. See
[The plugin system](/architecture/plugins/).
