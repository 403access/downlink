import { handleActionClick } from "./actions";
import { api } from "./api";
import { applyFilter, setFilter, updateEmptyState } from "./cards";
import {
  handleAddSubmit,
  importCurlCommand,
  pasteFromClipboard,
  setBatchMode,
  setRangeMode,
  updateRangePreview,
} from "./composer";
import {
  clearImportedHeaders,
  looksLikeCurl,
  openCurlDialog,
  updateCurlPreview,
} from "./curl-preview";
import { bindDetailEvents } from "./detail";
import {
  clearFormError,
  closeDialog,
  els,
  state,
  updateConnection,
} from "./dom";
import { applySnapshot, connectEvents } from "./events";
import { addInspectedUrl, bindInspectEvents, inspectCurrentUrl } from "./inspect";
import {
  clearCompleted,
  clearHistory,
  openFolder,
  openSettings,
  pauseAll,
  resumeAll,
  saveSettings,
} from "./settings";
import { applyTheme, initTheme } from "./theme";
import type { Filter, Snapshot } from "./types";

function bindEvents(): void {
  els.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleAddSubmit();
  });

  els.batchToggle.addEventListener("click", () => {
    setBatchMode(!state.batchMode);
  });

  els.rangeToggle.addEventListener("click", () => {
    setRangeMode(!state.rangeMode);
  });

  for (const input of [
    els.rangeStartInput,
    els.rangeEndInput,
    els.rangeIfInput,
  ]) {
    input.addEventListener("input", updateRangePreview);
  }

  els.pasteBtn.addEventListener("click", () => void pasteFromClipboard());
  els.curlToggle.addEventListener("click", () => openCurlDialog());
  els.curlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    importCurlCommand();
  });
  els.curlInput.addEventListener("input", () => updateCurlPreview());
  els.curlInput.addEventListener("paste", () => {
    window.setTimeout(() => updateCurlPreview(true), 0);
  });
  els.clearHeadersBtn.addEventListener("click", () => clearImportedHeaders());
  els.inspectBtn.addEventListener("click", () => void inspectCurrentUrl());
  els.inspectAddBtn.addEventListener("click", () => void addInspectedUrl());
  els.openFolderBtn.addEventListener("click", () => void openFolder());

  els.urlInput.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!looksLikeCurl(text)) return;
    event.preventDefault();
    openCurlDialog(text);
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim();
    applyFilter();
  });

  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter as Filter | undefined;
      if (filter) setFilter(filter);
    });
  });

  els.grid.addEventListener("click", handleActionClick);
  els.detailActions.addEventListener("click", handleActionClick);

  els.pauseAllBtn.addEventListener("click", () => void pauseAll());
  els.resumeAllBtn.addEventListener("click", () => void resumeAll());
  els.clearCompletedBtn.addEventListener("click", () => void clearCompleted());
  els.clearHistoryBtn.addEventListener("click", () => void clearHistory());

  for (const button of [els.settingsBtn, els.settingsBtnTop]) {
    button.addEventListener("click", openSettings);
  }

  els.themeBtn.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
  });

  els.themeBtnTop.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
  });

  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings();
  });

  for (const element of document.querySelectorAll<HTMLElement>("[data-close]")) {
    element.addEventListener("click", () => {
      const id = element.dataset.close;
      if (!id) return;
      const dialog = document.getElementById(id) as HTMLDialogElement | null;
      if (dialog) closeDialog(dialog);
    });
  }

  for (const dialog of [
    els.detailDialog,
    els.inspectDialog,
    els.settingsDialog,
    els.curlDialog,
    els.confirmDialog,
  ]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }

  els.confirmDialog.addEventListener("close", () => {
    const resolve = state.confirmResolve;
    state.confirmResolve = null;
    resolve?.(els.confirmDialog.returnValue === "confirm");
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT" ||
      target?.isContentEditable;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
      return;
    }
    if (typing) return;
    if (event.key === "/") {
      event.preventDefault();
      els.searchInput.focus();
      return;
    }
    if (event.key.toLowerCase() === "n" && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      (state.batchMode ? els.batchInput : els.urlInput).focus();
    }
  });

  document.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer) return;
    const hasText =
      event.dataTransfer.types.includes("text/uri-list") ||
      event.dataTransfer.types.includes("text/plain");
    if (!hasText) return;
    event.preventDefault();
    state.dragDepth += 1;
    els.dropOverlay.hidden = false;
  });

  document.addEventListener("dragover", (event) => {
    if (els.dropOverlay.hidden) return;
    event.preventDefault();
  });

  document.addEventListener("dragleave", () => {
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) els.dropOverlay.hidden = true;
  });

  document.addEventListener("drop", (event) => {
    if (els.dropOverlay.hidden) return;
    event.preventDefault();
    state.dragDepth = 0;
    els.dropOverlay.hidden = true;
    const text =
      event.dataTransfer?.getData("text/uri-list") ||
      event.dataTransfer?.getData("text/plain") ||
      "";
    if (looksLikeCurl(text)) {
      openCurlDialog(text);
      return;
    }
    const url = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (!url) return;
    if (state.batchMode) setBatchMode(false);
    els.urlInput.value = url;
    clearFormError();
    void inspectCurrentUrl();
  });
}

async function loadInitial(): Promise<void> {
  try {
    const data = await api<Snapshot>("/api/downloads");
    applySnapshot(data, false);
  } catch {
    state.offline = true;
    state.loaded = true;
    els.loadingState.hidden = true;
    updateConnection(false);
    updateEmptyState(0);
  } finally {
    connectEvents();
  }
}

function init(): void {
  initTheme();
  bindDetailEvents();
  bindInspectEvents();
  bindEvents();
  void loadInitial();
}

init();
