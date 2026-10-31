/**
 * Serves the built marketing site from dist/ for local previews.
 * Run `bun run site:build` first (or use `bun run site:dev`).
 */

import { join, normalize, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const server = Bun.serve({
  port,
  hostname: host,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname: string;

    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const relativePath = normalize(pathname).replace(/^\/+/, "");
    const target = resolve(dist, relativePath);
    if (target !== dist && !target.startsWith(`${dist}/`)) {
      return new Response("Not found", { status: 404 });
    }

    const filePath = pathname.endsWith("/") ? join(target, "index.html") : target;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, {
        headers: { "cache-control": "no-store" },
      });
    }

    return new Response(Bun.file(join(dist, "404.html")), {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  },
});

console.log(`Marketing site: http://${host}:${server.port}/`);
console.log("Press Ctrl+C to stop.");
