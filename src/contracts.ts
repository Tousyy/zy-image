import { z } from "zod";

export const MODELS = [
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
] as const;

export type ImageModel = (typeof MODELS)[number];

export const MODEL_CAPABILITIES = {
  "gpt-image-2": {
    generate: true,
    edit: true,
    defaultFor: [] as string[],
    quality: ["auto", "low", "medium", "high"] as const,
    status: "advertised_by_zy_api",
  },
  "gpt-image-2.5-flare": {
    generate: true,
    edit: true,
    defaultFor: ["generate"],
    quality: ["low"] as const,
    status: "advertised_by_zy_api",
  },
  "gpt-image-2.5-sunburst": {
    generate: true,
    edit: true,
    defaultFor: ["edit", "multi_reference", "batch_edit"],
    quality: ["low"] as const,
    status: "live_edit_verified_2026-09-15",
  },
} as const;

export const ModelSchema = z.enum(MODELS);
export const QualitySchema = z.enum(["auto", "low", "medium", "high"]).default("low").describe(
  "Quality value. On the current upstream route, gpt-image-2 supports auto/low/medium/high while both GPT Image 2.5 models accept only low.",
);

export type ImageQuality = z.infer<typeof QualitySchema>;

export function validateQuality(model: ImageModel, quality: ImageQuality): void {
  if (model !== "gpt-image-2" && quality !== "low") {
    throw new Error(`Model ${model} accepts only quality low on the current upstream route.`);
  }
}

export const SizeSchema = z.string().default("1024x1024").describe(
  "WIDTHxHEIGHT. Each edge must be divisible by 16, <=3840, aspect ratio <=3:1, and total pixels 655360..8294400.",
);

export const OutputFormatSchema = z.enum(["png", "jpeg", "webp"]).default("png");

export interface ParsedSize {
  width: number;
  height: number;
  normalized: string;
  pixels: number;
}
export function parseAndValidateSize(value: string): ParsedSize {
  const match = /^([1-9]\d*)x([1-9]\d*)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid size '${value}'. Use WIDTHxHEIGHT, for example 1024x1024.`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 256 || height < 256) {
    throw new Error(`Invalid size '${value}': each edge must be at least 256 pixels.`);
  }
  if (width > 3840 || height > 3840) {
    throw new Error(`Invalid size '${value}': the maximum edge is 3840 pixels.`);
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error(`Invalid size '${value}': width and height must be divisible by 16.`);
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 3) {
    throw new Error(`Invalid size '${value}': aspect ratio must not exceed 3:1.`);
  }
  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) {
    throw new Error(
      `Invalid size '${value}': total pixels must be between 655360 and 8294400.`,
    );
  }
  return { width, height, normalized: `${width}x${height}`, pixels };
}

export function validateCount(n: number, size: ParsedSize): void {
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new Error("n must be an integer between 1 and 10.");
  }
  if (size.pixels > 1_572_864 && n !== 1) {
    throw new Error("2K/4K requests require n=1 to avoid upstream queue failures.");
  }
}
