import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { growingFileStream } from "../src/server/stream";

const tempDirs: string[] = [];

async function tempFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "downlink-stream-"));
  tempDirs.push(dir);
  const path = join(dir, "file.part");
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("growing file stream", () => {
  test("keeps reading after the current end of the file", async () => {
    const path = await tempFile("hello");
    let live = true;
    const reader = growingFileStream(path, 0, 10, {
      chunkSize: 4,
      pollMs: 10,
      idleTimeoutMs: 2_000,
      isLive: () => live,
    }).getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe("hell");

    await appendFile(path, " world");

    let text = "hell";
    while (text.length < 11) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    expect(text).toBe("hello world");

    live = false;
    const end = await reader.read();
    expect(end.done).toBe(true);
  });

  test("stops at EOF when the writer is no longer live", async () => {
    const path = await tempFile("done");
    const response = new Response(
      growingFileStream(path, 0, 100, { isLive: () => false, pollMs: 10 }),
    );
    expect(await response.text()).toBe("done");
  });

  test("supports seeking into bytes that have already arrived", async () => {
    const path = await tempFile("0123456789");
    const response = new Response(
      growingFileStream(path, 4, 7, { isLive: () => false, pollMs: 10 }),
    );
    expect(await response.text()).toBe("4567");
  });
});
