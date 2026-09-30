/**
 * Computes a stable hash of the editor sources and lockfile.
 *
 * `npm run checksum` rewrites `editor-src/.bundle-checksum` after a build; the
 * Xcode staleness-guard script (Phase 8) recomputes it and warns when the
 * vendored bundle no longer matches the source it was built from.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const inputs = ["src", "package-lock.json", "package.json", "vite.config.ts"];

function walk(target, files = []) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(target).sort()) {
      walk(join(target, entry), files);
    }
  } else {
    files.push(target);
  }
  return files;
}

const hash = createHash("sha256");
for (const input of inputs) {
  for (const file of walk(join(root, input))) {
    hash.update(relative(root, file).split(sep).join("/"));
    hash.update(readFileSync(file));
  }
}

const digest = hash.digest("hex");
const outputPath = join(root, ".bundle-checksum");

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(outputPath, "utf8").trim();
  } catch {
    existing = "";
  }
  if (existing !== digest) {
    console.error(`stale: expected ${digest}, found ${existing || "<none>"}`);
    process.exit(1);
  }
  console.log("up to date");
} else {
  writeFileSync(outputPath, `${digest}\n`);
  console.log(digest);
}
