/**
 * Builds the static marketing site in website/ into dist/.
 *
 * The output is deliberately plain static HTML, CSS, JS, and images so GitHub
 * Pages can serve it without a runtime. CI runs this before uploading the
 * Pages artifact.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "website");
const output = join(root, "dist");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const siteUrl = (process.env.SITE_URL || "https://403access.github.io/downlink").replace(/\/+$/, "");
const version = pkg.version || "0.0.0";
const commit =
  (process.env.GITHUB_SHA || "").slice(0, 7) ||
  Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root }).stdout.toString().trim() ||
  "local";

const builtAt = new Date().toISOString();

console.log(`Building marketing site for ${siteUrl}`);
console.log(`  version ${version} · commit ${commit}`);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

// The app screenshots at the repository root are the source of truth for the two
// hero shots. They are copied at build time so a refreshed screenshot ships with
// the next deployment. The remaining screenshots live under website/assets/.
await cp(join(root, "screenshot.png"), join(output, "assets", "library.png"));
await cp(join(root, "preview.png"), join(output, "assets", "player.png"));

/** Replace build tokens in text files that ship with the site. */
const textExtensions = new Set([".html", ".txt", ".xml", ".json", ".js", ".css", ".svg", ".webmanifest"]);
const tokens = [
  ["__SITE_URL__", siteUrl],
  ["__VERSION__", version],
  ["__COMMIT__", commit],
];

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }

  return files;
}

let templated = 0;
for (const file of await walk(output)) {
  if (!textExtensions.has(file.slice(file.lastIndexOf(".")))) continue;

  let contents = await readFile(file, "utf8");
  let changed = false;
  for (const [token, value] of tokens) {
    if (!contents.includes(token)) continue;
    contents = contents.replaceAll(token, value);
    changed = true;
  }

  if (changed) {
    await writeFile(file, contents);
    templated += 1;
  }
}

/** Compile the site's own CSS and JS rather than serving the authoring copies. */
const build = await Bun.build({
  entrypoints: [join(source, "styles.css"), join(source, "app.js")],
  outdir: output,
  target: "browser",
  minify: true,
  sourcemap: "none",
});

if (!build.success) {
  for (const log of build.logs) console.error(log);
  throw new Error("Bun.build failed for the marketing site");
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${builtAt.slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

const buildInfo = {
  name: "downlink-marketing-site",
  siteUrl,
  version,
  commit,
  builtAt,
};

await writeFile(join(output, "sitemap.xml"), sitemap);
await writeFile(join(output, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
await writeFile(join(output, ".nojekyll"), "");

const files = await walk(output);
const bytes = (
  await Promise.all(files.map(async (file) => (await readFile(file)).byteLength))
).reduce((total, size) => total + size, 0);

console.log(`  ${files.length} files · ${(bytes / 1024 / 1024).toFixed(2)} MB · ${templated} templated`);
console.log(`  output ${relative(root, output)}/`);
