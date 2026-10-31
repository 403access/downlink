import type { ApiErrorBody } from "./types";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
