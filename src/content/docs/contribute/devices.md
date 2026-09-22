---
title: Devices and capabilities
description: How to add a device to Motrix Edge, and the parsing and capability contracts that keep replays honest and storage truthful.
---

A device is one module that parses one kind of payload and declares what it can do as capabilities. The mechanical steps are short and live in the repository; what this page goes deep on is the three contracts that outlast any refactor — what `receive()` is given, what it must never do with a bad parse, and when a capability claim needs its own class.

:::note[Canonical source]
The normative step-by-step recipe is [CONTRIBUTING.md — "Recipe: add a new device"](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-device) in motrix-edge. Follow it for the exact templates; this page explains the reasoning you need before you start.
:::

## The recipe, briefly

1. Create `devices/<kind>.py` with a class named by convention — `acme_meter` → `AcmeMeter`, subclassing `Device` (see [/architecture/plugins/](/architecture/plugins/) for the loading rule). No registry, no central import.
2. Your constructor takes `name` plus the three option dicts (`connector_options`, `listener_options`, `controller_options`) — the constructor signature *is* the options schema, as on every plugin axis.
3. Implement `receive()`: parse the raw transport data into `self.data` and return. You never call `update_device` — the connector's `on_device_data_received()` hook publishes the device for you.
4. Declare capabilities from [`api/capabilities.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/capabilities.py) so algorithms can find you without knowing your class.
5. Ship `devices/<kind>.schema.json` (validated as warnings, never fatal, and held in lockstep with your constructor by `tests/test_config.py`).
6. Tests: copy [`tests/test_p1_device.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_p1_device.py) (a meter with a parser) or [`tests/test_shelly_plug.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_shelly_plug.py) (a switch). `pytest` stays green with no hardware and no network.

The rest of this page is the part worth reading twice.

## Everything arrives as a `str` — and that is a contract

Every argument `receive()` gets is a string: MQTT passes `(topic, payload)`, HTTP, Modbus and OpenEMS pass `(payload,)`, Home Assistant passes `(entity_id, payload)`. This is not an accident of the transports; it is what makes replays honest.

The `pseudo` connector replays a `topic` and a `payload` column out of a CSV — both strings. If a connector handed its device a pre-parsed `dict`, the device would need a second, replay-only parse path for the string it gets from a replay file — and the backtest, which is what every regression fixture exercises, would then never touch the production parser. So connectors deliver strings even when it costs them something: `connectors/modbus_tcp.py` serialises its register words to JSON before calling `receive()` for exactly this reason.

Two practical consequences:

- **Parse from strings, always.** The same code path must run live and under replay; a replay connector declares `emulates` and impersonates your transport, so your device is backtestable without ever knowing about `pseudo` — see [/architecture/time-and-replay/](/architecture/time-and-replay/).
- **Accept **both** arities even if your connector only ever sends one — a replay row with a `topic` column arrives as `receive(topic, payload)` and one without as `receive(payload)`.** A device that accepts only one shape raises `TypeError` on every row of the other. `Connector.deliver` catches that and logs one traceback against the device, so it is no longer silent — but it is still a backtest that produces no readings for it.

## Never invent a reading

Malformed input is routine: a CRC error on a noisy line, a truncated frame, a topic you do not model. The contract has two halves:

- **Never assign an unusable parse result to `self.data`.** Overwriting the last good reading with an empty one turns a gap in the record into a reading of nothing.
- **Return `False` when you didn't parse.** That tells the framework the same thing about *publication*: without it, the connector republishes your unchanged `self.data` under the new timestamp, and a stalled meter shows up in storage as a flat line instead of missing data. (Returning `None` still means accepted, so devices written before this contract keep working.)

CONTRIBUTING states the principle in one line, worth keeping above your editor:

> Losing a sample is acceptable; inventing one is not.

A flat line is the more expensive lie because it looks like evidence. Downstream, a gap in the CSV means precisely "no reading received" — one of the storage format's chart-trust caveats, covered on [/reference/storage-format/](/reference/storage-format/). See [`devices/p1.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/p1.py) for the failure path and [`devices/shelly_plug.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/shelly_plug.py) for the unmodelled-topic one.

The same rule covers a transport your device cannot serve at all, and there it is a **declaration rather than a branch**: set `SUPPORTED_PROTOCOLS` on the class, and make `refuse_unserved_protocol()` the first line of `receive()`. The base class logs one error at startup naming the protocol, and every payload afterwards is refused rather than parsed. Do not raise — a device is a plugin, and although the connector now contains an exception rather than letting it end the run, being caught by the guard meant for a *device bug* is the wrong way for a plain wiring mistake to surface.

## `Switch` is a type claim — split the class

Put `Switch` only on a class that is genuinely writable, and split the class if writability is a config decision. The reasoning is a causal chain, and every link matters:

1. `Switch` is a **class-level** type claim. Algorithms act on it directly: `algorithms/auto_toggle.py` selects actuators with `isinstance(device, Switch) and device.data`, with **no** `is_writable` check.
2. `Algorithm.control_device` writes the decision to storage **unconditionally** — it controls the device and records the decision regardless of the outcome, because `Device.control` logs-and-returns instead of raising when the device is not writable.
3. Therefore a read-only device that subclasses `Switch` puts a row in `algorithm_decisions.csv` claiming an algorithm switched a thermometer on, **every tick** — a wrong entry in the versioned storage contract ([`docs/storage-format.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md)), not merely a noisy log.
4. Deriving `is_writable` per instance does not fix it, because `isinstance` is class-level.

Hence the split-class pattern shipped four times over: `modbus_meter` / `modbus_switch`, `ha_entity` / `ha_switch`, `openems` / `openems_switch`, `lora` / `lora_switch`. Each switch subclass is about fifteen lines, and the plugin loader makes the split free — no central registration to touch.

:::tip[The pattern to copy]
A base read-only device class, plus a thin `*_switch` subclass that adds `Switch` and `is_writable = True`. An operator who wires a read-only instance picks the base `kind`; one who wires an actuator picks the `_switch` kind. The type claim then always tells the truth.
:::

## `EnergyMeter`: `0.0` and `None` mean different things

`EnergyMeter` is safe to carry unconditionally — but only because its return contract is precise:

- Return **`0.0`** when the data is well-formed but holds no kWh register. A device with no energy source configured then stays harmless in an algorithm that sums every `EnergyMeter` it sees.
- Return **`None`** when the data is missing or malformed — a *configured* source that cannot be read. This is the case a silent `0.0` would hide, by deflating a site total. Log a warning, never raise.

## `MetricSource`: when payload structure carries meaning

The other capabilities are the device–algorithm contract; `MetricSource` is the device–storage one. Implement it when your `self.data` needs naming before it can be stored — that is, when its *structure* carries meaning.

A time-series database keys on field names, so a payload whose position is significant becomes unreadable once flattened generically: `P1`'s OBIS list would store `data.7.obis.class`, where index 7 is a different register the moment the meter emits a different number of lines. `get_metrics()` returns a flat `{name: scalar}` view with names that are stable across messages — `devices/p1.py` keys by OBIS code, not list position.

A device whose data is already flat and stably keyed — `shelly_plug`, `pseudo` — does not need it; the generic flattening path stays correct for it.

## Wiring it up

```json
{
	"devices": [
		{
			"name": "kitchen_meter",
			"kind": "acme_meter",
			"options": {
				"connector_options": { "name": "my_mqtt" },
				"listener_options": { "pattern": "acme/kitchen/.*", "subscription": "acme/kitchen/#" },
				"controller_options": {}
			}
		}
	]
}
```

`connector_options.name` must reference a connector declared in the same config; `Config` wires the two and injects the connector's `protocol` into `connector_options` for `receive()` to dispatch on. The full wiring model is on [/operate/configuration/](/operate/configuration/), and the transport side of the story is the flagship guide, [/contribute/your-first-connector/](/contribute/your-first-connector/).
