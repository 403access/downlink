import { constants, existsSync, mkdirSync } from "node:fs";
import { access } from "node:fs/promises";
import index from "./index.html";
import { addUrls, parsePartialRange } from "./server/add";
import {
  engine,
  HOST,
  PORT,
  STARTED_AT,
  store,
  VERSION,
} from "./server/context";
import { attachmentResponse, previewResponse } from "./server/files";
import { openInFileManager } from "./server/fs-actions";
import { normalizeRequestHeaders } from "./headers";
import { errorResponse, HttpError, jobId, json, readJson } from "./server/http";
import { makePreviewToken, remotePreviewResponse } from "./server/preview";
import { ProbeError, probeUrl } from "./probe";
import { eventStream } from "./server/sse";
import { snapshot } from "./server/snapshot";
import type { AppSettings } from "./types";
import { expandHome } from "./utils";

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,
  routes: {
    "/": index,
    "/favicon.ico": {
      GET: () =>
        new Response(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#b6f36b"/><path d="M32 14v27m0 0-10-10m10 10 10-10M18 50h28" fill="none" stroke="#101411" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" } },
        ),
    },
    "/manifest.webmanifest": {
      GET: () =>
        json(
          {
            name: "Downlink",
            short_name: "Downlink",
            description: "Local-first resumable downloader",
            start_url: "/",
            display: "standalone",
            background_color: "#0b0e0f",
            theme_color: "#b6f36b",
            icons: [],
          },
          200,
          { "Content-Type": "application/manifest+json" },
        ),
    },

    "/api/health": {
      GET: () =>
        json({
          ok: true,
          version: VERSION,
          uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
          active: engine.activeCount(),
          downloadDir: engine.getSettings().downloadDir,
        }),
    },

    "/api/downloads": {
      GET: () => json(snapshot()),
      POST: async (req) => {
        const body = await readJson(req);
        const raw: string[] = [];
        if (typeof body.url === "string") raw.push(body.url);
        if (Array.isArray(body.urls)) {
          for (const value of body.urls) {
            if (typeof value === "string") raw.push(value);
          }
        }
        if (raw.length === 0) throw new HttpError("A URL is required.", 400);
        const range = parsePartialRange(body.range);
        const headers = normalizeRequestHeaders(body.headers);
        const result = await addUrls(raw, range, headers);
        if (result.jobs.length === 0) {
          return json(
            {
              error: result.errors[0]?.error ?? "No downloads could be added.",
              errors: result.errors,
            },
            422,
          );
        }
        return json(result, 201);
      },
    },

    "/api/downloads/:id": {
      GET: (req) => {
        const job = engine.getPublicJob(jobId(req));
        if (!job) return json({ error: "Download not found." }, 404);
        return json({ job });
      },
      DELETE: async (req) => {
        const id = jobId(req);
        const removeFile = new URL(req.url).searchParams.get("files") !== "false";
        const ok = await engine.remove(id, removeFile);
        if (!ok) return json({ error: "Download not found." }, 404);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/pause": {
      POST: async (req) => {
        const ok = await engine.pause(jobId(req));
        if (!ok) return json({ error: "This download cannot be paused." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/resume": {
      POST: async (req) => {
        const ok = await engine.resume(jobId(req));
        if (!ok) return json({ error: "This download cannot be resumed." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/retry": {
      POST: async (req) => {
        const ok = await engine.retry(jobId(req));
        if (!ok) return json({ error: "This download cannot be retried." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/cancel": {
      POST: async (req) => {
        const ok = await engine.cancel(jobId(req));
        if (!ok) return json({ error: "This download cannot be canceled." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/reveal": {
      POST: async (req) => {
        const job = store.getDownload(jobId(req));
        if (!job) return json({ error: "Download not found." }, 404);
        const target = existsSync(job.file_path) ? job.file_path : engine.getSettings().downloadDir;
        return openInFileManager(target, existsSync(job.file_path));
      },
    },

    "/api/downloads/:id/preview": {
      GET: (req) => previewResponse(req),
      HEAD: (req) => previewResponse(req),
    },

    "/api/preview/:id": {
      GET: (req) => previewResponse(req),
      HEAD: (req) => previewResponse(req),
    },

    "/api/files/:id": {
      GET: (req) => attachmentResponse(req),
      HEAD: (req) => attachmentResponse(req),
    },

    "/api/downloads/:id/file": {
      GET: (req) => attachmentResponse(req),
      HEAD: (req) => attachmentResponse(req),
    },

    "/api/actions/pause-all": {
      POST: async () => json({ ok: true, changed: await engine.pauseAll() }),
    },
    "/api/actions/resume-all": {
      POST: async () => json({ ok: true, changed: await engine.resumeAll() }),
    },
    "/api/actions/clear-completed": {
      POST: async () => json({ ok: true, changed: await engine.clearCompleted() }),
    },
    "/api/actions/clear-history": {
      POST: async () => json({ ok: true, changed: await engine.clearHistory() }),
    },
    "/api/actions/open-folder": {
      POST: async () =>
        openInFileManager(engine.getSettings().downloadDir, false),
    },

    "/api/inspect": {
      POST: async (req) => {
        const body = await readJson(req);
        if (typeof body.url !== "string") throw new HttpError("A URL is required.", 400);
        const headers = normalizeRequestHeaders(body.headers);
        const probe = await probeUrl(body.url, headers);
        const canPreview = ["video", "audio", "image"].includes(probe.kind);
        return json({
          probe,
          canPreview,
          previewUrl: canPreview
            ? `/api/remote-preview?token=${encodeURIComponent(
                makePreviewToken(probe.finalUrl, headers),
              )}`
            : null,
        });
      },
    },

    "/api/remote-preview": {
      GET: (req) => remotePreviewResponse(req),
      HEAD: (req) => remotePreviewResponse(req),
    },

    "/api/settings": {
      GET: () => json({ settings: engine.getSettings() }),
      PATCH: async (req) => {
        const body = await readJson(req);
        const current = engine.getSettings();
        const next: AppSettings = { ...current };

        if (body.downloadDir !== undefined) {
          if (typeof body.downloadDir !== "string" || !body.downloadDir.trim()) {
            throw new HttpError("Choose a valid download folder.", 400);
          }
          if (body.downloadDir.length > 1024) {
            throw new HttpError("That folder path is too long.", 400);
          }
          const dir = expandHome(body.downloadDir);
          try {
            mkdirSync(dir, { recursive: true });
            await access(dir, constants.W_OK);
          } catch {
            throw new HttpError("That folder is not writable.", 400);
          }
          next.downloadDir = dir;
        }

        if (body.maxConcurrent !== undefined) {
          const value = Number(body.maxConcurrent);
          if (!Number.isInteger(value) || value < 1 || value > 10) {
            throw new HttpError("Simultaneous downloads must be between 1 and 10.", 400);
          }
          next.maxConcurrent = value;
        }

        if (body.speedLimitBps !== undefined) {
          const value = Number(body.speedLimitBps);
          if (!Number.isFinite(value) || value < 0 || value > 10_000_000_000) {
            throw new HttpError("Speed limit must be zero or a positive value.", 400);
          }
          next.speedLimitBps = Math.round(value);
        }

        store.saveSettings(next);
        engine.setSettings(next);
        return json({ settings: engine.getSettings() });
      },
    },

    "/api/events": {
      GET: (req) => eventStream(req),
    },
  },

  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/")) {
      return json({ error: "API route not found." }, 404);
    }
    return new Response("Not found", { status: 404 });
  },

  error(error) {
    if (!(error instanceof ProbeError) && !(error instanceof HttpError)) {
      console.error("[downlink]", error);
    }
    return errorResponse(error);
  },
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

engine.recover();

console.log(
  `\n  Downlink ${VERSION}\n  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${server.port}\n  Saving files to ${engine.getSettings().downloadDir}\n`,
);

if (HOST === "0.0.0.0") {
  console.warn(
    "  Warning: Downlink is listening on all interfaces. Only do this on a network you trust.\n",
  );
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n  Pausing active downloads…");
  await engine.shutdown();
  server.stop(true);
  try {
    store.close();
  } catch {
    /* already closed */
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
