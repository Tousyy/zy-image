#!/usr/bin/env node

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.ZY_USE_PROXY === "1") {
  setGlobalDispatcher(new EnvHttpProxyAgent({
    httpProxy: process.env.HTTP_PROXY || process.env.http_proxy,
    httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy,
    noProxy: process.env.NO_PROXY || process.env.no_proxy,
  }));
}

const baseUrl = (process.env.ZY_BASE_URL || "https://zy-api.cn/v1").replace(/\/$/, "");
const apiKey = process.env.ZY_API_KEY;

if (!apiKey) {
  console.error("Set ZY_API_KEY in the process environment before probing.");
  process.exit(2);
}

const expectedModels = [
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
];
const qualities = ["auto", "low", "medium", "high", "xhigh", "max"];

function sanitize(text) {
  return text
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 800);
}

async function request(path, init = {}) {
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  if (!response) throw new Error("No response received");
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: sanitize(text) };
  }
  return { status: response.status, body };
}

function errorMessage(body) {
  return String(body?.error?.message || body?.message || body?.raw || "");
}

function classifyQuality(result) {
  const message = errorMessage(result.body).toLowerCase();
  if (message.includes("invalid quality") || message.includes("quality") && message.includes("support")) {
    return "rejected";
  }
  if (message.includes("prompt") || message.includes("required")) {
    return "not_rejected_before_required_field_check";
  }
  return `inconclusive_http_${result.status}`;
}

const modelsResponse = await request("/models");
const advertisedModels = Array.isArray(modelsResponse.body?.data)
  ? modelsResponse.body.data.map((item) => item?.id).filter(Boolean)
  : [];

const qualityMatrix = {};
for (const model of expectedModels) {
  qualityMatrix[model] = {};
  for (const quality of qualities) {
    // Omitting the required prompt guarantees that no image can be generated.
    // A quality rejection is conclusive; a prompt rejection only shows that
    // quality was not rejected before required-field validation.
    const result = await request("/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        n: 1,
        quality,
        response_format: "b64_json",
      }),
    });
    qualityMatrix[model][quality] = {
      classification: classifyQuality(result),
      status: result.status,
      message: sanitize(errorMessage(result.body)),
    };
  }
}

console.log(JSON.stringify({
  probed_at: new Date().toISOString(),
  base_url: baseUrl,
  advertised_models: advertisedModels,
  expected_models_present: expectedModels.every((model) => advertisedModels.includes(model)),
  method: "generation requests with required prompt omitted; no image can be generated",
  quality_matrix: qualityMatrix,
}, null, 2));
