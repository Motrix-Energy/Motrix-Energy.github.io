---
title: Docker and compose profiles
description: The four compose invocations, the read-only config mount, and the two .env namespaces that are not interchangeable.
---

The EMS ships a `docker-compose.yml` where everything beyond the EMS itself is opt-in: profiles add a broker, a monitoring pair, or the gated viewer, and a bare `docker compose up` never breaks because a profile's image is missing.

:::note[Canonical source]
This page summarises [`README.md` — "Docker"](https://github.com/Motrix-Energy/motrix-edge/blob/main/README.md#docker), [`docker-compose.yml`](https://github.com/Motrix-Energy/motrix-edge/blob/main/docker-compose.yml) and [`.env.example`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.env.example), whose comments carry the full reasoning.
:::

## The four invocations

```bash
docker compose up -d                              # EMS alone
docker compose --profile mqtt up -d               # + mosquitto
docker compose --profile monitoring up -d         # + influxdb + grafana
docker compose --profile viewer up -d             # + the gated viewer on 127.0.0.1:8080
```

- **EMS alone** is enough for a replay-driven config: no broker, no other service.
- **`mqtt`** adds an eclipse-mosquitto broker on 1883, with a healthcheck the EMS waits on.
- **`monitoring`** adds InfluxDB 2.x and Grafana (provisioned against it) for the `influxdb` storage backend.
- **`viewer`** adds Motrix Edge View, published on `127.0.0.1:8080` — the only port this stack publishes by default. Its nginx gates `/api/*` with Basic auth and proxies to the EMS across the compose network.

`config.json` is mounted **read-only** into the container and `data/` read-write — the container can write readings, not rewrite its own wiring. The image carries its own `HEALTHCHECK` and compose adds none, because two definitions of health is drift waiting to happen.

The EMS's API port 8000 is deliberately **not published** — the viewer's nginx is the only authentication in this system, and publishing that port would put an ungated copy of every route beside the gated one; the full doctrine is on [Security model](/architecture/security/).

## `.env` holds two namespaces, and they are not interchangeable

[`.env.example`](https://github.com/Motrix-Energy/motrix-edge/blob/main/.env.example) marks every variable as one of two kinds:

- **`[container-runtime]`** — forwarded into the container by the compose file's `environment:` list and read *inside* it, mostly by `Config` resolving `${VAR}` in `config.json` (`MQTT_HOST`, `HA_TOKEN`, `INFLUXDB_TOKEN`, …). Compose forwards only what that list names: a `${VAR}` in `config.json` that no `environment:` line carries resolves to nothing.
- **`[compose-time]`** — substituted into `docker-compose.yml` by the docker CLI *before any container exists*: image tags and port bindings (`VIEWER_IMAGE`, `VIEWER_TAG`, `VIEWER_BIND`, `VIEWER_PORT`). These never enter a container, and referencing one from `config.json` resolves to nothing at all.

## The host-run trap

`docker compose up` reads `.env` automatically. **`python main.py` on the host does not** — `Config` reads `os.environ` directly and nothing loads a dotenv file. Export it first:

```bash
# bash
set -a; . ./.env; set +a
```

```bash
# PowerShell
Get-Content .env | % { if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim()) } }
```

The symptom of forgetting is quiet: every `${VAR}` resolves to nothing, schemas accept the nulls by design, and connectors fail to reach hosts that were never named. [Configuration](/operate/configuration/) explains why interpolation is that forgiving.

## Images are pinned, never `:latest`

The viewer profile pulls a published image from GHCR selected by `VIEWER_IMAGE` and `VIEWER_TAG` — and the tag must name a release that exists, because there is deliberately no `:latest`. A floating tag would silently change what a deployment runs on the next pull, and the version boundary between the two repositories is a pin all the way down: same storage format, both sides asserted by tests. Until the viewer has published a release, the commented `build:` block in `docker-compose.yml` is the working path for anyone holding both checkouts side by side.
