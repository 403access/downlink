---
title: Configuration
description: Environment variables, runtime settings, and where state is stored.
---

## Environment variables

| Variable       | Default       | Description                                    |
| -------------- | ------------- | ---------------------------------------------- |
| `PORT`         | `3000`        | HTTP port.                                     |
| `HOST`         | `127.0.0.1`   | Bind address. Only expose on trusted LANs.     |
| `DOWNLOAD_DIR` | `./downloads` | Initial save folder, also editable in the UI.  |
| `DATA_DIR`     | `./data`      | Directory for the SQLite database.             |

```bash
PORT=8080 DOWNLOAD_DIR="$HOME/Downloads/Video" bun start
```

`DOWNLOAD_DIR` sets the **initial** save folder. Changing the folder in Settings updates the
stored value, so a later restart keeps your choice rather than overriding it.

## Runtime settings

These live in the local database and are editable from the UI or the
[settings API](/reference/http-api#settings).

| Setting | Range | Default | Effect |
| --- | --- | --- | --- |
| Save folder | any writable path | `./downloads` | Where completed files are written. |
| Concurrency | 1–10 | 3 | How many downloads run at once. |
| Speed limit | MB/s | unlimited | Fair global cap across active transfers. |

Queue limits apply immediately: lowering concurrency does not kill running jobs, but no new
jobs start until the number of active downloads drops below the limit.

## Files and directories

```text
downloads/                  completed files, plus <name>.part while in progress
data/downlink.db            queue, settings, history, and stored headers
data/downlink.db-wal        SQLite write-ahead log (while running)
data/downlink.db-shm        SQLite shared-memory file (while running)
```

Both directories are created on demand and ignored by git.

:::warning
Imported headers are stored in the database so pause and resume still authenticate. Do not
share or commit `data/`.
:::

## A typical layout

```bash
# keep media on a large disk, state close to the app
DOWNLOAD_DIR="$HOME/Media/downloads" DATA_DIR="./data" bun start
```

If you run Downlink behind a reverse proxy, remember that the UI and API are designed for
loopback use. See [Privacy and security](/guides/privacy-and-security) before exposing it.
