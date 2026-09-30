import { mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Copies KaTeX's stylesheet and woff2 fonts into public/katex/, so Vite
 * serves them verbatim (see vite.config.ts's `publicDir`) instead of
 * bundling them into editor.css — which force-inlines every font as base64
 * and bloats the stylesheet past a megabyte.
 *
 * Only woff2 is copied: katex.min.css lists woff2/woff/ttf per @font-face,
 * in that preference order, and every platform Smudge targets (WKWebView on
 * a current macOS) supports woff2. The missing woff/ttf entries in the CSS
 * are harmless — the browser never requests a format it doesn't need.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const katexDist = path.join(root, "node_modules", "katex", "dist");
const outDir = path.join(root, "public", "katex");
const outFonts = path.join(outDir, "fonts");

mkdirSync(outFonts, { recursive: true });
copyFileSync(path.join(katexDist, "katex.min.css"), path.join(outDir, "katex.min.css"));

const fontFiles = readdirSync(path.join(katexDist, "fonts")).filter((name) => name.endsWith(".woff2"));
for (const name of fontFiles) {
  copyFileSync(path.join(katexDist, "fonts", name), path.join(outFonts, name));
}

console.log(`Copied katex.min.css and ${fontFiles.length} woff2 fonts to public/katex/.`);
