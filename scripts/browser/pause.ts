/**
 * End-to-end pause/resume test.
 *
 * Starts an isolated Downlink server and a range-capable fixture, drives the
 * real UI with Chrome DevTools Protocol, pauses the download, resumes it, and
 * verifies that the second request used If-Range + a byte offset.
 *
 *   bun run test:e2e
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getFreePort,
  launchChrome,
  projectRoot,
  waitFor,
  type BrowserSession,
} from "./cdp";

const FILE_SIZE = 24 * 1024 * 1024;
const ETAG = '"cdp-pause-v1"';
const DOWNLOAD_SPEED = 300_000;

const bytes = new Uint8Array(FILE_SIZE);
for (let index = 0; index < 4096; index += 1) bytes[index] = index % 251;

interface RangeRequest {
  range: string | null;
  ifRange: string | null;
}

const rangeRequests: RangeRequest[] = [];

const fixture = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/pause-test.bin") {
      return new Response("not found", { status: 404 });
    }
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Accept-Ranges": "bytes",
      ETag: ETAG,
      "Last-Modified": "Tue, 15 Sep 2026 00:23:27 GMT",
      "Content-Disposition": 'attachment; filename="Pause Test.bin"',
      "Cache-Control": "no-store",
    });

    if (req.method === "HEAD") {
      headers.set("Content-Length", String(FILE_SIZE));
      return new Response(null, { headers });
    }

    const range = req.headers.get("range");
    const ifRange = req.headers.get("if-range");
    rangeRequests.push({ range, ifRange });

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response("bad range", { status: 416 });
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), FILE_SIZE - 1) : FILE_SIZE - 1;
      if (start >= FILE_SIZE) {
        headers.set("Content-Range", `bytes */${FILE_SIZE}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${FILE_SIZE}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(bytes.slice(start, end + 1), { status: 206, headers });
    }

    headers.set("Content-Length", String(FILE_SIZE));
    return new Response(bytes, { headers });
  },
});

const root = projectRoot();
const tempDir = await mkdtemp(join(tmpdir(), "downlink-e2e-"));
const artifactsDir = join(root, "artifacts");
const appPort = await getFreePort();
const base = `http://127.0.0.1:${appPort}`;
const app = Bun.spawn([process.execPath, join(root, "src/server.ts")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(appPort),
    HOST: "127.0.0.1",
    DATA_DIR: join(tempDir, "data"),
    DOWNLOAD_DIR: join(tempDir, "downloads"),
  },
  stdout: "ignore",
  stderr: "inherit",
});

let browser: BrowserSession | null = null;

async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }
  return data as T;
}

async function getJob(id: string): Promise<any> {
  const data = await api<{ job: any }>(`/api/downloads/${id}`);
  return data.job;
}

async function main(): Promise<void> {
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`${base}/api/health`)).ok;
      } catch {
        return false;
      }
    }, 15_000);

    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ speedLimitBps: DOWNLOAD_SPEED }),
    });

    const added = await api<{ jobs: Array<{ id: string }> }>("/api/downloads", {
      method: "POST",
      body: JSON.stringify({
        url: `http://127.0.0.1:${fixture.port}/pause-test.bin`,
      }),
    });
    const id = added.jobs[0]?.id;
    assert.ok(id, "The fixture download was not created.");

    await Bun.sleep(1_000);
    await waitFor(async () => {
      const current = await getJob(id);
      return current.status === "downloading" && current.downloadedBytes > 0;
    }, 6_000);
    const before = await getJob(id);
    assert.equal(before.status, "downloading");
    assert.ok(before.downloadedBytes > 0, "No bytes were written before pause.");

    browser = await launchChrome({ width: 1440, height: 1000 });
    await browser.client.navigate(base);
    await browser.client.waitForFunction(
      `document.querySelector('.download-card[data-id="${id}"] [data-action="pause"]')`,
      15_000,
    );
    await browser.client.click(
      `.download-card[data-id="${id}"] [data-action="pause"]`,
    );

    await waitFor(async () => (await getJob(id)).status === "paused", 8_000);
    await browser.client.waitForFunction(
      `document.querySelector('.download-card[data-id="${id}"] .status-text')?.textContent === 'Paused'`,
      8_000,
    );

    const paused = await getJob(id);
    const domStatus = await browser.client.evaluate<string>(
      `document.querySelector('.download-card[data-id="${id}"] .status-text')?.textContent`,
    );
    assert.equal(paused.status, "paused");
    assert.equal(domStatus, "Paused");
    assert.ok(paused.downloadedBytes > 0);
    assert.ok(paused.downloadedBytes < FILE_SIZE);

    const partInfo = await stat(`${paused.filePath}.part`);
    const pausedBytes = partInfo.size;
    assert.equal(pausedBytes, paused.downloadedBytes);

    await mkdir(artifactsDir, { recursive: true });
    await browser.client.screenshot(join(artifactsDir, "pause-resume.png"));

    // Resume at full speed so the test verifies completion without waiting the
    // full ~80 seconds the 300 KB/s limit would otherwise require.
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ speedLimitBps: 0 }),
    });
    await api(`/api/downloads/${id}/resume`, { method: "POST" });

    await waitFor(async () => (await getJob(id)).status === "completed", 30_000);
    const completed = await getJob(id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.downloadedBytes, FILE_SIZE);

    const saved = await stat(completed.filePath);
    assert.equal(saved.size, FILE_SIZE);

    const resumed = rangeRequests.find(
      (request) => request.range === `bytes=${pausedBytes}-`,
    );
    assert.ok(resumed, `Expected a resume request at byte ${pausedBytes}.`);
    assert.equal(resumed.ifRange, ETAG);

    console.log(
      [
        "",
        "  CDP pause/resume test passed",
        `  paused at ${(pausedBytes / 1024 / 1024).toFixed(2)} MB`,
        `  resume range: ${resumed.range}`,
        `  If-Range: ${resumed.ifRange}`,
        `  final size: ${(saved.size / 1024 / 1024).toFixed(2)} MB`,
        `  screenshot: ${join(artifactsDir, "pause-resume.png")}`,
        "",
      ].join("\n"),
    );
  } finally {
    await browser?.close();
    app.kill();
    await Promise.race([app.exited, Bun.sleep(5_000)]);
    fixture.stop(true);
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("\n  CDP pause/resume test failed\n", error);
  process.exitCode = 1;
});
