import type { ParsedCurl } from "../curl";
import type { RequestHeader } from "../types";
import { esc, icon } from "./format";
import type { AppSettings, Filter, Job, Probe } from "./types";

export const state = {
  jobs: new Map<string, Job>(),
  settings: {
    downloadDir: "",
    maxConcurrent: 3,
    speedLimitBps: 0,
  } as AppSettings,
  filter: "all" as Filter,
  query: "",
  detailId: null as string | null,
  detailMediaKey: "",
  detailActionsKey: "",
  inspectProbe: null as Probe | null,
  inspectPreviewUrl: null as string | null,
  inspectRequest: 0,
  cards: new Map<string, HTMLElement>(),
  thumbs: new Map<string, string>(),
  thumbPending: new Set<string>(),
  loaded: false,
  offline: false,
  adding: false,
  batchMode: false,
  rangeMode: false,
  importedHeaders: [] as RequestHeader[],
  curlPreviewValid: false,
  curlPreviewTimer: null as number | null,
  curlParsed: null as ParsedCurl | null,
  notifications: localStorage.getItem("downlink.notifications") === "true",
  confirmResolve: null as ((value: boolean) => void) | null,
  eventSource: null as EventSource | null,
  refreshInFlight: false,
  dragDepth: 0,
};

const idleMarkup = new WeakMap<HTMLElement, string>();

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export const els = {
  addForm: byId<HTMLFormElement>("addForm"),
  urlInput: byId<HTMLInputElement>("urlInput"),
  batchInput: byId<HTMLTextAreaElement>("batchInput"),
  batchToggle: byId<HTMLButtonElement>("batchToggle"),
  rangeToggle: byId<HTMLButtonElement>("rangeToggle"),
  rangePanel: byId("rangePanel"),
  rangeStartInput: byId<HTMLInputElement>("rangeStartInput"),
  rangeEndInput: byId<HTMLInputElement>("rangeEndInput"),
  rangeIfInput: byId<HTMLInputElement>("rangeIfInput"),
  rangePreview: byId("rangePreview"),
  headersPanel: byId("headersPanel"),
  headersCount: byId("headersCount"),
  headerChips: byId("headerChips"),
  clearHeadersBtn: byId<HTMLButtonElement>("clearHeadersBtn"),
  curlToggle: byId<HTMLButtonElement>("curlToggle"),
  curlDialog: byId<HTMLDialogElement>("curlDialog"),
  curlForm: byId<HTMLFormElement>("curlForm"),
  curlInput: byId<HTMLTextAreaElement>("curlInput"),
  curlError: byId("curlError"),
  curlImportBtn: byId<HTMLButtonElement>("curlImportBtn"),
  curlPreviewState: byId("curlPreviewState"),
  curlPreviewBody: byId("curlPreviewBody"),
  addBtn: byId<HTMLButtonElement>("addBtn"),
  inspectBtn: byId<HTMLButtonElement>("inspectBtn"),
  pasteBtn: byId<HTMLButtonElement>("pasteBtn"),
  addError: byId("addError"),
  searchInput: byId<HTMLInputElement>("searchInput"),
  grid: byId("downloadGrid"),
  emptyState: byId("emptyState"),
  emptyTitle: byId("emptyTitle"),
  emptyText: byId("emptyText"),
  loadingState: byId("loadingState"),
  resultCount: byId("resultCount"),
  pageTitle: byId("pageTitle"),
  pageSubtitle: byId("pageSubtitle"),
  metricActive: byId("metricActive"),
  metricActiveFoot: byId("metricActiveFoot"),
  metricSpeed: byId("metricSpeed"),
  metricCompleted: byId("metricCompleted"),
  metricCompletedFoot: byId("metricCompletedFoot"),
  metricDisk: byId("metricDisk"),
  metricDiskFoot: byId("metricDiskFoot"),
  folderPath: byId("folderPath"),
  openFolderBtn: byId("openFolderBtn"),
  pauseAllBtn: byId("pauseAllBtn"),
  resumeAllBtn: byId("resumeAllBtn"),
  clearCompletedBtn: byId("clearCompletedBtn"),
  settingsBtn: byId("settingsBtn"),
  settingsBtnTop: byId("settingsBtnTop"),
  themeBtn: byId("themeBtn"),
  themeBtnTop: byId("themeBtnTop"),
  themeIcon: document.querySelector<SVGUseElement>("#themeIcon use"),
  themeIconTop: document.querySelector<SVGUseElement>("#themeIconTop use"),
  connDot: byId("connDot"),
  connText: byId("connText"),
  detailDialog: byId<HTMLDialogElement>("detailDialog"),
  detailKind: byId("detailKind"),
  detailRangeBadge: byId("detailRangeBadge"),
  detailStatusText: byId("detailStatusText"),
  detailTitle: byId("detailTitle"),
  detailHost: byId("detailHost"),
  detailVideo: byId<HTMLVideoElement>("detailVideo"),
  detailAudio: byId<HTMLAudioElement>("detailAudio"),
  detailImage: byId<HTMLImageElement>("detailImage"),
  detailPlaceholder: byId("detailPlaceholder"),
  detailPlayerBadge: byId("detailPlayerBadge"),
  detailPreviewNote: byId("detailPreviewNote"),
  detailError: byId("detailError"),
  detailPercent: byId("detailPercent"),
  detailBytes: byId("detailBytes"),
  detailProgress: byId("detailProgress"),
  detailProgressFill: byId("detailProgressFill"),
  detailSpeed: byId("detailSpeed"),
  detailEta: byId("detailEta"),
  detailMeta: byId("detailMeta"),
  detailActions: byId("detailActions"),
  inspectDialog: byId<HTMLDialogElement>("inspectDialog"),
  inspectKind: byId("inspectKind"),
  inspectTitle: byId("inspectTitle"),
  inspectHost: byId("inspectHost"),
  inspectVideo: byId<HTMLVideoElement>("inspectVideo"),
  inspectAudio: byId<HTMLAudioElement>("inspectAudio"),
  inspectImage: byId<HTMLImageElement>("inspectImage"),
  inspectLoading: byId("inspectLoading"),
  inspectPlaceholder: byId("inspectPlaceholder"),
  inspectFacts: byId("inspectFacts"),
  inspectUrl: byId("inspectUrl"),
  inspectError: byId("inspectError"),
  inspectAddBtn: byId<HTMLButtonElement>("inspectAddBtn"),
  settingsDialog: byId<HTMLDialogElement>("settingsDialog"),
  settingsForm: byId<HTMLFormElement>("settingsForm"),
  settingsError: byId("settingsError"),
  settingsSave: byId<HTMLButtonElement>("settingsSave"),
  downloadDirInput: byId<HTMLInputElement>("downloadDirInput"),
  maxConcurrentInput: byId<HTMLInputElement>("maxConcurrentInput"),
  speedLimitInput: byId<HTMLInputElement>("speedLimitInput"),
  notificationsInput: byId<HTMLInputElement>("notificationsInput"),
  clearHistoryBtn: byId<HTMLButtonElement>("clearHistoryBtn"),
  confirmDialog: byId<HTMLDialogElement>("confirmDialog"),
  confirmTitle: byId("confirmTitle"),
  confirmText: byId("confirmText"),
  confirmYes: byId<HTMLButtonElement>("confirmYes"),
  toastContainer: byId("toastContainer"),
  dropOverlay: byId("dropOverlay"),
};

export function setBusy(
  button: HTMLButtonElement,
  busy: boolean,
  label = "Working…",
): void {
  if (busy) {
    if (!idleMarkup.has(button)) idleMarkup.set(button, button.innerHTML);
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    const markup = idleMarkup.get(button);
    if (markup) button.innerHTML = markup;
  }
}

export function showFormError(message: string): void {
  els.addError.textContent = message;
  els.addError.hidden = false;
}

export function clearFormError(): void {
  els.addError.hidden = true;
  els.addError.textContent = "";
}

export function toast(
  title: string,
  message = "",
  type: "success" | "error" | "info" = "info",
): void {
  const element = document.createElement("div");
  const toastIcon =
    type === "success" ? "check" : type === "error" ? "alert" : "spark";
  element.className = `toast ${type}`;
  element.setAttribute("role", "status");
  element.innerHTML = `
    <span class="toast-icon">${icon(toastIcon)}</span>
    <span class="toast-copy">
      <strong>${esc(title)}</strong>
      ${message ? `<span>${esc(message)}</span>` : ""}
    </span>
  `;
  els.toastContainer.append(element);
  while (els.toastContainer.children.length > 4) {
    els.toastContainer.firstElementChild?.remove();
  }
  window.setTimeout(() => {
    element.classList.add("is-out");
    window.setTimeout(() => element.remove(), 220);
  }, 4_200);
}

export function updateConnection(online: boolean): void {
  const connection = els.connDot.closest(".connection");
  connection?.classList.toggle("is-online", online);
  connection?.classList.toggle("is-offline", !online);
  els.connText.textContent = online ? "Live" : "Reconnecting…";
}

export function applySettings(settings: AppSettings): void {
  state.settings = settings;
  els.folderPath.textContent = settings.downloadDir;
  els.folderPath.title = settings.downloadDir;
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}
