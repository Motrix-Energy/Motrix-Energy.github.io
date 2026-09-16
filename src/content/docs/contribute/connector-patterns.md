---
title: Connector patterns and footguns
description: The five documented ways connectors go wrong in Motrix Edge, and the subclassing doctrine that saves you writing most of a new one.
---

[Build your first connector](/contribute/your-first-connector/) walks the happy path. This page is the other half: the five ways real connectors have gone wrong — each written down because it happened, or was one review away from happening — and the subclassing doctrine that turned two whole protocols into a few dozen lines each. Every section names the shipped code that embodies the fix; the normative text is [CONTRIBUTING.md — Recipe: add a new connector](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-connector).

## The five footguns

### 1. Optional dependencies are imported at module top, never inside `start()`

**Symptom.** An operator without your optional extra installed starts the EMS; instead of one skipped plugin, the log fills with restart noise and then the *entire run shuts down* — over a dependency that was optional by design.

**Mechanism.** Where the import sits decides which error path catches it. At module top, `main.create_classes` catches the `ModuleNotFoundError` and skips that one config entry with a single honest error line; the rest of the EMS starts normally. The same import inside `start()` fires on a *supervised worker thread*, where it is indistinguishable from a crash: five restarts with bounded backoff, then CRITICAL — and a worker that has spent its restart budget counts as **finished**. Liveness is connector-shaped: `main` waits on the connectors, so the moment your crash-looped connector is "finished", `main` concludes the run is over and shuts everything down. A misplaced `import` line turns a missing pip package into a dead site.

**The rule.** Import the library at module top. Ship it in its own `requirements-<name>.txt` (copy [`requirements-modbus.txt`](https://github.com/Motrix-Energy/motrix-edge/blob/main/requirements-modbus.txt)), never in `requirements.txt` — the core deliberately ships without any of the extras — and add a `-r` line to [`requirements-dev.txt`](https://github.com/Motrix-Energy/motrix-edge/blob/main/requirements-dev.txt) so a dev checkout exercises your connector instead of skipping it. Runtime *resources* — a socket, a client object — still belong in `start()`; it is only the import that must not.

### 2. `send()` runs on the algorithm's thread

**Symptom.** A relay fails to answer, or an operator types a value the hardware cannot hold — and the *algorithm* crashes: restarted five times with backoff, then CRITICAL, having made no decision the whole time.

**Mechanism.** `send()` is the terminus of a call chain that starts in the algorithm's own supervised thread and catches nothing along the way:

```
Algorithm.control_device -> DevicesManager.control -> Device.control -> your send()
```

An exception escaping `send()` therefore surfaces in the supervisor as an algorithm failure, and is punished as one. The transport call is the obvious risk, but it is not the whole risk: coercing the payload — `int()` on an operator's typo, JSON-encoding a value — raises just as readily, so the coercion belongs inside the `try` too, not just the request.

**The rule.** Catch everything you can inside `send()`, log it through `self.LOGGER`, and return. [`connectors/openems.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/openems.py) is the worked example: its `send()` cannot simply delegate to the parent precisely because the parent guards only the HTTP call, and the OpenEMS value coercion has to sit inside the same `try`. [`connectors/lorawan.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/lorawan.py) shows the same discipline shaped differently: every reachable failure in `resolve_downlink()` returns `None` *having logged why*, so nothing on the control path ever raises.

### 3. The schema-lockstep test inspects *your* `__init__`, not the parent's

**Symptom.** Your subclass inherits an option from its parent — `host`, say — and your schema declares it, since operators do configure it. `tests/test_config.py` fails: *"schema allows options the constructor rejects"*. Adding `**kwargs` to your signature does not fix it.

**Mechanism.** The kwargs contract says config options are spread into the constructor, so `test_config.py` asserts that every key your schema allows (and everything it requires) is a named parameter of **your class's** `__init__` — it reads `inspect.signature(cls.__init__)`, and it never walks up to the parent. `**kwargs` is not a named parameter, so it cannot satisfy the subset check; the check would be worthless if it could, because `**kwargs` would legalise any schema at all.

**The rule.** An inherited option you want configurable must be re-declared in your own signature and forwarded to `super()`. [`OpenemsConnector.__init__`](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/openems.py) does exactly this — it re-declares the parent's `default_interval`, `timeout` and `verify_ssl` beside its own options and passes them through — and its docstring names this rule as the reason.

### 4. Never import your connector in `tests/test_shutdown.py`

**Symptom.** Your connector needs an optional extra. On any machine without it — a core-only checkout, a fresh contributor's laptop — `pytest` does not skip your tests: it aborts collection for the **whole suite**, every test file, before running anything.

**Mechanism.** [`tests/test_shutdown.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_shutdown.py) imports every connector it covers at module top. A module-top import that raises `ModuleNotFoundError` during collection is not a test failure pytest can contain to one file — it kills the collection pass itself. Adding your optional-extra connector to that file plants the failure in the one module every checkout imports.

**The rule.** Copy `test_shutdown.py`'s *pattern* — proving `stop()` unblocks a blocked `start()` within a bounded join — into your own test module, and never add your connector to the file itself. In your own module, guard with `pytest.importorskip` **before any project import that pulls the dependency in**:

```python
import pytest

pytest.importorskip("pymodbus")

from connectors.modbus_tcp import ModbusTcpConnector  # only now is this safe
```

Ordering is the entire trick: `importorskip` after the project import is a guard behind the thing it guards.

### 5. Subclass seams return regex *strings*, not compiled Patterns

**Symptom.** Your subclass synthesises a routing pattern that must match case-insensitively — a hex EUI, say — and there is no clean way to say so: compiling with `re.IGNORECASE` breaks the seam's contract, and embedding `(?i)` anywhere but the very start of an expression is an error in Python.

**Mechanism.** `MQTTConnector.resolve_listener()` returns its routing pattern as a **string**, and that is a designed decision, not laziness. It keeps `re.compile()` — and the `re.error` handling around it — in one place, the parent, instead of in every subclass. And it is what makes the inline-flag case expressible at all: Python accepts a global inline flag like `(?i)` only at position 0 of an expression, so only the party that assembles the *final, complete* string can prepend it. [`connectors/lorawan.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/connectors/lorawan.py) does exactly that: its filter-to-regex conversion prepends `(?i)`, escapes every literal segment, and anchors the end — three details its docstring defends one by one.

**The rule.** When you override a seam that produces a pattern, return the string and let the parent compile it. When you *design* a new seam, follow suit: strings compose (a subclass can prefix a flag, a parent can anchor); compiled `Pattern` objects do not.

## The subclassing doctrine

If your protocol is another connector's protocol in different dress, **subclass it rather than reimplementing it**. This is the pattern in this codebase, not an exception, and both shipped examples earn their keep:

- **`OpenemsConnector(HttpApiConnector)`** — an OpenEMS Edge is an HTTP endpoint polled on an interval. The subclass overrides exactly two things: `resolve_endpoint()`, the seam that turns a device's declared component and channels into a URL path, and `send()`, because the Edge wants `{"value": ...}` as JSON rather than a raw body. The poll loop, the per-device schedule, the bounded interruptible sleep and the failure/recovery tracking are inherited untouched.
- **`LoRaWANConnector(MQTTConnector)`** — a LoRaWAN network server *is* an MQTT broker with an opinion about topics and payload wrapping. The subclass overrides `resolve_listener()` (a device's devEUI into a subscription filter and a routing regex) and `resolve_downlink()` (a Switch token into base64 inside the vendor's JSON envelope), and inherits the connect ladder, paho's reconnect, the resubscribe-on-reconnect and the threaded fan-out.

Notice what the seams have in common: each one turns *what a device declares* into *what the transport needs* — a path, a topic filter, a message body. Transport mechanics never leak through them, which is why two protocols could be added without touching a live deployment.

A seam is small on purpose. Here is the entire body of `MQTTConnector.resolve_listener()` (docstring elided) — the parent's half of the contract the LoRaWAN connector overrides:

```python
	def resolve_listener(self, device: Device) -> tuple[Any, Optional[str]]:
		return device.listener_options.get("subscription"), device.listener_options.get("pattern")
```

That *is* the "default body that reproduces the parent's current behaviour": before the extraction those two lookups sat inline in the parent; after it, a plain MQTT deployment behaves identically, and a subclass has one method to replace. The same shape holds on the write path (`resolve_downlink()` returns the declared topic and the payload unchanged) and on the HTTP side (`resolve_endpoint()` returns `listener_options["endpoint"]`, or `None` having logged why).

### Adding a seam that does not exist yet

Sometimes the parent has no seam where you need one — the behaviour you want to specialise is inlined in its loop. The rule, applied for both examples above:

1. **Extract the seam with a default body that reproduces the parent's current behaviour**, byte for byte. The refactor must be invisible to every existing deployment of the parent.
2. **Add a `TestParentSeam` class to your subclass's test file, asserting the parent is unchanged** — that it still reads the same declared options and still answers the same way without them. The seam now has two clients, and the parent's behaviour is the contract between them.

[`tests/test_lorawan_connector.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_lorawan_connector.py) is the worked example — its `TestParentSeam` pins `MQTTConnector.resolve_listener()` and `resolve_downlink()` to their pre-extraction behaviour:

```python
class TestParentSeam:
	"""resolve_listener() and resolve_downlink() were extracted from MQTTConnector for
	this subclass; the parent must stay behaviour-identical."""

	def test_the_parent_still_reads_declared_listener_options(self):
		connector = MQTTConnector(name="mqtt", host="h", port=1883, version="3.1.1")
		device = StubDevice(listener_options={"subscription": "p1/#", "pattern": "p1/.*"})
		assert connector.resolve_listener(device) == ("p1/#", "p1/.*")
```

[`tests/test_openems_connector.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_openems_connector.py) does the same for `HttpApiConnector.resolve_endpoint()` — including the negative half, asserting the parent still warns and returns `None` when the option is missing. Copy either. A seam without a `TestParentSeam` is a refactor on trust, and the parent is running on sites you cannot see.

Remember footgun 3 while you are here: subclassing is also where the schema-lockstep trap fires, because your subclass's schema answers to your subclass's `__init__`.

## Where this leaves you

A new connector is usually one of three sizes: a subclass overriding a seam or two (start here — check whether `MQTTConnector` or `HttpApiConnector` already speaks your transport's family), a fresh transport written against the [walkthrough](/contribute/your-first-connector/), or a seam extraction that makes the first kind possible. Whichever it is, the [contribution workflow](/contribute/workflow/) is the same, and the pull request adds a row to the [plugin catalogue](/reference/plugin-catalog/).
