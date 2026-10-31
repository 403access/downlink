/**
 * Copies the app screenshots from the repository root into the docs site.
 *
 * The screenshots are the source of truth for the product UI, so the docs
 * build picks up refreshed captures instead of committing duplicates.
 */

import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const docsRoot = join(import.meta.dir, "..");
const repoRoot = join(docsRoot, "..");
const target = join(docsRoot, "static", "img");

await mkdir(target, { recursive: true });

await cp(join(repoRoot, "screenshot.png"), join(target, "library.png"));
await cp(join(repoRoot, "preview.png"), join(target, "player.png"));

console.log("Synced screenshots into docs-site/static/img/");
