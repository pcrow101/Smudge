import DOMPurify from "dompurify";

/**
 * HTML sanitization for everything the export renderer produces.
 *
 * The export renderer runs markdown-it with `html: true`, so raw HTML in a
 * document reaches the output verbatim. That's a feature for `<figure>` and
 * `<details>`, but it means a document the user didn't write controls the
 * markup. Two sinks consume it:
 *
 * - `renderDocumentHTML()` → Swift → an exported `.html`/`.pdf` file. This
 *   is the dangerous one: the export is opened *outside* the app, so the
 *   editor's CSP doesn't apply, and it's the file users forward to others.
 * - `renderInlineHTML()` → `innerHTML` on a footnote-preview widget. The
 *   editor's CSP (`script-src 'self'`, no `unsafe-inline`) already blocks
 *   script execution there, but defence in depth is cheap and the CSP
 *   shouldn't be the only thing standing between a document and script
 *   execution.
 *
 * DOMPurify uses the real DOM parser, which is the point — regex-based HTML
 * filtering loses to mutation/parser-confusion tricks, and we're running in
 * a WKWebView where a DOM is always available.
 */

/**
 * Tags we explicitly refuse on top of DOMPurify's defaults.
 *
 * `script`/`iframe`/`object`/`embed` are already blocked by default; listing
 * them is documentation, and insurance against a future config change that
 * widens the default set.
 *
 * `style` is the interesting one: DOMPurify would allow a `<style>` element
 * through, and the export template concatenates our stylesheet with the
 * document body, so a document could otherwise restyle or blank the page it
 * was exported into. `base` would repoint every relative URL; `meta` allows
 * `http-equiv="refresh"`; `form` gives a submission target.
 */
const FORBIDDEN_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "form",
  "noscript"
];

/**
 * `srcset` and `ping` are fetch vectors DOMPurify permits by default, and
 * `formaction` overrides a form target. None have a legitimate use in
 * rendered Markdown.
 *
 * Inline event handlers (`onclick`, `onerror`, …) don't need listing —
 * DOMPurify strips every `on*` attribute unconditionally.
 */
const FORBIDDEN_ATTRS = ["srcset", "ping", "formaction", "form"];

/**
 * MathML elements KaTeX emits that aren't in DOMPurify's default allow-list.
 *
 * KaTeX wraps its MathML in `<semantics>` with an `<annotation
 * encoding="application/x-tex">` carrying the original LaTeX. DOMPurify's
 * default MathML profile drops both, which doesn't just lose the annotation
 * — it unwraps the element and leaves the LaTeX source behind as a bare
 * text node inside `<math>`, so `$x^2$` exports with a stray "x^2" glued to
 * the rendered equation. Allowing these keeps KaTeX's output intact and
 * preserves the LaTeX round-trip that assistive tech and copy-paste rely on.
 */
const EXTRA_TAGS = ["semantics", "annotation", "annotation-xml"];

/**
 * Attributes our own renderers emit that aren't in DOMPurify's default
 * allow-list.
 *
 * `encoding` belongs to the `<annotation>` element above; the rest come from
 * markdown-it-footnote's backlink markup and the task-list checkboxes.
 * Without these, exported maths and footnotes render subtly wrong — the
 * usual reason people give up and disable sanitization, so it's worth being
 * precise instead.
 */
const EXTRA_ATTRS = ["encoding", "checked", "disabled", "start", "reversed", "colspan", "rowspan"];

const CONFIG = {
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: FORBIDDEN_ATTRS,
  ADD_TAGS: EXTRA_TAGS,
  ADD_ATTR: EXTRA_ATTRS,
  // KaTeX emits MathML (`<math>`, `<semantics>`, `<annotation>`) alongside
  // its styled spans, and diagrams may use inline SVG. DOMPurify allows both
  // namespaces by default; this makes the dependency explicit so a profile
  // change doesn't silently break maths rendering.
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true }
} as const;

let hookInstalled = false;

/**
 * DOMPurify's default `ALLOWED_URI_REGEXP` already rejects `javascript:`,
 * `vbscript:` and friends on `href`/`src`, so surviving links have a safe
 * scheme. This hook additionally pins `target`/`rel` on outbound links: an
 * exported document opened in a browser shouldn't hand `window.opener` to a
 * page the document author chose.
 *
 * In-document footnote backlinks (`#fn1`) are left alone — they must not
 * open a new window, and they carry no cross-origin risk.
 *
 * Installed once, globally: DOMPurify hooks are per-instance, not per-call.
 */
function ensureHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) {
      const href = node.getAttribute("href") ?? "";
      if (!href.startsWith("#")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
  });
  hookInstalled = true;
}

/** Sanitizes a full block-level document fragment. */
export function sanitizeBlockHTML(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html, CONFIG);
}

/** Sanitizes an inline fragment (no block wrapper is added). */
export function sanitizeInlineHTML(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html, CONFIG);
}
