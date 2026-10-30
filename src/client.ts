type JobStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "canceled";

type FileKind = "video" | "audio" | "image" | "archive" | "document" | "other";
type Filter = "all" | "active" | "completed" | "paused" | "failed";

interface Job {
  id: string;
  url: string;
  finalUrl: string | null;
  fileName: string;
  filePath: string;
  contentType: string;
  kind: FileKind;
  totalBytes: number;
  downloadedBytes: number;
  etag: string | null;
  lastModified: string | null;
  supportsRanges: boolean;
  status: JobStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  attempts: number;
  speedBps: number;
  etaSeconds: number | null;
  progress: number | null;
  host: string;
  canPreview: boolean;
  fileExists: boolean;
}

interface AppSettings {
  downloadDir: string;
  maxConcurrent: number;
  speedLimitBps: number;
}

interface Summary {
  total: number;
  active: number;
  downloading: number;
  queued: number;
  completed: number;
  paused: number;
  failed: number;
  canceled: number;
  speedBps: number;
  bytesOnDisk: number;
  completedBytes: number;
  downloadDir: string;
}

interface Snapshot {
  jobs: Job[];
  summary: Summary;
  settings: AppSettings;
}

interface Probe {
  url: string;
  finalUrl: string;
  fileName: string;
  contentType: string;
  kind: FileKind;
  totalBytes: number;
  supportsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  status: number;
}

interface InspectResult {
  probe: Probe;
  canPreview: boolean;
  previewUrl: string | null;
}

interface ApiErrorBody {
  error?: string;
  errors?: Array<{ url: string; error: string }>;
}

const state = {
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
  notifications:
    localStorage.getItem("downlink.notifications") === "true",
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

const els = {
  addForm: byId<HTMLFormElement>("addForm"),
  urlInput: byId<HTMLInputElement>("urlInput"),
  batchInput: byId<HTMLTextAreaElement>("batchInput"),
  batchToggle: byId<HTMLButtonElement>("batchToggle"),
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

// ---------------------------------------------------------------------------
// Formatting and small helpers
// ---------------------------------------------------------------------------

function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function icon(name: string, className = ""): string {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function formatBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fullDate(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function statusLabel(status: JobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "error":
      return "Needs attention";
    case "canceled":
      return "Canceled";
  }
}

function kindLabel(kind: FileKind): string {
  return kind === "other" ? "file" : kind;
}

function kindIcon(kind: FileKind): string {
  switch (kind) {
    case "video":
      return "video";
    case "audio":
      return "music";
    case "image":
      return "image";
    case "archive":
      return "archive";
    case "document":
      return "file";
    default:
      return "file";
  }
}

function canPreviewNow(job: Job): boolean {
  return job.canPreview && job.fileExists;
}

function isActiveStatus(status: JobStatus): boolean {
  return status === "downloading" || status === "queued";
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body = data as ApiErrorBody | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return data as T;
}

function setBusy(
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

function showFormError(message: string): void {
  els.addError.textContent = message;
  els.addError.hidden = false;
}

function clearFormError(): void {
  els.addError.hidden = true;
  els.addError.textContent = "";
}

function toast(
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

function updateConnection(online: boolean): void {
  const connection = els.connDot.closest(".connection");
  connection?.classList.toggle("is-online", online);
  connection?.classList.toggle("is-offline", !online);
  els.connText.textContent = online ? "Live" : "Reconnecting…";
}

function applySettings(settings: AppSettings): void {
  state.settings = settings;
  els.folderPath.textContent = settings.downloadDir;
  els.folderPath.title = settings.downloadDir;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("downlink.theme", theme);
  els.themeIcon?.setAttribute(
    "href",
    theme === "dark" ? "#i-sun" : "#i-moon",
  );
  els.themeIconTop?.setAttribute(
    "href",
    theme === "dark" ? "#i-sun" : "#i-moon",
  );
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0b0e0f" : "#f3f5ee";
}

function initTheme(): void {
  const saved = localStorage.getItem("downlink.theme");
  const preferred =
    saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  applyTheme(preferred);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function computeSummary(): Summary {
  const jobs = [...state.jobs.values()];
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
    downloadDir: state.settings.downloadDir,
  };
}

function updateSummary(): void {
  const summary = computeSummary();
  const counts: Record<string, number> = {
    all: summary.total,
    active: summary.active,
    completed: summary.completed,
    paused: summary.paused,
    failed: summary.failed,
  };

  document.querySelectorAll<HTMLElement>("[data-count]").forEach((element) => {
    const key = element.dataset.count ?? "";
    element.textContent = String(counts[key] ?? 0);
  });

  els.metricActive.textContent = String(summary.active);
  els.metricActiveFoot.textContent =
    summary.downloading > 0
      ? `${summary.downloading} running`
      : summary.queued > 0
        ? "waiting"
        : "idle";
  els.metricSpeed.textContent = formatSpeed(summary.speedBps);
  els.metricCompleted.textContent = String(summary.completed);
  els.metricCompletedFoot.textContent = "files";
  els.metricDisk.textContent = formatBytes(summary.bytesOnDisk);
  els.metricDiskFoot.textContent =
    summary.bytesOnDisk > 0 ? "downloaded" : "empty";

  els.pageSubtitle.textContent =
    summary.active > 0
      ? `${summary.active} in the queue · ${formatSpeed(summary.speedBps)} combined`
      : summary.total > 0
        ? `${summary.completed} completed · ${formatBytes(summary.completedBytes)} saved`
        : "Grab a direct link. Keep everything local.";

  document.title =
    summary.downloading > 0
      ? `${summary.downloading} downloading — Downlink`
      : "Downlink — local downloader";
}

function matchesFilter(job: Job): boolean {
  switch (state.filter) {
    case "active":
      return isActiveStatus(job.status);
    case "completed":
      return job.status === "completed";
    case "paused":
      return job.status === "paused";
    case "failed":
      return job.status === "error";
    default:
      return true;
  }
}

function matchesSearch(job: Job): boolean {
  if (!state.query) return true;
  const query = state.query.toLowerCase();
  return (
    job.fileName.toLowerCase().includes(query) ||
    job.host.toLowerCase().includes(query) ||
    job.url.toLowerCase().includes(query) ||
    job.contentType.toLowerCase().includes(query) ||
    job.status.includes(query)
  );
}

function applyFilter(): void {
  let visible = 0;
  for (const job of state.jobs.values()) {
    const card = state.cards.get(job.id);
    if (!card) continue;
    const show = matchesFilter(job) && matchesSearch(job);
    card.hidden = !show;
    if (show) visible += 1;
  }

  els.resultCount.textContent = `${visible} ${visible === 1 ? "item" : "items"}`;
  syncFilterButtons();
  updateEmptyState(visible);
  updateSummary();
}

function syncFilterButtons(): void {
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  });

  const titles: Record<Filter, string> = {
    all: "Downloads",
    active: "Active downloads",
    completed: "Completed",
    paused: "Paused",
    failed: "Needs attention",
  };
  els.pageTitle.textContent = titles[state.filter];
}

function updateEmptyState(visible: number): void {
  if (!state.loaded) {
    els.emptyState.hidden = true;
    return;
  }
  if (visible > 0) {
    els.emptyState.hidden = true;
    return;
  }

  els.emptyState.hidden = false;
  if (state.offline) {
    els.emptyTitle.textContent = "Engine offline";
    els.emptyText.textContent =
      "Waiting for the local Downlink engine. Start it with `bun run dev`, then this page reconnects automatically.";
    return;
  }
  if (state.query) {
    els.emptyTitle.textContent = "No matching downloads";
    els.emptyText.textContent = `Nothing matches “${state.query}”. Try a different search.`;
    return;
  }

  switch (state.filter) {
    case "active":
      els.emptyTitle.textContent = "Nothing in flight";
      els.emptyText.textContent =
        "Active downloads show up here with live speed, progress and a partial-file preview.";
      break;
    case "completed":
      els.emptyTitle.textContent = "No completed files yet";
      els.emptyText.textContent =
        "Finished downloads land here and stay available in your local library.";
      break;
    case "paused":
      els.emptyTitle.textContent = "Nothing paused";
      els.emptyText.textContent =
        "Paused downloads keep their partial file and resume exactly where they left off.";
      break;
    case "failed":
      els.emptyTitle.textContent = "Nothing needs attention";
      els.emptyText.textContent =
        "Failed downloads appear here with their error and a retry action.";
      break;
    default:
      els.emptyTitle.textContent = "Your queue is clear";
      els.emptyText.textContent =
        "Paste a direct media or file URL above to start. Downloads resume automatically if the connection drops.";
  }
}

function setFilter(filter: Filter): void {
  state.filter = filter;
  applyFilter();
  updatePageTitle();
}

function updatePageTitle(): void {
  const titles: Record<Filter, string> = {
    all: "Downloads",
    active: "Active downloads",
    completed: "Completed",
    paused: "Paused",
    failed: "Needs attention",
  };
  els.pageTitle.textContent = titles[state.filter];
}

function syncCards(): void {
  for (const [id, card] of state.cards) {
    if (!state.jobs.has(id)) {
      card.remove();
      state.cards.delete(id);
      state.thumbs.delete(id);
    }
  }
  const ordered = [...state.jobs.values()].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  for (const job of ordered) {
    let card = state.cards.get(job.id);
    if (!card) card = createCard(job);
    updateCard(card, job);
  }
}

function createCard(job: Job): HTMLElement {
  const card = document.createElement("article");
  card.className = "download-card";
  card.dataset.id = job.id;
  card.style.order = String(-job.createdAt);
  card.innerHTML = `
    <div class="thumb">
      <div class="thumb-art">${icon(kindIcon(job.kind))}</div>
      <div class="thumb-shade"></div>
      <div class="thumb-top">
        <span class="status-badge"><span class="status-dot"></span><span class="status-text"></span></span>
        <span class="kind-badge">${icon(kindIcon(job.kind))}<span>${esc(kindLabel(job.kind))}</span></span>
      </div>
      <div class="thumb-bottom">
        <span class="thumb-size"></span>
        <span class="thumb-percent"></span>
      </div>
      <div class="thumb-progress"><span></span></div>
    </div>
    <div class="card-body">
      <div class="card-title-row">
        <div class="file-type-icon">${icon(kindIcon(job.kind))}</div>
        <div class="file-copy">
          <h3 class="file-name"></h3>
          <p class="file-meta">
            <span class="file-host"></span>
            <span class="meta-dot"></span>
            <span class="file-date"></span>
          </p>
        </div>
      </div>
      <div class="card-status-line"><strong></strong><span></span></div>
      <div class="card-progress"><span></span></div>
      <p class="card-error" hidden></p>
      <div class="card-actions"></div>
    </div>
  `;
  els.grid.append(card);
  state.cards.set(job.id, card);
  card.classList.add("is-new");
  window.setTimeout(() => card.classList.remove("is-new"), 900);
  return card;
}

function updateCard(card: HTMLElement, job: Job): void {
  card.dataset.status = job.status;
  card.dataset.kind = job.kind;
  card.classList.toggle("is-downloading", job.status === "downloading");
  card.classList.toggle("is-error", job.status === "error");
  card.setAttribute(
    "aria-label",
    `${job.fileName}, ${statusLabel(job.status)}. Open details.`,
  );

  const badge = card.querySelector<HTMLElement>(".status-badge");
  if (badge) {
    badge.className = `status-badge ${job.status}`;
    const text = badge.querySelector<HTMLElement>(".status-text");
    if (text) text.textContent = statusLabel(job.status);
  }

  const kindBadge = card.querySelector<HTMLElement>(".kind-badge span");
  if (kindBadge) kindBadge.textContent = kindLabel(job.kind);

  const name = card.querySelector<HTMLElement>(".file-name");
  if (name) name.textContent = job.fileName;

  const host = card.querySelector<HTMLElement>(".file-host");
  if (host) host.textContent = job.host;

  const date = card.querySelector<HTMLElement>(".file-date");
  if (date) date.textContent = relativeTime(job.createdAt);

  const size = card.querySelector<HTMLElement>(".thumb-size");
  if (size) size.textContent = formatBytes(job.totalBytes || job.downloadedBytes);

  const percent = job.progress ?? (job.status === "completed" ? 100 : 0);
  const percentText = card.querySelector<HTMLElement>(".thumb-percent");
  if (percentText) {
    percentText.textContent =
      job.progress == null && job.status === "downloading"
        ? "…"
        : `${Math.round(percent)}%`;
  }

  const thumbProgress = card.querySelector<HTMLElement>(".thumb-progress span");
  if (thumbProgress) thumbProgress.style.width = `${percent}%`;
  const cardProgress = card.querySelector<HTMLElement>(".card-progress span");
  if (cardProgress) cardProgress.style.width = `${percent}%`;

  const statusStrong = card.querySelector<HTMLElement>(".card-status-line strong");
  const statusRight = card.querySelector<HTMLElement>(".card-status-line span");
  if (statusStrong) {
    if (job.status === "downloading") {
      statusStrong.textContent =
        job.speedBps > 0 ? formatSpeed(job.speedBps) : "Connecting…";
    } else if (job.status === "queued") {
      statusStrong.textContent = "Waiting for a slot";
    } else if (job.status === "error") {
      statusStrong.textContent = "Needs attention";
    } else if (job.status === "completed") {
      statusStrong.textContent = "Completed";
    } else if (job.status === "paused") {
      statusStrong.textContent = "Paused";
    } else {
      statusStrong.textContent = "Canceled";
    }
  }
  if (statusRight) {
    if (job.status === "downloading") {
      statusRight.textContent = job.etaSeconds
        ? `${formatEta(job.etaSeconds)} left`
        : formatBytes(job.downloadedBytes);
    } else if (job.status === "completed") {
      statusRight.textContent = relativeTime(job.completedAt);
    } else if (job.status === "queued") {
      statusRight.textContent = formatBytes(job.totalBytes);
    } else {
      statusRight.textContent = job.progress != null ? `${job.progress}%` : "—";
    }
  }

  const error = card.querySelector<HTMLElement>(".card-error");
  if (error) {
    error.hidden = job.status !== "error" || !job.error;
    error.textContent = job.error ?? "";
    error.title = job.error ?? "";
  }

  const actionsKey = `${job.status}|${job.fileExists}|${job.kind}|${job.canPreview}`;
  const actions = card.querySelector<HTMLElement>(".card-actions");
  if (actions && actions.dataset.key !== actionsKey) {
    actions.dataset.key = actionsKey;
    actions.innerHTML = cardActions(job);
  }

  const thumb = card.querySelector<HTMLElement>(".thumb");
  if (thumb) thumb.classList.toggle("has-preview", Boolean(thumb.querySelector(".thumb-preview")));
  ensureCardThumb(card, job);
}

function cardButton(
  action: string,
  job: Job,
  label: string,
  iconName: string,
  options: { primary?: boolean; danger?: boolean; iconOnly?: boolean } = {},
): string {
  const classes = [
    "card-action",
    options.primary ? "primary" : "",
    options.danger ? "danger" : "",
    options.iconOnly ? "icon-only" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<button class="${classes}" type="button" data-action="${action}" data-id="${esc(
    job.id,
  )}" title="${esc(label)}" aria-label="${esc(label)}">
    ${icon(iconName)}${options.iconOnly ? "" : `<span>${esc(label)}</span>`}
  </button>`;
}

function cardActions(job: Job): string {
  const parts: string[] = [];
  if (job.status === "downloading" || job.status === "queued") {
    parts.push(cardButton("pause", job, "Pause", "pause", { primary: true }));
  } else if (job.status === "paused") {
    parts.push(cardButton("resume", job, "Resume", "play", { primary: true }));
  } else if (job.status === "error" || job.status === "canceled") {
    parts.push(cardButton("retry", job, "Retry", "refresh", { primary: true }));
  } else if (job.status === "completed") {
    if (canPreviewNow(job)) {
      parts.push(cardButton("preview", job, "Preview", "play", { primary: true }));
    } else {
      parts.push(cardButton("reveal", job, "Show", "folder", { primary: true }));
    }
  }

  if (job.status !== "completed" && canPreviewNow(job)) {
    parts.push(cardButton("preview", job, "Preview partial file", "inspect", { iconOnly: true }));
  }

  if (job.status === "completed" && job.fileExists) {
    parts.push(
      `<a class="card-action icon-only" href="/api/files/${esc(job.id)}" download title="Save a copy" aria-label="Save a copy">${icon(
        "download",
      )}</a>`,
    );
  }

  parts.push(cardButton("delete", job, "Delete", "trash", { danger: true, iconOnly: true }));
  return parts.join("");
}

function ensureCardThumb(card: HTMLElement, job: Job): void {
  if (job.status !== "completed" || !job.fileExists || !job.canPreview) return;
  const thumb = card.querySelector<HTMLElement>(".thumb");
  if (!thumb || thumb.querySelector(".thumb-preview")) return;

  if (job.kind === "image") {
    const image = document.createElement("img");
    image.className = "thumb-preview";
    image.alt = "";
    image.loading = "lazy";
    image.src = `/api/preview/${encodeURIComponent(job.id)}`;
    image.addEventListener("error", () => image.remove(), { once: true });
    thumb.append(image);
    return;
  }

  if (job.kind !== "video") return;
  const cached = state.thumbs.get(job.id);
  if (cached) {
    const image = document.createElement("img");
    image.className = "thumb-preview";
    image.alt = "";
    image.src = cached;
    thumb.append(image);
    return;
  }
  if (state.thumbPending.has(job.id)) return;
  state.thumbPending.add(job.id);
  void generateVideoThumbnail(job.id);
}

function attachThumb(jobId: string, dataUrl: string): void {
  state.thumbs.set(jobId, dataUrl);
  const card = state.cards.get(jobId);
  if (!card) return;
  const thumb = card.querySelector<HTMLElement>(".thumb");
  if (!thumb || thumb.querySelector(".thumb-preview")) return;
  const image = document.createElement("img");
  image.className = "thumb-preview";
  image.alt = "";
  image.src = dataUrl;
  thumb.append(image);
}

async function generateVideoThumbnail(jobId: string): Promise<void> {
  const video = document.createElement("video");
  let settled = false;
  const cleanup = (): void => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    video.removeAttribute("src");
    video.load();
    state.thumbPending.delete(jobId);
  };
  const timeout = window.setTimeout(cleanup, 10_000);

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = `/api/preview/${encodeURIComponent(jobId)}`;
  video.addEventListener("error", cleanup, { once: true });

  video.addEventListener(
    "loadedmetadata",
    () => {
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : 2;
        video.currentTime = Math.min(1.2, Math.max(0.08, duration * 0.12));
      } catch {
        cleanup();
      }
    },
    { once: true },
  );

  video.addEventListener(
    "seeked",
    () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 270;
        const context = canvas.getContext("2d");
        if (!context) {
          cleanup();
          return;
        }
        context.fillStyle = "#0a0d0e";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const ratio = video.videoWidth / video.videoHeight;
        let width = canvas.width;
        let height = canvas.height;
        let x = 0;
        let y = 0;
        if (ratio > 16 / 9) {
          height = width / ratio;
          y = (canvas.height - height) / 2;
        } else {
          width = height * ratio;
          x = (canvas.width - width) / 2;
        }
        context.drawImage(video, x, y, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.76);
        attachThumb(jobId, dataUrl);
      } catch {
        /* codec or canvas restriction */
      }
      cleanup();
    },
    { once: true },
  );

  video.load();
}

// ---------------------------------------------------------------------------
// Download events and snapshots
// ---------------------------------------------------------------------------

function applySnapshot(data: Snapshot, notifyTransitions: boolean): void {
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
    if (!job) closeDialog(els.detailDialog);
    else updateDetail(job);
  }
}

function handleJob(job: Job, notify = true): void {
  const old = state.jobs.get(job.id);
  if (notify && old) {
    if (old.status !== "completed" && job.status === "completed") {
      announceCompletion(job);
    } else if (old.status !== "error" && job.status === "error") {
      announceFailure(job);
    }
  }
  state.jobs.set(job.id, job);
  let card = state.cards.get(job.id);
  if (!card) card = createCard(job);
  updateCard(card, job);
  applyFilter();

  if (state.detailId === job.id) updateDetail(job);
}

function handleDeleted(id: string): void {
  const card = state.cards.get(id);
  card?.remove();
  state.cards.delete(id);
  state.jobs.delete(id);
  state.thumbs.delete(id);
  if (state.detailId === id) closeDialog(els.detailDialog);
  applyFilter();
}

function announceCompletion(job: Job): void {
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

function announceFailure(job: Job): void {
  toast("Download failed", job.error ?? job.fileName, "error");
}

async function refreshSnapshot(): Promise<void> {
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

function connectEvents(): void {
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

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

function openDetail(id: string): void {
  const job = state.jobs.get(id);
  if (!job) return;
  state.detailId = id;
  state.detailMediaKey = "";
  state.detailActionsKey = "";
  resetDetailMedia();
  if (!els.detailDialog.open) els.detailDialog.showModal();
  updateDetail(job);
  els.detailDialog.scrollTop = 0;
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}

function resetDetailMedia(): void {
  for (const media of [els.detailVideo, els.detailAudio]) {
    media.pause();
    media.removeAttribute("src");
    media.load();
    media.hidden = true;
  }
  els.detailImage.hidden = true;
  els.detailImage.removeAttribute("src");
  els.detailPlaceholder.hidden = true;
}

function updateDetail(job: Job): void {
  if (!els.detailDialog.open || state.detailId !== job.id) return;

  els.detailKind.textContent = job.kind;
  els.detailTitle.textContent = job.fileName;
  els.detailHost.textContent = `${job.host} · ${statusLabel(job.status)}`;
  els.detailStatusText.textContent =
    job.progress != null && job.status !== "completed"
      ? `${statusLabel(job.status)} · ${job.progress}%`
      : statusLabel(job.status);

  const progress = job.progress ?? (job.status === "completed" ? 100 : 0);
  els.detailPercent.textContent =
    job.progress == null && job.status === "downloading"
      ? "…"
      : `${Math.round(progress)}%`;
  els.detailBytes.textContent = `${formatBytes(job.downloadedBytes)}${
    job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""
  }`;
  els.detailProgressFill.style.width = `${progress}%`;
  els.detailProgress.classList.toggle("is-error", job.status === "error");
  els.detailProgress.classList.toggle("is-paused", job.status === "paused");

  if (job.status === "downloading") {
    els.detailSpeed.textContent = formatSpeed(job.speedBps);
    els.detailEta.textContent = job.etaSeconds
      ? `${formatEta(job.etaSeconds)} left`
      : "";
  } else if (job.status === "completed") {
    els.detailSpeed.textContent = "Completed";
    els.detailEta.textContent = relativeTime(job.completedAt);
  } else if (job.status === "paused") {
    els.detailSpeed.textContent = "Paused";
    els.detailEta.textContent = `${Math.round(progress)}% saved`;
  } else if (job.status === "error") {
    els.detailSpeed.textContent = "Failed";
    els.detailEta.textContent = job.progress != null ? `${job.progress}% saved` : "";
  } else if (job.status === "queued") {
    els.detailSpeed.textContent = "Queued";
    els.detailEta.textContent = "waiting for a slot";
  } else {
    els.detailSpeed.textContent = "Canceled";
    els.detailEta.textContent = "";
  }

  els.detailError.hidden = job.status !== "error" || !job.error;
  els.detailError.textContent = job.error ?? "";

  renderDetailMeta(job);
  syncDetailMedia(job);

  const actionsKey = `${job.status}|${job.fileExists}|${job.canPreview}|${job.kind}`;
  if (state.detailActionsKey !== actionsKey) {
    state.detailActionsKey = actionsKey;
    els.detailActions.innerHTML = detailActions(job);
  }
}

function metaRow(label: string, value: string): string {
  return `<div class="meta-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

function renderDetailMeta(job: Job): void {
  const source = job.finalUrl ?? job.url;
  const rows: string[] = [];
  rows.push(metaRow("Status", esc(statusLabel(job.status))));
  rows.push(metaRow("Size", esc(formatBytes(job.totalBytes || job.downloadedBytes))));
  rows.push(metaRow("Type", esc(job.contentType || "unknown")));
  rows.push(
    metaRow(
      "Source",
      `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer" title="${esc(
        source,
      )}">${esc(job.host)} ↗</a>`,
    ),
  );
  rows.push(metaRow("Saved to", `<code title="${esc(job.filePath)}">${esc(job.filePath)}</code>`));
  rows.push(metaRow("Resume", job.supportsRanges ? "HTTP Range" : "Server dependent"));
  rows.push(metaRow("Added", esc(fullDate(job.createdAt))));
  if (job.etag) rows.push(metaRow("ETag", `<code>${esc(job.etag)}</code>`));
  if (job.attempts > 1) rows.push(metaRow("Attempts", String(job.attempts)));
  els.detailMeta.innerHTML = rows.join("");
}

function syncDetailMedia(job: Job): void {
  const key = `${job.id}|${job.status}|${job.fileExists}|${job.kind}`;
  if (state.detailMediaKey === key) return;
  state.detailMediaKey = key;
  resetDetailMedia();

  if (!job.fileExists || !job.canPreview) {
    els.detailPlayerBadge.textContent = "NO PREVIEW";
    els.detailPlaceholder.hidden = false;
    const label = els.detailPlaceholder.querySelector("span");
    if (label) {
      label.textContent =
        job.status === "queued"
          ? "Preview starts with the download"
          : "No inline preview for this type";
    }
    els.detailPreviewNote.textContent =
      job.status === "queued"
        ? "The player becomes available as soon as the first bytes arrive."
        : "You can still reveal the file on disk or save a copy.";
    return;
  }

  const previewUrl = `/api/preview/${encodeURIComponent(job.id)}`;
  if (job.kind === "video") {
    els.detailVideo.src = previewUrl;
    els.detailVideo.hidden = false;
    els.detailVideo.load();
    els.detailPlayerBadge.textContent =
      job.status === "completed" ? "LOCAL PREVIEW" : "PARTIAL PREVIEW";
    els.detailPreviewNote.textContent =
      job.status === "completed"
        ? "Playing from the finished file on your disk."
        : "Live preview of the bytes downloaded so far. Seeking may be limited until the file finishes.";
  } else if (job.kind === "audio") {
    els.detailAudio.src = previewUrl;
    els.detailAudio.hidden = false;
    els.detailAudio.load();
    els.detailPlayerBadge.textContent =
      job.status === "completed" ? "LOCAL AUDIO" : "PARTIAL AUDIO";
    els.detailPreviewNote.textContent =
      job.status === "completed"
        ? "Playing from the finished audio file on your disk."
        : "Preview the audio downloaded so far. The rest arrives as the download continues.";
  } else if (job.kind === "image") {
    els.detailImage.src = previewUrl;
    els.detailImage.hidden = false;
    els.detailPlayerBadge.textContent =
      job.status === "completed" ? "LOCAL IMAGE" : "PARTIAL IMAGE";
    els.detailPreviewNote.textContent =
      job.status === "completed"
        ? "Showing the finished image on your disk."
        : "The image may appear incomplete until the download finishes.";
  }
}

function detailActions(job: Job): string {
  const buttons: string[] = [];
  if (job.status === "downloading" || job.status === "queued") {
    buttons.push(
      `<button class="button primary" type="button" data-action="pause" data-id="${esc(
        job.id,
      )}">${icon("pause")} Pause</button>`,
    );
  } else if (job.status === "paused") {
    buttons.push(
      `<button class="button primary" type="button" data-action="resume" data-id="${esc(
        job.id,
      )}">${icon("play")} Resume</button>`,
    );
  } else if (job.status === "error" || job.status === "canceled") {
    buttons.push(
      `<button class="button primary" type="button" data-action="retry" data-id="${esc(
        job.id,
      )}">${icon("refresh")} Retry</button>`,
    );
  } else if (job.status === "completed" && job.fileExists) {
    buttons.push(
      `<a class="button primary" href="/api/files/${esc(job.id)}" download>${icon(
        "download",
      )} Save a copy</a>`,
    );
  }

  buttons.push(
    `<button class="button subtle" type="button" data-action="reveal" data-id="${esc(
      job.id,
    )}">${icon("folder")} Reveal</button>`,
  );
  buttons.push(
    `<button class="button subtle" type="button" data-action="copy" data-id="${esc(
      job.id,
    )}">${icon("copy")} Copy URL</button>`,
  );
  if (job.status !== "completed") {
    buttons.push(
      `<button class="button subtle" type="button" data-action="cancel" data-id="${esc(
        job.id,
      )}">${icon("x")} Cancel</button>`,
    );
  }
  buttons.push(
    `<button class="button subtle" type="button" data-action="delete" data-id="${esc(
      job.id,
    )}">${icon("trash")} Delete</button>`,
  );
  return buttons.join("");
}

// ---------------------------------------------------------------------------
// Inspect dialog
// ---------------------------------------------------------------------------

function resetInspectPlayer(): void {
  for (const media of [els.inspectVideo, els.inspectAudio]) {
    media.pause();
    media.removeAttribute("src");
    media.load();
    media.hidden = true;
  }
  els.inspectImage.hidden = true;
  els.inspectImage.removeAttribute("src");
  els.inspectPlaceholder.hidden = true;
  els.inspectLoading.hidden = false;
}

function openInspectDialog(): void {
  state.inspectProbe = null;
  state.inspectPreviewUrl = null;
  state.inspectRequest += 1;
  els.inspectKind.textContent = "preview";
  els.inspectTitle.textContent = "Inspecting link…";
  els.inspectHost.textContent = "Reading headers. This does not download the file yet.";
  els.inspectFacts.innerHTML = "";
  els.inspectUrl.textContent = "";
  els.inspectError.hidden = true;
  els.inspectError.textContent = "";
  els.inspectAddBtn.disabled = true;
  resetInspectPlayer();
  if (!els.inspectDialog.open) els.inspectDialog.showModal();
}

function inspectFact(label: string, value: string): string {
  return `<div class="inspect-fact"><span>${esc(label)}</span><span title="${esc(
    value,
  )}">${esc(value)}</span></div>`;
}

async function inspectCurrentUrl(): Promise<void> {
  const raw = els.urlInput.value.trim();
  if (!raw) {
    els.urlInput.focus();
    showFormError("Paste a URL to preview it.");
    return;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS links are supported.");
    }
  } catch (error) {
    showFormError(
      error instanceof Error ? error.message : "Enter a valid HTTP or HTTPS URL.",
    );
    els.urlInput.focus();
    return;
  }

  clearFormError();
  openInspectDialog();
  const request = state.inspectRequest;
  setBusy(els.inspectBtn, true, "Inspecting…");

  try {
    const result = await api<InspectResult>("/api/inspect", {
      method: "POST",
      body: JSON.stringify({ url: raw }),
    });
    if (request !== state.inspectRequest) return;
    state.inspectProbe = result.probe;
    state.inspectPreviewUrl = result.previewUrl;
    renderInspectResult(result);
  } catch (error) {
    if (request !== state.inspectRequest) return;
    els.inspectLoading.hidden = true;
    els.inspectPlaceholder.hidden = false;
    const label = els.inspectPlaceholder.querySelector("span");
    if (label) label.textContent = "Could not inspect this link";
    els.inspectTitle.textContent = "Preview unavailable";
    els.inspectHost.textContent = "The URL could not be read.";
    els.inspectError.textContent =
      error instanceof Error ? error.message : "Could not inspect this URL.";
    els.inspectError.hidden = false;
  } finally {
    setBusy(els.inspectBtn, false);
  }
}

function renderInspectResult(result: InspectResult): void {
  const probe = result.probe;
  els.inspectKind.textContent = kindLabel(probe.kind);
  els.inspectTitle.textContent = probe.fileName;
  els.inspectHost.textContent = hostFromUrl(probe.finalUrl);
  els.inspectLoading.hidden = true;
  els.inspectError.hidden = true;
  els.inspectFacts.innerHTML = [
    inspectFact("Size", formatBytes(probe.totalBytes)),
    inspectFact("Type", probe.contentType || "unknown"),
    inspectFact("Resume", probe.supportsRanges ? "Yes · HTTP Range" : "Server dependent"),
    inspectFact("Status", `HTTP ${probe.status}`),
    probe.etag ? inspectFact("ETag", probe.etag) : "",
    probe.lastModified ? inspectFact("Modified", probe.lastModified) : "",
  ].join("");
  els.inspectUrl.textContent = probe.finalUrl;

  if (result.canPreview && result.previewUrl) {
    els.inspectPlaceholder.hidden = true;
    if (probe.kind === "video") {
      els.inspectVideo.src = result.previewUrl;
      els.inspectVideo.hidden = false;
      els.inspectVideo.load();
    } else if (probe.kind === "audio") {
      els.inspectAudio.src = result.previewUrl;
      els.inspectAudio.hidden = false;
      els.inspectAudio.load();
    } else if (probe.kind === "image") {
      els.inspectImage.src = result.previewUrl;
      els.inspectImage.hidden = false;
    }
  } else {
    els.inspectPlaceholder.hidden = false;
    const label = els.inspectPlaceholder.querySelector("span");
    if (label) label.textContent = "No inline preview for this type";
  }
  els.inspectAddBtn.disabled = false;
}

async function addInspectedUrl(): Promise<void> {
  const probe = state.inspectProbe;
  if (!probe) return;
  setBusy(els.inspectAddBtn, true, "Adding…");
  els.inspectError.hidden = true;
  try {
    const result = await addUrls([probe.finalUrl || probe.url]);
    if (result.jobs.length > 0) {
      result.jobs.forEach((job) => handleJob(job, false));
      toast(
        result.jobs.length === 1 ? "Added to downloads" : `Added ${result.jobs.length} downloads`,
        result.jobs[0]?.fileName,
        "success",
      );
      closeDialog(els.inspectDialog);
    }
    if (result.errors.length > 0) {
      els.inspectError.textContent = result.errors
        .map((item) => item.error)
        .join(" ");
      els.inspectError.hidden = false;
    }
  } catch (error) {
    els.inspectError.textContent =
      error instanceof Error ? error.message : "Could not add this download.";
    els.inspectError.hidden = false;
  } finally {
    setBusy(els.inspectAddBtn, false);
  }
}

// ---------------------------------------------------------------------------
// Add downloads
// ---------------------------------------------------------------------------

async function addUrls(urls: string[]): Promise<{
  jobs: Job[];
  errors: Array<{ url: string; error: string }>;
}> {
  return api<{ jobs: Job[]; errors: Array<{ url: string; error: string }> }>(
    "/api/downloads",
    {
      method: "POST",
      body: JSON.stringify(urls.length === 1 ? { url: urls[0] } : { urls }),
    },
  );
}

function collectFormUrls(): string[] {
  if (state.batchMode) {
    return els.batchInput.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const value = els.urlInput.value.trim();
  return value ? [value] : [];
}

async function handleAddSubmit(): Promise<void> {
  if (state.adding) return;
  clearFormError();
  const urls = collectFormUrls();
  if (urls.length === 0) {
    showFormError(
      state.batchMode
        ? "Paste one URL per line to add a batch."
        : "Paste a direct HTTP or HTTPS URL.",
    );
    (state.batchMode ? els.batchInput : els.urlInput).focus();
    return;
  }

  for (const raw of urls) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS links are supported.");
      }
    } catch {
      showFormError(`Not a valid HTTP/HTTPS URL: ${raw}`);
      return;
    }
  }

  state.adding = true;
  setBusy(
    els.addBtn,
    true,
    urls.length > 1 ? `Adding ${urls.length} links…` : "Inspecting…",
  );

  try {
    const result = await addUrls(urls);
    result.jobs.forEach((job) => handleJob(job, false));
    if (result.jobs.length > 0) {
      if (state.batchMode) {
        const failedUrls = new Set(result.errors.map((item) => item.url));
        els.batchInput.value = urls.filter((url) => failedUrls.has(url)).join("\n");
      } else {
        els.urlInput.value = "";
      }
      toast(
        result.jobs.length === 1
          ? "Added to downloads"
          : `Added ${result.jobs.length} downloads`,
        result.jobs.length === 1 ? result.jobs[0]?.fileName : "They are queued now.",
        "success",
      );
    }
    if (result.errors.length > 0) {
      showFormError(
        result.errors
          .map((item) => `${hostFromUrl(item.url)}: ${item.error}`)
          .join("  ·  "),
      );
      toast(
        result.jobs.length > 0 ? "Some links failed" : "Could not add URL",
        result.errors[0]?.error,
        "error",
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not add this download.";
    showFormError(message);
    toast("Could not add URL", message, "error");
  } finally {
    state.adding = false;
    setBusy(els.addBtn, false);
  }
}

function setBatchMode(enabled: boolean): void {
  state.batchMode = enabled;
  const urlField = document.querySelector<HTMLElement>(".url-field");
  if (urlField) urlField.hidden = enabled;
  els.batchInput.hidden = !enabled;
  els.inspectBtn.disabled = enabled;
  els.batchToggle.querySelector("span")?.replaceChildren(
    document.createTextNode(enabled ? "Single link" : "Batch mode"),
  );
  const addLabel = els.addBtn.querySelector("span");
  if (addLabel) addLabel.textContent = enabled ? "Add all" : "Add download";

  if (enabled) {
    if (!els.batchInput.value && els.urlInput.value.trim()) {
      els.batchInput.value = els.urlInput.value.trim();
    }
    els.batchInput.focus();
  } else {
    if (els.batchInput.value.trim()) {
      els.urlInput.value = els.batchInput.value.split(/\r?\n/)[0] ?? "";
    }
    els.urlInput.focus();
  }
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    if (text.includes("\n")) {
      setBatchMode(true);
      els.batchInput.value = text.trim();
    } else {
      if (state.batchMode) setBatchMode(false);
      els.urlInput.value = text.trim();
    }
    clearFormError();
    els.urlInput.focus();
  } catch {
    toast(
      "Clipboard permission needed",
      "Paste with ⌘V or allow clipboard access in the browser.",
      "error",
    );
    (state.batchMode ? els.batchInput : els.urlInput).focus();
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function removeJobLocally(id: string): void {
  const card = state.cards.get(id);
  card?.remove();
  state.cards.delete(id);
  state.jobs.delete(id);
  if (state.detailId === id) closeDialog(els.detailDialog);
  applyFilter();
}

async function performAction(action: string, id: string): Promise<void> {
  const job = state.jobs.get(id);
  if (!job) return;

  try {
    switch (action) {
      case "pause":
        await api(`/api/downloads/${encodeURIComponent(id)}/pause`, {
          method: "POST",
        });
        toast("Paused", job.fileName, "info");
        break;
      case "resume":
        await api(`/api/downloads/${encodeURIComponent(id)}/resume`, {
          method: "POST",
        });
        toast("Resuming", job.fileName, "success");
        break;
      case "retry":
        await api(`/api/downloads/${encodeURIComponent(id)}/retry`, {
          method: "POST",
        });
        toast("Queued for retry", job.fileName, "success");
        break;
      case "cancel": {
        const ok = await askConfirm({
          title: "Cancel this download?",
          message:
            "The partial file will be discarded. You can still retry from the same URL later.",
          confirmLabel: "Cancel download",
          danger: true,
        });
        if (!ok) return;
        await api(`/api/downloads/${encodeURIComponent(id)}/cancel`, {
          method: "POST",
        });
        toast("Download canceled", job.fileName, "info");
        break;
      }
      case "reveal": {
        await api(`/api/downloads/${encodeURIComponent(id)}/reveal`, {
          method: "POST",
        });
        toast("Opened in your file manager", "", "success");
        break;
      }
      case "copy": {
        await navigator.clipboard.writeText(job.finalUrl ?? job.url);
        toast("Source URL copied", "", "success");
        break;
      }
      case "delete": {
        const ok = await askConfirm({
          title: "Delete this download?",
          message: `“${job.fileName}” and its partial or finished file will be removed from disk and from the library.`,
          confirmLabel: "Delete file",
          danger: true,
        });
        if (!ok) return;
        await api(`/api/downloads/${encodeURIComponent(id)}?files=true`, {
          method: "DELETE",
        });
        removeJobLocally(id);
        toast("Deleted", job.fileName, "info");
        break;
      }
    }
  } catch (error) {
    toast(
      "Action failed",
      error instanceof Error ? error.message : "The engine could not complete that action.",
      "error",
    );
  }
}

function askConfirm(options: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  if (state.confirmResolve) {
    state.confirmResolve(false);
    state.confirmResolve = null;
  }
  els.confirmTitle.textContent = options.title;
  els.confirmText.textContent = options.message;
  els.confirmYes.textContent = options.confirmLabel;
  els.confirmYes.className = options.danger ? "button danger" : "button primary";
  els.confirmDialog.returnValue = "";
  els.confirmDialog.showModal();
  return new Promise<boolean>((resolve) => {
    state.confirmResolve = resolve;
  });
}

function handleActionClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const actionElement = target.closest<HTMLElement>("[data-action]");
  if (actionElement) {
    const action = actionElement.dataset.action;
    const id = actionElement.dataset.id;
    if (action && id) {
      event.preventDefault();
      void performAction(action, id);
    }
    return;
  }

  const card = target.closest<HTMLElement>(".download-card");
  if (card && !target.closest("a")) {
    const id = card.dataset.id;
    if (id) openDetail(id);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function openSettings(): void {
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

async function saveSettings(): Promise<void> {
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

// ---------------------------------------------------------------------------
// Misc actions
// ---------------------------------------------------------------------------

async function pauseAll(): Promise<void> {
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

async function resumeAll(): Promise<void> {
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

async function clearCompleted(): Promise<void> {
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

async function clearHistory(): Promise<void> {
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

async function openFolder(): Promise<void> {
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

// ---------------------------------------------------------------------------
// Boot and events
// ---------------------------------------------------------------------------

function bindEvents(): void {
  els.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleAddSubmit();
  });

  els.batchToggle.addEventListener("click", () => {
    setBatchMode(!state.batchMode);
  });

  els.pasteBtn.addEventListener("click", () => void pasteFromClipboard());
  els.inspectBtn.addEventListener("click", () => void inspectCurrentUrl());
  els.inspectAddBtn.addEventListener("click", () => void addInspectedUrl());
  els.openFolderBtn.addEventListener("click", () => void openFolder());

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
    els.confirmDialog,
  ]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }

  els.detailDialog.addEventListener("close", () => {
    state.detailId = null;
    state.detailMediaKey = "";
    resetDetailMedia();
  });

  els.inspectDialog.addEventListener("close", () => {
    state.inspectProbe = null;
    state.inspectPreviewUrl = null;
    state.inspectRequest += 1;
    resetInspectPlayer();
    setBusy(els.inspectBtn, false);
  });

  for (const media of [els.detailVideo, els.detailAudio]) {
    media.addEventListener("error", () => {
      if (!media.getAttribute("src") || media.hidden) return;
      const job = state.detailId ? state.jobs.get(state.detailId) : null;
      els.detailPreviewNote.textContent =
        job?.status === "completed"
          ? "Your browser cannot play this codec. Save a copy and open it in a local media player."
          : "This partial file is not playable yet. The preview unlocks as more data arrives.";
    });
  }

  els.detailImage.addEventListener("error", () => {
    if (els.detailImage.hidden) return;
    els.detailImage.hidden = true;
    els.detailPlaceholder.hidden = false;
    const label = els.detailPlaceholder.querySelector("span");
    if (label) label.textContent = "This image could not be decoded";
  });

  for (const media of [els.inspectVideo, els.inspectAudio]) {
    media.addEventListener("error", () => {
      if (!media.getAttribute("src") || media.hidden) return;
      els.inspectError.textContent =
        "The browser could not play this remote preview. The file can still be downloaded.";
      els.inspectError.hidden = false;
    });
  }

  els.inspectImage.addEventListener("error", () => {
    if (els.inspectImage.hidden) return;
    els.inspectError.textContent =
      "The browser could not display this remote image. The file can still be downloaded.";
    els.inspectError.hidden = false;
  });

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
  bindEvents();
  void loadInitial();
}

init();
