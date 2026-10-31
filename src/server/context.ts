import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../db";
import { DownloadEngine } from "../engine";
import type { AppSettings } from "../types";
import { expandHome } from "../utils";

export const ROOT = resolve(import.meta.dir, "../..");
export const DATA_DIR = process.env.DATA_DIR
  ? expandHome(process.env.DATA_DIR)
  : join(ROOT, "data");
export const DEFAULT_DOWNLOAD_DIR = process.env.DOWNLOAD_DIR
  ? expandHome(process.env.DOWNLOAD_DIR)
  : join(ROOT, "downloads");
export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? "127.0.0.1";
export const MAX_BATCH = 25;
export const PROBE_CONCURRENCY = 4;
export const STARTED_AT = Date.now();
export const VERSION = "1.0.0";

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });

export const store = new Store(join(DATA_DIR, "downlink.db"));
const defaults: AppSettings = {
  downloadDir: DEFAULT_DOWNLOAD_DIR,
  maxConcurrent: 3,
  speedLimitBps: 0,
};
const savedSettings = store.getSettings(defaults);
const settings: AppSettings = {
  ...savedSettings,
  downloadDir: expandHome(savedSettings.downloadDir || DEFAULT_DOWNLOAD_DIR),
};
mkdirSync(settings.downloadDir, { recursive: true });
store.saveSettings(settings);

export const engine = new DownloadEngine(store, settings);
