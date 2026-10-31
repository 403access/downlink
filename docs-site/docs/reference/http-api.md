---
title: HTTP API
description: Routes, payloads, and the SSE event stream.
---

Everything the UI does is a JSON call against the local server. All routes live under
`http://127.0.0.1:3000` and assume a trusted local user; there is no authentication layer.

## Conventions

- Requests and responses are JSON unless noted.
- Errors use `{ "error": "message" }` with a `4xx`/`5xx` status.
- Timestamps are Unix milliseconds.
- Byte counts are bytes, not megabytes.
- Job identifiers are opaque strings.

## Health

### `GET /api/health`

```json
{
  "ok": true,
  "version": "1.0.0",
  "uptimeSeconds": 128,
  "active": 2,
  "downloadDir": "/Users/you/Downloads"
}
```

## Downloads

### `GET /api/downloads`

Returns a snapshot of jobs, aggregate summary, and current settings.

```json
{
  "jobs": ["…"],
  "summary": {
    "total": 4,
    "active": 2,
    "downloading": 1,
    "queued": 1,
    "completed": 2,
    "paused": 0,
    "failed": 0,
    "canceled": 0,
    "speedBps": 7340032,
    "bytesOnDisk": 182450120,
    "completedBytes": 182450120,
    "downloadDir": "/Users/you/Downloads"
  },
  "settings": {
    "downloadDir": "/Users/you/Downloads",
    "maxConcurrent": 3,
    "speedLimitBps": 0
  }
}
```

### `POST /api/downloads`

Add one URL or a batch. Returns `201` with the jobs that were created and any per-URL errors.

```json
{
  "url": "https://example.com/video.mp4",
  "headers": [
    { "name": "referer", "value": "https://example.com/watch" }
  ],
  "range": {
    "start": 432144384,
    "end": 823121180,
    "ifRange": "\"6aa88fff-310fd51d\""
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | A single direct HTTP/HTTPS URL. |
| `urls` | string[] | Batch mode. Up to **25** URLs. |
| `headers` | object or array | Either `{ "name": "value" }` or `{ name, value }[]`. Managed transport headers are dropped. |
| `range` | object | `{ start, end?, ifRange? }`. Cannot be combined with multiple URLs. |

```json
{
  "jobs": ["…"],
  "errors": [
    { "url": "https://example.com/private", "error": "The server refused access (HTTP 403)." }
  ]
}
```

If every URL fails, the response is `422` with the first error and the full `errors` array.

### `GET /api/downloads/:id`

Returns `{ "job": { … } }` or `404`.

### `DELETE /api/downloads/:id`

Removes the job and, by default, its file or partial data. Pass `?files=false` to keep files on
disk.

### `POST /api/downloads/:id/pause`

### `POST /api/downloads/:id/resume`

### `POST /api/downloads/:id/retry`

### `POST /api/downloads/:id/cancel`

Each returns `{ "ok": true }` or `409` when the job is not in a state that allows the action.

### `POST /api/downloads/:id/reveal`

Reveals the file, or the save folder if the file no longer exists.

## Inspection and preview

### `POST /api/inspect`

Probes a URL without adding it to the queue.

```json
{ "url": "https://example.com/video.mp4", "headers": { "referer": "https://example.com/watch" } }
```

```json
{
  "probe": {
    "url": "https://example.com/video.mp4",
    "finalUrl": "https://cdn.example.com/video.mp4",
    "fileName": "video.mp4",
    "contentType": "video/mp4",
    "kind": "video",
    "totalBytes": 823121181,
    "supportsRanges": true,
    "etag": "\"6aa88fff-310fd51d\"",
    "lastModified": "Wed, 21 Oct 2026 07:28:00 GMT",
    "status": 206
  },
  "canPreview": true,
  "previewUrl": "/api/remote-preview?token=…"
}
```

### `GET /api/downloads/:id/preview`

Inline, range-enabled playback of the completed file or the growing `.part` file. Supports
`Range` and `HEAD`.

### `GET /api/downloads/:id/file`

Range-enabled attachment download.

### `GET /api/preview/:id` and `GET /api/files/:id`

Short aliases for the two routes above.

### `GET /api/remote-preview?token=…`

Signed proxy for a URL previously inspected by the engine. The token is what limits the proxy
to known URLs.

## Settings

### `GET /api/settings`

```json
{
  "settings": {
    "downloadDir": "/Users/you/Downloads",
    "maxConcurrent": 3,
    "speedLimitBps": 0
  }
}
```

### `PATCH /api/settings`

Send any subset of the fields below. The folder must exist or be creatable and writable.

| Field | Type | Range |
| --- | --- | --- |
| `downloadDir` | string | 1–1024 characters; `~` is expanded. |
| `maxConcurrent` | integer | 1–10. |
| `speedLimitBps` | integer | `0` (unlimited) to `10,000,000,000`. |

```bash
curl -X PATCH http://127.0.0.1:3000/api/settings \
  -H 'content-type: application/json' \
  -d '{"maxConcurrent": 4, "speedLimitBps": 20971520}'
```

## Bulk actions

| Route | Effect |
| --- | --- |
| `POST /api/actions/pause-all` | Pause active and queued jobs. |
| `POST /api/actions/resume-all` | Resume paused jobs. |
| `POST /api/actions/clear-completed` | Remove completed records, keep files. |
| `POST /api/actions/clear-history` | Remove error and canceled records. |
| `POST /api/actions/open-folder` | Open the save folder in the file manager. |

Each returns `{ "ok": true, "changed": <count> }`, except `open-folder` which reports the
result of the file-manager call.

## Events

### `GET /api/events`

A Server-Sent Events stream. It starts with a `snapshot` event, then pushes job and settings
changes as they happen. A comment ping is sent every 15 seconds.

| Event | Payload |
| --- | --- |
| `snapshot` | The same body as `GET /api/downloads`. |
| `job` | A single updated job. |
| `deleted` | `{ "id": "…" }` |
| `settings` | `{ "settings": { … } }` |
| `refresh` | `{}` — re-fetch the snapshot. |

```js
const events = new EventSource("/api/events");
events.addEventListener("job", (event) => {
  const job = JSON.parse(event.data);
  console.log(job.fileName, job.status, job.progress);
});
```

## Job shape

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque job identifier. |
| `url`, `finalUrl` | string | Requested URL and the URL after redirects. |
| `fileName`, `filePath` | string | Final name and absolute path. |
| `contentType`, `kind` | string | MIME type and `video`/`audio`/`image`/`archive`/`document`/`other`. |
| `totalBytes`, `downloadedBytes` | number | Segment or file size, and bytes on disk. |
| `progress` | number \| null | `0–1`, or `null` when the size is unknown. |
| `speedBps`, `etaSeconds` | number \| null | Live telemetry. |
| `status` | string | `queued`, `downloading`, `paused`, `completed`, `error`, `canceled`. |
| `etag`, `lastModified` | string \| null | Validators used for resume. |
| `supportsRanges` | boolean | Whether the server advertised or proved range support. |
| `rangeStart`, `rangeEnd`, `rangeIf` | number / number \| null / string \| null | Explicit segment request. |
| `remoteTotal`, `httpStatus` | number \| null | Original remote size and observed status. |
| `fileExists`, `isPartial`, `canPreview` | boolean | UI hints. |
| `headers` | `{ name, value }[]` | Stored request headers. |
| `error` | string \| null | Failure reason. |
