---
title: FAQ
description: Short answers to the questions people ask before switching.
---

## Does Downlink download from YouTube, TikTok, or streaming sites?

No. Downlink is a **direct-file** downloader for URLs that return a file. HLS playlists
(`.m3u8` and their content types) are detected and rejected rather than saved incorrectly.
It does not bypass authentication, DRM, or anti-bot protections.

## What happens if I quit mid-download?

The `.part` file and its byte count stay on disk in SQLite. When you start Downlink again,
interrupted jobs are recovered, and resume sends a range request for the remaining bytes. If
the remote file changed, Downlink starts it over cleanly.

## Where do my files go?

By default, to `./downloads` next to the app. You can change the save folder in Settings or with
`DOWNLOAD_DIR`. Queue state and history live in `./data/downlink.db`.

## Is there a hosted or cloud version?

No. Downlink is designed to run on your own machine and bind to localhost. Hosting it would
mean uploading your downloads, headers, and cookies somewhere else — the opposite of the point.

## Does it work on Windows?

Yes. Downlink runs on macOS, Linux, and Windows with Bun 1.2+. “Reveal” uses `open`, `explorer`,
or `xdg-open` depending on the platform.

## How do I download a link that needs cookies or a referer?

Use **Import cURL**. In your browser, open DevTools → Network, right-click the request, and
choose **Copy → Copy as cURL**. Paste it into Downlink; the URL, range, and safe request headers
are imported and stored with the job. See [cURL import](/guides/curl-import).

## Why did the download restart instead of resuming?

The remote file changed, or the server ignored the range request. Both cases force a clean
restart so the saved file cannot contain bytes from two different versions. See
[Resumable downloads](/guides/resumable-downloads).

## Can I download only part of a file?

Yes. Use **206 range** and enter a start byte, an optional end byte, and an optional `If-Range`
validator. Downlink requires a `206 Partial Content` and saves only that segment with a range
suffix in the filename.

## How many URLs can I add at once?

Up to 25 in a batch paste. Each URL gets its own result, so one bad link does not block the
rest.

## Does Downlink re-encode or convert media?

No. Bytes are written exactly as the server sends them. Playback depends on the browser's
native codec support; unsupported files can still be downloaded and opened locally.

## Is anything sent to a third party?

No analytics, telemetry, or cloud service is involved. Requests go from your machine to the
source you asked for. Imported headers stay in the local SQLite database.

## Can I run it on a remote server?

You can, but do not expose it to an untrusted network. There is no authentication layer, and
`data/` contains stored cookies and tokens. Use a firewall or an authenticated reverse proxy if
you must access it remotely.

## Where are the tests?

```bash
bun test               # unit and integration
bun run test:e2e       # pause/resume in Chrome
bun run test:curl      # cURL import and private preview
bun run test:browser   # smoke test and screenshots
```

The E2E scripts need a local Chrome/Chromium. Set `CHROME_PATH` if it is not in a standard
location.
