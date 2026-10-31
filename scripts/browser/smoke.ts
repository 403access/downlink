/**
 * Lightweight browser smoke/visual check against an already-running server.
 *
 *   APP_URL=http://127.0.0.1:3123 bun run test:browser
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchChrome, projectRoot } from "./cdp";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3123";
const artifactsDir = join(projectRoot(), "artifacts");

const health = await fetch(new URL("/api/health", appUrl)).catch(() => null);
if (!health?.ok) {
  throw new Error(
    `Downlink is not reachable at ${appUrl}. Start it first, or set APP_URL.`,
  );
}

const browser = await launchChrome({ width: 1440, height: 1000 });
try {
  await browser.client.navigate(appUrl);
  await browser.client.waitForFunction(
    "document.querySelector('#loadingState')?.hidden",
    15_000,
  );
  await Bun.sleep(700);

  assert.equal(
    await browser.client.evaluate("document.documentElement.dataset.theme"),
    "dark",
  );
  assert.ok(
    (await browser.client.evaluate<number>("document.body.scrollWidth")) <=
      (await browser.client.evaluate<number>("innerWidth")),
    "Desktop layout has horizontal overflow.",
  );

  await mkdir(artifactsDir, { recursive: true });
  await browser.client.screenshot(join(artifactsDir, "smoke-desktop.png"));

  const hasCard = await browser.client.evaluate<boolean>(
    "Boolean(document.querySelector('.download-card'))",
  );
  if (hasCard) {
    await browser.client.click(".download-card");
    await Bun.sleep(600);
    await browser.client.screenshot(join(artifactsDir, "smoke-detail.png"));
    await browser.client.evaluate("document.querySelector('#detailDialog')?.close()");
  }

  await browser.client.click("#rangeToggle");
  assert.equal(
    await browser.client.evaluate<boolean>(
      "document.querySelector('#rangePanel').hidden",
    ),
    false,
  );
  await browser.client.evaluate(`
    document.querySelector('#rangeStartInput').value = '1234';
    document.querySelector('#rangeEndInput').value = '5678';
    document.querySelector('#rangeEndInput').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.equal(
    await browser.client.evaluate(
      "document.querySelector('#rangePreview').textContent",
    ),
    "bytes=1234-5678",
  );
  await browser.client.click("#rangeToggle");
  assert.equal(
    await browser.client.evaluate<boolean>(
      "document.querySelector('#rangePanel').hidden",
    ),
    true,
  );

  const curlCommand = [
    "curl --url 'https://example.com/video.mp4?x=1' \\",
    "  -H 'referer: https://example.com/' \\",
    "  -H 'range: bytes=1000-' \\",
    '  -H \'if-range: "etag-test"\' \\',
    "  -H 'user-agent: Smoke Test'",
  ].join("\n");
  await browser.client.evaluate(`
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(curlCommand)});
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
    await browser.client.evaluate("document.querySelector('#curlInput').value"),
    curlCommand,
  );
  assert.equal(
    await browser.client.evaluate("document.querySelector('#curlPreviewState').textContent"),
    "Ready",
  );
  assert.ok(
    (
      await browser.client.evaluate<string>(
        "document.querySelector('#curlPreviewBody').textContent",
      )
    ).includes("bytes=1000-"),
  );
  assert.equal(
    await browser.client.evaluate<boolean>(
      "document.querySelector('#curlImportBtn').disabled",
    ),
    false,
  );

  const editedCurl = curlCommand.replace("Smoke Test", "Live Edit");
  await browser.client.evaluate(`
    const input = document.querySelector('#curlInput');
    input.value = ${JSON.stringify(editedCurl)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await Bun.sleep(250);
  assert.ok(
    (
      await browser.client.evaluate<string>(
        "document.querySelector('#curlPreviewBody').textContent",
      )
    ).includes("Live Edit"),
  );
  assert.equal(
    await browser.client.evaluate("document.querySelector('#curlPreviewState').textContent"),
    "Ready",
  );

  await browser.client.click("#curlImportBtn");
  await Bun.sleep(250);
  assert.equal(
    await browser.client.evaluate<boolean>("document.querySelector('#curlDialog').open"),
    false,
  );
  assert.equal(
    await browser.client.evaluate("document.querySelector('#urlInput').value"),
    "https://example.com/video.mp4?x=1",
  );
  assert.equal(
    await browser.client.evaluate<boolean>("document.querySelector('#rangePanel').hidden"),
    false,
  );
  assert.equal(
    await browser.client.evaluate("document.querySelector('#rangeStartInput').value"),
    "1000",
  );
  assert.equal(
    await browser.client.evaluate("document.querySelector('#headersCount').textContent"),
    "2",
  );
  assert.equal(
    await browser.client.evaluate("document.querySelector('#rangeIfInput').value"),
    '"etag-test"',
  );
  await browser.client.click("#clearHeadersBtn");
  assert.equal(
    await browser.client.evaluate<boolean>("document.querySelector('#headersPanel').hidden"),
    true,
  );
  await browser.client.click("#rangeToggle");
  await browser.client.evaluate(`
    document.querySelector('#urlInput').value = '';
  `);

  await browser.client.click("#themeBtn");
  await Bun.sleep(400);
  assert.equal(
    await browser.client.evaluate("document.documentElement.dataset.theme"),
    "light",
  );
  await browser.client.screenshot(join(artifactsDir, "smoke-light.png"));

  await browser.client.setDeviceMetrics(390, 844, true, 2);
  await browser.client.evaluate("window.dispatchEvent(new Event('resize'))");
  await Bun.sleep(400);
  assert.equal(
    await browser.client.evaluate(
      "getComputedStyle(document.querySelector('.sidebar')).display",
    ),
    "none",
  );
  assert.ok(
    (await browser.client.evaluate<number>("document.body.scrollWidth")) <= 390,
    "Mobile layout has horizontal overflow.",
  );
  assert.equal(
    await browser.client.evaluate<boolean>("Boolean(document.querySelector('#themeBtnTop'))"),
    true,
  );
  await browser.client.screenshot(join(artifactsDir, "smoke-mobile.png"));

  if (browser.client.errors.length > 0) {
    throw new Error(
      `Browser console errors:\n${browser.client.errors.join("\n")}`,
    );
  }

  console.log(
    [
      "",
      "  CDP browser smoke test passed",
      `  app: ${appUrl}`,
      `  screenshots: ${artifactsDir}`,
      "",
    ].join("\n"),
  );
} finally {
  await browser.close();
}
