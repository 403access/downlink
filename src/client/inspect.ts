import { api } from "./api";
import { addUrls, getRangeFromForm } from "./composer";
import { clearImportedHeaders } from "./curl-preview";
import {
  clearFormError,
  closeDialog,
  els,
  setBusy,
  showFormError,
  state,
  toast,
} from "./dom";
import { handleJob } from "./events";
import { esc, formatBytes, hostFromUrl, kindLabel } from "./format";
import type { InspectResult, PartialRangeRequest } from "./types";

export function resetInspectPlayer(): void {
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

export function openInspectDialog(): void {
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

export function inspectFact(label: string, value: string): string {
  return `<div class="inspect-fact"><span>${esc(label)}</span><span title="${esc(
    value,
  )}">${esc(value)}</span></div>`;
}

export async function inspectCurrentUrl(): Promise<void> {
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
      body: JSON.stringify({
        url: raw,
        headers: state.importedHeaders,
      }),
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

export function renderInspectResult(result: InspectResult): void {
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

export async function addInspectedUrl(): Promise<void> {
  const probe = state.inspectProbe;
  if (!probe) return;
  let range: PartialRangeRequest | null = null;
  try {
    range = getRangeFromForm();
  } catch (error) {
    els.inspectError.textContent =
      error instanceof Error ? error.message : "Enter a valid byte range.";
    els.inspectError.hidden = false;
    return;
  }
  setBusy(els.inspectAddBtn, true, "Adding…");
  els.inspectError.hidden = true;
  try {
    const result = await addUrls([probe.finalUrl || probe.url], range);
    if (result.jobs.length > 0) {
      result.jobs.forEach((job) => handleJob(job, false));
      if (result.errors.length === 0) clearImportedHeaders();
      toast(
        range ? "Added partial download" : "Added to downloads",
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

export function bindInspectEvents(): void {
  els.inspectDialog.addEventListener("close", () => {
    state.inspectProbe = null;
    state.inspectPreviewUrl = null;
    state.inspectRequest += 1;
    resetInspectPlayer();
    setBusy(els.inspectBtn, false);
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
}
