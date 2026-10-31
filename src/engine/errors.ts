export class DownloadFailure extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "DownloadFailure";
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof DownloadFailure) return error.message;
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Download paused.";
    if (error.message.includes("fetch failed")) {
      return "The connection to the remote server was lost.";
    }
    return error.message.slice(0, 600);
  }
  return "An unexpected error stopped the download.";
}

export function httpFailure(response: Response): DownloadFailure {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new DownloadFailure(
      `Access denied by the remote server (HTTP ${status}). The link may have expired or need a referer/cookie.`,
      status,
    );
  }
  if (status === 404) {
    return new DownloadFailure("The remote file no longer exists (HTTP 404).", status);
  }
  if (status === 429) {
    return new DownloadFailure(
      "The remote server is rate limiting downloads (HTTP 429). Try again later.",
      status,
    );
  }
  return new DownloadFailure(
    `Remote server returned HTTP ${status}${response.statusText ? ` ${response.statusText}` : ""}.`,
    status,
  );
}

export function parseUnsatisfiedTotal(value: string | null): number | null {
  if (!value) return null;
  const match = /^bytes\s+\*\/(\d+)$/i.exec(value.trim());
  return match?.[1] ? Number(match[1]) : null;
}
