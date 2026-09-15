import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MODEL_CAPABILITIES, MODELS, ModelSchema, OutputFormatSchema, parseAndValidateSize, QualitySchema, SizeSchema, validateCount, type ImageModel } from "./contracts.js";
import type { Config } from "./config.js";
import { ZyApiError } from "./errors.js";
import { loadImageSource, pngDimensions } from "./image-files.js";
import { saveImage, type SavedImage } from "./output-store.js";
import { ZyApiClient, type ApiImage } from "./zy-api.js";

type KeyProvider = () => string | undefined;

const promptSchema = z.string().min(1).max(32_000).describe(
  "Production-ready image prompt. The conversation model should preserve exact user requirements and quote required text verbatim.",
);
const basenameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/).optional();
const inlineSchema = z.boolean().default(true).describe("Return generated pixels as MCP image content when within the configured byte limit.");

function safeSummary(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toolError(error: unknown): CallToolResult {
  const detail = error instanceof ZyApiError
    ? error.detail
    : {
        code: "local_validation_error",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        suggestedChanges: [] as string[],
      };
  return {
    isError: true,
    content: [{ type: "text", text: safeSummary({ ok: false, error: detail }) }],
    structuredContent: { ok: false, error: detail },
  };
}

async function finalize(
  images: ApiImage[],
  args: { requestedSize: string; model: ImageModel; basename?: string; inline: boolean },
  config: Config,
  notes: string[] = [],
): Promise<CallToolResult> {
  const saved: SavedImage[] = [];
  for (let index = 0; index < images.length; index += 1) {
    saved.push(await saveImage(config.saveDir, images[index].bytes, images[index].mimeType, args.basename, index));
  }
  const result = {
    ok: true,
    model: args.model,
    requested_size: args.requestedSize,
    saved: saved.map((item) => ({
      path: item.path,
      size_bytes: item.sizeBytes,
      actual_size: item.actualSize || null,
      size_honored: item.actualSize ? item.actualSize === args.requestedSize : null,
      mime_type: item.mimeType,
    })),
    notes,
  };
  const imageContent: CallToolResult["content"] = [];
  if (args.inline) {
    for (const item of saved) {
      if (item.sizeBytes <= config.inlineMaxBytes) {
        imageContent.push({ type: "image", data: item.bytes.toString("base64"), mimeType: item.mimeType });
      } else {
        result.notes.push(`Inline image omitted because ${item.sizeBytes} bytes exceeds ZY_INLINE_MAX_BYTES=${config.inlineMaxBytes}.`);
      }
    }
  }
  const content: CallToolResult["content"] = [
    { type: "text", text: safeSummary(result) },
    ...imageContent,
  ];
  return { content, structuredContent: result };
}

function requireKey(provider: KeyProvider): string {
  const key = provider()?.trim();
  if (!key) throw new Error("No zy-api key is configured. Run the local installer, set ZY_API_KEY, or create ~/.config/zy-image-mcp/api-key.");
  return key;
}

export function createMcpServer(config: Config, keyProvider: KeyProvider): McpServer {
  const server = new McpServer({ name: "zy-image-mcp", version: "0.1.0" }, {
    capabilities: { logging: {} },
    instructions: "Use server_info before the first image task. The conversation model should interpret the user's visual goal, preserve exact text/invariants, then call image_generate for no references, image_edit for one image, image_multi_reference for 2-10 references, or image_batch_edit for the same edit on multiple independent images. Only quality='low' is currently verified on zy-api. Always inspect saved.actual_size and size_honored. Upstream errors are structured; correct parameters and retry only when error.retryable or suggested_changes says so. Never ask users to paste keys into tool arguments.",
  });

  server.registerTool("server_info", {
    title: "ZY Image capabilities",
    description: "Return current models, verified parameter rules, transport mode, and safety limits. Call once before the first image request.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => {
    const info = {
      name: "zy-image-mcp",
      version: "0.1.0",
      base_url: config.baseUrl,
      api_key_configured: Boolean(keyProvider()),
      available_models: MODELS,
      model_capabilities: MODEL_CAPABILITIES,
      defaults: { generate: "gpt-image-2.5-flare", edit: "gpt-image-2.5-sunburst", quality: "low", size: "1024x1024" },
      endpoints: { generate: "/images/generations", edit: "/images/edits" },
      size_rules: { divisible_by: 16, min_edge: 256, max_edge: 3840, max_aspect_ratio: 3, min_pixels: 655_360, max_pixels: 8_294_400, high_resolution_requires_n: 1 },
      recommended_sizes: ["1024x1024", "1536x1024", "1024x1536", "2048x1152", "1152x2048", "3840x2160", "2160x3840"],
      output: { save_dir: config.saveDir, inline_max_bytes: config.inlineMaxBytes, always_reports_actual_size: true },
      input: { local_paths_allowed: true, accepted_sources: ["local path", "https URL", "data:image base64"], formats: ["png", "jpeg", "webp"], max_each_bytes: 50 * 1024 * 1024 },
      verification: {
        models_listed_by_zy_api: true,
        sunburst_low_edit_live_verified: "2026-09-15",
        higher_quality_values: "not exposed because zy-api rejected sunburst high and has no public model contract",
        exact_output_dimensions: "not guaranteed by gateway; inspect size_honored",
      },
    };
    return { content: [{ type: "text", text: safeSummary(info) }], structuredContent: info };
  });

  server.registerTool("image_generate", {
    title: "Generate images",
    description: "Generate images from text only. Default model is Flare. Use explicit size when the user specifies aspect ratio or resolution.",
    inputSchema: {
      prompt: promptSchema,
      model: ModelSchema.default("gpt-image-2.5-flare"),
      size: SizeSchema,
      n: z.number().int().min(1).max(10).default(1),
      quality: QualitySchema,
      output_format: OutputFormatSchema,
      basename: basenameSchema,
      inline_image: inlineSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => {
    try {
      const size = parseAndValidateSize(args.size);
      validateCount(args.n, size);
      const client = new ZyApiClient({ baseUrl: config.baseUrl, apiKey: requireKey(keyProvider), timeoutMs: config.timeoutMs, dispatcher: config.dispatcher });
      const images = await client.generate({ model: args.model, prompt: args.prompt, size: size.normalized, n: args.n, quality: args.quality, outputFormat: args.output_format });
      return await finalize(images, { requestedSize: size.normalized, model: args.model, basename: args.basename, inline: args.inline_image }, config);
    } catch (error) { return toolError(error); }
  });

  const editFields = {
    prompt: promptSchema,
    image_source: z.string().min(1).describe("Local path, HTTPS URL, or data:image source."),
    mask_source: z.string().min(1).optional().describe("Optional PNG alpha mask; transparent pixels are editable."),
    model: ModelSchema.default("gpt-image-2.5-sunburst"),
    size: SizeSchema,
    quality: QualitySchema,
    output_format: OutputFormatSchema,
    basename: basenameSchema,
    inline_image: inlineSchema,
  };

  server.registerTool("image_edit", {
    title: "Edit one image",
    description: "Edit one reference image through /images/edits. State invariants explicitly. A prompt cannot guarantee pixel-identical preservation; use a mask or local compositing when exact product labels must remain unchanged.",
    inputSchema: editFields,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => {
    try {
      const size = parseAndValidateSize(args.size);
      const options = { allowLocal: true, inputRoot: config.inputRoot, dispatcher: config.dispatcher, timeoutMs: config.timeoutMs };
      const image = await loadImageSource(args.image_source, options);
      const mask = args.mask_source ? await loadImageSource(args.mask_source, options) : undefined;
      if (mask) {
        if (mask.mimeType !== "image/png") throw new Error("mask_source must be a PNG image.");
        const imageSize = pngDimensions(image.bytes);
        const maskSize = pngDimensions(mask.bytes);
        if (!imageSize || !maskSize || imageSize.width !== maskSize.width || imageSize.height !== maskSize.height) {
          throw new Error("For masked editing, the input and mask must both be PNG with identical dimensions.");
        }
      }
      const client = new ZyApiClient({ baseUrl: config.baseUrl, apiKey: requireKey(keyProvider), timeoutMs: config.timeoutMs, dispatcher: config.dispatcher });
      const images = await client.edit({ model: args.model, prompt: args.prompt, size: size.normalized, quality: args.quality, outputFormat: args.output_format, images: [image], mask });
      return await finalize(images, { requestedSize: size.normalized, model: args.model, basename: args.basename, inline: args.inline_image }, config, ["Reference-image edits may redraw unmasked details. For exact labels or logos, composite original pixels locally after generation."]);
    } catch (error) { return toolError(error); }
  });

  server.registerTool("image_multi_reference", {
    title: "Create from multiple references",
    description: "Combine 2-10 reference images into one new image through /images/edits. Assign each image a role in the prompt.",
    inputSchema: {
      prompt: promptSchema,
      image_sources: z.array(z.string().min(1)).min(2).max(10),
      model: ModelSchema.default("gpt-image-2.5-sunburst"),
      size: SizeSchema,
      quality: QualitySchema,
      output_format: OutputFormatSchema,
      basename: basenameSchema,
      inline_image: inlineSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => {
    try {
      const size = parseAndValidateSize(args.size);
      const options = { allowLocal: true, inputRoot: config.inputRoot, dispatcher: config.dispatcher, timeoutMs: config.timeoutMs };
      const imagesIn = await Promise.all(args.image_sources.map((source) => loadImageSource(source, options)));
      const total = imagesIn.reduce((sum, image) => sum + image.bytes.length, 0);
      if (total > 80 * 1024 * 1024) throw new Error("Combined reference images exceed the 80 MB safety limit.");
      const client = new ZyApiClient({ baseUrl: config.baseUrl, apiKey: requireKey(keyProvider), timeoutMs: config.timeoutMs, dispatcher: config.dispatcher });
      const images = await client.edit({ model: args.model, prompt: args.prompt, size: size.normalized, quality: args.quality, outputFormat: args.output_format, images: imagesIn });
      return await finalize(images, { requestedSize: size.normalized, model: args.model, basename: args.basename, inline: args.inline_image }, config);
    } catch (error) { return toolError(error); }
  });

  server.registerTool("image_batch_edit", {
    title: "Batch edit independent images",
    description: "Apply the same edit independently to 2-10 inputs. Requests run sequentially to respect zy-api image queues; each result reports success or a structured error.",
    inputSchema: {
      prompt: promptSchema,
      image_sources: z.array(z.string().min(1)).min(2).max(10),
      model: ModelSchema.default("gpt-image-2.5-sunburst"),
      size: SizeSchema,
      quality: QualitySchema,
      output_format: OutputFormatSchema,
      basename: basenameSchema,
      inline_image: inlineSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (args) => {
    try {
      const size = parseAndValidateSize(args.size);
      const key = requireKey(keyProvider);
      const client = new ZyApiClient({ baseUrl: config.baseUrl, apiKey: key, timeoutMs: config.timeoutMs, dispatcher: config.dispatcher });
      const options = { allowLocal: true, inputRoot: config.inputRoot, dispatcher: config.dispatcher, timeoutMs: config.timeoutMs };
      const allSaved: SavedImage[] = [];
      const results: unknown[] = [];
      for (let index = 0; index < args.image_sources.length; index += 1) {
        try {
          const input = await loadImageSource(args.image_sources[index], options);
          const output = await client.edit({ model: args.model, prompt: args.prompt, size: size.normalized, quality: args.quality, outputFormat: args.output_format, images: [input] });
          const saved = await saveImage(config.saveDir, output[0].bytes, output[0].mimeType, args.basename ? `${args.basename}_${index + 1}` : undefined, 0);
          allSaved.push(saved);
          results.push({ index, ok: true, path: saved.path, actual_size: saved.actualSize || null, size_honored: saved.actualSize ? saved.actualSize === size.normalized : null });
        } catch (error) {
          results.push({ index, ok: false, error: error instanceof ZyApiError ? error.detail : { code: "batch_item_failed", message: error instanceof Error ? error.message : String(error), retryable: false } });
        }
      }
      const summary = { ok: allSaved.length > 0, total: args.image_sources.length, succeeded: allSaved.length, failed: args.image_sources.length - allSaved.length, model: args.model, requested_size: size.normalized, results };
      const content: CallToolResult["content"] = [{ type: "text", text: safeSummary(summary) }];
      if (args.inline_image) {
        for (const item of allSaved) if (item.sizeBytes <= config.inlineMaxBytes) content.push({ type: "image", data: item.bytes.toString("base64"), mimeType: item.mimeType });
      }
      return { isError: allSaved.length === 0, content, structuredContent: summary };
    } catch (error) { return toolError(error); }
  });

  return server;
}
