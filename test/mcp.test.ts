import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.js";
import type { Config } from "../src/config.js";

function testConfig(): Config {
  return {
    baseUrl: "http://127.0.0.1:9",
    apiKey: "unused",
    saveDir: path.join(os.tmpdir(), "zy-image-mcp-tests"),
    inlineMaxBytes: 1024,
    timeoutMs: 1000,
  };
}

test("MCP initializes, advertises five tools, and publishes workflow instructions", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(testConfig(), () => "test-key");
  const client = new Client({ name: "test-client", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    assert.match(client.getInstructions() || "", /server_info/);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "image_batch_edit",
      "image_edit",
      "image_generate",
      "image_multi_reference",
      "server_info",
    ]);
    const info = await client.callTool({ name: "server_info", arguments: {} });
    assert.equal(info.isError, undefined);
    assert.match(JSON.stringify(info.structuredContent), /gpt-image-2.5-sunburst/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("invalid tool arguments are rejected without an API request", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(testConfig(), () => "test-key");
  const client = new Client({ name: "test-client", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "image_generate",
      arguments: { prompt: "test", size: "1920x1080", quality: "low" },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /divisible by 16/);
  } finally {
    await client.close();
    await server.close();
  }
});
