import { parseCurl } from "../curl";
import type { RequestHeader } from "../types";
import { api } from "./api";
import {
  clearImportedHeaders,
  looksLikeCurl,
  openCurlDialog,
  setImportedHeaders,
  updateCurlPreview,
} from "./curl-preview";
import {
  clearFormError,
  closeDialog,
  els,
  setBusy,
  showFormError,
  state,
  toast,
} from "./dom";
import { openDetail } from "./detail";
import { handleJob } from "./events";
import { hostFromUrl } from "./format";
import type { Job, PartialRangeRequest } from "./types";

export async function addUrls(
  urls: string[],
  range: PartialRangeRequest | null = null,
  headers: RequestHeader[] = state.importedHeaders,
): Promise<{
  jobs: Job[];
  errors: Array<{ url: string; error: string }>;
}> {
  const payload: Record<string, unknown> =
    urls.length === 1 ? { url: urls[0] } : { urls };
  if (range) payload.range = range;
  if (headers.length > 0) payload.headers = headers;
  return api<{ jobs: Job[]; errors: Array<{ url: string; error: string }> }>(
    "/api/downloads",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getRangeFromForm(): PartialRangeRequest | null {
  if (!state.rangeMode) return null;
  const startText = els.rangeStartInput.value.trim();
  const endText = els.rangeEndInput.value.trim();
  const start = startText ? Number(startText) : 0;
  const end = endText ? Number(endText) : null;

  if (!Number.isInteger(start) || start < 0) {
    throw new Error("Range start must be a non-negative whole number.");
  }
  if (end !== null && (!Number.isInteger(end) || end < start)) {
    throw new Error("Range end must be a whole number at or after the start.");
  }
  if (start === 0 && end === null) {
    throw new Error("Enter a start byte or an end byte for a partial download.");
  }

  return {
    start,
    end,
    ifRange: els.rangeIfInput.value.trim() || null,
  };
}

export function updateRangePreview(): void {
  const start = els.rangeStartInput.value.trim() || "0";
  const end = els.rangeEndInput.value.trim();
  const ifRange = els.rangeIfInput.value.trim();
  els.rangePreview.textContent = `bytes=${start}-${end}${
    ifRange ? ` · If-Range: ${ifRange}` : ""
  }`;
}

export function updateAddButtonLabel(): void {
  const addLabel = els.addBtn.querySelector("span");
  if (!addLabel) return;
  addLabel.textContent = state.batchMode
    ? "Add all"
    : state.rangeMode
      ? "Add range"
      : "Add download";
}
export function importCurlCommand(): void {
  els.curlError.hidden = true;
  updateCurlPreview(true);
  if (!state.curlPreviewValid) return;
  try {
    const parsed = state.curlParsed ?? parseCurl(els.curlInput.value);
    if (state.batchMode) setBatchMode(false);
    els.urlInput.value = parsed.url;
    setImportedHeaders(parsed.headers);

    if (parsed.range) {
      setRangeMode(true);
      els.rangeStartInput.value = String(parsed.range.start);
      els.rangeEndInput.value =
        parsed.range.end === null ? "" : String(parsed.range.end);
      els.rangeIfInput.value = parsed.ifRange ?? "";
    } else {
      setRangeMode(false);
      els.rangeStartInput.value = "";
      els.rangeEndInput.value = "";
      els.rangeIfInput.value = "";
    }
    updateRangePreview();
    clearFormError();
    closeDialog(els.curlDialog);

    const details: string[] = [];
    if (parsed.headers.length > 0) {
      details.push(`${parsed.headers.length} header${parsed.headers.length === 1 ? "" : "s"}`);
    }
    if (parsed.range) {
      details.push(
        `bytes=${parsed.range.start}-${parsed.range.end ?? ""}`,
      );
    }
    toast(
      "cURL imported",
      details.length > 0 ? details.join(" · ") : "URL filled in.",
      "success",
    );
    if (parsed.warnings.length > 0) {
      toast("Import notes", parsed.warnings.join(" "), "info");
    }
    els.urlInput.focus();
  } catch (error) {
    els.curlError.textContent =
      error instanceof Error ? error.message : "Could not parse that cURL command.";
    els.curlError.hidden = false;
  }
}

export function collectFormUrls(): string[] {
  if (state.batchMode) {
    return els.batchInput.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const value = els.urlInput.value.trim();
  return value ? [value] : [];
}

export async function handleAddSubmit(): Promise<void> {
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

  let range: PartialRangeRequest | null = null;
  try {
    range = getRangeFromForm();
  } catch (error) {
    showFormError(
      error instanceof Error ? error.message : "Enter a valid byte range.",
    );
    els.rangeStartInput.focus();
    return;
  }

  state.adding = true;
  setBusy(
    els.addBtn,
    true,
    urls.length > 1 ? `Adding ${urls.length} links…` : "Inspecting…",
  );

  try {
    const result = await addUrls(urls, range);
    result.jobs.forEach((job) => handleJob(job, false));
    if (result.jobs.length > 0) {
      if (result.errors.length === 0) clearImportedHeaders();
      if (!state.batchMode && result.jobs.length === 1) {
        openDetail(result.jobs[0]!.id, { reveal: false });
      }
      if (state.batchMode) {
        const failedUrls = new Set(result.errors.map((item) => item.url));
        els.batchInput.value = urls.filter((url) => failedUrls.has(url)).join("\n");
      } else {
        els.urlInput.value = "";
      }
      toast(
        result.jobs.length === 1
          ? range
            ? "Added partial download"
            : "Added to downloads"
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

export function setRangeMode(enabled: boolean): void {
  if (enabled && state.batchMode) setBatchMode(false);
  state.rangeMode = enabled;
  els.rangePanel.hidden = !enabled;
  els.rangeToggle.classList.toggle("is-active", enabled);
  els.rangeToggle.setAttribute("aria-pressed", String(enabled));
  updateRangePreview();
  updateAddButtonLabel();
  if (enabled) els.rangeStartInput.focus();
}

export function setBatchMode(enabled: boolean): void {
  if (enabled && state.rangeMode) setRangeMode(false);
  state.batchMode = enabled;
  const urlField = document.querySelector<HTMLElement>(".url-field");
  if (urlField) urlField.hidden = enabled;
  els.batchInput.hidden = !enabled;
  els.inspectBtn.disabled = enabled;
  els.batchToggle.querySelector("span")?.replaceChildren(
    document.createTextNode(enabled ? "Single link" : "Batch mode"),
  );
  updateAddButtonLabel();

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

export async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    if (looksLikeCurl(text)) {
      openCurlDialog(text);
      return;
    }
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
