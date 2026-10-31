---
title: Resumable downloads
description: How Downlink resumes a transfer from the exact byte, safely.
---

A download is not a browser tab that forgets what happened. Downlink writes to
`<filename>.part`, stores the byte count in SQLite, and only renames the file when the
transfer is complete.

## The resume contract

1. A download writes to `<filename>.part` and stores its byte count in SQLite.
2. Pause, cancel, or restart leaves the `.part` file in place.
3. On resume, Downlink sends `Range: bytes=<downloaded>-` and, when available,
   `If-Range: <ETag or Last-Modified>`.
4. A `206 Partial Content` response is appended. If the server replies `200`, or the validator
   changed, the partial file is truncated and the download restarts from byte 0.
5. When the response ends, the part file is renamed to its final name and the job is marked
   completed.

## A real exchange

```http
GET /video.mp4
Range: bytes=432144384-
If-Range: "6aa88fff-310fd51d"
Referer: https://example.com/watch

206 Partial Content
Content-Range: bytes 432144384-823121180/823121181
ETag: "6aa88fff-310fd51d"
```

Downlink appends 390,976,797 bytes to `video.mp4.part`, then renames it to `video.mp4`.

## Why the validators matter

If a file is replaced between pause and resume, appending the new bytes to the old prefix
produces a corrupt file. `If-Range` makes this explicit: the server only honors the range when
the validator still matches. If it does not, Downlink restarts cleanly instead of stitching
two versions together.

- `ETag` is preferred when the server provides one.
- `Last-Modified` is used when there is no ETag.
- Without either, resume still sends `Range`, but cannot prove the remote file is unchanged.

## What survives a restart

| Thing | Survives restart? | Where |
| --- | --- | --- |
| Downloaded bytes | Yes | `<name>.part` on disk |
| Byte count and validators | Yes | SQLite |
| Imported request headers | Yes | SQLite |
| Queue position and state | Yes | SQLite |
| In-flight socket | No | Reopened on resume |

Interrupted jobs are recovered when the engine boots. Jobs that were actively downloading move
back into the queue; paused jobs stay paused.

## Failure behavior

- **Server ignores ranges** (`200 OK` on resume): the transfer restarts from zero rather than
  corrupting the file.
- **Validator changed**: the partial file is truncated and restarted.
- **Connection drops**: the job pauses with the bytes received so far; resume continues from
  there.
- **Disk full or permission error**: the job fails with the error surfaced in the card and in
  the API.

:::tip Testing resume
The fixture tests in `tests/` exercise the range parser, safe filename handling, and resume
behavior against a local range-capable server. `bun run test:e2e` drives a real pause/resume
cycle in Chrome and asserts the `Range` and `If-Range` headers.
:::
