import { fetch, FormData, Headers, type Dispatcher, type RequestInit, type Response } from "undici";
import { classifyApiError, sanitizeErrorText, ZyApiError } from "./errors.js";
import { loadImageSource, type LoadedImage } from "./image-files.js";
import type { ImageModel, ImageQuality } from "./contracts.js";

export interface ApiImage {
  bytes: Buffer;
  mimeType: string;
  revisedPrompt?: string;
}

export interface GenerateRequest {
  model: ImageModel;
  prompt: string;
  size: string;
  n: number;
  quality: ImageQuality;
  outputFormat: "png" | "jpeg" | "webp";
}

export interface EditRequest extends Omit<GenerateRequest, "n"> {
  images: LoadedImage[];
  mask?: LoadedImage;
}

interface ZyApiOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  dispatcher?: Dispatcher;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ZyApiClient {
  constructor(private readonly options: ZyApiOptions) {}

  async listModels(): Promise<string[]> {
    const response = await this.request("/models", () => ({ method: "GET" }), 1);
    const body = await this.parseJson(response);
    return Array.isArray(body?.data)
      ? body.data.map((entry: { id?: unknown }) => entry?.id).filter((id: unknown): id is string => typeof id === "string")
      : [];
  }

  async generate(request: GenerateRequest): Promise<ApiImage[]> {
    const response = await this.request("/images/generations", () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        n: request.n,
        quality: request.quality,
        output_format: request.outputFormat,
        response_format: "b64_json",
      }),
    }));
    return this.extractImages(await this.parseJson(response), request.outputFormat);
  }

  async edit(request: EditRequest): Promise<ApiImage[]> {
    const response = await this.request("/images/edits", () => {
      const form = new FormData();
      form.set("model", request.model);
      form.set("prompt", request.prompt);
      form.set("size", request.size);
      form.set("n", "1");
      form.set("quality", request.quality);
      form.set("output_format", request.outputFormat);
      form.set("response_format", "b64_json");
      for (const image of request.images) {
        form.append("image[]", new Blob([Uint8Array.from(image.bytes)], { type: image.mimeType }), image.filename);
      }
      if (request.mask) {
        form.set("mask", new Blob([Uint8Array.from(request.mask.bytes)], { type: "image/png" }), "mask.png");
      }
      return { method: "POST", body: form };
    });
    return this.extractImages(await this.parseJson(response), request.outputFormat);
  }

  private async request(
    path: string,
    buildInit: () => RequestInit,
    maxAttempts = 3,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const init = buildInit();
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.options.apiKey}`);
        headers.set("User-Agent", "zy-image-mcp/0.1.0");
        const response = await fetch(`${this.options.baseUrl}${path}`, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.options.timeoutMs),
          dispatcher: this.options.dispatcher,
        });
        if (response.ok) return response;

        const raw = sanitizeErrorText(await response.text(), [this.options.apiKey]);
        let message = raw;
        try {
          const parsed = JSON.parse(raw);
          message = String(parsed?.error?.message || parsed?.message || raw);
        } catch {
          // Preserve non-JSON gateway errors.
        }
        const detail = classifyApiError(response.status, message);
        if (!detail.retryable || attempt === maxAttempts) throw new ZyApiError(detail);
        await sleep(Math.min(8_000, 750 * 2 ** (attempt - 1)));
      } catch (error) {
        if (error instanceof ZyApiError) throw error;
        lastError = error;
        if (attempt === maxAttempts) {
          const raw = sanitizeErrorText(error instanceof Error ? error.message : String(error), [this.options.apiKey]);
          throw new ZyApiError({
            code: "network_error",
            message: raw,
            retryable: true,
            suggestedChanges: ["Check network/proxy settings or retry later."],
          });
        }
        await sleep(Math.min(8_000, 750 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  private async parseJson(response: Response): Promise<any> {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ZyApiError({
        code: "invalid_upstream_response",
        message: "zy-api returned a non-JSON response.",
        status: response.status,
        retryable: false,
        suggestedChanges: ["Check the configured ZY_BASE_URL."],
      });
    }
  }

  private async extractImages(body: any, requestedFormat: string): Promise<ApiImage[]> {
    if (!Array.isArray(body?.data) || body.data.length === 0) {
      throw new ZyApiError({
        code: "missing_image_payload",
        message: "zy-api response did not contain any image payloads.",
        retryable: false,
        suggestedChanges: ["Inspect the upstream response or retry with response_format=b64_json."],
      });
    }

    const images: ApiImage[] = [];
    for (const item of body.data) {
      let loaded: LoadedImage;
      if (typeof item?.b64_json === "string" && item.b64_json.length > 0) {
        const bytes = Buffer.from(item.b64_json, "base64");
        loaded = { bytes, mimeType: `image/${requestedFormat === "jpg" ? "jpeg" : requestedFormat}`, filename: `output.${requestedFormat}` };
      } else if (typeof item?.url === "string" && item.url.length > 0) {
        loaded = await loadImageSource(item.url, {
          allowLocal: false,
          dispatcher: this.options.dispatcher,
          timeoutMs: this.options.timeoutMs,
        });
      } else {
        throw new ZyApiError({
          code: "missing_image_payload",
          message: "An image result had neither b64_json nor url.",
          retryable: false,
          suggestedChanges: [],
        });
      }
      images.push({
        bytes: loaded.bytes,
        mimeType: loaded.mimeType,
        revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : undefined,
      });
    }
    return images;
  }
}
