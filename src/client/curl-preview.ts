import { parseCurl, type ParsedCurl } from "../curl";
import type { RequestHeader } from "../types";
import { els, state } from "./dom";
import { esc } from "./format";

function headerChipsMarkup(headers: RequestHeader[]): string {
  return headers
    .map((header) => {
      const preview =
        header.value.length > 140
          ? `${header.value.slice(0, 137)}…`
          : header.value || "—";
      return `<span class="header-chip" title="${esc(
        `${header.name}: ${header.value}`,
      )}"><b>${esc(header.name)}</b><span>${esc(preview)}</span></span>`;
    })
    .join("");
}

function renderImportedHeaders(): void {
  const headers = state.importedHeaders;
  els.headersPanel.hidden = headers.length === 0;
  els.headersCount.textContent = String(headers.length);
  els.headerChips.innerHTML = headerChipsMarkup(headers);
}

export function setImportedHeaders(headers: RequestHeader[]): void {
  state.importedHeaders = headers;
  renderImportedHeaders();
}

export function clearImportedHeaders(): void {
  setImportedHeaders([]);
}

function setCurlPreviewState(
  label: string,
  mode: "waiting" | "ready" | "error",
): void {
  els.curlPreviewState.textContent = label;
  els.curlPreviewState.className = `curl-preview-state is-${mode}`;
}

function renderCurlPreview(parsed: ParsedCurl): void {
  const range = parsed.range
    ? `bytes=${parsed.range.start}-${parsed.range.end ?? ""}`
    : "Full file";
  const headers = headerChipsMarkup(parsed.headers);
  const warnings = parsed.warnings
    .map((warning) => `<span>${esc(warning)}</span>`)
    .join("");
  els.curlPreviewBody.innerHTML = `
    <div class="curl-request-line">
      <span class="curl-method">${esc(parsed.method)}</span>
      <code>${esc(parsed.url)}</code>
    </div>
    <div class="curl-preview-facts">
      <div class="curl-preview-fact"><span>Range</span><strong title="${esc(range)}">${esc(range)}</strong></div>
      <div class="curl-preview-fact"><span>If-Range</span><strong title="${esc(parsed.ifRange ?? "")}">${esc(parsed.ifRange ?? "—")}</strong></div>
      <div class="curl-preview-fact"><span>Headers</span><strong>${parsed.headers.length}</strong></div>
    </div>
    ${
      headers
        ? `<div class="header-chips curl-preview-headers">${headers}</div>`
        : ""
    }
    ${
      warnings
        ? `<div class="curl-warnings"><strong>Notes</strong>${warnings}</div>`
        : ""
    }
  `;
  setCurlPreviewState("Ready", "ready");
  state.curlPreviewValid = true;
  els.curlImportBtn.disabled = false;
  els.curlError.hidden = true;
}

function renderCurlPreviewError(message: string, empty = false): void {
  state.curlPreviewValid = false;
  state.curlParsed = null;
  els.curlImportBtn.disabled = true;
  els.curlError.hidden = true;
  if (empty) {
    setCurlPreviewState("Waiting", "waiting");
    els.curlPreviewBody.innerHTML = `<p class="curl-preview-empty">Paste or type a cURL command to preview the URL, Range, If-Range and headers before importing.</p>`;
    return;
  }
  setCurlPreviewState("Check command", "error");
  els.curlPreviewBody.innerHTML = `<p class="curl-preview-empty">${esc(message)}</p>`;
}

export function updateCurlPreview(immediate = false): void {
  if (state.curlPreviewTimer) {
    window.clearTimeout(state.curlPreviewTimer);
    state.curlPreviewTimer = null;
  }
  const run = (): void => {
    state.curlPreviewTimer = null;
    const value = els.curlInput.value.trim();
    if (!value) {
      renderCurlPreviewError("", true);
      return;
    }
    try {
      const parsed = parseCurl(value);
      state.curlParsed = parsed;
      renderCurlPreview(parsed);
    } catch (error) {
      renderCurlPreviewError(
        error instanceof Error ? error.message : "That cURL command could not be parsed.",
      );
    }
  };
  if (immediate) run();
  else state.curlPreviewTimer = window.setTimeout(run, 120);
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*(?:\$\s*)?(?:sudo\s+)?curl(?:\.exe)?\b/i.test(text);
}

export function openCurlDialog(text = ""): void {
  els.curlError.hidden = true;
  els.curlError.textContent = "";
  if (text) els.curlInput.value = text;
  if (!els.curlDialog.open) els.curlDialog.showModal();
  updateCurlPreview(true);
  els.curlInput.focus();
}
