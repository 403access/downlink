---
title: Privacy and security
description: What stays local, what is stored, and how to run Downlink safely.
---

Downlink is private by architecture, not by policy. There is no account, no cloud service, and
no telemetry endpoint to send anything to.

## What stays on your machine

| Data | Where it lives |
| --- | --- |
| Downloaded files | Your chosen save folder (`./downloads` by default) |
| Queue, history, settings | `data/downlink.db` |
| Imported request headers | `data/downlink.db` |
| Partial downloads | `<name>.part` next to the final file |

Nothing is uploaded to a Downlink server because there is no Downlink server.

## Localhost by default

The server binds to `127.0.0.1`. Requests go from your machine directly to the source. The
HTTP API has no authentication layer because it assumes a single trusted local user.

If you set `HOST=0.0.0.0`, you are exposing an unauthenticated downloader and its stored
headers to your network. Do that only on a trusted LAN, and prefer a firewall or reverse proxy
with authentication if you need remote access.

## Imported headers are sensitive

Cookies and authorization tokens are stored in plain form in SQLite so that a paused download
can resume after a restart. That is the trade-off that makes resume work.

- Do not commit, sync, or share the `data/` directory.
- Do not expose the server to an untrusted network.
- Delete jobs (or clear history) to remove their stored headers.

## Remote preview tokens

The remote preview proxy only accepts URLs that the engine has inspected, and it uses a signed,
short-lived token rather than replaying arbitrary URLs. It exists so the browser can seek in a
remote file without handing your request headers to page JavaScript.

## No telemetry, no analytics

There are no analytics scripts, tracking pixels, or crash reporting in the app or the docs.
The marketing site is static HTML, CSS, and JavaScript.

## What Downlink will not do

- Bypass authentication, paywalls, DRM, or anti-bot protections.
- Solve CAPTCHAs or impersonate a logged-in browser beyond replaying headers you provide.
- Reconstruct HLS/DASH streams from manifests.

Only download content you have permission to save.
