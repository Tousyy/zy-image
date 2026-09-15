#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createMcpServer(config, () => config.apiKey);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 80 * 1024 * 1024,
  });
  await server.connect(transport);
  console.error(`zy-image-mcp stdio ready; outputs: ${config.saveDir}`);

  process.stdin.resume();
  const keepAlive = setInterval(() => {}, 60_000);
  try {
    await new Promise<void>((resolve) => {
      process.stdin.once("end", resolve);
    });
  } finally {
    clearInterval(keepAlive);
  }
  await server.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
