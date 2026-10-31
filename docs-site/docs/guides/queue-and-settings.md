---
title: Queue and settings
description: Concurrency, speed limits, queue states, and bulk actions.
---

The queue is the part of Downlink that remembers. It survives restarts and exposes both bulk
and per-job controls.

## States

| State | Meaning |
| --- | --- |
| `queued` | Waiting for a concurrency slot. |
| `downloading` | Actively receiving bytes. |
| `paused` | Stopped, bytes and headers retained. |
| `completed` | Renamed to its final filename. |
| `error` | Stopped with an error; retry keeps partial data. |
| `canceled` | Stopped and partial data removed. |

## Concurrency

`maxConcurrent` is the number of simultaneous downloads, from **1 to 10** (default `3`).
Lowering it does not kill running jobs; the engine simply waits for active downloads to finish
before starting more.

## Global speed limit

`speedLimitBps` is a single cap in **bytes per second** (`0` means unlimited) applied fairly
across active downloads. The UI shows it in MB/s. It is enforced by the engine rather than by a
proxy, so it also covers resumed transfers.

## Bulk actions

| Action | Effect |
| --- | --- |
| Pause all | Pauses active and queued jobs. |
| Resume all | Resumes paused jobs. |
| Clear completed | Removes completed records; files stay on disk. |
| Clear history | Removes error and canceled records. |
| Open folder | Reveals the save folder in Finder/Explorer. |

## Per-job actions

- **Pause** — stop and keep `.part` bytes.
- **Resume** — continue from the stored byte.
- **Retry** — restart an error or canceled job, keeping any partial data.
- **Cancel** — stop and remove partial data.
- **Preview** — select the card to show its player and details in the preview dock.
- **Reveal** — show the file in the OS file manager.
- **Save a copy** — range-enabled attachment download.
- **Delete** — remove the job and, optionally, its files.

## Keyboard and conveniences

| Shortcut / gesture | Action |
| --- | --- |
| `⌘K` or `/` | Focus search |
| `n` | Focus the new-URL field |
| Paste | Fill the URL field from the clipboard |
| Drag and drop a link | Add it to the queue |

Toasts confirm actions, desktop notifications report completed downloads, and the theme toggle
switches between dark and light without an account.

## Settings API

Everything on this page can be scripted:

```bash
# change concurrency and the speed limit (bytes per second)
curl -X PATCH http://127.0.0.1:3000/api/settings \
  -H 'content-type: application/json' \
  -d '{"maxConcurrent": 4, "speedLimitBps": 20971520}'
```

See [HTTP API](/reference/http-api) for request and response shapes.
