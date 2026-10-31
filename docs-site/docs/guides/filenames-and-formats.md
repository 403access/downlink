---
title: Filenames and formats
description: How Downlink names files, infers extensions, and avoids collisions.
---

A downloader that gets filenames wrong leaves a pile of `download` and `download (1)` files. The
naming pipeline is deliberately boring and conservative.

## Where the name comes from

1. `Content-Disposition`, including RFC 5987 `filename*` values.
2. The final URL path after redirects.
3. A MIME-derived fallback.

The result is sanitized before it ever touches disk.

## Sanitization

- Takes only the basename, so traversal segments supplied by a server disappear.
- Unicode-normalizes and strips control characters.
- Replaces characters that are illegal on Windows and awkward everywhere else
  (`\ / : * ? " < > |`).
- Falls back to `download` when nothing usable remains.

## Extension inference

When a URL has no usable extension, the content type decides one:

| Content type | Extension |
| --- | --- |
| `video/mp4` | `.mp4` |
| `video/webm` | `.webm` |
| `audio/mpeg` | `.mp3` |
| `image/jpeg` | `.jpg` |
| `application/pdf` | `.pdf` |
| `application/zip` | `.zip` |

The exact table lives in `src/utils.ts`. If a type is unknown, the file keeps the name without
an invented extension.

## Collisions

Existing files are never overwritten. A new download with the same name becomes
`name (1).ext`, then `name (2).ext`, and so on. Downlink also reserves the `.part` path while a
job is active, so a queued file cannot collide with an in-progress one.

## Segmented downloads

Explicit byte-range jobs get a range suffix so they do not look like the complete file:

```text
video [432144384-823121180].mp4    # closed range
video [from 432144384].mp4         # open-ended range
```

## Supported inputs

- Direct HTTP and HTTPS URLs that return a file.
- Browser request captures imported as cURL.
- Batch pastes of up to **25** URLs at once, with a per-URL result.

## Rejected inputs

- **HLS playlists** (`.m3u8` and their content types) — a playlist is not a file.
- **Web pages** (`text/html`, `application/xhtml+xml`) — Downlink asks for a direct file link
  instead of saving the page.
- **Other schemes** — only `http:` and `https:` are accepted.

See [Limits and format support](/help/faq) for the full list of what is out of scope.
