import { Tag } from "@lezer/highlight";
import type { BlockParser, InlineParser, MarkdownConfig } from "@lezer/markdown";

/**
 * A minimal, best-effort math syntax extension for `@lezer/markdown`.
 *
 * There is no official Math extension for this parser (the CommonMark/GFM
 * spec doesn't define one), so this implements the common Pandoc-style
 * convention used by most Markdown-with-math tools:
 *
 * - Inline: `$...$`, where the content has no leading/trailing whitespace and
 *   doesn't cross a blank line. This mirrors Pandoc's rule and is what stops
 *   ordinary prose like "$5 and $10" from being misread as math.
 * - Block: a line containing only `$$`, followed by any number of lines,
 *   closed by a line containing only `$$`.
 *
 * `\$` escapes a literal dollar sign inside a math span.
 */

/** Highlight tag for math source, used by both raw and preview mode styling. */
export const mathTag = Tag.define();

const DOLLAR = 36;
const BACKSLASH = 92;

const inlineMath: InlineParser = {
  name: "InlineMath",
  parse(cx, next, pos) {
    if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) {
      return -1;
    }
    // No whitespace immediately after the opening delimiter.
    const afterOpen = cx.slice(pos + 1, pos + 2);
    if (afterOpen === "" || /\s/.test(afterOpen)) {
      return -1;
    }

    let end = pos + 1;
    while (end < cx.end) {
      const code = cx.char(end);
      if (code === BACKSLASH) {
        end += 2;
        continue;
      }
      if (code === DOLLAR) {
        break;
      }
      end++;
    }
    if (end >= cx.end || cx.char(end) !== DOLLAR) {
      return -1;
    }
    // No whitespace immediately before the closing delimiter.
    const beforeClose = cx.slice(end - 1, end);
    if (/\s/.test(beforeClose)) {
      return -1;
    }

    return cx.addElement(cx.elt("InlineMath", pos, end + 1));
  },
  before: "Emphasis"
};

const blockMathRe = /^\$\$\s*$/;

const blockMath: BlockParser = {
  name: "BlockMath",
  parse(cx, line) {
    if (!blockMathRe.test(line.text.slice(line.pos))) {
      return false;
    }
    const start = cx.lineStart;
    let end = cx.lineStart + line.text.length;
    for (;;) {
      if (!cx.nextLine()) {
        break;
      }
      if (blockMathRe.test(line.text.slice(line.pos))) {
        end = cx.lineStart + line.text.length;
        cx.nextLine();
        break;
      }
      end = cx.lineStart + line.text.length;
    }
    cx.addElement(cx.elt("BlockMath", start, end));
    return true;
  },
  before: "FencedCode"
};

export const MathExtension: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: mathTag },
    { name: "BlockMath", block: true, style: mathTag }
  ],
  parseInline: [inlineMath],
  parseBlock: [blockMath]
};
