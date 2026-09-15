import { promises as fs } from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { fetch, type Dispatcher } from "undici";

const MAX_INPUT_BYTES = 50 * 1024 * 1024;

export interface LoadedImage {
  bytes: Buffer;
  mimeType: string;
  filename: string;
}

function mimeFromName(name: string): string | undefined {
  const extension = path.extname(name).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  }[extension];
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function assertPublicHttpsUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("Image URLs must use HTTPS.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("Local image URLs are not allowed.");
  }
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error("Private-network image URLs are not allowed.");
    return;
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Image URL resolved to a private or unavailable address.");
  }
}

function parseDataUrl(source: string): LoadedImage | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(source);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) {
    throw new Error("Inline image must be between 1 byte and 50 MB.");
  }
  const extension = match[1].toLowerCase() === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  return { bytes, mimeType: match[1].toLowerCase(), filename: `input.${extension}` };
}

export async function loadImageSource(
  source: string,
  options: { allowLocal: boolean; inputRoot?: string; dispatcher?: Dispatcher; timeoutMs: number },
): Promise<LoadedImage> {
  const inline = parseDataUrl(source);
  if (inline) return inline;

  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    await assertPublicHttpsUrl(url);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(options.timeoutMs, 60_000)),
      dispatcher: options.dispatcher,
    });
    if (!response.ok) throw new Error(`Could not download input image: HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_INPUT_BYTES) throw new Error("Input image exceeds 50 MB.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) throw new Error("Input image must be between 1 byte and 50 MB.");
    const mimeType = response.headers.get("content-type")?.split(";")[0] || mimeFromName(url.pathname);
    if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
      throw new Error("Input URL must return PNG, JPEG, or WebP.");
    }
    return { bytes, mimeType, filename: path.basename(url.pathname) || "input.png" };
  }

  if (!options.allowLocal) {
    throw new Error("Local file paths are not accepted in this internal download context.");
  }
  const resolved = path.resolve(source);
  if (options.inputRoot) {
    const root = path.resolve(options.inputRoot);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Input path must stay under ZY_INPUT_ROOT (${root}).`);
    }
  }
  const real = await fs.realpath(resolved);
  if (options.inputRoot) {
    const realRoot = await fs.realpath(options.inputRoot);
    const relative = path.relative(realRoot, real);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Input symlink escapes ZY_INPUT_ROOT.");
    }
  }
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_BYTES) {
    throw new Error("Input image must be a regular file between 1 byte and 50 MB.");
  }
  const mimeType = mimeFromName(real);
  if (!mimeType) throw new Error("Local input must be PNG, JPEG, or WebP.");
  return { bytes: await fs.readFile(real), mimeType, filename: path.basename(real) };
}

export function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
