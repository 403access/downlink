---
title: Troubleshooting
description: Fixes for the failures you are most likely to hit.
---

## The server won't start

**Port already in use.** Change the port:

```bash
PORT=8080 bun start
```

**Bun is missing or too old.** Check the version and upgrade if needed:

```bash
bun --version   # needs 1.2 or newer
```

**The save folder is not writable.** Point it somewhere else:

```bash
DOWNLOAD_DIR="$HOME/Downloads/downlink" bun start
```

## A download fails with 401 or 403

The server refused the request. The link may be private, expired, or require a referer, cookie,
or signed header.

1. Copy the request from DevTools → Network → **Copy as cURL**.
2. Paste it into **Import cURL**.
3. Confirm the URL and headers in the live preview, then add the download.

If the link still fails, it likely depends on authentication or anti-bot protection that
Downlink does not bypass.

## The URL is rejected as a web page

Downlink received `text/html` instead of a file. That usually means the URL is a player page or
a login redirect, not a direct media link. Open the page, find the actual file request in
DevTools → Network, and copy that URL or its cURL command.

## The 206 download was rejected

Explicit range mode requires a `206 Partial Content`. A `200 OK` means the server ignored the
`Range` header and wanted to send the whole file. Downlink rejects it rather than saving the
wrong bytes.

Check the observed status and range in the job details. If the server does not support ranges,
download the full file instead.

## Resume restarted from zero

This is intentional when the remote file changed. The stored `ETag` or `Last-Modified` no
longer matched, so appending would have produced a corrupt file. A server that ignores ranges
(`200` on resume) also forces a clean restart.

## Preview won't play

- Some codecs and containers are not decodable by every browser.
- MP4 files with metadata at the end may not seek until the tail arrives.
- A growing `.part` file is not a finished container; the browser may refuse it until enough
  bytes exist. The player reconnects automatically while the download is active.
- A 206 range that starts mid-file may not include the container header at all. Download the
  file from byte 0 (or the complete file) if you need a playable preview.

The download is still valid. Open the completed file in a local player.

## Downloads are slower than expected

Check three things:

1. **Concurrency** — `maxConcurrent` may be `1`.
2. **Speed limit** — `speedLimitBps` may be set. `0` means unlimited.
3. **The source** — a single slow origin is the usual bottleneck. More concurrency cannot make
   one server faster.

## Reveal does nothing

“Reveal” shells out to `open` (macOS), `explorer` (Windows), or `xdg-open` (Linux). On a
headless Linux box there may be no file manager to open. The file is still at the path shown in
the job details.

## The queue looks stuck after a crash

Interrupted jobs are recovered on boot. If a job stays queued with free concurrency slots,
restart the server once and check `/api/health`:

```bash
curl http://127.0.0.1:3000/api/health
```

If the engine reports no active downloads and the queue does not move, retry the job from the
UI or via `POST /api/downloads/:id/retry`.

## Still stuck?

Open an issue with the Downlink version, platform, the failing URL shape (redact tokens), and
the error text from the job card:

<https://github.com/403access/downlink/issues>
