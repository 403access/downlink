---
title: Previewing files
description: Inspect remote files and stream partial downloads while they arrive.
---

Downlink previews before and during a download. Both paths appear in the docked panel on
the right, so you can inspect a link or a library item without opening a dialog.

## Remote inspection

**Preview** probes a URL before committing to a download. The engine reports:

- size and content type,
- range support and the accepted units,
- `ETag` / `Last-Modified` validators,
- the final URL after redirects.

The remote preview is served through a signed proxy token that is limited to URLs the engine
inspected. It exists so a browser can play a remote file without exposing your request headers
to the page.

## Preview while downloading

Select a library card and the preview dock streams from the growing `.part` file. The endpoint
`/api/downloads/:id/preview` supports `Range` requests, so seeking works mid-transfer instead
of waiting for completion.

This works best for:

- **MP4** files with metadata at the front (`moov` before `mdat`),
- **WebM** and audio containers the browser decodes natively,
- images, which render as soon as enough bytes arrive.

Some codecs and containers are not playable by every browser, and a file whose metadata is at
the end may not seek until the tail arrives. The download is still valid — open the completed
file in a local player.

## Preview vs download

| Action | Endpoint | Range | Headers |
| --- | --- | --- | --- |
| Inline preview | `/api/downloads/:id/preview` | Yes | Stored job headers |
| Save a copy | `/api/downloads/:id/file` | Yes | Stored job headers |
| Remote preview | `/api/remote-preview?token=…` | Yes | Imported headers, signed token |

:::tip
Use preview to confirm a URL returns the file you expect before adding a large transfer to the
queue. It costs one probe and does not write to disk.
:::
