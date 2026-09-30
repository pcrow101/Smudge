import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Builds the editor core as a single self-contained IIFE bundle plus one CSS
 * file, written directly into the app's vendored resources directory.
 *
 * No code splitting and no dynamic imports: the bundle is loaded from a
 * `file://` URL inside WKWebView under a strict CSP, where module scripts and
 * chunk fetching are unreliable.
 */
export default defineConfig({
  // public/katex/ (KaTeX's CSS + woff2 fonts, copied verbatim by a script,
  // see README) is copied straight into outDir untouched — no bundling, no
  // base64 inlining.
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../Resources/editor", import.meta.url)),
    emptyOutDir: false,
    target: "safari18",
    cssCodeSplit: false,
    sourcemap: false,
    // Vite 8 builds with rolldown, which ships its own (oxc) minifier.
    // esbuild is no longer bundled, and pulling it back in just for
    // minification would re-add a native dependency with install scripts.
    minify: "oxc",
    assetsInlineLimit: 0,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "SmudgeEditor",
      formats: ["iife"],
      fileName: () => "editor.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => {
          if (asset.names?.some((name) => name.endsWith(".css"))) {
            return "editor.css";
          }
          return "assets/[name][extname]";
        }
      }
    }
  }
});
