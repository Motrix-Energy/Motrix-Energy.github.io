---
title: REST API
description: The five read-only GET routes served by the rest_api service — live runtime state, worker supervision, and the cursored decision log.
---

The `rest_api` service is a read-only HTTP view of the live runtime, served in-process by
uvicorn. It exists for the state that never reaches storage: a device that is configured
but has never produced a reading writes no rows, so no time-series dashboard can tell
*silent* from *not configured* — absence of data is not data. The same goes for readiness
and connectedness, for which capabilities a device satisfies, for supervisor restart and
crash counts, and for replay-barrier progress. Everything is read from the live objects;
the service holds no state of its own and writes nothing.

The source of truth is
[`services/rest_api.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/services/rest_api.py) —
its class docstring and route handlers carry the full reasoning behind every choice on
this page.

:::caution[No auth, no CORS — by design]
The viewer's nginx is the only authentication in this system — never publish the EMS
port. The full doctrine lives on [Security model](/architecture/security/).
:::

## Enabling the service

Declare it in `config.json` and install its optional extra:

```bash
pip install -r requirements-api.txt
```

```json
{
	"services": [
		{
			"name": "api",
			"class": "rest_api",
			"options": {
				"port": 8000
			}
		}
	]
}
```

FastAPI and uvicorn are deliberately not in `requirements.txt` — a CSV-only EMS should
not install a web framework. Without the extra, the service is one clean per-entry skip
at startup and the EMS runs on. The options (`host`, `port`, `root_path`, `access_log`,
`docs`, `shutdown_timeout_seconds`) are documented `$comment` by `$comment` in
[`services/rest_api.schema.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/services/rest_api.schema.json);
the defaults bind `127.0.0.1:8000`.

## Conventions shared by every route

- **GET only, everywhere.** `DevicesAccess.control()` is one careless route away from
  turning a read-only observer into an actuation API, so no route mutates anything.
- **Every response carries `Cache-Control: no-store`.** Every payload is live state
  behind a reverse proxy that would otherwise be free to cache it — including a payload
  carrying a physical meter's equipment identifier.
- **Non-finite floats are encoded as the strings `"nan"`, `"inf"` and `"-inf"`.**
  `json.dumps` would otherwise emit bare `NaN`/`Infinity` — valid Python, invalid JSON —
  and `JSON.parse` in a browser would throw on the entire response. This is the same
  encoding the CSV backend uses (see
  [`docs/storage-format.md` §5](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#5-data_json)),
  so both surfaces agree and a consumer meets one convention, not two.
- **Timestamps stay naive.** Both runtime clocks produce naive local datetimes, and the
  API keeps them naive rather than inventing an offset the source never carried. See
  [Storage format 1.0](/reference/storage-format/) for what that means to a consumer.
- **Every payload is an explicit field allowlist**, never `vars(obj)`: a device snapshot
  deliberately shares the live connector, and an attribute walk over it would reach a
  broker password. Device *data* is telemetry and is exposed; device *options* are
  configuration and are not.
- **`/docs` and `/openapi.json` exist only while the `docs` option is on** (the default).
  Turning it off is the one knob that shrinks the introspection surface without moving
  the port.

## GET /health

The endpoint a Docker health check polls forever, so every read behind it is O(1).
`status` is one of three values:

| Status | Meaning | HTTP code |
|---|---|---|
| `ok` | every worker healthy | 200 |
| `degraded` | at least one worker has crashed and been restarted | 200 |
| `down` | a worker is permanently down or was lost | 503 |

503 is reserved for `down` on purpose: Docker's health check is binary, and under
`restart: unless-stopped` an unhealthy verdict restarts the container — which would throw
away every other worker's state and a running replay. A worker mid-backoff is already
being remedied by the supervisor, so `degraded` is for humans and dashboards and stays
200. `down` means the supervisor gave up permanently, which is the one state a restart
can actually fix.

The payload carries `status`, `uptime_seconds` (of this service, not the process), a
`clock` block (`simulated`, `generation`, `step_time`, `pending` — replay-barrier
progress), a `workers` block (`total`, `running`, `finished`, `down`, `lost`, `crashed`,
`restarts`), a `devices` block (`total`, `connected`, `data_ready`), and a `decisions`
block (`total`, `retained`, `capacity`) — three O(1) counters that let a client notice it
has fallen behind, or that `total` went *down* (a process restart), without polling
`/decisions` at all.

## GET /devices

All devices, sorted by name so the payload is stable across requests — a viewer diffing
it and a test asserting on it both depend on that. Top-level fields: `count`,
`simulation_time`, `devices`.

Each device payload:

| Field | Meaning |
|---|---|
| `name` | the operator-chosen device name |
| `class` | the Python class name — kind `p1` appears here as `P1`; do not treat it as the config key |
| `connector` | the name of the connector the device is wired to |
| `protocol` | the *emulated* protocol: a replay connector with `emulates: "mqtt"` makes its devices report `mqtt`; `connector` disambiguates |
| `readable` / `writable` | the device's declared directions |
| `connected` / `data_ready` | live readiness state |
| `capabilities` | class names of every capability the device satisfies — discovered from `api/capabilities.py`, so a new capability shows up here with no edit to the service |
| `metrics` | `MetricSource.get_metrics()`, or `null` when the device does not implement it |
| `total_energy_kwh` | `EnergyMeter.get_total_energy_kwh()`, or `null` |
| `data` | the device's last accepted payload, verbatim, made JSON-safe |

`data` is the one field with residual exposure — a P1 telegram carries the meter's
equipment identifier. That is the point of the endpoint, and the mitigation is
deployment: the port is not published to the host, and must stay that way.

## GET /devices/{name}

One device by name, with the same payload as above plus `simulation_time`. The route is
declared as `{name:path}` rather than `{name}` because device names are operator-chosen
free text — spaces, slashes, commas and non-ASCII are all legal (see
[`docs/storage-format.md` §8](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#8-what-is-not-in-the-files)),
and a plain path parameter would make a name containing `/` unreachable.

An unknown name is a 404 with the detail `Unknown device`; the requested name is
deliberately not echoed back.

## GET /workers

Every supervised worker, whichever plugin axis it came from. One endpoint rather than
`/connectors` plus `/algorithms`: the supervisor keeps a single list and draws no such
distinction, so two endpoints would be the API inventing a taxonomy the runtime does not
have — and would have gone blind to the services axis the day it was added.

Common fields per worker: `name`, `axis` (`connector` | `algorithm` | `service` |
`unknown`), `class`, `state`, `restarts`, `crashes`, `max_restarts`, `restart_enabled`,
`stopping`.

`state` is one of four values:

| State | Meaning |
|---|---|
| `running` | the thread is alive |
| `finished` | returned cleanly — a replay that ran to its end. A worker that crashed twice, restarted, and later returned cleanly is `finished` with `crashes: 2`, which is the honest report |
| `down` | exhausted its restart budget |
| `lost` | the thread died without the supervisor noticing — the one state no other surface can produce. Unreachable for a worker the supervisor actually started, since `_finished` is now set from a `finally`; what remains are a worker constructed but never started, and a daemon thread caught by interpreter shutdown |

Connectors additionally report their `devices` (names only). Algorithms additionally
report `delay_seconds`, `required_devices`, `wait_for_devices_timeout`, `runs`,
`last_run`, `last_run_seconds`, and `step_participant` — which distinguishes "stuck on
the [lockstep barrier](/architecture/time-and-replay/)" from "left, and the replay moved
on".

## GET /decisions

```
GET /decisions?after=<seq>&limit=<n>
```

Algorithm decisions newer than `after`, oldest first. The one piece of history this API
serves, and the reason it exists as a cursored log rather than a snapshot: every other
endpoint is a snapshot of *now*, and a decision is a discrete event — a client polling on
an interval sees only the ones that happened to be current when it looked. Miss the poll,
miss the event.

The buffer it reads is core state
([`api/decisions.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/api/decisions.py)),
fed from the storage funnel every backend already sees, so `/decisions` and
`algorithm_decisions.csv` hold the same decisions in the same order by construction —
and decisions are recorded whether or not any storage backend is configured.

### The cursor is a sequence number, never a timestamp

`after` is a server-assigned, monotonic, per-process `seq` — **not** a timestamp, and
that is the whole design.
[`docs/storage-format.md` §4](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#4-timestamps--read-this-part-twice)
states rows are not monotonic and duplicate timestamps are legal, and under `speed=0`
every decision in one timestep carries the *identical* committed step time. An inclusive
timestamp cursor would re-deliver the whole timestep on every poll; an exclusive one
would drop all but the first decision in it. `seq` has neither failure.

Both parameters **clamp rather than reject**, so a polling client cannot wedge itself on
an out-of-range value it computed. `limit=0` is a seek-to-head probe: it delivers nothing
and returns the current head as `next_cursor`, which is how a client starts streaming
from now without backfilling. A non-integer still gets FastAPI's own 422.

### Response fields

| Field | Meaning |
|---|---|
| `count` | decisions in this response |
| `total` | recorded since process start — the highest `seq` ever assigned |
| `retained` | how many are still held in the bounded buffer |
| `capacity` | the buffer's size (1000) |
| `oldest_seq` | the oldest `seq` still retained, or `null` when the log is empty |
| `missed` | records evicted between the caller's cursor and what is still held — stated, so a consumer never has to infer a loss |
| `next_cursor` | server-assigned: pass it back verbatim as `after`. Never the client's own `max(seq)`, and never a record that was not delivered |
| `has_more` | the limit truncated this response — poll again now, do not wait out the interval |
| `epoch` | opaque identity of this process's sequence |
| `simulation_time` | the replay clock's current moment, or `null` |
| `decisions` | the records: `seq`, `timestamp`, `algorithm`, `device`, `command` |

Four of the five record keys are `algorithm_decisions.csv`'s own column names, on
purpose: a consumer already reading the CSV needs no second vocabulary. `seq` is
transport, not data. `command` is served **verbatim** — never parsed, never truncated. It
is an opaque string: `AutoToggle` emits the bare words `on`/`off`, and pre-parsing a JSON
one here would make a live decision and its CSV twin two different events (see
[Storage format 1.0](/reference/storage-format/)).

### `epoch`, and talking to an older EMS

`seq` is per-process and restarts at 1, so `epoch` changes when the EMS restarts. Without
it, a client holding a high cursor across a restart would wait forever for a `seq` that
will not come back for hours — silently, with no error anywhere. Compare it for equality,
never parse it; when it changes, reset your cursor.

Two degradations are deliberate and must stay distinguishable:

- **An empty log is `200` with `count: 0`, never 404** — "no decisions yet" is data.
- **An EMS predating this route answers 404, and that is not a failure.** A client
  written against a newer EMS should stop asking for the session and degrade to
  file-only decisions — exactly what [the viewer](/operate/viewer/) does.
