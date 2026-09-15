export interface PublicError {
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  requestId?: string;
  suggestedChanges: string[];
}
export class ZyApiError extends Error {
  constructor(public readonly detail: PublicError) {
    super(detail.message);
    this.name = "ZyApiError";
  }
}

export function sanitizeErrorText(text: string, secrets: string[]): string {
  let clean = text;
  for (const secret of secrets.filter(Boolean)) {
    clean = clean.split(secret).join("[REDACTED]");
  }
  clean = clean.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]");
  clean = clean.replace(/[A-Za-z0-9+/=]{128,}/g, "[REDACTED_BASE64]");
  return clean.slice(0, 1200);
}

export function classifyApiError(status: number, rawMessage: string): PublicError {
  const requestId = /request id:\s*([^\s)]+)/i.exec(rawMessage)?.[1];
  const message = rawMessage || `zy-api returned HTTP ${status}`;
  const lower = message.toLowerCase();
  const suggestedChanges: string[] = [];
  let code = `upstream_http_${status}`;

  if (status === 401 || status === 403) {
    code = "authentication_failed";
    suggestedChanges.push("Check that ZY_API_KEY is valid and allowed to use image models.");
  } else if (lower.includes("quality")) {
    code = "invalid_quality";
    suggestedChanges.push("Retry with quality='low'; zy-image-mcp only exposes this verified value.");
  } else if (lower.includes("size") || lower.includes("dimension")) {
    code = "invalid_size";
    suggestedChanges.push("Retry with 1024x1024, 1536x1024, or 1024x1536.");
  } else if (status === 429 || lower.includes("too many requests")) {
    code = "rate_limited";
    suggestedChanges.push("Retry later, request one image, or use a smaller size.");
  } else if (status === 524 || status === 408 || status >= 500) {
    code = "upstream_unavailable";
    suggestedChanges.push("Retry later or use a smaller size.");
  }

  return {
    code,
    message,
    status,
    retryable: status === 408 || status === 429 || status === 524 || status >= 500,
    requestId,
    suggestedChanges,
  };
}
