---
title: Algorithms
description: How to write a Motrix Edge algorithm — one main(), capability-based device selection, and no knowledge of time or transport.
---

An algorithm is the actual EMS logic: one `main()` that reads devices and issues commands. It is also the plugin axis with the least ceremony — the whole point of the architecture is that an algorithm author never touches a connector, a thread, or a clock.

:::note[Canonical source]
The normative step-by-step recipe is [CONTRIBUTING.md — "Recipe: add a new algorithm"](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-algorithm) in motrix-edge. This page shows the shipped worked example and explains the rules; that file has the exact steps.
:::

## AutoToggle, in full

This is [`algorithms/auto_toggle.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/algorithms/auto_toggle.py)'s logic, as the Edge README presents it — a complete, shipped algorithm that fits on one screen:

```python
class AutoToggle(Algorithm):
	@override
	def main(self) -> None:
		super().main()
		total: float = 0
		for device in self.devices.values():
			if isinstance(device, EnergyMeter):
				energy = device.get_total_energy_kwh()
				if energy is None:
					self.LOGGER.warning(f"Skipping {device.name}: no usable energy data")
					continue
				total += energy
		self.LOGGER.info(f"Total: {total}")
		for device in self.devices.values():
			if isinstance(device, Switch) and device.data:
				self.control_device(device, device.COMMAND_ON if total > 500 else device.COMMAND_OFF)
```

A walkthrough, line by line:

- **`super().main()` first.** It refreshes `self.devices` from `devices_manager.get_devices()` — a snapshot, so the set you iterate cannot change under you mid-step.
- **`isinstance(device, EnergyMeter)`** is the load-bearing line. `P1` *is* an `EnergyMeter`; so is any meter written next year, and this algorithm picks it up without a diff.
- **`energy is None`** is a real branch, not defensive noise: an `EnergyMeter` returns `None` for a configured source it cannot read, and `0.0` for a well-formed payload with no kWh register — the distinction is explained on [/contribute/devices/](/contribute/devices/).
- **`isinstance(device, Switch) and device.data`** selects actuators that have produced data. `COMMAND_ON` / `COMMAND_OFF` come from the device, because hardware that does not speak literal `on`/`off` overrides the tokens.
- **`self.control_device(device, command)`** routes the command to the *live* device (not your snapshot copy) and logs the decision to storage.

## Select by capability, never by concrete class

`isinstance`-check the capability ABCs in [`api/capabilities.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/capabilities.py) — `EnergyMeter`, `Switch`, `MetricSource` — and never a concrete device class. `isinstance(device, P1)` would work today and quietly exclude every meter added tomorrow; the capability check is what keeps the algorithm hardware-agnostic, and it is why an algorithm imports no connector and no device module at all.

## `required_devices` is a readiness gate, not a selector

Set `required_devices` (as a class attribute or via config `options`) and the framework blocks before the first `main()` until each named device is data-ready and connected, bounded by `wait_for_devices_timeout` (default 60 seconds; `null` waits forever). That is *all* it does. Selection inside `main()` stays capability-based — a required device guarantees you do not compute on an empty site at startup, it does not become your device list.

## Write nothing about time or transport

The base `loop()` steps `main()` once per committed timestep when a replay connector drives the clock, and on a `delay_seconds` wall-clock cadence otherwise. That single fact is what lets the same `main()` run lockstep against a 2013 replay and live against hardware, unchanged — under a replay each timestep is *held* until your `main()` returns, so a slow algorithm slows the backtest rather than silently skipping steps ([/architecture/time-and-replay/](/architecture/time-and-replay/) covers the two clocks and the barrier).

The corollaries:

- Never call `time.sleep()` or read the wall clock inside `main()`. Read the moment with `devices_manager.get_simulation_time()`; it is stable for the whole of your `main()`.
- Never talk to a transport. `control_device()` is the only way out, and the connector on the other side deals with the wire.
- Cooperative stop is free: the base `loop()` polls the stop event, so `Ctrl+C` lands between steps rather than inside one ([/architecture/lifecycle/](/architecture/lifecycle/)).

## No options schema, by design

Connectors, devices, storage backends and services each ship a `*.schema.json` beside the module. Algorithms deliberately do not. The constructor *is* the contract: every key in your config entry's `options` arrives as a keyword argument, an unknown key raises `TypeError`, and the plugin loader reports the entry as "could not be instantiated". That `TypeError` at load time is the validation — a second, hand-maintained schema would only be one more thing to drift.

Forward `**kwargs` to `super().__init__` — the base reads `delay_seconds`, `required_devices` and `wait_for_devices_timeout` straight from your options:

```python
from typing import override

from api.algorithm import Algorithm
from api.capabilities import EnergyMeter, Switch
from api.devices_access import DevicesAccess


class AutoToggle(Algorithm):
	@override
	def __init__(self, name: str, devices_manager: DevicesAccess, **kwargs) -> None:
		super().__init__(name, devices_manager, **kwargs)
```

And the config entry (the key is `class`; `auto_toggle` → `AutoToggle`, no suffix):

```json
{
	"algorithms": [
		{
			"name": "Auto Toggle",
			"class": "auto_toggle",
			"options": {
				"required_devices": ["kitchen_meter", "patio_switch"],
				"delay_seconds": 900,
				"wait_for_devices_timeout": 120
			}
		}
	]
}
```

## Tests: capability stubs, no hardware

Copy [`tests/test_auto_toggle.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_auto_toggle.py) as your template. It drives `main()` directly with capability **stubs** — a stub `EnergyMeter` returning a preset total (or `None` for unusable data), a stub `Switch`, and a no-capability device — so no hardware, no broker and no concrete device class is involved. Because the algorithm only ever sees capabilities, the stubs are the whole world it needs, and the tests read as behaviour tables: above threshold → `on`, below → `off`, summed across meters, a switch without data skipped. `pytest` must stay green; the wider bar for a contribution is on [/contribute/workflow/](/contribute/workflow/).
