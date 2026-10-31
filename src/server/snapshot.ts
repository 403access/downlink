import type { PublicJob } from "../types";
import { engine } from "./context";

export function summarize(jobs: PublicJob[]) {
  let speedBps = 0;
  let bytesOnDisk = 0;
  let completedBytes = 0;
  let downloading = 0;
  let queued = 0;
  let completed = 0;
  let paused = 0;
  let failed = 0;
  let canceled = 0;

  for (const job of jobs) {
    speedBps += job.speedBps;
    bytesOnDisk += job.downloadedBytes;
    if (job.status === "downloading") downloading += 1;
    if (job.status === "queued") queued += 1;
    if (job.status === "completed") {
      completed += 1;
      completedBytes += job.totalBytes || job.downloadedBytes;
    }
    if (job.status === "paused") paused += 1;
    if (job.status === "error") failed += 1;
    if (job.status === "canceled") canceled += 1;
  }

  return {
    total: jobs.length,
    active: downloading + queued,
    downloading,
    queued,
    completed,
    paused,
    failed,
    canceled,
    speedBps,
    bytesOnDisk,
    completedBytes,
    downloadDir: engine.getSettings().downloadDir,
  };
}

export function snapshot() {
  const jobs = engine.listPublicJobs();
  return { jobs, summary: summarize(jobs), settings: engine.getSettings() };
}
