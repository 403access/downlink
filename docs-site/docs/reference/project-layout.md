---
title: Project layout
description: Where each part of Downlink lives in the repository.
---

```text
src/
  index.html     Bun-native fullstack entry
  server.ts      Bun.serve entry and route table
  server/        API helpers split by responsibility
  client/        framework-free UI modules (TypeScript)
  engine.ts      download scheduler, concurrency, speed limits
  engine/        transfer and error helpers
  probe.ts       HEAD / one-byte Range probing and metadata
  curl.ts        pasted-cURL parser (URL, headers, Range, If-Range)
  headers.ts     request-header normalization and managed-header rules
  db.ts          bun:sqlite schema and persistence
  utils.ts       filename, MIME, range, and URL helpers
  css/           app styles split by feature
  styles.css     CSS entry point

tests/           range parser, resume, probe, and cURL fixtures
scripts/
  browser/       CDP helpers and pause/resume + cURL E2E tests
  build-site.ts  marketing site build (templates, minify, sitemap)
  serve-site.ts  local preview server for dist/
website/         marketing site source (static HTML/CSS/JS + assets)
docs-site/       this documentation site (Docusaurus)
docs-site/docs/  the pages you are reading
  .github/workflows/marketing-site.yml  builds and deploys both sites to Pages
downloads/       default save folder
data/            SQLite database (created at runtime)
artifacts/       generated browser screenshots (ignored)
```

## Server modules

| Module | Responsibility |
| --- | --- |
| `server/context.ts` | Store/engine/config bootstrapping and shared constants. |
| `server/add.ts` | URL, range, and header add pipeline. |
| `server/files.ts` | Local file and `Range` responses. |
| `server/preview.ts` | Signed remote-preview token and proxy. |
| `server/sse.ts` | Event stream. |
| `server/http.ts` | JSON and error helpers. |
| `server/snapshot.ts` | API snapshot and summary. |
| `server/fs-actions.ts` | Open/reveal in the file manager. |

## Client modules

The browser client is plain TypeScript bundled by Bun's native HTML pipeline — no framework and
no separate build step.

| Module | Responsibility |
| --- | --- |
| `client/index.ts` | Bindings, drag and drop, boot. |
| `client/cards.ts` | Library cards, filters, summaries, thumbnails. |
| `client/composer.ts` | Add form, 206 range mode, cURL apply, clipboard paste. |
| `client/detail.ts` | Docked detail panel, selection, and media preview. |
| `client/inspect.ts` | Docked remote inspect panel. |
| `client/curl-preview.ts` | Live cURL preview and imported-header chips. |
| `client/actions.ts` | Pause/resume/retry/delete actions and confirm dialog. |
| `client/settings.ts` | Settings and queue actions. |
| `client/events.ts` | SSE state updates. |
| `client/dom.ts` | Shared DOM references, state, and toasts. |
| `client/format.ts` | Formatting helpers. |
| `client/types.ts` | Client-side types. |

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Server + client hot reload. |
| `bun start` | Normal run. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun test` | Unit and integration tests. |
| `bun run test:e2e` | Pause/resume in Chrome over CDP. |
| `bun run test:curl` | cURL import and private preview in Chrome over CDP. |
| `bun run test:browser` | Smoke test and screenshots against a running app. |
| `bun run site:build` | Build the marketing site and the docs into `dist/`. |
| `bun run site:dev` | Build and preview both sites on port 4173. |
| `bun run docs:dev` | Docs dev server on port 4000. |
| `bun run docs:build` | Build only the docs site into `dist/docs/`. |

The CDP scripts use a local Chrome/Chromium installation and write screenshots to `artifacts/`
(ignored by git). Set `CHROME_PATH` if the browser is not in a standard location, and `APP_URL`
for the smoke test.

## Deployment

Both sites ship in one GitHub Pages artifact:

```text
dist/            marketing site
dist/docs/       Docusaurus documentation
```

`scripts/build-site.ts` builds the marketing site first, then the docs build writes into
`dist/docs/`. The shared `SITE_URL` environment variable controls the canonical origin and
repository path for both.
