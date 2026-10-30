import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dir, "../..");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));

export function projectRoot(): string {
  return ROOT;
}

export async function findChrome(): Promise<string> {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "Chrome/Chromium was not found. Set CHROME_PATH to the browser executable.",
  );
}

export async function getFreePort(): Promise<number> {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = server.port;
  if (port == null) throw new Error("Bun did not assign a free port.");
  server.stop(true);
  await Bun.sleep(30);
  return port;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms.`);
    }
    await Bun.sleep(intervalMs);
  }
}

export interface LaunchOptions {
  width?: number;
  height?: number;
  port?: number;
  userDataDir?: string;
}

export class CDPClient {
  private readonly socket: WebSocket;
  private messageId = 0;
  private readonly pending = new Map<number, (value: any) => void>();
  private readonly waiters = new Map<string, Set<() => void>>();
  readonly errors: string[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data));
      if (data.method) {
        if (data.method === "Runtime.exceptionThrown") {
          this.errors.push(
            data.params?.exceptionDetails?.exception?.description ??
              data.params?.exceptionDetails?.text ??
              "Runtime exception",
          );
        }
        if (
          data.method === "Runtime.consoleAPICalled" &&
          data.params?.type === "error"
        ) {
          this.errors.push(
            (data.params.args ?? [])
              .map((arg: { value?: unknown; description?: string }) =>
                String(arg.value ?? arg.description ?? ""),
              )
              .join(" "),
          );
        }
        if (data.method === "Log.entryAdded" && data.params?.entry?.level === "error") {
          this.errors.push(String(data.params.entry.text ?? "Log error"));
        }
        const listeners = this.waiters.get(data.method);
        if (listeners) {
          this.waiters.delete(data.method);
          for (const listener of listeners) listener();
        }
      }
      if (data.id != null && this.pending.has(data.id)) {
        this.pending.get(data.id)?.(data.result ?? data.error);
        this.pending.delete(data.id);
      }
    });
  }

  static async connect(webSocketUrl: string): Promise<CDPClient> {
    const socket = new WebSocket(webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP socket failed")), {
        once: true,
      });
    });
    return new CDPClient(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const requestId = ++this.messageId;
    this.socket.send(JSON.stringify({ id: requestId, method, params }));
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  waitForEvent(method: string, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const wrapped = () => {
        clearTimeout(timer);
        resolve();
      };
      const listeners = this.waiters.get(method) ?? new Set<() => void>();
      listeners.add(wrapped);
      this.waiters.set(method, listeners);
    });
  }

  async enable(): Promise<void> {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
  }

  async navigate(url: string): Promise<void> {
    await this.enable();
    const loaded = this.waitForEvent("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Runtime.evaluate failed",
      );
    }
    return result?.result?.value as T;
  }

  async waitForFunction(expression: string, timeoutMs = 15_000): Promise<void> {
    await waitFor(
      () => this.evaluate<boolean>(`Boolean(${expression})`),
      timeoutMs,
      80,
    );
  }

  async screenshot(path: string): Promise<void> {
    await mkdir(resolve(path, ".."), { recursive: true });
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await Bun.write(path, Buffer.from(shot.data, "base64"));
  }

  async setDeviceMetrics(
    width: number,
    height: number,
    mobile = false,
    deviceScaleFactor = 1,
  ): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      mobile,
      deviceScaleFactor,
    });
  }

  async click(selector: string): Promise<void> {
    const clicked = await this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Could not click ${selector}`);
  }

  close(): void {
    this.socket.close();
  }
}

export interface BrowserSession {
  client: CDPClient;
  process: Bun.Subprocess;
  userDataDir: string;
  close: () => Promise<void>;
}

export async function launchChrome(options: LaunchOptions = {}): Promise<BrowserSession> {
  const chrome = await findChrome();
  const port = options.port ?? (await getFreePort());
  const userDataDir =
    options.userDataDir ??
    (await mkdtemp(join(tmpdir(), "downlink-chrome-")));

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${options.width ?? 1440},${options.height ?? 1000}`,
    "about:blank",
  ];
  if (process.env.CHROME_NO_SANDBOX === "1") args.splice(1, 0, "--no-sandbox");

  const browserProcess = Bun.spawn([chrome, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });

  let target: { webSocketDebuggerUrl: string } | null = null;
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (!response.ok) return false;
      const targets = (await response.json()) as Array<{
        type: string;
        webSocketDebuggerUrl: string;
      }>;
      target = targets.find((item) => item.type === "page") ?? null;
      return Boolean(target?.webSocketDebuggerUrl);
    } catch {
      return false;
    }
  }, 15_000, 100);

  const client = await CDPClient.connect(target!.webSocketDebuggerUrl);

  return {
    client,
    process: browserProcess,
    userDataDir,
    async close() {
      client.close();
      browserProcess.kill();
      await Promise.race([browserProcess.exited, Bun.sleep(2_000)]);
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}
