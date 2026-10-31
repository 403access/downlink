# Downlink docs

The documentation site, built with [Docusaurus](https://docusaurus.io) and themed to match the
marketing site in [`../website`](../website).

```bash
bun run docs:dev     # from the repo root: http://127.0.0.1:4000
bun run docs:build   # build into ../dist/docs
bun run docs:serve   # preview the production build on http://127.0.0.1:4001
```

Run commands from the repository root so Bun resolves the workspace dependencies.

## Structure

```text
docs/                Markdown and MDX pages
src/pages/index.tsx  marketing-style documentation landing page
src/components/      landing page cards
src/theme/           custom navbar brand and footer
src/css/custom.css   the shared design system (tokens, navbar, docs, code, footer)
static/img/          logo and favicon; app screenshots are synced at build time
docusaurus.config.ts site URL, base path, navbar, and syntax theme
sidebars.ts          manual sidebar order
```

`scripts/sync-assets.ts` copies `screenshot.png` and `preview.png` from the repository root into
`static/img/` before each build, so refreshed app screenshots ship with the docs.

## Deployment

The production build lands in `dist/docs` inside the Pages artifact. `SITE_URL` (shared with
the marketing site build) determines the origin and repository path; the docs base path defaults
to `<repo path>/docs/`. Use `DOCS_BASE_URL` to override it for a different host or for local
development.
