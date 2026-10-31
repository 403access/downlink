import { open, type FileHandle } from "node:fs/promises";

const DEFAULT_CHUNK_SIZE = 256 * 1024;
const DEFAULT_POLL_MS = 120;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export interface GrowingFileOptions {
  /** Maximum number of bytes to enqueue per pull. */
  chunkSize?: number;
  /** How often to check the file for new bytes. */
  pollMs?: number;
  /** Stop waiting when no new bytes have arrived for this long. */
  idleTimeoutMs?: number;
  /** Aborted when the client disconnects. */
  signal?: AbortSignal;
  /** Whether the writer may still append more bytes. */
  isLive?: () => boolean;
  /** Try this path if `path` disappears (for example after a `.part` rename). */
  fallbackPath?: string;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Stream a file that is still being written. The stream reads up to `end`,
 * waiting for the writer to append more bytes instead of reporting EOF as soon
 * as the current end of the file is reached.
 *
 * This lets a browser play a `.part` file sequentially while the download is
 * still in progress: the player's socket stays open and receives each new
 * chunk as it lands on disk.
 */
export function growingFileStream(
  path: string,
  start: number,
  end: number,
  options: GrowingFileOptions = {},
): ReadableStream<Uint8Array> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const pollMs = Math.max(10, options.pollMs ?? DEFAULT_POLL_MS);
  const idleTimeoutMs = Math.max(
    pollMs,
    options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
  );
  const signal = options.signal;
  const isLive = options.isLive ?? (() => true);

  let offset = Math.max(0, start);
  let handlePromise: Promise<FileHandle> | null = null;
  let closed = false;
  let lastGrowth = Date.now();

  const closeHandle = async (): Promise<void> => {
    if (!handlePromise) return;
    const handle = await handlePromise.catch(() => null);
    try {
      await handle?.close();
    } catch {
      /* the file may already be closed */
    }
  };

  const openHandle = async (): Promise<FileHandle> => {
    try {
      return await open(path, "r");
    } catch (error) {
      if (
        options.fallbackPath &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return open(options.fallbackPath, "r");
      }
      throw error;
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const handle = await (handlePromise ??= openHandle());
        while (!closed) {
          if (signal?.aborted || offset > end) break;

          const info = await handle.stat();
          const availableEnd = Math.min(info.size - 1, end);
          if (offset <= availableEnd) {
            const length = Math.min(availableEnd - offset + 1, chunkSize);
            const buffer = Buffer.allocUnsafe(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            if (bytesRead > 0) {
              offset += bytesRead;
              lastGrowth = Date.now();
              controller.enqueue(
                new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead),
              );
              return;
            }
          }

          // There is no new data right now. Stop when the job is finished or
          // nothing has arrived for a long time; otherwise wait for the writer.
          if (!isLive()) break;
          if (Date.now() - lastGrowth > idleTimeoutMs) break;
          await wait(pollMs, signal);
        }

        if (!closed) {
          closed = true;
          controller.close();
        }
        await closeHandle();
      } catch (error) {
        if (closed) return;
        closed = true;
        controller.error(error);
        await closeHandle();
      }
    },

    async cancel() {
      closed = true;
      await closeHandle();
    },
  });
}
