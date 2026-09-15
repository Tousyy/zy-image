#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../dist/config.js";
import { createMcpServer } from "../dist/server.js";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function fixturePng(width, height, variant) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      raw[offset] = variant === 1 ? Math.round(40 + 180 * x / width) : 30;
      raw[offset + 1] = variant === 1 ? 90 : Math.round(50 + 180 * y / height);
      raw[offset + 2] = variant === 1 ? Math.round(180 - 120 * y / height) : Math.round(50 + 170 * x / width);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const config = loadConfig();
if (!config.apiKey) throw new Error("ZY_API_KEY is required.");
await mkdir(config.saveDir, { recursive: true });
const fixtureA = path.join(config.saveDir, "fixture-blue.png");
const fixtureB = path.join(config.saveDir, "fixture-green.png");
await writeFile(fixtureA, fixturePng(1024, 1024, 1));
await writeFile(fixtureB, fixturePng(1024, 1024, 2));

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer(config, () => config.apiKey);
const client = new Client({ name: "zy-image-live-smoke", version: "1" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const checks = [];
const timeout = { timeout: 600_000, maxTotalTimeout: 600_000 };

async function call(name, args, validate) {
  const started = Date.now();
  try {
    const response = await client.callTool({ name, arguments: args }, undefined, timeout);
    const data = response.structuredContent;
    if (response.isError || data?.ok === false) {
      throw new Error(JSON.stringify(data?.error || data || { message: "Unknown tool error" }));
    }
    validate?.(data);
    checks.push({ tool: name, ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, result: data });
    return data;
  } catch (error) {
    checks.push({ tool: name, ok: false, seconds: Math.round((Date.now() - started) / 100) / 10, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

await call("server_info", {}, (data) => {
  if (data?.base_url !== config.baseUrl) throw new Error("server_info returned the wrong base URL.");
  if (!data?.api_key_configured) throw new Error("server_info did not detect the API key.");
});

await call("image_generate", {
  prompt: "Use case: stylized-concept. A polished abstract studio test image with one cobalt glass sphere and one warm gold cube on a neutral surface, soft side light, no text, no logo, no watermark.",
  model: "gpt-image-2.5-flare",
  size: "1024x1024",
  n: 1,
  quality: "low",
  output_format: "png",
  basename: "live-generate",
  inline_image: false,
}, (data) => {
  if (data?.saved?.length !== 1) throw new Error("Expected one generated image.");
});

await call("image_edit", {
  prompt: "Use case: precise-object-edit. Add a single matte white circle at the center. Keep the blue gradient background unchanged. No text, no logo, no watermark.",
  image_source: fixtureA,
  model: "gpt-image-2.5-sunburst",
  size: "1024x1024",
  quality: "low",
  output_format: "png",
  basename: "live-edit",
  inline_image: false,
}, (data) => {
  if (data?.saved?.length !== 1) throw new Error("Expected one edited image.");
});

await call("image_multi_reference", {
  prompt: "Use case: compositing. Image 1 supplies the blue color palette and image 2 supplies the green color palette. Create one clean abstract studio composition blending both palettes, with two simple glass objects. No text, no logo, no watermark.",
  image_sources: [fixtureA, fixtureB],
  model: "gpt-image-2.5-sunburst",
  size: "1024x1024",
  quality: "low",
  output_format: "png",
  basename: "live-multi-reference",
  inline_image: false,
}, (data) => {
  if (data?.saved?.length !== 1) throw new Error("Expected one multi-reference image.");
});

await call("image_batch_edit", {
  prompt: "Use case: precise-object-edit. Add one small soft white spotlight in the center while preserving the background palette. No text, no logo, no watermark.",
  image_sources: [fixtureA, fixtureB],
  model: "gpt-image-2.5-sunburst",
  size: "1024x1024",
  quality: "low",
  output_format: "png",
  basename: "live-batch",
  inline_image: false,
}, (data) => {
  if (data?.succeeded !== 2 || data?.failed !== 0) throw new Error(`Expected two successful batch items, got ${JSON.stringify(data)}`);
});

await client.close();
await server.close();

const summary = {
  ok: checks.every((check) => check.ok),
  base_url: config.baseUrl,
  output_dir: config.saveDir,
  checks,
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
