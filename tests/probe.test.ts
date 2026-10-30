import { afterAll, describe, expect, test } from "bun:test";
import { probeUrl } from "../src/probe";

const fixture = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/head-rejected.mp4") {
      if (req.method === "HEAD") {
        return new Response("head not allowed", { status: 404 });
      }
      return new Response(new Uint8Array([0]), {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/123456",
          "Content-Length": "1",
          "Accept-Ranges": "bytes",
          ETag: '"head-fallback"',
          "Content-Disposition": 'attachment; filename="head-fallback.mp4"',
        },
      });
    }
    if (url.pathname === "/page") {
      return new Response("<html><body>not a file</body></html>", {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.pathname === "/header-check.mp4") {
      if (req.headers.get("x-token") !== "secret") {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(null, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "4096",
          "Accept-Ranges": "bytes",
          ETag: '"header-check"',
        },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => {
  fixture.stop(true);
});

describe("URL probing", () => {
  test("falls back to a ranged GET when HEAD returns 404", async () => {
    const result = await probeUrl(
      `http://127.0.0.1:${fixture.port}/head-rejected.mp4`,
    );
    expect(result.status).toBe(206);
    expect(result.totalBytes).toBe(123456);
    expect(result.contentType).toBe("video/mp4");
    expect(result.supportsRanges).toBe(true);
    expect(result.etag).toBe('"head-fallback"');
    expect(result.fileName).toBe("head-fallback.mp4");
  });

  test("rejects HTML pages instead of saving them as files", async () => {
    await expect(
      probeUrl(`http://127.0.0.1:${fixture.port}/page`),
    ).rejects.toThrow("web page");
  });

  test("forwards imported headers during probing", async () => {
    const result = await probeUrl(
      `http://127.0.0.1:${fixture.port}/header-check.mp4`,
      [{ name: "X-Token", value: "secret" }],
    );
    expect(result.totalBytes).toBe(4096);
    expect(result.etag).toBe('"header-check"');
  });
});
