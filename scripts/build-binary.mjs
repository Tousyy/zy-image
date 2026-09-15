#!/usr/bin/env node

import { copyFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const buildDir = path.join(root, "build");
const releaseDir = path.join(root, "release");
const extension = process.platform === "win32" ? ".exe" : "";
const packageName = `zy-image-mcp-${process.platform}-${process.arch}`;
const binaryName = `${packageName}${extension}`;
const output = path.join(buildDir, binaryName);
const packageDir = path.join(releaseDir, packageName);
const blob = path.join(buildDir, "sea-prep.blob");
const seaConfig = path.join(buildDir, "sea-config.json");

await mkdir(buildDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });
await rm(packageDir, { recursive: true, force: true });
await writeFile(seaConfig, JSON.stringify({
  main: path.join(buildDir, "sea.cjs"),
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, ["--experimental-sea-config", seaConfig]);
await rm(output, { force: true });
await copyFile(process.execPath, output);
if (process.platform !== "win32") await chmod(output, 0o755);

if (process.platform === "darwin") run("codesign", ["--remove-signature", output]);

const postject = path.join(root, "node_modules", "postject", "dist", "cli.js");
run(process.execPath, [
  postject,
  output,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
]);

if (process.platform === "darwin") run("codesign", ["--sign", "-", output]);

await mkdir(packageDir, { recursive: true });
await copyFile(output, path.join(packageDir, binaryName));
const installer = process.platform === "win32" ? "install-local.ps1" : "install-local.sh";
await copyFile(path.join(root, installer), path.join(packageDir, installer));
if (process.platform === "win32") {
  await copyFile(path.join(root, "install-local.cmd"), path.join(packageDir, "install-local.cmd"));
} else if (process.platform === "darwin") {
  const commandInstaller = path.join(packageDir, "install-local.command");
  await copyFile(path.join(root, "install-local.command"), commandInstaller);
  await chmod(commandInstaller, 0o755);
}
if (process.platform !== "win32") await chmod(path.join(packageDir, installer), 0o755);
await copyFile(path.join(root, "README.md"), path.join(packageDir, "README.md"));
await copyFile(path.join(root, "LICENSE"), path.join(packageDir, "LICENSE"));
await mkdir(path.join(packageDir, "docs"), { recursive: true });
await copyFile(path.join(root, "docs", "CAPABILITIES.md"), path.join(packageDir, "docs", "CAPABILITIES.md"));
console.log(packageDir);
