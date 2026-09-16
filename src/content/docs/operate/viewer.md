---
title: Using the viewer
description: Three ways to get Motrix Edge View, what it shows, and the three honesty caveats that apply to live mode.
---

Motrix Edge View is an offline, single-file viewer for Motrix Edge output: load the two CSVs the EMS writes and see what your devices reported and what your algorithms decided, on one synchronised timeline.

:::note[Canonical source]
This page summarises the [Motrix Edge View `README.md`](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/README.md), which is the authority when they disagree.
:::

## Three ways to get it

1. **Download and open.** Grab `index.html` from the latest release and double-click it. It is one file with every dependency inlined — no server, no install, no network. Drag in `device_data.csv` and `algorithm_decisions.csv` from an EMS run, or the golden fixture the viewer repository vendors under `test/fixtures/auto_toggle/expected/`.
2. **Generate data first.** From the EMS repository, the [quickstart](/start/quickstart/) produces a real run in about a second — `python main.py --config examples/auto_toggle/config.json` — then open the viewer and drag in the two files from `data/storage/`.
3. **The compose profile.** `docker compose --profile viewer up -d` in the EMS repository serves the same file on `127.0.0.1:8080`, with nginx gating `/api/*` and proxying it to the EMS — the deployment where live mode works out of the box. Details on [Docker and compose profiles](/operate/docker/).

## What it does

- **Charts.** Pick any numeric field from any device or algorithm; the fields are discovered from the data, never hardcoded. Series of different magnitudes get their own y-axis automatically, zooming one chart zooms them all with a shared crosshair, and zooming *refines* — the visible window is downsampled to the pixel budget, so the closer you look the more real samples you see.
- **Timeline.** Every reading and every decision, merged chronologically across every loaded dataset and virtualised so a hundred thousand rows scroll smoothly. Filters by dataset, kind, actor and free text intersect; click a row for its full payload.
- **Several runs at once.** Datasets are a list, not a switch — load two backtests side by side and compare them.
- **t₀-normalised time.** Two runs from different years share no wall-clock range; switch the x-axis to t₀-normalised and they superimpose, each measured from its own start.
- **Live mode, by polling.** A running EMS becomes one more dataset beside the loaded files — not a mode — so a live feed and an old replay share one chart. Charts follow the live edge until you zoom, and stop following the moment you do. A separate Live status page shows what has no time axis: health, the replay clock, device readiness, worker restart counts.
- **It tells you what it could not read.** Unparseable timestamps, malformed payloads, rows that step backwards, timestamps carrying no timezone — all reported with row numbers rather than silently dropped.

## Beyond the two CSVs

The viewer also reads two files that are not storage output, both recognised from their contents rather than their names. A **replay input** (`timestamp,device_name,topic,payload`) loaded beside the `device_data.csv` from the same run is the only way to see a payload the EMS *rejected* — no row is written for one, so an input with no reading at the same instant is the evidence. And a **`config.json`** loads as a topology overlay, answering the one question the CSVs cannot: a device that was configured and produced nothing writes no rows, and neither does one that was never configured. Only names, kinds, classes, connectors and protocols are read — hosts, credentials, topics, ports and register maps are never read and never shown.

The interface is in English, French, Dutch and German, picked from your browser and changeable in the header. Timestamps stay ISO-8601 in every language, deliberately: a value you read off a chart has to be greppable in the CSV it came from.

## Three things to know before trusting live mode

- **Decisions shown depend on the EMS's version.** An EMS that serves `GET /decisions` streams them beside the readings from the moment you connect; an older one answers 404, the viewer stops asking, and the UI says so — load `algorithm_decisions.csv` alongside to see them.
- **Live series are sampled by the viewer** at its poll interval, and labelled as such. `/devices` is a snapshot endpoint, so a point appears only when a payload actually changes — a flat stretch means nothing changed, not that nothing was measured.
- **A backgrounded tab stops polling**, and says so. Browsers throttle background timers to about one a minute; continuing would thin the samples thirtyfold and pretend nothing had happened.

## Signing in

nginx in the viewer container gates `/api/*` — and only `/api/*` — with Basic auth driven by `VIEWER_USER` and `VIEWER_PASSWORD`; the static page stays public, and opening the file from disk has no gate because the CSVs are already on that machine. Why the container is fail-closed and why that single gate is the only authentication in the whole system is on [Security model](/architecture/security/).

## Reading the charts

A gap in a chart means "no reading received", not zero — one of three storage-format caveats worth knowing before trusting any chart, all on [Storage format 1.0](/reference/storage-format/).
