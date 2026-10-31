---
title: Installation
description: Requirements and setup for Downlink.
---

## Requirements

- [Bun](https://bun.sh) **1.2 or newer**. Development happens against Bun 1.4.
- macOS, Linux, or Windows. “Reveal” uses `open`, `explorer`, or `xdg-open` depending on the
  platform.
- No database server, container runtime, or package manager beyond Bun.

Downlink has **zero runtime dependencies**. `bun install` exists only to fetch TypeScript
developer types.

## From source

```bash
git clone https://github.com/403access/downlink.git
cd downlink
bun install
```

Then start the app:

```bash
bun run dev    # hot reload on http://127.0.0.1:3000
# or
bun start      # normal run
```

Open <http://127.0.0.1:3000>. The server binds to loopback by default and creates
`./downloads` and `./data` on first use.

## Verify the install

```bash
curl http://127.0.0.1:3000/api/health
```

The response reports engine health and the current save folder. If the port is busy, see
[Troubleshooting](/help/troubleshooting#the-server-wont-start).

## Updating

```bash
git pull
bun install
```

Your queue, settings, history, and partial downloads are not touched by `git pull`. They live
in `data/` and `downloads/`, which are ignored by git.

:::warning Back up imported headers
The SQLite database stores imported request headers, including cookies and authorization
tokens, so paused jobs can resume. Treat `data/` as sensitive.
:::
