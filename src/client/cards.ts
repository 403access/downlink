import { selectDetail } from "./detail";
import { els, state } from "./dom";
import {
  esc,
  formatBytes,
  formatEta,
  formatSpeed,
  icon,
  isActiveStatus,
  kindIcon,
  kindLabel,
  rangeLabel,
  relativeTime,
  statusLabel,
} from "./format";
import type { Filter, Job, Summary } from "./types";

export function computeSummary(): Summary {
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

export function updateSummary(): void {
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

export function matchesFilter(job: Job): boolean {
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

export function matchesSearch(job: Job): boolean {
  if (!state.query) return true;
  const query = state.query.toLowerCase();
  return (
    job.fileName.toLowerCase().includes(query) ||
    job.host.toLowerCase().includes(query) ||
    job.url.toLowerCase().includes(query) ||
    job.contentType.toLowerCase().includes(query) ||
    job.status.includes(query) ||
    (job.isPartial && "206 partial range".includes(query))
  );
}

export function applyFilter(): void {
  const ordered = [...state.jobs.values()].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  let visible = 0;
  let firstVisible: string | null = null;
  for (const job of ordered) {
    const card = state.cards.get(job.id);
    if (!card) continue;
    const show = matchesFilter(job) && matchesSearch(job);
    card.hidden = !show;
    if (show) {
      visible += 1;
      firstVisible ??= job.id;
    }
  }

  const selectedCard = state.detailId ? state.cards.get(state.detailId) : null;
  const selectedVisible = Boolean(
    state.detailId &&
      selectedCard &&
      !selectedCard.hidden &&
      state.jobs.has(state.detailId),
  );
  if (!selectedVisible) {
    selectDetail(state.detailDismissed ? null : firstVisible, {
      switchView: state.dockView !== "inspect",
    });
  }

  els.resultCount.textContent = `${visible} ${visible === 1 ? "item" : "items"}`;
  syncFilterButtons();
  updateEmptyState(visible);
  updateSummary();
}

export function syncFilterButtons(): void {
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

export function updateEmptyState(visible: number): void {
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

export function setFilter(filter: Filter): void {
  state.filter = filter;
  applyFilter();
  updatePageTitle();
}

export function updatePageTitle(): void {
  const titles: Record<Filter, string> = {
    all: "Downloads",
    active: "Active downloads",
    completed: "Completed",
    paused: "Paused",
    failed: "Needs attention",
  };
  els.pageTitle.textContent = titles[state.filter];
}

export function syncCards(): void {
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

export function createCard(job: Job): HTMLElement {
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
        <span class="thumb-badges">
          <span class="partial-badge" hidden>206</span>
          <span class="kind-badge">${icon(kindIcon(job.kind))}<span>${esc(kindLabel(job.kind))}</span></span>
        </span>
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

export function updateCard(card: HTMLElement, job: Job): void {
  card.dataset.status = job.status;
  card.dataset.kind = job.kind;
  card.classList.toggle("is-downloading", job.status === "downloading");
  card.classList.toggle("is-error", job.status === "error");
  card.classList.toggle("is-selected", state.detailId === job.id);
  if (state.detailId === job.id) card.setAttribute("aria-current", "true");
  else card.removeAttribute("aria-current");
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

  const partialBadge = card.querySelector<HTMLElement>(".partial-badge");
  if (partialBadge) {
    partialBadge.hidden = !job.isPartial;
    partialBadge.textContent = job.httpStatus === 206 ? "206" : "range";
    partialBadge.title = rangeLabel(job);
  }

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

export function cardButton(
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

export function cardActions(job: Job): string {
  const parts: string[] = [];
  if (job.status === "downloading" || job.status === "queued") {
    parts.push(cardButton("pause", job, "Pause", "pause", { primary: true }));
  } else if (job.status === "paused") {
    parts.push(cardButton("resume", job, "Resume", "play", { primary: true }));
  } else if (job.status === "error" || job.status === "canceled") {
    parts.push(cardButton("retry", job, "Retry", "refresh", { primary: true }));
  } else if (job.status === "completed" && job.fileExists) {
    parts.push(
      cardButton("reveal", job, "Show in folder", "folder", { primary: true }),
    );
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

export function ensureCardThumb(card: HTMLElement, job: Job): void {
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

export function attachThumb(jobId: string, dataUrl: string): void {
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

export function upsertCard(job: Job): void {
  state.jobs.set(job.id, job);
  let card = state.cards.get(job.id);
  if (!card) card = createCard(job);
  updateCard(card, job);
  applyFilter();
}

export function handleDeleted(id: string): void {
  const card = state.cards.get(id);
  card?.remove();
  state.cards.delete(id);
  state.jobs.delete(id);
  state.thumbs.delete(id);
  applyFilter();
}
