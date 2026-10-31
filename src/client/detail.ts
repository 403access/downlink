import { closeDock, els, revealDock, setDockView, state } from "./dom";
import {
  esc,
  formatBytes,
  formatEta,
  formatSpeed,
  fullDate,
  httpStatusLabel,
  icon,
  rangeLabel,
  relativeTime,
  statusLabel,
} from "./format";
import type { Job } from "./types";

interface DetailOptions {
  reveal?: boolean;
  switchView?: boolean;
}

export function openDetail(id: string, options: DetailOptions = {}): void {
  state.detailDismissed = false;
  selectDetail(id, {
    reveal: options.reveal ?? true,
    switchView: options.switchView ?? true,
  });
}

export function selectDetail(
  id: string | null,
  options: DetailOptions = {},
): void {
  const { reveal = false, switchView = true } = options;
  const job = id ? state.jobs.get(id) ?? null : null;
  const nextId = job?.id ?? null;
  if (nextId !== state.detailId) {
    state.detailId = nextId;
    state.detailMediaKey = "";
    state.detailMediaRetryAt = 0;
    state.detailActionsKey = "";
    resetDetailMedia();
    if (nextId) els.detailPanel.scrollTop = 0;
  }

  updateCardSelection();
  if (switchView) {
    if (nextId) {
      cancelInspectPreview();
      setDockView("detail");
    } else if (state.dockView !== "inspect") {
      syncDockEmpty();
      setDockView("empty");
    }
  }
  if (reveal && nextId) revealDock();
  if (job) updateDetail(job);
}

export function refreshSelectedDetail(): void {
  const job = state.detailId ? state.jobs.get(state.detailId) : null;
  if (job) {
    setDockView("detail");
    updateDetail(job);
  } else {
    syncDockEmpty();
    setDockView("empty");
  }
}

export function closeDetail(): void {
  state.detailDismissed = true;
  selectDetail(null);
  closeDock();
}

function syncDockEmpty(): void {
  const empty = state.jobs.size === 0;
  els.dockEmptyTitle.textContent = empty ? "Your queue is empty" : "No download selected";
  els.dockEmptyText.textContent = empty
    ? "Add a download to see its live preview, progress, metadata and actions here."
    : "Select a download to see its live preview, progress, metadata and actions here.";
}

function updateCardSelection(): void {
  for (const [id, card] of state.cards) {
    const selected = id === state.detailId;
    card.classList.toggle("is-selected", selected);
    if (selected) card.setAttribute("aria-current", "true");
    else card.removeAttribute("aria-current");
  }
}

export function pauseDetailMedia(): void {
  els.detailVideo.pause();
  els.detailAudio.pause();
}

function cancelInspectPreview(): void {
  state.inspectProbe = null;
  state.inspectPreviewUrl = null;
  state.inspectRequest += 1;
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
  els.inspectAddBtn.disabled = true;
}

export function resetDetailMedia(): void {
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

export function updateDetail(job: Job): void {
  if (state.detailId !== job.id) return;

  els.detailKind.textContent = job.kind;
  els.detailRangeBadge.hidden = !job.isPartial;
  els.detailRangeBadge.textContent =
    job.httpStatus === 206 ? "206 partial" : "partial range";
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
  recoverDetailMedia(job);

  const actionsKey = `${job.status}|${job.fileExists}|${job.canPreview}|${job.kind}`;
  if (state.detailActionsKey !== actionsKey) {
    state.detailActionsKey = actionsKey;
    els.detailActions.innerHTML = detailActions(job);
  }
}

export function metaRow(label: string, value: string): string {
  return `<div class="meta-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

export function renderDetailMeta(job: Job): void {
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
  if (job.isPartial) {
    rows.push(metaRow("Range", `<code>${esc(rangeLabel(job))}</code>`));
    if (job.remoteTotal > 0) {
      rows.push(metaRow("Remote size", esc(formatBytes(job.remoteTotal))));
    }
    if (job.rangeIf) {
      rows.push(metaRow("If-Range", `<code>${esc(job.rangeIf)}</code>`));
    }
  }
  rows.push(metaRow("HTTP", esc(httpStatusLabel(job.httpStatus))));
  if (job.headers.length > 0) {
    rows.push(
      metaRow(
        "Headers",
        `<span title="${esc(job.headers.map((header) => header.name).join(", "))}">${job.headers.length} custom header${job.headers.length === 1 ? "" : "s"}</span>`,
      ),
    );
  }
  rows.push(metaRow("Resume", job.supportsRanges ? "HTTP Range" : "Server dependent"));
  rows.push(metaRow("Added", esc(fullDate(job.createdAt))));
  if (job.etag) rows.push(metaRow("ETag", `<code>${esc(job.etag)}</code>`));
  if (job.attempts > 1) rows.push(metaRow("Attempts", String(job.attempts)));
  els.detailMeta.innerHTML = rows.join("");
}

function previewUrl(job: Job, version?: number): string {
  const suffix = version == null ? "" : `?v=${version}`;
  return `/api/preview/${encodeURIComponent(job.id)}${suffix}`;
}

type MediaElement = HTMLVideoElement | HTMLAudioElement;

function attachDetailMedia(
  media: MediaElement,
  job: Job,
  preserve: boolean,
): void {
  const time =
    preserve && Number.isFinite(media.currentTime) ? media.currentTime : 0;
  const wasPlaying = preserve && !media.paused;
  media.src = previewUrl(job, job.downloadedBytes);
  media.load();
  if (!preserve) return;

  const restore = (): void => {
    media.removeEventListener("loadedmetadata", restore);
    try {
      if (time > 0.1) media.currentTime = time;
    } catch {
      /* the new file may be shorter than the old playback position */
    }
    if (wasPlaying) void media.play().catch(() => undefined);
  };
  media.addEventListener("loadedmetadata", restore);
}

function badgeFor(
  job: Job,
  completed: string,
  active: string,
  paused: string,
  waiting: string,
  partial: string,
): string {
  if (job.status === "completed") return completed;
  if (job.status === "downloading") return active;
  if (job.status === "paused") return paused;
  if (job.status === "queued") return waiting;
  return partial;
}

function previewNote(job: Job, kind: "video" | "audio"): string {
  const noun = kind === "video" ? "video" : "audio";
  let note: string;
  if (job.status === "completed") {
    note = `Playing from the finished ${noun} file on your disk.`;
  } else if (job.status === "downloading") {
    note = `Streaming from the growing file on disk. Playback follows the download and may briefly buffer while new bytes arrive.`;
  } else if (job.status === "paused") {
    note = `The download is paused. You can play the bytes already on disk; playback continues when you resume.`;
  } else if (job.status === "queued") {
    note = `Waiting for a free slot. The player will start as soon as bytes arrive.`;
  } else {
    note = `The download stopped. You can still play the ${noun} bytes that were saved.`;
  }
  if (job.isPartial && job.rangeStart > 0) {
    note +=
      " This is a byte-range segment that starts mid-file, so it may not contain the container header a player needs.";
  }
  return note;
}

export function syncDetailMedia(job: Job): void {
  // Keep the source stable when a download completes. The live stream simply
  // reaches the end of the file, and reloading here would send the player back
  // to the start. Images reload once so a partial image becomes complete.
  const statusKey = job.kind === "image" ? job.status : "";
  const key = `${job.id}|${job.fileExists}|${job.canPreview}|${job.kind}|${statusKey}`;
  const changed = state.detailMediaKey !== key;
  if (changed) {
    state.detailMediaKey = key;
    state.detailMediaRetryAt = 0;
    resetDetailMedia();
  }

  if (!job.fileExists || !job.canPreview) {
    if (changed) {
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
    }
    return;
  }

  if (changed) {
    if (job.kind === "video") {
      els.detailVideo.src = previewUrl(job);
      els.detailVideo.hidden = false;
      els.detailVideo.load();
    } else if (job.kind === "audio") {
      els.detailAudio.src = previewUrl(job);
      els.detailAudio.hidden = false;
      els.detailAudio.load();
    } else if (job.kind === "image") {
      els.detailImage.src = previewUrl(job);
      els.detailImage.hidden = false;
    }
  }

  if (job.kind === "video") {
    els.detailPlayerBadge.textContent = badgeFor(
      job,
      "LOCAL PREVIEW",
      "LIVE PREVIEW",
      "PAUSED PREVIEW",
      "WAITING FOR BYTES",
      "PARTIAL PREVIEW",
    );
    els.detailPreviewNote.textContent = previewNote(job, "video");
  } else if (job.kind === "audio") {
    els.detailPlayerBadge.textContent = badgeFor(
      job,
      "LOCAL AUDIO",
      "LIVE AUDIO",
      "PAUSED AUDIO",
      "WAITING FOR BYTES",
      "PARTIAL AUDIO",
    );
    els.detailPreviewNote.textContent = previewNote(job, "audio");
  } else if (job.kind === "image") {
    els.detailPlayerBadge.textContent = badgeFor(
      job,
      "LOCAL IMAGE",
      "PARTIAL IMAGE",
      "PARTIAL IMAGE",
      "WAITING FOR BYTES",
      "PARTIAL IMAGE",
    );
    els.detailPreviewNote.textContent =
      job.status === "completed"
        ? "Showing the finished image on your disk."
        : "The image may appear incomplete until the download finishes.";
  }
}

/**
 * Recover a media preview when its live stream ends unexpectedly (for example
 * because the connection idled out while the download was paused). The new
 * request continues from the bytes that have arrived since.
 */
export function recoverDetailMedia(job: Job): void {
  if (!job.canPreview || job.status !== "downloading") return;
  if (job.isPartial && job.rangeStart > 0) return;
  const media =
    job.kind === "video"
      ? els.detailVideo
      : job.kind === "audio"
        ? els.detailAudio
        : null;

  if (media) {
    if (media.hidden || !media.getAttribute("src")) return;
    if (!media.error && !media.ended) return;
  } else if (job.kind === "image") {
    if (!els.detailImage.hidden) return;
  } else {
    return;
  }

  const now = Date.now();
  if (now - state.detailMediaRetryAt < 3_000) return;
  state.detailMediaRetryAt = now;

  if (media) {
    attachDetailMedia(media, job, true);
    return;
  }
  els.detailImage.src = previewUrl(job, job.downloadedBytes);
  els.detailImage.hidden = false;
  els.detailPlaceholder.hidden = true;
}

export function detailActions(job: Job): string {
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


export function bindDetailEvents(): void {
  els.detailCloseBtn.addEventListener("click", closeDetail);

  for (const media of [els.detailVideo, els.detailAudio]) {
    media.addEventListener("error", () => {
      if (!media.getAttribute("src") || media.hidden) return;
      const job = state.detailId ? state.jobs.get(state.detailId) : null;
      if (job?.isPartial && job.rangeStart > 0) {
        els.detailPreviewNote.textContent =
          "This byte-range segment starts mid-file, so it is missing the container header a player needs. Download the file from byte 0 to preview it.";
        return;
      }
      if (job?.status === "completed") {
        els.detailPreviewNote.textContent =
          "Your browser cannot play this codec. Save a copy and open it in a local media player.";
        return;
      }
      els.detailPreviewNote.textContent =
        "Waiting for more bytes. The preview reconnects automatically as the download advances.";
    });
  }

  els.detailImage.addEventListener("error", () => {
    if (els.detailImage.hidden) return;
    els.detailImage.hidden = true;
    els.detailPlaceholder.hidden = false;
    const label = els.detailPlaceholder.querySelector("span");
    if (label) label.textContent = "This image could not be decoded";
  });
}
