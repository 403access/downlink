import { askConfirm } from "./actions";
import { api } from "./api";
import {
  applySettings,
  closeDialog,
  els,
  setBusy,
  state,
  toast,
} from "./dom";
import { refreshSnapshot } from "./events";
import type { AppSettings } from "./types";

export function openSettings(): void {
  els.settingsError.hidden = true;
  els.settingsError.textContent = "";
  els.downloadDirInput.value = state.settings.downloadDir;
  els.maxConcurrentInput.value = String(state.settings.maxConcurrent);
  els.speedLimitInput.value = String(
    Math.round((state.settings.speedLimitBps / 1_000_000) * 10) / 10,
  );
  els.notificationsInput.checked = state.notifications;
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

export async function saveSettings(): Promise<void> {
  els.settingsError.hidden = true;
  const speedMb = Number.parseFloat(els.speedLimitInput.value || "0");
  if (!Number.isFinite(speedMb) || speedMb < 0) {
    els.settingsError.textContent = "Enter a valid speed limit.";
    els.settingsError.hidden = false;
    return;
  }

  let notifications = els.notificationsInput.checked;
  if (notifications && "Notification" in window && Notification.permission !== "granted") {
    try {
      const permission = await Notification.requestPermission();
      notifications = permission === "granted";
    } catch {
      notifications = false;
    }
  }
  if (!notifications) els.notificationsInput.checked = false;
  state.notifications = notifications;
  localStorage.setItem("downlink.notifications", String(notifications));

  setBusy(els.settingsSave, true, "Saving…");
  try {
    const payload = {
      downloadDir: els.downloadDirInput.value.trim(),
      maxConcurrent: Number(els.maxConcurrentInput.value),
      speedLimitBps: Math.round(speedMb * 1_000_000),
    };
    const result = await api<{ settings: AppSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    applySettings(result.settings);
    closeDialog(els.settingsDialog);
    toast("Settings saved", "", "success");
  } catch (error) {
    els.settingsError.textContent =
      error instanceof Error ? error.message : "Could not save settings.";
    els.settingsError.hidden = false;
  } finally {
    setBusy(els.settingsSave, false);
  }
}
export async function pauseAll(): Promise<void> {
  try {
    const result = await api<{ changed: number }>("/api/actions/pause-all", {
      method: "POST",
    });
    toast(
      result.changed > 0 ? "Paused all downloads" : "Nothing to pause",
      result.changed > 0 ? `${result.changed} file${result.changed === 1 ? "" : "s"} paused.` : "",
      "info",
    );
  } catch (error) {
    toast("Could not pause", error instanceof Error ? error.message : "", "error");
  }
}

export async function resumeAll(): Promise<void> {
  try {
    const result = await api<{ changed: number }>("/api/actions/resume-all", {
      method: "POST",
    });
    toast(
      result.changed > 0 ? "Resumed downloads" : "Nothing to resume",
      result.changed > 0 ? `${result.changed} file${result.changed === 1 ? "" : "s"} queued.` : "",
      "success",
    );
  } catch (error) {
    toast("Could not resume", error instanceof Error ? error.message : "", "error");
  }
}

export async function clearCompleted(): Promise<void> {
  const count = [...state.jobs.values()].filter(
    (job) => job.status === "completed",
  ).length;
  if (count === 0) {
    toast("No completed downloads to clear", "", "info");
    return;
  }
  const ok = await askConfirm({
    title: "Clear completed downloads?",
    message:
      "This removes completed entries from the library. The downloaded files stay on disk.",
    confirmLabel: "Clear entries",
    danger: false,
  });
  if (!ok) return;
  try {
    const result = await api<{ changed: number }>("/api/actions/clear-completed", {
      method: "POST",
    });
    toast(
      "Library cleared",
      `${result.changed} completed entr${result.changed === 1 ? "y" : "ies"} removed.`,
      "success",
    );
    await refreshSnapshot();
  } catch (error) {
    toast("Could not clear", error instanceof Error ? error.message : "", "error");
  }
}

export async function clearHistory(): Promise<void> {
  const ok = await askConfirm({
    title: "Clear failed downloads?",
    message:
      "Failed and canceled entries are removed from the library. Any partial files are deleted.",
    confirmLabel: "Clear failed",
    danger: true,
  });
  if (!ok) return;
  try {
    const result = await api<{ changed: number }>("/api/actions/clear-history", {
      method: "POST",
    });
    toast(
      "History cleared",
      `${result.changed} entr${result.changed === 1 ? "y" : "ies"} removed.`,
      "success",
    );
    await refreshSnapshot();
  } catch (error) {
    toast("Could not clear", error instanceof Error ? error.message : "", "error");
  }
}

export async function openFolder(): Promise<void> {
  try {
    await api("/api/actions/open-folder", { method: "POST" });
    toast("Opened download folder", "", "success");
  } catch (error) {
    toast(
      "Could not open folder",
      error instanceof Error ? error.message : "",
      "error",
    );
  }
}
