import { describe, expect, test } from "bun:test";
import { parseCurl } from "../src/curl";
import { normalizeRequestHeaders } from "../src/headers";

const command = `curl --url 'https://example.com/media/clip.mp4?_=1' \\
  -H 'accept: */*' \\
  -H 'accept-language: de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' \\
  -H 'if-range: "6aa88fff-310fd51d"' \\
  -H 'priority: i' \\
  -H 'range: bytes=432144384-823121180' \\
  -H 'referer: https://example.com/watch' \\
  -H 'sec-ch-ua: "Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"' \\
  -H 'sec-ch-ua-mobile: ?1' \\
  -H 'sec-ch-ua-platform: "iOS"' \\
  -H 'sec-fetch-dest: video' \\
  -H 'sec-fetch-mode: no-cors' \\
  -H 'sec-fetch-site: cross-site' \\
  -H 'user-agent: Mozilla/5.0 Test Browser'`;

describe("cURL import", () => {
  test("extracts URL, Range, If-Range and headers", () => {
    const parsed = parseCurl(command);
    expect(parsed.url).toBe("https://example.com/media/clip.mp4?_=1");
    expect(parsed.range).toEqual({ start: 432144384, end: 823121180 });
    expect(parsed.ifRange).toBe('"6aa88fff-310fd51d"');
    expect(parsed.warnings).toEqual([]);

    const names = parsed.headers.map((header) => header.name.toLowerCase());
    expect(names).toContain("referer");
    expect(names).toContain("user-agent");
    expect(names).toContain("sec-ch-ua");
    expect(names).toContain("priority");
    expect(names).not.toContain("range");
    expect(names).not.toContain("if-range");

    const referer = parsed.headers.find(
      (header) => header.name.toLowerCase() === "referer",
    );
    expect(referer?.value).toBe("https://example.com/watch");
  });

  test("supports open-ended ranges and attached short options", () => {
    const parsed = parseCurl(
      `curl -H'x-token: abc' -r 900- --url https://example.com/file.bin`,
    );
    expect(parsed.range).toEqual({ start: 900, end: null });
    expect(parsed.headers).toContainEqual({ name: "x-token", value: "abc" });
  });

  test("warns for unsupported method/body instead of failing", () => {
    const parsed = parseCurl(
      `curl https://example.com/upload -X POST --data-raw 'hello'`,
    );
    expect(parsed.url).toBe("https://example.com/upload");
    expect(parsed.method).toBe("GET");
    expect(parsed.warnings.some((warning) => warning.includes("Method POST"))).toBe(true);
    expect(parsed.warnings.some((warning) => warning.includes("bodies"))).toBe(true);
  });

  test("rejects commands without a URL", () => {
    expect(() => parseCurl(`curl -H 'accept: */*'`)).toThrow("No URL");
  });
});

describe("header normalization", () => {
  test("removes managed transport headers and strips newlines", () => {
    const headers = normalizeRequestHeaders([
      { name: "Referer", value: " https://example.com/ " },
      { name: "Range", value: "bytes=0-10" },
      { name: "If-Range", value: '"etag"' },
      { name: "Accept-Encoding", value: "gzip" },
      { name: "Host", value: "evil.example" },
      { name: "X-Test", value: "one\r\nInjected: yes" },
    ]);
    expect(headers).toEqual([
      { name: "Referer", value: "https://example.com/" },
      { name: "X-Test", value: "one Injected: yes" },
    ]);
  });
});
