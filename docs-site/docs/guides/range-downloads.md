---
title: Explicit range downloads
description: Download a specific byte range and require a 206 response.
---

Sometimes you want a segment, not a whole file: a single track, a slice for analysis, or a
portion of an archive on a metered connection. Downlink supports explicit `Range` requests in
the composer.

## Request a segment

1. Open **206 range** in the composer.
2. Enter a **start** byte (required) and an **end** byte (optional — open-ended if omitted).
3. Optionally add an `If-Range` validator.
4. Add the download.

Downlink sends:

```http
Range: bytes=432144384-823121180
If-Range: "6aa88fff-310fd51d"
```

## The 200 rule

In explicit range mode, Downlink requires **`206 Partial Content`**. A `200 OK` response means
the server ignored the range and would send the whole file, so the job is rejected instead of
silently saving the wrong bytes.

The UI shows the observed status, the requested range, and the original remote size, which
makes a server that does not support ranges obvious.

## Naming

Segmented downloads get a descriptive filename so they do not collide with the full file. The
exact name is derived from the remote filename plus the requested range.

## Using cURL instead

If you copied a request from DevTools that already contains a `Range` header, the
[cURL importer](/guides/curl-import) fills in both the range and the validator for you.

:::info Resume still applies
A range download is still resumable within its segment. The same `.part` and byte-count
mechanism is used, and a resume continues from the bytes already received.
:::
