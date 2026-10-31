import { els, state } from "./dom";
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

export function openDetail(id: string): void {
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
  if (!els.detailDialog.open || state.detailId !== job.id) return;

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

export function syncDetailMedia(job: Job): void {
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
  els.detailDialog.addEventListener("close", () => {
    state.detailId = null;
    state.detailMediaKey = "";
    resetDetailMedia();
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
}
