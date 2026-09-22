---
title: Shipped plugin catalogue
description: Every plugin shipped in motrix-edge across the five axes — purpose, optional extra, schema file, and worked example.
---

One row per shipped plugin, one table per [plugin axis](/architecture/plugins/). This is
the most drift-prone page on the site, which is why every row links straight into the
repository.

:::note[Canonical source]
The repository directories are the truth:
[`connectors/`](https://github.com/Motrix-Energy/motrix-edge/tree/main/connectors),
[`devices/`](https://github.com/Motrix-Energy/motrix-edge/tree/main/devices),
[`algorithms/`](https://github.com/Motrix-Energy/motrix-edge/tree/main/algorithms),
[`storage/`](https://github.com/Motrix-Energy/motrix-edge/tree/main/storage),
[`services/`](https://github.com/Motrix-Energy/motrix-edge/tree/main/services) —
one module per plugin, summarised in the
[README's five-axes table](https://github.com/Motrix-Energy/motrix-edge/blob/main/README.md#the-five-plugin-axes).
A pull request adding a plugin should touch this page too — see
[Contribution workflow](/contribute/workflow/).
:::

Each plugin's options are documented `$comment` by `$comment` in the schema file shipped
next to it; the worked examples in
[`examples/connectors/`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/README.md)
are complete, runnable configs, not fragments. An optional extra lives in its own
`requirements-*.txt`, never in `requirements.txt` — a missing one is a clean per-entry
skip at startup, and the EMS runs on without the plugin. The **Extra** column names it:
install with `pip install -r requirements-<extra>.txt`.

## Connectors

| Name | Purpose | Extra | Schema | Example |
|---|---|---|---|---|
| `mqtt` | MQTT broker client, the base transport (paho-mqtt is core) | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/mqtt.schema.json) | — |
| `http_api` | Polls an HTTP endpoint on an interval, with failure/recovery tracking | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/http_api.schema.json) | — |
| `modbus_tcp` | Modbus TCP meters and gateways; serialises register words to JSON for its devices | `modbus` (pymodbus) | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/modbus_tcp.schema.json) | [example](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/modbus_tcp.json) |
| `home_assistant` | Home Assistant over its WebSocket API, with a long-lived token | `homeassistant` (websocket-client) | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/home_assistant.schema.json) | [example](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/home_assistant.json) |
| `openems` | OpenEMS Edge REST, subclassing `http_api` — overrides only `resolve_endpoint()` and `send()` | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/openems.schema.json) | [example](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/openems.json) |
| `lorawan` | LoRaWAN network server over MQTT, subclassing `mqtt` — no extra needed, it *is* MQTT | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/lorawan.schema.json) | [example](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/lorawan.json) |
| `lora` | Point-to-point LoRa radio on a serial port of this machine | `lora` (pyserial) | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/lora.schema.json) | [example](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/lora.json) |
| `pseudo` | Deterministic file replay (CSV or JSON); impersonates any transport via `emulates` and drives the simulation clock | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/pseudo.schema.json) | [example](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/auto_toggle/config.json) |

The two LoRa entries are the same protocol reached two ways: `lorawan` talks to a network
server that has already abstracted every gateway and radio; `lora` drives a module wired
to this host, for point-to-point links with no network server at all. See
[Connecting real hardware](/operate/hardware/).

## Devices

Devices never need an optional extra: each one parses the string its connector puts on
the wire using only the standard library — `modbus_meter` decodes register words with
`struct`, `lora` with `base64` and `struct` — which is what lets any of them be replayed
on a machine without the protocol stack installed. Capabilities shown are the ones each
class implements; the `*_switch` split exists because `Switch` is a class-level type
claim — see [Recipe: devices and capabilities](/contribute/devices/).

| Name | Purpose | Capabilities | Schema |
|---|---|---|---|
| `p1` | P1 smart meter — OBIS telegram parsing with CRC16-ARC | `EnergyMeter`, `MetricSource` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/p1.schema.json) |
| `shelly_plug` | Shelly Plug S over MQTT — a metering switch | `Switch` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/shelly_plug.schema.json) |
| `modbus_meter` | Generic Modbus meter driven by a register map from config | `EnergyMeter`, `MetricSource` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/modbus_meter.schema.json) |
| `modbus_switch` | `modbus_meter` plus write access | + `Switch` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/modbus_switch.schema.json) |
| `ha_entity` | One Home Assistant entity's state | `EnergyMeter`, `MetricSource` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/ha_entity.schema.json) |
| `ha_switch` | `ha_entity` plus service calls to switch it | + `Switch` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/ha_switch.schema.json) |
| `openems` | An OpenEMS Edge channel view | `EnergyMeter`, `MetricSource` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/openems.schema.json) |
| `openems_switch` | `openems` plus channel writes | + `Switch` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/openems_switch.schema.json) |
| `lora` | Generic LoRa node with a config-driven payload map, behind either LoRa transport | `EnergyMeter`, `MetricSource` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/lora.schema.json) |
| `lora_switch` | `lora` plus downlink commands | + `Switch` | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/lora_switch.schema.json) |
| `pseudo` | Simulated device for replay files — stores the payload verbatim, decodes JSON when it can | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/devices/pseudo.schema.json) |

## Algorithms

Algorithms ship an options schema like every other axis. Both shipped ones take only the
three the base class reads — `delay_seconds`, `required_devices`,
`wait_for_devices_timeout` — so their two schemas are identical by construction. See
[Recipe: algorithms](/contribute/algorithms/).

| Name | Purpose | Schema |
|---|---|---|
| [`auto_toggle`](https://github.com/Motrix-Energy/motrix-edge/blob/main/algorithms/auto_toggle.py) | The public worked example: sums every `EnergyMeter`, switches every `Switch` on or off across a threshold. Seventeen lines, fully capability-based | [`auto_toggle.schema.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/algorithms/auto_toggle.schema.json) |
| [`device_checker`](https://github.com/Motrix-Energy/motrix-edge/blob/main/algorithms/device_checker.py) | A diagnostic: logs which devices currently hold data and which do not | [`device_checker.schema.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/algorithms/device_checker.schema.json) |

## Storage backends

Storage is optional and plural — declare zero backends, or several at once;
`StorageManager` fans out with per-backend error isolation.

| Name | Purpose | Extra | Schema |
|---|---|---|---|
| `csv_file` | The two CSVs — a **published interface**, frozen by [Storage format 1.0](/reference/storage-format/) | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/storage/csv_file.schema.json) |
| `influxdb` | InfluxDB 2.x with batched writes and Flux reads (influxdb-client is core) | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/storage/influxdb.schema.json) |
| `null` | Discards everything — the template for a no-options backend | — | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/storage/null.schema.json) |

## Services

| Name | Purpose | Extra | Schema |
|---|---|---|---|
| `rest_api` | Read-only introspection of the live runtime — see [REST API](/reference/rest-api/) | `api` (fastapi + uvicorn) | [schema](https://github.com/Motrix-Energy/motrix-edge/blob/main/services/rest_api.schema.json) |
