---
title: Quickstart
description: A complete EMS run in about a second — no broker, no hardware, no network — and an annotated walkthrough of what just happened.
---

Two commands give you a complete, deterministic EMS run: three simulated devices, a real
algorithm, and two CSV files of output. You need
[Python 3.12+](/start/prerequisites/) and nothing else.

## Run it

From a checkout of [motrix-edge](https://github.com/Motrix-Energy/motrix-edge):

```bash
pip install -r requirements.txt
python main.py --config examples/auto_toggle/config.json
```

About a second. No broker, no hardware, no network. It replays three simulated devices
through the `AutoToggle` algorithm and writes two files:

| File | Contents |
|---|---|
| `data/storage/device_data.csv` | 36 readings — 12 timesteps × 3 devices |
| `data/storage/algorithm_decisions.csv` | 12 decisions — six `off`, then six `on`, as the meter crosses the threshold |

The committed fixture beside the example
([`examples/auto_toggle/expected/`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/README.md))
is larger — 54 readings and 18 decisions — because it is *two* runs appended, one with
naive timestamps and one offset-aware. Your single run writes the first of them.

:::tip[Run it twice and you get 72 rows]
The `csv_file` backend appends. That is deliberate — an operator restart on a real site
appends to the same files — but it means a second quickstart run doubles the row counts.
Delete `data/storage/` when you want a clean slate. The example's own output directory is
parameterised precisely so the quickstart cannot dirty the committed fixture.
:::

## What just happened

The run exercises the whole architecture, end to end. Reading
[`examples/auto_toggle/config.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/auto_toggle/config.json)
top to bottom is reading the run in execution order.

### A connector replayed a file

```json
{
	"name": "replay",
	"protocol": "pseudo",
	"options": {
		"replay_file": "${EMS_REPLAY_FILE:-examples/auto_toggle/replay.naive.csv}",
		"control_log": "${EMS_CONTROL_LOG:-data/storage/control.log}",
		"speed": 0,
		"step_timeout_seconds": 30,
		"emulates": "mqtt"
	}
}
```

The `pseudo` connector replays a timestamped CSV through the same code paths a live
transport would take, and `emulates: "mqtt"` makes the devices treat it as their MQTT
broker. `speed: 0` does **not** mean "as fast as the file reads" — it means as fast as the
algorithms allow: the replay clock runs in lockstep with the algorithms, which is what
makes the run deterministic down to the byte.
[Time, replay and determinism](/architecture/time-and-replay/) explains the two clocks
behind that sentence.

### Three devices parsed the payloads

The config declares three devices against that connector, and each one is in the fixture
to prove something a real site will throw at you:

- **`p1_meter`** (`p1`) parses real P1 telegrams — deeply nested, positional, with a gas
  register that disappears halfway through the run.
- **`shelly_plug`** (`shelly_plug`) delivers flat payloads with string-typed numbers, and
  is the run's only switch — so it is the decision target.
- **`pseudo_sensor`** (`pseudo`) carries a double-encoded payload, JSON inside JSON.

Each device names its connector; nothing else connects them. Devices, like connectors,
are plugins loaded by name from the config — no registry, no import to add. The loading
convention is on [the plugin system](/architecture/plugins/), and the full story of what
each fixture device proves is in
[`examples/README.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/README.md#what-each-device-is-there-to-prove).

### An algorithm crossed a threshold

Every 900 simulated seconds, `AutoToggle` summed the total energy of every device that
`isinstance`-checks as an `EnergyMeter`, and commanded every `Switch` with `on` or `off`
depending on whether the total crossed 500 kWh. The meter crosses at step 7 — which is why
the decision stream reads six `off` then six `on` rather than twelve identical rows.

The load-bearing word is *capability*: the algorithm checks `EnergyMeter` and `Switch`
from `api/capabilities.py`, never a concrete device class, so it works unchanged against
a P1 meter, a Modbus meter, or a replay of either.
[Data flow: wire to decision](/architecture/data-flow/) traces the path from payload to
command; [the algorithm recipe](/contribute/algorithms/) shows `AutoToggle` in full — it
fits on one screen.

### Storage wrote the record

The `csv_file` backend wrote every accepted reading to `device_data.csv` and every
decision to `algorithm_decisions.csv`. Two things are worth knowing before you chart
them: the `command` column is an opaque string (the bare words `on` and `off`, not JSON),
and a missing row is information, not an accident. The
[storage format 1.0 reference](/reference/storage-format/) covers what those files
guarantee — and what they deliberately do not.

## Now see it on a timeline

Numbers in a terminal prove the run worked; a timeline shows you what it did. The next
page, [from replay to timeline](/start/replay-to-timeline/), loads these two files into
Motrix Edge View — and then, optionally, connects the viewer to a live run.
