import { Tag } from "@lezer/highlight";
import { tags } from "@lezer/highlight";
import type { InlineParser, MarkdownConfig } from "@lezer/markdown";

/**
 * A minimal `==highlighted text==` extension for `@lezer/markdown`.
 *
 * There's no official Highlight/Mark extension for this parser (it's not
 * part of CommonMark or the GFM spec — it's a widely-implemented convention
 * from Pandoc/Obsidian/markdown-it-mark instead), so this follows the same
 * pattern already used here for math (`mathSyntax.ts`): single-pass matching
 * of a fixed delimiter pair on one contiguous span, requiring non-whitespace
 * immediately inside both delimiters (so `a == b == c` full of stray `==`
 * doesn't get misread). A run of three or more `=` is deliberately excluded
 * from matching, so `===` (sometimes used as a Setext heading underline or
 * just emphatic punctuation) never triggers this.
 *
 * Nested inline formatting (e.g. `==**bold**==`) is intentionally not
 * supported, the same trade-off already made for `$...$` math spans — this
 * keeps the export-time `markdown-it` rendering in `exportRender.ts` (which
 * mirrors this exact convention) trivially consistent with live preview.
 */

/** Highlight tag for `==...==` spans, used by both raw and preview mode styling. */
export const highlightTag = Tag.define();

const EQUALS = 61;

const inlineHighlight: InlineParser = {
  name: "Highlight",
  parse(cx, next, pos) {
    if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) {
      return -1;
    }
    // No whitespace immediately after the opening delimiter.
    const afterOpen = cx.slice(pos + 2, pos + 3);
    if (afterOpen === "" || /\s/.test(afterOpen)) {
      return -1;
    }

    let end = pos + 2;
    while (end < cx.end) {
      if (cx.char(end) === EQUALS && cx.char(end + 1) === EQUALS && cx.char(end + 2) !== EQUALS) {
        break;
      }
      end++;
    }
    if (end >= cx.end) {
      return -1;
    }
    // No whitespace immediately before the closing delimiter.
    const beforeClose = cx.slice(end - 1, end);
    if (/\s/.test(beforeClose)) {
      return -1;
    }

    return cx.addElement(
      cx.elt("Highlight", pos, end + 2, [cx.elt("HighlightMark", pos, pos + 2), cx.elt("HighlightMark", end, end + 2)])
    );
  },
  before: "Emphasis"
};

export const HighlightExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: tags.processingInstruction }
  ],
  parseInline: [inlineHighlight]
};
