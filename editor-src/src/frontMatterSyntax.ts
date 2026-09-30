import type { BlockParser, MarkdownConfig } from "@lezer/markdown";
import { Tag } from "@lezer/highlight";

/**
 * Front-matter block detection for `@lezer/markdown`.
 *
 * There's no official front-matter extension for this parser, so this
 * implements the common convention (Jekyll/Hugo/Obsidian): the document's
 * very first line is `---` or `+++`, followed by any number of lines, closed
 * by a line containing only the same delimiter. Deliberately restricted to
 * `cx.lineStart === 0` — front matter only ever exists at the true start of
 * a file, which also means this parser can never misfire on a `---` used
 * elsewhere (e.g. as a Setext heading underline or thematic break).
 *
 * If no closing delimiter is ever found, the block is deliberately allowed to
 * run to the end of the document — the same permissive tradeoff already made
 * for unterminated `$$` blocks in `mathSyntax.ts`, and safe here for the same
 * reason: an opening delimiter at position 0 with no closing delimiter
 * anywhere in the file is a rare, malformed edge case, not a normal document.
 */

/** Highlight tag for the `---`/`+++` delimiter lines themselves. */
export const frontMatterTag = Tag.define();

const openRe = /^(-{3}|\+{3})[ \t]*$/;

function closeRe(delimiter: string): RegExp {
  return delimiter === "+++" ? /^\+{3}[ \t]*$/ : /^-{3}[ \t]*$/;
}

const frontMatterParser: BlockParser = {
  name: "FrontMatter",
  parse(cx, line) {
    if (cx.lineStart !== 0) {
      return false;
    }
    const match = openRe.exec(line.text.slice(line.pos));
    if (!match) {
      return false;
    }
    const close = closeRe(match[1]);
    const start = cx.lineStart;
    let end = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      end = cx.lineStart + line.text.length;
      if (close.test(line.text.slice(line.pos))) {
        cx.nextLine();
        break;
      }
    }
    cx.addElement(cx.elt("FrontMatter", start, end));
    return true;
  },
  before: "HorizontalRule"
};

export const FrontMatterExtension: MarkdownConfig = {
  defineNodes: [{ name: "FrontMatter", block: true, style: frontMatterTag }],
  parseBlock: [frontMatterParser]
};
