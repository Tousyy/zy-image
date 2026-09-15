#!/usr/bin/env node

import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../dist/config.js";
import { createMcpServer } from "../dist/server.js";

const config = loadConfig();
if (!config.apiKey) throw new Error("ZY_API_KEY is required.");
const model = process.env.ZY_TEST_MODEL || "gpt-image-2";
const quality = process.env.ZY_TEST_QUALITY || "high";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer(config, () => config.apiKey);
const client = new Client({ name: "zy-image-quality-smoke", version: "1" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

try {
  const response = await client.callTool({
    name: "image_generate",
    arguments: {
      prompt: "A premium studio test image of a single translucent amber glass sphere on a charcoal pedestal, precise rim light, clean background, no text, no logo, no watermark.",
      model,
      size: "1024x1024",
      n: 1,
      quality,
      output_format: "png",
      basename: `live-${model.replaceAll(".", "_")}-${quality}`,
      inline_image: false,
    },
  }, undefined, { timeout: 600_000, maxTotalTimeout: 600_000 });
  const data = response.structuredContent;
  console.log(JSON.stringify(data, null, 2));
  if (response.isError || data?.ok !== true || data?.saved?.length !== 1) process.exitCode = 1;
} finally {
  await client.close();
  await server.close();
}
