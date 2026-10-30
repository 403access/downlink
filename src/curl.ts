import { normalizeRequestHeaders } from "./headers";
import type { RequestHeader } from "./types";

export interface ParsedCurl {
  url: string;
  method: string;
  headers: RequestHeader[];
  range: { start: number; end: number | null } | null;
  ifRange: string | null;
  warnings: string[];
}

const VALUE_OPTIONS = new Set([
  "-o",
  "--output",
  "--output-dir",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--json",
  "-F",
  "--form",
  "--form-string",
  "--connect-timeout",
  "-m",
  "--max-time",
  "--retry",
  "--retry-delay",
  "--retry-max-time",
  "-x",
  "--proxy",
  "--proxy-user",
  "-u",
  "--user",
  "-w",
  "--write-out",
  "--limit-rate",
  "--max-filesize",
  "--interface",
  "--resolve",
  "--cacert",
  "--capath",
  "--cert",
  "--key",
  "--pass",
  "--connect-to",
  "--dns-servers",
  "--request-target",
  "--local-port",
  "--range",
  "-r",
]);

const BODY_OPTIONS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--json",
  "-F",
  "--form",
  "--form-string",
]);

const FLAG_OPTIONS = new Set([
  "-L",
  "--location",
  "--location-trusted",
  "--compressed",
  "-k",
  "--insecure",
  "-s",
  "--silent",
  "-S",
  "--show-error",
  "-f",
  "--fail",
  "--fail-with-body",
  "-g",
  "--globoff",
  "-I",
  "--head",
  "--http1.0",
  "--http1.1",
  "--http2",
  "--http2-prior-knowledge",
  "--ipv4",
  "--ipv6",
  "-N",
  "--no-buffer",
  "-i",
  "--include",
  "-v",
  "--verbose",
  "-4",
  "-6",
  "--no-progress-meter",
  "--progress-bar",
  "-O",
  "--remote-name",
  "-J",
  "--remote-header-name",
]);

function stripShellDollar(token: string): string {
  return token.startsWith("$") && token.length > 1 ? token.slice(1) : token;
}

/** Small POSIX-ish tokenizer for a pasted cURL command. */
export function tokenizeCurl(input: string): string[] {
  const text = input
    .replace(/\\\r?\n/g, " ")
    .replace(/\^\r?\n/g, " ")
    .replace(/`\r?\n/g, " ");
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  let hasToken = false;

  for (const char of text) {
    if (escaping) {
      current += char;
      escaping = false;
      hasToken = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      else {
        current += char;
        hasToken = true;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\") escaping = true;
      else {
        current += char;
        hasToken = true;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(stripShellDollar(current));
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }

  if (quote) throw new Error("The cURL command has an unterminated quote.");
  if (escaping) current += "\\";
  if (hasToken) tokens.push(stripShellDollar(current));
  return tokens;
}

function parseRequestedRange(
  value: string,
  warnings: string[],
): { start: number; end: number | null } | null {
  const trimmed = value.trim();
  if (trimmed.includes(",")) {
    warnings.push("Multiple byte ranges aren't supported; use one start/end range.");
    return null;
  }
  const match = /^(?:bytes\s*=\s*)?(\d+)-(\d*)$/i.exec(trimmed);
  if (!match) {
    warnings.push(`Unsupported Range header “${trimmed}” was ignored.`);
    return null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  if (!Number.isSafeInteger(start) || (end !== null && !Number.isSafeInteger(end))) {
    warnings.push("Range values are too large; the Range header was ignored.");
    return null;
  }
  if (end !== null && end < start) {
    warnings.push("Range end is before its start; the Range header was ignored.");
    return null;
  }
  return { start, end };
}

/**
 * Parse a pasted cURL command into the pieces Downlink can use:
 * URL, custom headers, Range/If-Range. It deliberately ignores request bodies,
 * cookies read from files and unsupported transfer options.
 */
export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenizeCurl(input);
  if (tokens.length === 0) throw new Error("Paste a cURL command first.");

  if (
    tokens[0] === "curl" ||
    tokens[0]?.endsWith("/curl") ||
    tokens[0]?.toLowerCase() === "curl.exe"
  ) {
    tokens.shift();
  }

  const warnings: string[] = [];
  const headerPairs: RequestHeader[] = [];
  let url: string | null = null;
  let positionalUrl: string | null = null;
  let method = "GET";
  let rangeHeader: string | null = null;
  let ifRange: string | null = null;
  let hasBody = false;

  const addHeader = (raw: string): void => {
    const line = raw.trim();
    if (!line) return;
    const colon = line.indexOf(":");
    let name: string;
    let value: string;
    if (colon === -1) {
      if (line.endsWith(";")) {
        name = line.slice(0, -1).trim();
        value = "";
      } else {
        warnings.push(`Ignored malformed header “${line}”.`);
        return;
      }
    } else {
      name = line.slice(0, colon).trim();
      value = line.slice(colon + 1).trim();
    }
    const lower = name.toLowerCase();
    if (lower === "range") {
      rangeHeader = value;
      return;
    }
    if (lower === "if-range") {
      ifRange = value || null;
      return;
    }
    headerPairs.push({ name, value });
  };

  const takeValue = (index: number, inline: string | null): string | null => {
    if (inline !== null) return inline;
    const next = tokens[index + 1];
    return next ?? null;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    let token = tokens[index] ?? "";
    if (!token) continue;

    // Support the common attached forms, e.g. -H'X: y' or -XPOST.
    if (!token.startsWith("--") && token.length > 2) {
      const short = token.slice(0, 2);
      const attached = token.slice(2);
      if (short === "-H") {
        addHeader(attached);
        continue;
      }
      if (short === "-A") {
        headerPairs.push({ name: "User-Agent", value: attached });
        continue;
      }
      if (short === "-e") {
        headerPairs.push({ name: "Referer", value: attached });
        continue;
      }
      if (short === "-b") {
        if (attached.includes("=")) headerPairs.push({ name: "Cookie", value: attached });
        else warnings.push("Cookie files aren't imported; pass a Cookie header instead.");
        continue;
      }
      if (short === "-r") {
        rangeHeader = attached;
        continue;
      }
      if (short === "-X") {
        method = attached.toUpperCase();
        continue;
      }
      if (short === "-d" || short === "-F" || short === "-o" || short === "-u") {
        if (short === "-d" || short === "-F") hasBody = true;
        continue;
      }
    }

    if (token === "--") {
      const rest = tokens.slice(index + 1).find((value) => !value.startsWith("-"));
      if (rest) positionalUrl ??= rest;
      break;
    }

    if (!token.startsWith("-")) {
      if (!positionalUrl && /^https?:\/\//i.test(token)) positionalUrl = token;
      continue;
    }

    const equals = token.indexOf("=");
    const option = equals > 0 ? token.slice(0, equals) : token;
    const inline = equals > 0 ? token.slice(equals + 1) : null;

    if (option === "--url") {
      url = takeValue(index, inline);
      if (inline === null) index += 1;
      continue;
    }
    if (option === "--header" || option === "-H") {
      const value = takeValue(index, inline);
      if (value !== null) addHeader(value);
      if (inline === null) index += 1;
      continue;
    }
    if (option === "--user-agent" || option === "-A") {
      const value = takeValue(index, inline);
      if (value !== null) headerPairs.push({ name: "User-Agent", value });
      if (inline === null) index += 1;
      continue;
    }
    if (option === "--referer" || option === "-e") {
      const value = takeValue(index, inline);
      if (value !== null) headerPairs.push({ name: "Referer", value });
      if (inline === null) index += 1;
      continue;
    }
    if (option === "--cookie" || option === "-b") {
      const value = takeValue(index, inline);
      if (value !== null) {
        if (value.includes("=")) headerPairs.push({ name: "Cookie", value });
        else warnings.push("Cookie files aren't imported; pass a Cookie header instead.");
      }
      if (inline === null) index += 1;
      continue;
    }
    if (option === "--range" || option === "-r") {
      rangeHeader = takeValue(index, inline);
      if (inline === null) index += 1;
      continue;
    }
    if (option === "--request" || option === "-X") {
      method = (takeValue(index, inline) ?? method).toUpperCase();
      if (inline === null) index += 1;
      continue;
    }

    if (BODY_OPTIONS.has(option)) {
      hasBody = true;
      if (inline === null && VALUE_OPTIONS.has(option)) index += 1;
      continue;
    }
    if (VALUE_OPTIONS.has(option)) {
      if (inline === null) index += 1;
      continue;
    }
    if (FLAG_OPTIONS.has(option)) continue;
    if (option.startsWith("--")) continue;

    // An unknown short option is most likely a flag. Do not consume its next
    // token, since that token may be the URL or a header value.
  }

  const finalUrl = url ?? positionalUrl;
  if (!finalUrl) {
    throw new Error("No URL was found in that cURL command.");
  }
  let normalizedUrl: URL;
  try {
    normalizedUrl = new URL(finalUrl);
  } catch {
    throw new Error("The cURL URL is not valid.");
  }
  if (normalizedUrl.protocol !== "http:" && normalizedUrl.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS cURL requests are supported.");
  }
  if (!["GET", "HEAD"].includes(method)) {
    warnings.push(`Method ${method} was ignored; Downlink only performs GET downloads.`);
  }
  if (hasBody) {
    warnings.push("Request bodies are ignored; the URL is downloaded with GET.");
  }

  const parsedRange =
    rangeHeader === null ? null : parseRequestedRange(rangeHeader, warnings);
  if (parsedRange && parsedRange.start === 0 && parsedRange.end === null) {
    warnings.push("A full-file Range was imported; use normal mode for the whole file.");
  }
  const effectiveRange =
    parsedRange && parsedRange.start === 0 && parsedRange.end === null
      ? null
      : parsedRange;
  if (!effectiveRange && ifRange) {
    warnings.push("If-Range was ignored because no usable Range header was present.");
  }

  return {
    url: normalizedUrl.href,
    method: "GET",
    headers: normalizeRequestHeaders(headerPairs),
    range: effectiveRange,
    ifRange: effectiveRange ? ifRange || null : null,
    warnings,
  };
}
