import { EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import { emojiForShortcode } from "./emoji";
import type { FrontMatterSummaryEntry } from "./frontMatter";

/**
 * A small bounded cache so re-rendering the same formula (repeated in the
 * document, or retyped to its previous state) skips KaTeX's layout pass.
 * Widget instances are already reused across unaffected decoration rebuilds
 * via `eq()` — this additionally covers the case where the *same source*
 * reappears as a genuinely new widget instance (e.g. after an undo/redo, or
 * duplicated elsewhere in the document).
 */
class RenderCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Refresh recency.
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
}

const katexCache = new RenderCache<string, string | { error: true; text: string }>(300);

function renderKatexHTML(source: string, display: boolean): string | { error: true; text: string } {
  const cacheKey = `${display ? "1" : "0"}\u0000${source}`;
  const cached = katexCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: string | { error: true; text: string };
  try {
    result = katex.renderToString(source, { displayMode: display, throwOnError: true, strict: "ignore" });
  } catch {
    result = { error: true, text: display ? `$$${source}$$` : `$${source}$` };
  }
  katexCache.set(cacheKey, result);
  return result;
}

/**
 * Renders a math span (inline or block) via KaTeX. Falls back to the raw
 * source, styled as an error, if the expression doesn't parse — math should
 * never block editing or hide content the author can't otherwise see.
 */
export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement(this.display ? "div" : "span");
    wrap.className = this.display ? "cm-md-math cm-md-math-block" : "cm-md-math cm-md-math-inline";
    const result = renderKatexHTML(this.source, this.display);
    if (typeof result === "string") {
      wrap.innerHTML = result;
    } else {
      wrap.classList.add("cm-md-math-error");
      wrap.textContent = result.text;
    }
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * A lightweight placeholder shown instead of the full widget when the
 * document is large enough to be in the `reduced` performance profile.
 * Avoids KaTeX layout, image decode/network, and table DOM construction
 * entirely — the raw source is always one click away via raw mode.
 */
export class CollapsedWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly kind: "math" | "image" | "table"
  ) {
    super();
  }

  override eq(other: CollapsedWidget): boolean {
    return other.label === this.label && other.kind === this.kind;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-md-collapsed cm-md-collapsed-${this.kind}`;
    span.textContent = this.label;
    span.title = "Switch to raw mode to edit, or wait for the document to finish loading.";
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** A rendered `<hr>` replacing a `---`/`***`/`___` horizontal rule line. */
export class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-md-hr";
    return hr;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Natural image dimensions, cached by src so re-showing an image (e.g. after
 *  scrolling it out and back into the viewport, or the same image used more
 *  than once) reserves the correct height immediately instead of jumping. */
const imageDimensionCache = new Map<string, { width: number; height: number }>();

/**
 * Renders `![alt](src)` as an actual image. `block` widgets (an image alone
 * on its own line) get room to breathe; inline images stay compact.
 *
 * Height is reserved from the image's natural size once known, so loading an
 * image doesn't cause the surrounding text to jump.
 */
export class ImageWidgetView extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly block: boolean
  ) {
    super();
  }

  override eq(other: ImageWidgetView): boolean {
    return other.src === this.src && other.alt === this.alt && other.block === this.block;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? "div" : "span");
    wrap.className = this.block ? "cm-md-image cm-md-image-block" : "cm-md-image cm-md-image-inline";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = this.alt;

    const known = imageDimensionCache.get(this.src);
    if (known) {
      // Reserve the aspect ratio immediately; browser lays out at the right
      // height before the bytes even arrive, so nothing shifts on load.
      img.style.aspectRatio = `${known.width} / ${known.height}`;
    }

    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        imageDimensionCache.set(this.src, { width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.onerror = () => {
      wrap.classList.add("cm-md-image-error");
      wrap.textContent = this.alt || this.src || "(image)";
    };
    img.src = this.src;
    wrap.appendChild(img);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * An interactive checkbox for a GFM task-list item marker (`[ ]` / `[x]`).
 * Clicking toggles the underlying source text directly, so undo/redo and the
 * Swift-side document both see it as an ordinary edit.
 */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-checkbox";
    box.checked = this.checked;
    box.onmousedown = (event) => event.preventDefault();
    box.onchange = () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" },
        userEvent: "input.toggleTask"
      });
    };
    return box;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

/**
 * Replaces an unordered list item's raw `-`/`*`/`+` marker with a rendered
 * bullet glyph. Ordered lists keep their literal `1.`/`2.` numbering (it's
 * meaningful content, not decoration), and task items keep their checkbox
 * instead of getting a redundant bullet — this widget is only used for
 * plain `BulletList` items.
 */
export class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "\u2022";
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Renders a `:shortcode:` as its Unicode emoji glyph. */
export class EmojiWidgetView extends WidgetType {
  constructor(readonly shortcode: string) {
    super();
  }

  override eq(other: EmojiWidgetView): boolean {
    return other.shortcode === this.shortcode;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-emoji";
    span.textContent = emojiForShortcode(this.shortcode) ?? `:${this.shortcode}:`;
    span.title = `:${this.shortcode}:`;
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The collapsed front-matter summary bar — a single-line block widget shown
 * in place of the raw `---`/YAML/`---` block, rendering the configured
 * fields (title/date/tags by default) as a compact label plus chips.
 * Clicking it moves the cursor inside the block, which is what actually
 * reveals the raw YAML (see the `FrontMatter` case in `livePreview.ts`) —
 * this widget itself has no expand/collapse logic of its own.
 */
export class FrontMatterSummaryWidget extends WidgetType {
  constructor(
    readonly raw: string,
    readonly entries: FrontMatterSummaryEntry[],
    readonly error: string | null,
    readonly nodeFrom: number
  ) {
    super();
  }

  override eq(other: FrontMatterSummaryWidget): boolean {
    return (
      other.raw === this.raw &&
      other.error === this.error &&
      JSON.stringify(other.entries) === JSON.stringify(this.entries)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement("div");
    bar.className = this.error ? "cm-md-frontmatter-bar cm-md-frontmatter-error" : "cm-md-frontmatter-bar";
    bar.title = this.error
      ? `Front matter \u2014 invalid YAML: ${this.error}`
      : "Click to edit front matter";

    const icon = document.createElement("span");
    icon.className = "cm-md-frontmatter-icon";
    icon.textContent = "\u25B8";
    bar.appendChild(icon);

    for (const entry of this.entries.slice(0, 6)) {
      const el = document.createElement("span");
      el.className = entry.chip ? "cm-md-frontmatter-chip" : "cm-md-frontmatter-value";
      el.textContent = entry.chip || !entry.label ? entry.value : `${entry.label}: ${entry.value}`;
      bar.appendChild(el);
    }

    bar.onmousedown = (event) => event.preventDefault();
    bar.onclick = () => {
      view.dispatch({
        selection: { anchor: Math.min(this.nodeFrom + 4, view.state.doc.length) },
        scrollIntoView: true
      });
      view.focus();
    };
    return bar;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

/**
 * A `[^label]` reference, rendered as a small clickable superscript number
 * (its position in reference order, matching `exportRender.ts`'s
 * `markdown-it-footnote` numbering for export). Clicking jumps the cursor to
 * the matching definition — which, like a hidden heading `#` or blockquote
 * `>`, is only actually hidden from its original spot while *not* the active
 * line, so jumping there both reveals and lets you edit its raw source.
 */
export class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly defFrom: number
  ) {
    super();
  }

  override eq(other: FootnoteRefWidget): boolean {
    return other.index === this.index && other.defFrom === this.defFrom;
  }

  override toDOM(view: EditorView): HTMLElement {
    const sup = document.createElement("sup");
    sup.className = "cm-md-footnote-ref";
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = String(this.index);
    link.title = "Go to footnote";
    link.onmousedown = (event) => event.preventDefault();
    link.onclick = (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.defFrom }, scrollIntoView: true });
      view.focus();
    };
    sup.appendChild(link);
    return sup;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

/** One entry rendered inside the aggregated footnotes section at document's end. */
export interface FootnoteItem {
  index: number;
  /** Pre-rendered inline HTML (via the shared `exportRenderer()`), so bold/links/code inside a footnote render correctly. */
  html: string;
  /** Position of this footnote's (first) reference, for the backlink. */
  refFrom: number;
}

/**
 * The aggregated block widget appended after the very last line of the
 * document, listing every *referenced* footnote definition — regardless of
 * where in the source each `[^label]: ...` was written — in reference order,
 * with a backlink from each footnote back up to where it was cited. This is
 * what actually makes footnotes appear "at the bottom of the page" in
 * preview, mirroring `markdown-it-footnote`'s export-time behaviour.
 */
export class FootnotesSectionWidget extends WidgetType {
  constructor(readonly items: FootnoteItem[]) {
    super();
  }

  override eq(other: FootnotesSectionWidget): boolean {
    return JSON.stringify(other.items) === JSON.stringify(this.items);
  }

  override toDOM(view: EditorView): HTMLElement {
    const section = document.createElement("section");
    section.className = "cm-md-footnotes";

    const hr = document.createElement("hr");
    hr.className = "cm-md-footnotes-sep";
    section.appendChild(hr);

    const list = document.createElement("ol");
    for (const item of this.items) {
      const li = document.createElement("li");
      li.className = "cm-md-footnote-item";

      const content = document.createElement("span");
      content.innerHTML = item.html;
      li.appendChild(content);

      const back = document.createElement("a");
      back.className = "cm-md-footnote-backref";
      back.href = "#";
      back.textContent = "\u21A9\uFE0E";
      back.title = "Back to reference";
      back.onmousedown = (event) => event.preventDefault();
      back.onclick = (event) => {
        event.preventDefault();
        view.dispatch({ selection: { anchor: item.refFrom }, scrollIntoView: true });
        view.focus();
      };
      li.appendChild(back);

      list.appendChild(li);
    }
    section.appendChild(list);
    return section;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" && event.type !== "click";
  }
}
