---
title: cURL import
description: Carry a browser request's URL, range, and headers into a download.
---

Some files need a `Referer`, a cookie, or a signed header before the server will serve them.
Instead of reconstructing the request by hand, copy it from the browser.

## Copy the request

1. Open DevTools → **Network**.
2. Reproduce the request (play the video, click the download, reload the page).
3. Right-click the request → **Copy** → **Copy as cURL**.
4. In Downlink, open **Import cURL** and paste.

You can also paste a cURL command directly into the URL field.

## What is imported

```bash
curl --url 'https://example.com/video.mp4' \
  -H 'referer: https://example.com/watch' \
  -H 'range: bytes=432144384-823121180' \
  -H 'if-range: "6aa88fff-310fd51d"' \
  -H 'user-agent: Mozilla/5.0'
```

| Field | Becomes |
| --- | --- |
| URL | The download target |
| `Range` | The 206 range start (and end) |
| `If-Range` | The validator for the range mode |
| Other safe headers | Stored with the job and sent on every request |

The import window previews the parsed request live as you type, paste, or edit the command, so
you can confirm the URL and headers before committing anything.

## Where headers are used

Imported headers are not a one-time trick. They are sent on:

- the initial inspection/probe,
- the signed remote preview,
- the download,
- and every resume request.

That is why a paused job still authenticates after a restart: the headers live in SQLite with
the job.

## Header safety

Downlink filters managed and unsafe headers instead of blindly replaying everything. Hop-by-hop
headers and values that the engine owns (such as the `Range` it is actively managing) are
normalized or dropped so the resume contract stays intact.

:::warning Cookies and tokens
Imported headers can contain session cookies and authorization tokens. They are stored in
`data/downlink.db` in plain form so paused downloads can resume. Do not share the `data/`
directory, and do not expose the server to an untrusted network.
:::

## When import is not enough

Downlink does not bypass authentication, DRM, or anti-bot protections. If a request only works
inside a player's JavaScript, or a signed URL expires faster than the download runs, cURL
import cannot fix that. See [Limits](/help/faq#does-downlink-download-from-youtube-tiktok-or-streaming-sites)
for what is out of scope.
