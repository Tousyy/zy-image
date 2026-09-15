#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageName = `zy-image-mcp-${process.platform}-${process.arch}`;
const defaultBinary = path.join("release", packageName, `${packageName}${process.platform === "win32" ? ".exe" : ""}`);
const command = path.resolve(process.argv[2] || defaultBinary);
const useNode = command.endsWith(".js");
const transport = new StdioClientTransport({
  command: useNode ? process.execPath : command,
  args: useNode ? [command] : [],
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));

const client = new Client({ name: "zy-image-mcp-smoke", version: "1" });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const info = await client.callTool({ name: "server_info", arguments: {} });
  if (listed.tools.length !== 5 || info.structuredContent?.name !== "zy-image-mcp") {
    throw new Error("Unexpected MCP capabilities.");
  }
  console.log(JSON.stringify({ ok: true, tools: listed.tools.map((tool) => tool.name) }));
} finally {
  await client.close();
}
