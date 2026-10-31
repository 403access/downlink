---
title: Quickstart
description: Add your first resumable download.
---

This walkthrough takes you from a fresh terminal to a completed, resumable download.

## 1. Start the server

```bash
bun install
bun run dev
```

Open <http://127.0.0.1:3000>.

## 2. Paste a direct link

Paste a direct HTTP/HTTPS file URL into the composer — for example a `.mp4`, `.webm`, `.mp3`,
`.flac`, `.jpg`, `.zip`, or PDF. Press **Add download**.

Downlink probes the URL first, records the size, type, range support, ETag, and
`Last-Modified`, and then queues the transfer.

:::tip
HLS playlists (`.m3u8` and their content types) are not files. Downlink detects and rejects them
instead of saving something broken. Paste a direct media or file URL instead.
:::

## 3. Preview before committing

Press **Preview** to inspect the remote file — size, type, range support, validators — and
stream a signed remote preview in the right-hand panel without starting a download. The
preview proxy is limited to URLs inspected by the engine.

## 4. Pause, quit, and resume

Pause whenever you like. You can even quit the server, reboot, or lose Wi-Fi:

1. The `.part` file and its byte count stay on disk and in SQLite.
2. After a restart, interrupted jobs are recovered automatically.
3. Resume sends `Range: bytes=<downloaded>-` and, when available,
   `If-Range: <ETag or Last-Modified>`.
4. A `206 Partial Content` is appended to the part file. If the remote file changed, Downlink
   truncates and restarts cleanly.

## 5. Add a request that needs context

If a link requires a `Referer`, cookies, or a signed header, copy the request from the browser:

1. Open DevTools → **Network**.
2. Right-click the request → **Copy** → **Copy as cURL**.
3. Paste it into **Import cURL** (or directly into the URL field).

The URL, range, `If-Range`, and safe headers are filled in automatically, with a live preview
of the parsed request. See [cURL import](/guides/curl-import).

## 6. Grab a byte range

Use **206 range** when you want only part of a file. Enter a start byte, an optional end byte,
and an optional `If-Range` validator. Downlink sends the `Range` request, requires a
`206 Partial Content`, and saves only that segment. See
[Explicit range downloads](/guides/range-downloads).

## Next

- [Configuration](/getting-started/configuration) — ports, folders, and settings.
- [Queue and settings](/guides/queue-and-settings) — concurrency and speed limits.
- [HTTP API](/reference/http-api) — script the same operations.
