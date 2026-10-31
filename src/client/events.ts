import { api } from "./api";
import {
  applyFilter,
  handleDeleted as removeJobFromLibrary,
  syncCards,
  upsertCard,
} from "./cards";
import { updateDetail } from "./detail";
import { applySettings, els, state, toast, updateConnection } from "./dom";
import type { AppSettings, Job, Snapshot } from "./types";

export function applySnapshot(data: Snapshot, notifyTransitions: boolean): void {
  const previous = new Map(state.jobs);
  state.offline = false;
  state.loaded = true;
  els.loadingState.hidden = true;
  updateConnection(true);
  applySettings(data.settings);

  if (notifyTransitions) {
    for (const job of data.jobs) {
      const old = previous.get(job.id);
      if (!old) continue;
      if (old.status !== "completed" && job.status === "completed") {
        announceCompletion(job);
      } else if (old.status !== "error" && job.status === "error") {
        announceFailure(job);
      }
    }
  }

  state.jobs = new Map(data.jobs.map((job) => [job.id, job]));
  syncCards();
  applyFilter();

  if (state.detailId) {
    const job = state.jobs.get(state.detailId);
    if (job) updateDetail(job);
  }
}

export function handleJob(job: Job, notify = true): void {
  const old = state.jobs.get(job.id);
  if (notify && old) {
    if (old.status !== "completed" && job.status === "completed") {
      announceCompletion(job);
    } else if (old.status !== "error" && job.status === "error") {
      announceFailure(job);
    }
  }
  upsertCard(job);

  if (state.detailId === job.id) updateDetail(job);
}

export function announceCompletion(job: Job): void {
  toast("Download complete", job.fileName, "success");
  if (
    state.notifications &&
    document.hidden &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      const notification = new Notification("Download complete", {
        body: job.fileName,
        icon: "/favicon.ico",
        tag: job.id,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      /* notifications can fail silently in some environments */
    }
  }
}

export function announceFailure(job: Job): void {
  toast("Download failed", job.error ?? job.fileName, "error");
}

export async function refreshSnapshot(): Promise<void> {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    const data = await api<Snapshot>("/api/downloads");
    applySnapshot(data, true);
  } catch {
    updateConnection(false);
  } finally {
    state.refreshInFlight = false;
  }
}

export function connectEvents(): void {
  state.eventSource?.close();
  const source = new EventSource("/api/events");
  state.eventSource = source;

  source.addEventListener("open", () => {
    state.offline = false;
    updateConnection(true);
  });

  source.addEventListener("snapshot", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as Snapshot;
      applySnapshot(data, state.loaded);
    } catch {
      /* ignore malformed event */
    }
  });

  source.addEventListener("job", (event) => {
    try {
      handleJob(JSON.parse((event as MessageEvent<string>).data) as Job);
    } catch {
      /* ignore malformed event */
    }
  });

  source.addEventListener("deleted", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { id: string };
      if (data.id) handleDeleted(data.id);
    } catch {
      /* ignore malformed event */
    }
  });

  source.addEventListener("settings", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        settings: AppSettings;
      };
      applySettings(data.settings);
    } catch {
      /* ignore malformed event */
    }
  });

  source.addEventListener("refresh", () => {
    void refreshSnapshot();
  });

  source.addEventListener("error", () => {
    updateConnection(false);
  });
}

export function handleDeleted(id: string): void {
  removeJobFromLibrary(id);
}
