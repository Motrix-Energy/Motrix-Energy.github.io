---
title: Storage backends and services
description: How to add a storage backend or a service to Motrix Edge — timestamp discipline, shutdown flush, injected handles, and why neither axis keeps a run alive.
---

Two plugin axes share this page because they share a temperament: both are supervised infrastructure that must never distort the record and never outlive the run. A storage backend is a sink/source, not a participant in the runtime; a service is a supervised worker that owns no devices.

## Storage backends

:::note[Canonical source]
The normative step-by-step recipe is [CONTRIBUTING.md — "Recipe: add a new storage backend"](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-storage-backend) in motrix-edge.
:::

Three backends ship: `csv_file`, `influxdb` and `null`. Storage is optional and plural — declare zero, or several at once. A backend lives in `storage/<class>.py` as `<Name>Backend` (`csv_file` → `CsvFileBackend`), with a `*.schema.json` beside it, and implements the three sinks/source from [`api/storage_backend.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/storage_backend.py):

- `write_device_data(device, data)` — called on every device `receive()`.
- `write_algorithm_decision(algorithm, device, command)` — called when an algorithm controls a device.
- `read(device, start, end)` — return stored rows within a time range, or `[]`.

### Always stamp with the base class's helpers

Neither write method takes a timestamp — deliberately. Derive one from `self._data_timestamp()` for a device reading and `self._decision_timestamp()` for an algorithm decision, and **never** reach for `datetime.now()` directly, or your backend stamps backtests with the wall clock.

The two helpers exist because the two writes resolve to *different clocks* under a replay: a reading belongs to the timestep being dispatched (event time), a decision to the timestep the algorithm was processing (committed step time). Both fall back to `datetime.now()` when no replay drives the clock. The two-clocks model is explained on [/architecture/time-and-replay/](/architecture/time-and-replay/).

### Fan-out isolates you — so just do your job

Backends run behind `StorageManager`, which fans every write out to all backends with **per-backend error isolation**: one backend raising never blocks the others, and `read()` returns the first non-empty result. Do not build your own retry-and-swallow layer around every write; let exceptions surface and the manager contain them. A dead InfluxDB does not take the CSV down with it.

Optionally, a backend whose schema is its field names may prefer `MetricSource.get_metrics()` over the raw payload — [`storage/influxdb.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/storage/influxdb.py) does; `CsvFileBackend`, which serialises the payload verbatim, has no reason to.

### `close()` is your flush — and bound every wait

`StorageManager.close_all()` calls `close()` once at shutdown; anything still in memory when it returns is lost. The default is a no-op, correct for a write-through backend like `CsvFileBackend` (one open/close per row) but wrong for anything that batches — flush there.

The worked example is `storage/influxdb.py`, and it earned its scars: left on its defaults, the InfluxDB client kept the process alive for **213 seconds past "Shutdown complete"**, because a force-closed writer does not cancel an in-flight retry and those threads are not daemons. The fix is the pattern to copy — swap the handles out under the lock, flush outside it, and bound every wait you can (`max_close_wait_ms`, plus a retry budget capped to match). A network client's defaults are chosen for throughput, not shutdown.

:::caution[Test the ugly shutdown]
If your backend talks to a network service, time a real shutdown against an *unreachable* one before you call it done. The happy path proves nothing about the hang.
:::

### `CsvFileBackend` is a published interface

One backend is special: `CsvFileBackend`'s two files are parsed by an external application (Motrix Edge View), so their headers, dialect, timestamp shape and gap semantics are frozen by the normative contract and pinned byte-for-byte by `tests/test_storage_contract.py`. Changing that backend's output is a cross-repo breaking change — read [/contribute/storage-format-changes/](/contribute/storage-format-changes/) first.

Every *other* backend answers only to its own store and shapes its output as it likes, **with one reservation**: `device_data.csv` and `algorithm_decisions.csv` under a backend's `output_dir` are format 1.0 by name and by column shape, and the viewer identifies them by shape. A backend writing either name with those columns produces a file the viewer reads as a Motrix Edge run, with none of the byte-exactness the fixture comparison guarantees — so only a backend that passes it should emit them. `StorageManager` also warns at startup when two registered backends resolve to the same `output_dir`: two `csv_file` entries on one directory interleave their rows into a single file, with the header decided from the size on disk at open time and nothing marking the seam.

## Services

:::note[Canonical source]
The normative step-by-step recipe is [CONTRIBUTING.md — "Recipe: add a new service"](https://github.com/Motrix-Energy/motrix-edge/blob/main/CONTRIBUTING.md#recipe-add-a-new-service) in motrix-edge.
:::

A service is a supervised worker that owns **no devices**: it observes the runtime or exposes it — the shipped example is `rest_api`, the read-only introspection API. It lives in `services/<class>.py` as `<Name>Service`, with a blocking, stoppable `start()` like a connector's.

### The injected handles, and the schema-minus-injected-keys rule

Every service constructor receives `devices_manager` and `supervisor`, injected by `main` — declare them and forward them to `super().__init__`, used or not, or your service is skipped with a "could not be instantiated" log line. A service that reaches for a singleton instead is lying about its dependencies and cannot be unit-tested.

Your `services/<class>.schema.json` describes the config `options` keys, **minus** `devices_manager` and `supervisor` — those never come from config, and declaring either would let a config entry collide with the injected value and fail instantiation with "got multiple values".

### `SystemExit` is not a crash — make exit paths explicit

A library that calls `sys.exit()` on failure raises `SystemExit`, which is a `BaseException`. The supervisor has a branch for it: the worker is logged CRITICAL, marked finished, and deliberately **not restarted** — a worker that exits is treated as having given up rather than having failed. That is usually right, and for a port that is momentarily held by something else it is wrong. Catch it and re-raise something that inherits from `Exception`, which is what buys the bounded retry a crash gets. [`services/rest_api.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/services/rest_api.py) does exactly this; uvicorn's failure to bind a port is the real-world case.

The other race worth designing against: a `stop()` arriving *before* `start()` must still be honoured — guard the top of `start()` with `if self.is_stopping(): return`, and re-check under a lock after building the resource, or a shutdown that races startup binds a port and leaks it.

### Bound every wait you own

`stop_all()` joins all workers within one shared grace period (`runtime.shutdown_timeout_seconds`, default 10 seconds); anything you block on past that is reported as a straggler and left to die with the interpreter. Server defaults are chosen for throughput, not shutdown — uvicorn's graceful-shutdown timeout defaults to *unbounded*, so `RestApiService` caps it at 5 seconds.

### Services never keep a run alive

Liveness is connector-shaped: `main` waits on the connectors only, then stops everything else — so a service never keeps a finished replay alive, which is why an API cannot simply be declared as a `Connector` with stub methods. The corollary is worth knowing before you debug it: **a config with services and no connectors exits immediately**, with a warning saying so. To hold a process open while poking at a service, run a `pseudo` connector with `"loop": true`. The supervision and liveness model is on [/architecture/lifecycle/](/architecture/lifecycle/).

:::danger[Serialise allowlists, never objects]
If your service exposes runtime state, serialise an explicit allowlist of named fields — never `vars(obj)`. A device snapshot deliberately shares the live connector, so any attribute walk reaches the broker password. Device *data* is telemetry and may be exposed; device *options* are configuration and may hold credentials.
:::

## Tests, for both axes

Storage: copy [`tests/test_storage_csv.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_storage_csv.py) (file-backed), [`tests/test_storage_null.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_storage_null.py) (the no-op) or [`tests/test_storage_influxdb.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_storage_influxdb.py) (a network client, mocked at its single construction site). Services: copy [`tests/test_rest_api_service.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/tests/test_rest_api_service.py), and use `tests/test_shutdown.py` as the template for proving `stop()` unblocks `start()` — including `stop()` before `start()`. Either way, `pytest` must stay green with no external service and no network; mock the client or write to a temp dir.
