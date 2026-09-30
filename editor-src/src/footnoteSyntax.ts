import { Tag } from "@lezer/highlight";
import type { BlockParser, InlineParser, MarkdownConfig } from "@lezer/markdown";

/**
 * A minimal `[^label]` reference / `[^label]: definition` extension for
 * `@lezer/markdown`, mirroring the same widely-supported (Pandoc/PHP-Markdown-
 * Extra/GFM-adjacent, and what `markdown-it-footnote` implements for export
 * in `exportRender.ts`) convention:
 *
 * ```
 * Some text with a reference.[^1]
 *
 * [^1]: The footnote's definition text.
 * ```
 *
 * As with `definitionListSyntax.ts`, only the common single-line-definition
 * subset is supported (no multi-paragraph/indented-continuation footnotes) —
 * the same simplifying trade-off already made elsewhere in this codebase.
 * Live preview (`livePreview.ts`) is what actually moves the *rendered*
 * definitions down to the bottom of the document; this module only supplies
 * the syntax tree nodes.
 */

/** Highlight tag for a footnote reference (`[^label]`), used by raw-mode styling. */
export const footnoteRefTag = Tag.define();
/** Highlight tag for a footnote definition's `[^label]:` marker. */
export const footnoteDefMarkTag = Tag.define();

const defRe = /^\[\^([^\]\s]+)\]:[ \t]*/;
const refRe = /^\[\^([^\]\s]+)\]/;

const footnoteDefBlock: BlockParser = {
  name: "FootnoteDef",
  parse(cx, line) {
    const text = line.text.slice(line.pos);
    const match = defRe.exec(text);
    if (!match) {
      return false;
    }
    const start = cx.lineStart;
    const end = cx.lineStart + line.text.length;
    const markFrom = cx.lineStart + line.pos;
    const markTo = markFrom + match[0].length;
    const contentFrom = markTo;
    const children = [cx.elt("FootnoteDefMark", markFrom, markTo)];
    if (contentFrom < end) {
      children.push(...cx.parser.parseInline(text.slice(match[0].length), contentFrom));
    }
    cx.addElement(cx.elt("FootnoteDef", start, end, children));
    cx.nextLine();
    return true;
  },
  before: "FencedCode"
};

const footnoteRefInline: InlineParser = {
  name: "FootnoteRef",
  parse(cx, next, pos) {
    if (next !== 91 /* [ */) {
      return -1;
    }
    const match = refRe.exec(cx.slice(pos, cx.end));
    if (!match) {
      return -1;
    }
    const end = pos + match[0].length;
    // A `[^label]:` immediately following is a definition marker that
    // strayed into inline text (e.g. mid-paragraph), not a reference —
    // leave it as plain text rather than rendering a bogus ref.
    if (cx.slice(end, end + 1) === ":") {
      return -1;
    }
    return cx.addElement(cx.elt("FootnoteRef", pos, end));
  },
  before: "Link"
};

export const FootnoteExtension: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteDef", block: true },
    { name: "FootnoteDefMark", style: footnoteDefMarkTag },
    { name: "FootnoteRef", style: footnoteRefTag }
  ],
  parseBlock: [footnoteDefBlock],
  parseInline: [footnoteRefInline]
};

/** Extracts the `label` out of a `[^label]` or `[^label]:` source slice. */
export function footnoteLabel(source: string): string {
  return (refRe.exec(source) ?? defRe.exec(source))?.[1] ?? "";
}
