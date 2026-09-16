---
title: Connecting real hardware
description: The five worked connector configurations, what each needs on the other end, and how to backtest any of them without hardware.
---

The repository ships five worked configurations for the connectors that talk to something outside it — not runnable fixtures, but complete runs you can point `main.py` at to see the shape of each connector's options without reading its schema file.

:::note[Canonical source]
This page summarises [`examples/connectors/README.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/README.md), which is the authority when they disagree.
:::

## The five worked configs

| Config | Connector | Needs |
|---|---|---|
| [`modbus_tcp.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/modbus_tcp.json) | `modbus_tcp` | A Modbus TCP meter or gateway (`MODBUS_HOST`, `MODBUS_PORT`, `MODBUS_UNIT_ID`), and `pip install -r requirements-modbus.txt` (pymodbus) |
| [`home_assistant.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/home_assistant.json) | `home_assistant` | A Home Assistant instance — `HA_URL` is the WebSocket endpoint (`ws://` or `wss://`, not the UI's `http://`) plus a long-lived access token in `HA_TOKEN` — and `pip install -r requirements-homeassistant.txt` (websocket-client) |
| [`openems.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/openems.json) | `openems` | An OpenEMS Edge with its REST controller enabled (`OPENEMS_HOST`, `OPENEMS_PORT`, `OPENEMS_PASSWORD` — a role name, not a per-user secret). **No extra dependency**: it subclasses the HTTP connector and `requests` is core |
| [`lorawan.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/lorawan.json) | `lorawan` | A LoRaWAN network server publishing to MQTT (ChirpStack, The Things Stack, …) and at least one joined node, configured through the `LORAWAN_*` variables. **No extra dependency** — it is MQTT, and paho is core |
| [`lora.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/connectors/lora.json) | `lora` | A LoRa radio on a serial port of this machine, and `pip install -r requirements-lora.txt` (pyserial) |

Each config declares a `csv_file` storage backend and the `AutoToggle` algorithm, so it is a complete run rather than a fragment:

```bash
python main.py --config examples/connectors/modbus_tcp.json
```

## LoRa is not LoRaWAN, and the choice is not close

The two LoRa entries are the same protocol reached two ways. `lorawan` talks to a **network server**, which has already abstracted every gateway and every end-node radio — the EMS needs no radio of its own and nothing outside the core. `lora` drives a **module wired to this host** over a serial port, and exists for point-to-point links that have no network server at all. If a network server is available, use it. Both transports feed the same `lora` / `lora_switch` device, whose payload map is configuration — one device class covers every node model behind either.

## What an unplugged meter looks like

Run any of these configs with nothing on the other end and you still get a useful result: the connector constructs, reports its configuration warnings, fails to connect, and backs off on a doubling ladder — **without** crashing the supervisor and without a traceback. That is worth watching once, because it is exactly what a site looks like when a meter is unplugged: a reconnect loop with bounded backoff, not a crash.

`Ctrl-C` in that state returns promptly. The algorithm is sitting in its readiness gate waiting for `required_devices` that will never become ready, and it polls the stop event within a poll slice rather than holding the shutdown for the whole `wait_for_devices_timeout`.

## Capture, then backtest

Every device here parses a string, and the string is exactly what its connector puts on the wire — so a run recorded against real hardware can be replayed with no hardware at all. Record a run's CSVs, then swap the connector for a `pseudo` one declaring `emulates`, and the same devices parse the capture without knowing the transport changed:

```json
{
	"name": "replay",
	"protocol": "pseudo",
	"options": {
		"replay_file": "my_capture.csv",
		"emulates": "modbus_tcp",
		"speed": 0
	}
}
```

The replay file's `payload` column carries the same JSON the live connector produced — for `modbus_tcp` that is `{"blocks": {...}}`, for `openems` the Edge's channel response, and for `home_assistant` a state object with the `entity_id` in the `topic` column. How the replay clock keeps that deterministic is on [Time, replay and determinism](/architecture/time-and-replay/); the options are documented in [`connectors/pseudo.schema.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/pseudo.schema.json).

## Secrets stay in the environment

Credentials in these configs are written as `${VAR}` and resolved from the environment at load time — never commit a token or a password into a config file. [`.env.example`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.env.example) documents the variables each connector expects and, bluntly, what each one is worth to an attacker.
