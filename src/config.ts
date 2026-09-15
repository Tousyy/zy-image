import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { EnvHttpProxyAgent, type Dispatcher } from "undici";

export interface Config {
  baseUrl: string;
  apiKey?: string;
  saveDir: string;
  inputRoot?: string;
  inlineMaxBytes: number;
  timeoutMs: number;
  dispatcher?: Dispatcher;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function loadConfig(): Config {
  const rawBase = process.env.ZY_BASE_URL || "https://zy-api.cn/v1";
  const base = new URL(rawBase);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(base.hostname))) {
    throw new Error("ZY_BASE_URL must use HTTPS, except for a loopback test server.");
  }

  const saveDir = path.resolve(
    process.env.ZY_SAVE_DIR || path.join(os.homedir(), "Pictures", "zy-image-out"),
  );
  const inputRoot = process.env.ZY_INPUT_ROOT
    ? path.resolve(process.env.ZY_INPUT_ROOT)
    : undefined;

  let dispatcher: Dispatcher | undefined;
  if (process.env.ZY_USE_PROXY === "1") {
    dispatcher = new EnvHttpProxyAgent({
      httpProxy: process.env.HTTP_PROXY || process.env.http_proxy,
      httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy,
      noProxy: process.env.NO_PROXY || process.env.no_proxy,
    });
  }

  const defaultKeyFile = path.join(os.homedir(), ".config", "zy-image-mcp", "api-key");
  const keyFile = process.env.ZY_KEY_FILE || defaultKeyFile;
  let fileKey: string | undefined;
  try {
    const stat = fs.statSync(keyFile);
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
      console.error(`Warning: ${keyFile} is readable by other users; run chmod 600 on it.`);
    }
    fileKey = fs.readFileSync(keyFile, "utf8").trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return {
    baseUrl: base.toString().replace(/\/$/, ""),
    apiKey: process.env.ZY_API_KEY?.trim() || fileKey,
    saveDir,
    inputRoot,
    inlineMaxBytes: positiveInteger("ZY_INLINE_MAX_BYTES", 12 * 1024 * 1024),
    timeoutMs: positiveInteger("ZY_TIMEOUT_MS", 240_000),
    dispatcher,
  };
}
