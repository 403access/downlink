/**
 * End-to-end cURL import test.
 *
 * Verifies that URL, Range, If-Range and headers fill the UI, that the remote
 * preview and download both carry the imported headers, and that a 206 segment
 * is written.
 *
 *   bun run test:curl
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getFreePort,
  launchChrome,
  projectRoot,
  waitFor,
  type BrowserSession,
} from "./cdp";

const FILE_SIZE = 512 * 1024;
const ETAG = '"curl-e2e-v1"';
const API_KEY = "secret-token";

const svgHead = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#b6f36b"/><text x="32" y="190" font-family="sans-serif" font-size="28" fill="#101411">Downlink cURL import test</text><!--`;
const svgTail = `--></svg>`;
const svg = new TextEncoder().encode(
  `${svgHead}${"x".repeat(FILE_SIZE - svgHead.length - svgTail.length)}${svgTail}`,
);

interface SeenRequest {
  range: string | null;
  headers: Record<string, string>;
}
const seen: SeenRequest[] = [];

const fixture = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/secure-test.svg") {
      return new Response("not found", { status: 404 });
    }
    if (
      req.headers.get("x-api-key") !== API_KEY ||
      req.headers.get("referer") !== "https://example.com/watch"
    ) {
      return new Response("forbidden", { status: 403 });
    }
    const headers = new Headers({
      "Content-Type": "image/svg+xml",
      "Accept-Ranges": "bytes",
      ETag: ETAG,
      "Last-Modified": "Tue, 15 Sep 2026 00:23:27 GMT",
      "Content-Disposition": 'inline; filename="secure-test.svg"',
      "Cache-Control": "no-store",
    });
    const range = req.headers.get("range");
    if (req.method === "HEAD") {
      headers.set("Content-Length", String(FILE_SIZE));
      return new Response(null, { headers });
    }
    seen.push({
      range,
      headers: Object.fromEntries(req.headers.entries()),
    });
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response("bad range", { status: 416 });
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), FILE_SIZE - 1) : FILE_SIZE - 1;
      headers.set("Content-Range", `bytes ${start}-${end}/${FILE_SIZE}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(svg.slice(start, end + 1), { status: 206, headers });
    }
    headers.set("Content-Length", String(FILE_SIZE));
    return new Response(svg, { headers });
  },
});

const root = projectRoot();
const tempDir = await mkdtemp(join(tmpdir(), "downlink-curl-e2e-"));
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

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
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

    browser = await launchChrome({ width: 1440, height: 1000 });
    await browser.client.navigate(base);
    await browser.client.waitForFunction(
      "document.querySelector('#loadingState')?.hidden",
      15_000,
    );

    const curl = [
      `curl --url 'http://127.0.0.1:${fixture.port}/secure-test.svg' \\`,
      `  -H 'x-api-key: ${API_KEY}' \\`,
      "  -H 'referer: https://example.com/watch' \\",
      "  -H 'range: bytes=100000-199999' \\",
      `  -H 'if-range: ${ETAG}'`,
    ].join("\n");

    await browser.client.evaluate(`
      const data = new DataTransfer();
      data.setData('text/plain', ${JSON.stringify(curl)});
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      document.querySelector('#urlInput').dispatchEvent(event);
    `);
    await Bun.sleep(300);
    assert.equal(
      await browser.client.evaluate<boolean>("document.querySelector('#curlDialog').open"),
      true,
    );
    assert.equal(
      await browser.client.evaluate("document.querySelector('#curlPreviewState').textContent"),
      "Ready",
    );
    const previewText = await browser.client.evaluate<string>(
      "document.querySelector('#curlPreviewBody').textContent",
    );
    assert.ok(previewText.includes("bytes=100000-199999"));
    assert.ok(previewText.includes("x-api-key"));
    assert.equal(
      await browser.client.evaluate<boolean>(
        "document.querySelector('#curlImportBtn').disabled",
      ),
      false,
    );
    await browser.client.screenshot(join(root, "artifacts", "curl-live-preview.png"));

    await browser.client.click("#curlImportBtn");
    await Bun.sleep(250);

    assert.equal(
      await browser.client.evaluate("document.querySelector('#urlInput').value"),
      `http://127.0.0.1:${fixture.port}/secure-test.svg`,
    );
    assert.equal(
      await browser.client.evaluate<boolean>("document.querySelector('#rangePanel').hidden"),
      false,
    );
    assert.equal(
      await browser.client.evaluate("document.querySelector('#rangeStartInput').value"),
      "100000",
    );
    assert.equal(
      await browser.client.evaluate("document.querySelector('#rangeEndInput').value"),
      "199999",
    );
    assert.equal(
      await browser.client.evaluate("document.querySelector('#headersCount').textContent"),
      "2",
    );
    await browser.client.screenshot(join(root, "artifacts", "curl-import.png"));

    // Inspect must succeed with the private headers, and the signed remote
    // preview must carry them as well.
    await browser.client.click("#inspectBtn");
    await browser.client.waitForFunction(
      "document.querySelector('#inspectAddBtn')?.disabled === false",
      15_000,
    );
    assert.equal(
      await browser.client.evaluate(
        "document.querySelector('#inspectTitle').textContent",
      ),
      "secure-test.svg",
    );
    const previewSrc = await browser.client.evaluate<string>(
      "document.querySelector('#inspectImage').src",
    );
    assert.ok(previewSrc.includes("/api/remote-preview?token="));
    const previewStatus = await browser.client.evaluate<number>(`(async () => {
      const response = await fetch(${JSON.stringify(previewSrc)}, {
        headers: { Range: 'bytes=0-9' }
      });
      return response.status;
    })()`);
    assert.equal(previewStatus, 206);
    await browser.client.screenshot(join(root, "artifacts", "curl-preview.png"));

    await browser.client.evaluate(
      "document.querySelector('#inspectCloseBtn').click()",
    );
    await Bun.sleep(150);
    await browser.client.click("#addBtn");

    await waitFor(async () => {
      const jobs = await api<{ jobs: any[] }>("/api/downloads");
      return jobs.jobs[0]?.status === "completed";
    }, 20_000);
    const job = (await api<{ jobs: any[] }>("/api/downloads")).jobs[0];
    assert.ok(job, "Download was not created.");
    const completed = await getJob(job.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.isPartial, true);
    assert.equal(completed.rangeStart, 100000);
    assert.equal(completed.rangeEnd, 199999);
    assert.equal(completed.httpStatus, 206);
    assert.equal(completed.downloadedBytes, 100_000);
    assert.equal(completed.headers.length, 2);
    assert.ok(
      completed.headers.some(
        (header: { name: string; value: string }) =>
          header.name === "x-api-key" && header.value === API_KEY,
      ),
    );

    const file = await stat(completed.filePath);
    assert.equal(file.size, 100_000);
    const downloadRequest = seen.find(
      (request) => request.range === "bytes=100000-199999",
    );
    assert.ok(downloadRequest, "No ranged download request was observed.");
    assert.equal(downloadRequest?.headers["x-api-key"], API_KEY);
    assert.equal(downloadRequest?.headers["referer"], "https://example.com/watch");

    console.log(
      [
        "",
        "  CDP cURL import test passed",
        "  imported 2 headers + Range + If-Range",
        "  remote preview carried private headers and returned 206",
        `  saved ${(file.size / 1000).toFixed(0)} KB segment`,
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
  console.error("\n  CDP cURL import test failed\n", error);
  process.exitCode = 1;
});
