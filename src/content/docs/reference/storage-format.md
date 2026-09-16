---
title: Storage format 1.0
description: The two CSV files the EMS writes, the three caveats to know before trusting a chart, and where the version is pinned.
---

The `csv_file` storage backend writes two files, and their shape is a versioned,
cross-repository contract — the interface Motrix Edge View consumes.

:::note[Canonical source]
This page is a one-screen summary of
[`docs/storage-format.md`](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md)
in motrix-edge.
:::

## The two files

| File | Written when |
|---|---|
| `device_data.csv` | a device accepts a payload |
| `algorithm_decisions.csv` | an algorithm sends a control command |

Their header rows, byte-exact — column order is part of the contract:

```
timestamp,device_name,data_json
timestamp,algorithm,device,command
```

Neither file exists until its first write: a run in which no algorithm ever acted
produces no `algorithm_decisions.csv` at all, and a consumer must read *missing* as
*no data*, never as an error.

## Three caveats before trusting a chart

1. **A gap means "no reading received" — never interpolate across one.** The EMS writes
   no row for a rejected payload, deliberately: republishing the previous reading would
   turn a stalled or corrupt meter into a flat line instead of the gap it actually is.
   Absence does not mean unchanged, and it does not mean zero. Break the line at a gap.
2. **The `timestamp` column can hold two time domains.** A live run stamps naive local
   time — local to the machine that wrote the file — while a replay stamps whatever the
   replay file carried, offset or not. One file routinely holds both. Honour an offset
   when present; read a naive stamp as local-to-the-writer, and surface the ambiguity
   rather than silently assuming UTC.
3. **`command` is an opaque string.** `AutoToggle`, the project's own worked example,
   emits the bare words `on` and `off` — code that assumes `JSON.parse(command)` breaks
   on the project's own example. Try-parse and fall back to the raw string.

## The version, and where it is pinned

The current version is **1.0**, pinned in four places that a lockstep test keeps from
drifting apart: the `STORAGE_FORMAT_VERSION` constant in
[`storage/csv_file.py`](https://github.com/Motrix-Energy/motrix-edge/blob/main/storage/csv_file.py),
[`examples/MANIFEST.json`](https://github.com/Motrix-Energy/motrix-edge/blob/main/examples/MANIFEST.json),
the version line at the top of `docs/storage-format.md`, and `motrixStorageFormat` in the
viewer's `package.json`. How a bump propagates across the two repositories is the subject
of [Changing the storage format](/contribute/storage-format-changes/).

:::caution[Normative source]
**The normative contract is `docs/storage-format.md` in motrix-edge. This page is a
summary and yields to it in any conflict.** Read the numbered sections before writing a
consumer:
[§2 dialect](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#2-dialect),
[§4 timestamps](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#4-timestamps--read-this-part-twice),
[§7 gaps](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#7-gaps-mean-something),
[§11 versioning](https://github.com/Motrix-Energy/motrix-edge/blob/main/docs/storage-format.md#11-versioning).
:::
