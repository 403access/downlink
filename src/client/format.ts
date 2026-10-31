import type { FileKind, Job, JobStatus } from "./types";

export function esc(value: unknown): string {
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

export function icon(name: string, className = ""): string {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function formatBytes(bytes: number): string {
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

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

export function relativeTime(timestamp: number | null): string {
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

export function httpStatusLabel(status: number | null): string {
  if (status === 200) return "200 OK";
  if (status === 206) return "206 Partial Content";
  if (status === 416) return "416 Range Not Satisfiable";
  if (status) return `HTTP ${status}`;
  return "Waiting for response";
}

export function rangeLabel(job: Job): string {
  if (!job.isPartial) return "Full file";
  const end = job.rangeEnd ?? (job.remoteTotal > 0 ? job.remoteTotal - 1 : null);
  return `bytes=${job.rangeStart.toLocaleString()}-${
    end === null ? "" : end.toLocaleString()
  }`;
}

export function fullDate(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function statusLabel(status: JobStatus): string {
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

export function kindLabel(kind: FileKind): string {
  return kind === "other" ? "file" : kind;
}

export function kindIcon(kind: FileKind): string {
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

export function canPreviewNow(job: Job): boolean {
  return job.canPreview && job.fileExists;
}

export function isActiveStatus(status: JobStatus): boolean {
  return status === "downloading" || status === "queued";
}
