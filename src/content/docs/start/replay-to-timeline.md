---
title: From replay to timeline
description: The end-to-end tutorial — generate a run with Motrix Edge, read it in Motrix Edge View, then connect the viewer to a live EMS.
---

This tutorial crosses the repository boundary: it takes the run the
[quickstart](/start/quickstart/) produced and puts it on a timeline in
[Motrix Edge View](https://github.com/Motrix-Energy/motrix-edge-view). Steps 1–3 need no
network at all; step 4 is optional and adds a live EMS beside the file. No hardware
anywhere.

## 1. Generate the CSVs

From a checkout of [motrix-edge](https://github.com/Motrix-Energy/motrix-edge):

```bash
pip install -r requirements.txt
python main.py --config examples/auto_toggle/config.json
```

About a second later, `data/storage/` holds `device_data.csv` (36 readings) and
`algorithm_decisions.csv` (12 decisions). The [quickstart](/start/quickstart/) walks
through what that run actually did.

No Edge checkout to hand? The viewer repository vendors real EMS output at
`test/fixtures/auto_toggle/expected/` — 54 readings and 18 decisions from the same three
devices — and everything below works with those files too.

## 2. Get the viewer

Two ways; the first needs nothing installed.

**A. Download and open.** Grab `index.html` from the
[latest motrix-edge-view release](https://github.com/Motrix-Energy/motrix-edge-view/releases/latest)
and double-click it. The viewer is a single self-contained file — no server, no install,
no network. Opened from disk it simply works, which is the point: an EMS lives on a site
LAN, and a debugging tool that needs the internet to render is the wrong shape.

**B. Run the dev server.** From a checkout of motrix-edge-view, with Node 22+:

```bash
npm ci
npm run dev
```

This serves the same app on port 5173, with one difference that matters for step 4: the
dev server proxies `/api` to `http://localhost:8000`, so a locally running EMS is
reachable. If you only want to read files, either way is fine.

## 3. Load the run

Drag `device_data.csv` and `algorithm_decisions.csv` into the viewer — together or one
after the other. The viewer recognises each file from its contents, not its name, so
renamed copies load just as well; the exact set of file kinds it reads is documented in
the viewer README's
[Data format section](https://github.com/Motrix-Energy/motrix-edge-view/blob/main/README.md#data-format).

What to look at first:

- **The timeline** merges every reading and every decision chronologically. Filter by
  device or free text, and click a row to expand its full payload — expand a decision row
  and you will see the command is the bare word `on` or `off`, not JSON.
- **The charts** offer every numeric field the viewer discovered in the data — nothing is
  hardcoded, so `p1_meter`'s registers and `pseudo_sensor`'s decoded value appear side by
  side. Zooming one chart zooms them all.
- **The transition.** Around step 7 the meter's tariff register crosses AutoToggle's
  500 kWh threshold, and the decision stream flips from `off` to `on`. Seeing a threshold
  crossing as a vertical alignment of chart and timeline is what the viewer is for.

:::note[Before trusting a chart]
Three properties of the storage format shape how you should read what you see — what a
gap means, what timestamps do and do not carry, and what the `command` column is. They
live on one page: [storage format 1.0](/reference/storage-format/).
:::

### The replay input is a dataset too

Now drag in `examples/auto_toggle/replay.naive.csv` — the file the `pseudo` connector
replayed. The viewer recognises it as a **replay input** (its header is
`timestamp,device_name,topic,payload`) and gives it its own event kind rather than folding
it into the readings, with series qualified by topic, because one device publishes on
several.

The distinction is the feature. The EMS writes no storage row for a payload it rejects,
so a rejected payload is invisible in `device_data.csv` alone — but load the input beside
the output and it shows up as an input event with no reading at the same instant. That
absence is the only evidence rejection leaves. In this fixture every one of the 36
published entries was accepted, so input and readings line up one to one — and that
equality is itself worth seeing once, because on a real site it is the first thing to
check when a device seems silent.

### The config is an overlay

You can also drop `examples/auto_toggle/config.json` in. A config is not a dataset — it
has no instants — so the viewer uses it as a topology overlay, answering the one question
the CSVs cannot: whether a device that wrote no rows was configured-but-silent or simply
never configured. Only names, kinds, classes, connectors and protocols are read; hosts,
credentials, topics and every other option are never read and never shown.

## 4. Optional: the live leg

The viewer can watch a running EMS beside the loaded files — a live feed is one more
dataset in the list, not a mode. For that, the EMS needs its optional REST API, and the
run needs to last longer than a second.

First, install the API extra (kept out of `requirements.txt` deliberately — a CSV-only
EMS should not install a web framework):

```bash
pip install -r requirements-api.txt
```

Then copy `examples/auto_toggle/config.json` to `config.live.json` at the repository root
and make two edits. Slow the replay down and loop it — Edge's liveness is
connector-shaped, so the moment a non-looping replay finishes, the EMS exits and takes
the API with it (see [lifecycle](/architecture/lifecycle/)):

```json
"connectors": [
	{
		"name": "replay",
		"protocol": "pseudo",
		"options": {
			"replay_file": "${EMS_REPLAY_FILE:-examples/auto_toggle/replay.naive.csv}",
			"control_log": "${EMS_CONTROL_LOG:-data/storage/control.log}",
			"speed": 60,
			"loop": true,
			"step_timeout_seconds": 30,
			"emulates": "mqtt"
		}
	}
]
```

`speed: 60` replays the 15-minute timesteps one every fifteen seconds — fast enough to
watch, slow enough to follow. Then declare the service:

```json
"services": [
	{
		"name": "api",
		"class": "rest_api",
		"options": {}
	}
]
```

Run it, and start the viewer's dev server in the other repository:

```bash
python main.py --config config.live.json
```

```bash
npm run dev
```

The dev server's `/api` proxy points at the EMS's default `127.0.0.1:8000`, so the
viewer's boot probe finds it and offers the live source — no sign-in, because in
development there is no gate in front of the proxy; the Basic auth lives in the
container's nginx, which is a [deployment concern](/architecture/security/). Connect, and
the live dataset appears in the list beside the file one: same devices, same fields,
accumulating in real time as the loop replays. The **Live status** page shows what has no
time axis at all — health, the replay clock, device readiness, worker restart counts.

Live mode has honest limits — the viewer does its own sampling, and a backgrounded tab
stops polling — summarised with the rest of the viewer's behaviour on
[using the viewer](/operate/viewer/).

## Where next

You have now crossed the whole system: a config wired a replay through an algorithm into
versioned CSV files, and two different consumers — file and live — read the same run.

- How that wiring generalises to real sites: [configuration](/operate/configuration/)
  and [connecting real hardware](/operate/hardware/).
- What the REST API serves and why it is read-only: [REST API](/reference/rest-api/).
- The extension path the architecture exists for:
  [build your first connector](/contribute/your-first-connector/).
