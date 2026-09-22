---
title: Troubleshooting
description: Symptoms, causes and fixes for the failure modes both repositories document, from skipped plugins to shutdown stragglers.
---

Most of what looks like a fault in Motrix Edge is a design decision announcing itself — a skipped plugin, an immediate exit, a gap where a lesser system would draw a flat line. The EMS logs the reason for everything it skips and everything it restarts, so the log line is always the place to start; this page maps the lines you will actually see to the mechanism behind them and the fix.

### A plugin is skipped with "could not be instantiated"

**Cause.** An option key in `config.json` that the plugin's constructor does not accept. Every key in an entry's `options` object is passed as a keyword argument to the constructor — the constructor signature *is* the options schema — so an unknown key raises `TypeError` and the loader skips the plugin with that log line. A typo in a key name and a key that belongs to a different plugin both land here.

**Fix.** Match the `options` keys against the constructor's keyword arguments, or against the plugin's `*.schema.json` file, which is tested to stay in lockstep with them. If the plugin ships a schema, the config validation warning a few lines earlier usually named the offending key already — schema warnings are never fatal, so the `TypeError` is where the run actually stops using the plugin. The loading convention is on [the plugin system](/architecture/plugins/).

For a **service**, one more way to trip this: `devices_manager` and `supervisor` are injected by `main` into every service constructor. A service that does not declare and forward both is skipped with the same line — and declaring either in the service's schema lets a config entry collide with the injected value and fail with *"got multiple values"*.

### A plugin is skipped at startup with a missing-module error

**Cause.** Optional dependencies are imported at module top on purpose, so that `main.create_classes` catches the `ModuleNotFoundError` and skips the plugin with one honest error line while the rest of the EMS starts normally. The extra it needs is not installed — none of them is in `requirements.txt`, because an MQTT-and-CSV site should not install a web framework or a protocol stack for hardware it does not have.

**Fix.** Install the extra for the plugin you declared:

```bash
pip install -r requirements-api.txt            # rest_api service (fastapi + uvicorn)
pip install -r requirements-modbus.txt         # modbus_tcp connector (pymodbus)
pip install -r requirements-homeassistant.txt  # home_assistant connector (websocket-client)
pip install -r requirements-lora.txt           # lora serial connector (pyserial)
```

The `lorawan` and `openems` connectors need no extra — one is MQTT and the other subclasses the HTTP connector, both on core dependencies. Why the import sits at module top rather than inside `start()` — where it would be a crash loop instead of a clean skip — is the first footgun on [connector patterns](/contribute/connector-patterns/).

### The log complains about the configuration version

**Cause.** `config.json`'s optional top-level `version` declares the format of that file, and the build compares it against the one format it understands. A *warning* means a newer minor — the file was written against a newer format, so anything in it this build's schema does not know is being ignored without comment. An *error* means the majors differ, where a key can have been renamed or changed meaning, so the file may be read wrongly rather than incompletely. A warning that the version could not be read means it is not three numbers — often a `${VAR}`, which is not resolved in this key because a document's format is a property of the document and not of the machine reading it.

**Fix.** Each message names the action: set `"version"` to three numbers, rewrite the file against the `config.schema.json` this build ships, or upgrade Motrix Edge. Omitting the key entirely is also valid and draws no verdict — absence is not a claim. Nothing here is ever fatal, so a run that logged one of these still started; what it means is that the wiring you read and the wiring the EMS read may not be the same document. The full table is on [Configuration](/operate/configuration/).

### A device is configured, starts, and never reports

**Cause.** The device cannot parse anything the connector it names delivers. Each device declares which transports it serves, and one wired to any other logs a single error at startup — naming the protocol and why that transport cannot carry its payload — then refuses every payload afterwards. This is **not** a skip: the device exists, appears in `/devices` and is marked connected, because payloads really are arriving; it simply never becomes data-ready, so an algorithm waiting on it waits forever. The commonest cause by far is a replay: a `pseudo` connector without `emulates` hands the device the literal protocol `pseudo`, which no real device kind claims.

**Fix.** Read the startup error — it names the fix, and for a replay that fix is one line, `"emulates": "mqtt"` (or whichever transport the device expects) in the connector's options. Otherwise point the device at a connector whose protocol it serves, or use the device kind that does serve the one you have. How a replay impersonates a live transport is on [Time, replay and determinism](/architecture/time-and-replay/).

### The process exits immediately when only services are configured

**Cause.** By design. Liveness is connector-shaped: `main` waits on the connectors only, so a service — a supervised worker that owns no devices — never keeps a finished replay alive. A config with services and no connectors therefore has nothing to wait on and exits immediately, logging a warning that says so.

**Fix.** Declare a connector. To hold a process open while poking at a service — the `rest_api` service, say — run a `pseudo` connector with `"loop": true` so the replay never finishes. The reasoning, and why the API is a fifth axis rather than a `Connector` with stub methods, is on [Lifecycle](/architecture/lifecycle/).

### A replay produces no readings

**Cause.** The device's `receive()` does not accept the replay's calling arity. `PseudoConnector` replays a `topic` and a `payload` column, both strings — and calls `receive()` with both when the `topic` cell is non-empty. A device written for a single-argument transport that declares `receive(self, payload)` raises `TypeError` on every row. `Connector.deliver` catches that and logs one traceback against the device — quietly after the first — so the backtest produces no readings for it, and the log names which device rather than blaming the replay file.

**Fix.** Accept **both** arities even if your connector only ever sends one — the shipped devices declare `receive(self, *args, **kwargs)`. This is a contract, not an accident: every argument is a `str` so the same production parser runs under replay, per [the device recipe in `CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-device). How the replay impersonates a live transport via `emulates` is on [Time, replay and determinism](/architecture/time-and-replay/).

### A chart shows a flat line where a gap should be

**Cause.** A connector that calls `on_device_data_received(device)` without forwarding what `receive()` returned. A device returns `False` when a payload gave it nothing usable — a CRC error, a truncated frame, an unmodelled topic — and forwarding that `False` is what keeps the corrupt frame out of storage. Swallow it and the connector republishes the device's unchanged `self.data` under a new timestamp: a stalled meter shows up as a flat line instead of missing data.

**Fix.** Hand the payload over with `self.deliver(device, payload)`, which forwards what `device.receive(...)` returned for you. A connector that still calls the two steps by hand can drop the value on the floor; `deliver()` cannot. The full path from wire to decision, including what `accepted=False` suppresses, is on [Data flow](/architecture/data-flow/). Losing a sample is acceptable; inventing one is not.

### `/api/health` returns 502 through the viewer

**Cause.** The EMS's `config.json` declares no `rest_api` service, so nothing listens on port 8000 and the viewer's nginx has nothing to proxy to. This is intended behaviour, not a fault: the viewer's boot probe reads the 502 as "no live EMS" and comes up file-only with no error.

**Fix.** If you want live mode, declare the `rest_api` service in the EMS config and install `requirements-api.txt` — without the extra, the service is one clean per-entry skip at startup and you are back to the 502. In the container, `MOTRIX_HEALTHCHECK_URL` must also agree: leave it empty when no `rest_api` service is declared, or the EMS container reports unhealthy forever. The routes are on [REST API](/reference/rest-api/); why the API itself carries no authentication is on [Security model](/architecture/security/).

### The browser pops its own Basic-auth dialogue over the viewer

**Cause.** You navigated to `/api/*` directly — typing `/api/health` into the address bar *is* a navigation, and the browser handles the 401 itself. The app's own requests never trigger that dialogue: they are sent with `credentials: 'omit'`, precisely so the gated nginx cannot pop the browser's prompt over the app's sign-in panel.

**Fix.** Nothing is broken — sign in through the app's own panel, and use direct `/api/*` URLs only when you deliberately want the raw JSON. The auth topology is on [Security model](/architecture/security/).

### Every `${VAR}` in the config resolves to nothing

**Cause.** One of two loading rules, depending on where you run. On the host, `python main.py` reads `os.environ` directly and loads no dotenv file — a `.env` sitting next to it is ignored. In a container, `docker compose up` does read `.env`, but compose forwards only the variables its `environment:` list names — a `${VAR}` in `config.json` backed by no `environment:` line resolves to nothing. Either way the run starts anyway: interpolation yields `null`, the schemas accept it by design, and the connector fails to reach a host that was never named.

**Fix.** On the host, export `.env` first — the one-liners are on [Docker and compose profiles](/operate/docker/). In a container, add the variable to the `edge` service's `environment:` list in [`docker-compose.yml`](https://github.com/Motrix-Energy/motrix-edge/blob/main/docker-compose.yml). Why interpolation is deliberately this forgiving is on [Configuration](/operate/configuration/).

### InfluxDB answers 401 after you changed the token

**Cause.** The InfluxDB container applies `INFLUXDB_TOKEN` only the first time its volume is created (`DOCKER_INFLUXDB_INIT_MODE=setup` is one-shot). Changing the value in `.env` afterwards updates the client's token but not the server's, which shows up as an unexplained 401.

**Fix.** `docker compose down -v` to reset the volume and re-initialise — accepting that this discards the stored data — or change the token on the server through InfluxDB's own UI instead. The one-shot behaviour is documented in [`.env.example`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.env.example) and [`docker-compose.yml`](https://github.com/Motrix-Energy/motrix-edge/blob/main/docker-compose.yml).

### The viewer stops proxying after the edge container is recreated

**Cause.** The viewer's nginx names `edge` literally in `proxy_pass` with no `resolver`, so it resolves the name once at configuration-parse time and caches the IP for its lifetime. Recreate the edge container and the viewer proxies a dead address until it is restarted too. The trade is deliberate — the alternative buys re-resolution and loses the automatic `/api` prefix rewrite.

**Fix.** `docker compose restart viewer`. The full reasoning lives in the comments of [`docker-compose.yml`](https://github.com/Motrix-Energy/motrix-edge/blob/main/docker-compose.yml).

### Fixture tests fail on Windows, or `examples/` shows modifications you never made

**Cause.** Line-ending normalisation. The fixtures in `examples/` are bytes, not text: `CsvFileBackend` writes CRLF terminators on every platform, quoted fields can contain raw CRLF, the P1 telegrams in the replay files are CRLF-delimited, and `tests/test_storage_contract.py` compares byte-for-byte while `examples/MANIFEST.json` publishes a SHA-256 of each file. The repository pins `examples/** -text` in [`.gitattributes`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.gitattributes) so `core.autocrlf` cannot touch them — so drift means something rewrote the files anyway: an editor "fixing" line endings on save, a copy through a normalising tool, or a working tree checked out before the attribute applied.

**Fix.** Never hand-edit anything under `examples/`. Make git re-materialise the files from the index, where the bytes are always exact:

```bash
git checkout -- examples/
```

If they still show as modified, force the re-checkout — or simply re-clone, which is always correct because the attribute travels with the repository:

```bash
git rm -r --cached examples/
git checkout HEAD -- examples/
```

Then confirm with `pytest tests/test_storage_contract.py`. The Windows editor and git setup that avoids this in the first place is on [Prerequisites](/start/prerequisites/).

### pytest aborts collection with `ModuleNotFoundError`

**Cause.** A test module imports something that pulls in an optional dependency at module top — which is exactly where plugins import them — on a checkout without that extra installed. A bare `ModuleNotFoundError` during collection aborts the *entire* suite, not just the offending file.

**Fix.** Guard the test module with `pytest.importorskip("<dep>")` **before any project import that pulls the dependency in**. And never add a connector needing an extra to `tests/test_shutdown.py`: it imports every connector at module top, so one absent extra would abort collection for everyone. On a core-only checkout, `pytest -rs` lists what was skipped and why — a skip there is the system working. Both rules are on [connector patterns](/contribute/connector-patterns/).

### Shutdown hangs, then names stragglers

**Cause.** A worker or client blocking on a wait it does not bound. `stop_all()` joins every worker within one shared grace period (`runtime.shutdown_timeout_seconds`, default 10 s); anything still blocked past that is reported as a straggler and left to die with the interpreter. The canonical offender is a batching network client at close: defaults are chosen for throughput, not shutdown, and left alone the InfluxDB client once kept the process alive for 213 seconds past *"Shutdown complete"* — a force-closed writer does not cancel an in-flight retry, and those threads are not daemons. uvicorn's graceful-shutdown timeout defaults to unbounded for the same reason, which is why `RestApiService` caps it at 5 s.

**Fix.** Bound every wait you own. For a buffering storage backend, flush in `close()` with a hard cap — `storage/influxdb.py` is the worked example (`max_close_wait_ms`, plus a retry budget capped to match) — and time a real shutdown against an *unreachable* service before calling it done. The `close()` discipline is on [storage backends and services](/contribute/storage-and-services/); the grace period and what the supervisor does with a straggler are on [Lifecycle](/architecture/lifecycle/).

---

Not listed here? The two repositories keep their sharpest operational notes next to the code: [`CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md) for every plugin contract, [`.env.example`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.env.example) for what each variable does and costs, the [viewer README](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/README.md) for everything between the CSVs and the chart, and the [viewer's `CONTRIBUTING.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/CONTRIBUTING.md#rules-that-are-load-bearing) for the rules that explain a blank chart, a stale language or a viewer that will not load offline.
