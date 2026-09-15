import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pngDimensions } from "./image-files.js";

const SAFE_BASENAME = /^[A-Za-z0-9_.-]{1,80}$/;

export interface SavedImage {
  path: string;
  sizeBytes: number;
  actualSize?: string;
  mimeType: string;
  bytes: Buffer;
}
function extensionForMime(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

export async function saveImage(
  root: string,
  bytes: Buffer,
  mimeType: string,
  basename: string | undefined,
  index: number,
): Promise<SavedImage> {
  const prefix = basename || `zy_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${crypto.randomBytes(3).toString("hex")}`;
  if (!SAFE_BASENAME.test(prefix) || prefix === "." || prefix === "..") {
    throw new Error("basename may contain only letters, digits, underscore, dash, and dot (max 80 chars)." );
  }
  await fs.mkdir(root, { recursive: true });
  const extension = extensionForMime(mimeType);
  const suffix = index === 0 ? "" : `_${index + 1}`;
  let candidate = path.join(root, `${prefix}${suffix}.${extension}`);
  for (let version = 2; ; version += 1) {
    try {
      const handle = await fs.open(candidate, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      candidate = path.join(root, `${prefix}${suffix}-v${version}.${extension}`);
    }
  }
  const dimensions = mimeType === "image/png" ? pngDimensions(bytes) : undefined;
  return {
    path: candidate,
    sizeBytes: bytes.length,
    actualSize: dimensions ? `${dimensions.width}x${dimensions.height}` : undefined,
    mimeType,
    bytes,
  };
}
