import { ProbeError } from "../probe";

export class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function json(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof ProbeError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return json({ error: message }, 500);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError("Expected a JSON request body.", 415);
  }
  const text = await req.text();
  if (text.length > 1_000_000) throw new HttpError("Request body is too large.", 413);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError("Expected a JSON object.", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("Invalid JSON.", 400);
  }
}

export function jobId(req: Request): string {
  const id = (req as Request & { params?: Record<string, string> }).params?.id;
  if (!id) throw new HttpError("Missing download id.", 400);
  return id;
}
