import { Tag } from "@lezer/highlight";
import type { BlockContext, BlockParser, Element, LeafBlock, LeafBlockParser, Line, MarkdownConfig } from "@lezer/markdown";

/**
 * A `@lezer/markdown` extension for Pandoc/PHP-Markdown-Extra/markdown-it-deflist
 * style definition lists:
 *
 * ```
 * Term
 * : Definition one
 * : Definition two
 * ```
 *
 * There's no official definition-list extension for this parser, so this
 * implements the common, widely-supported subset: a single-line "term"
 * paragraph immediately followed (no blank line) by one or more lines
 * starting with `:` plus at least one space/tab, each becoming one
 * definition. This mirrors `Table`'s own technique in `@lezer/markdown`
 * (a `LeafBlockParser` that watches a paragraph-in-progress and decides,
 * once it sees the telltale second line, whether to reinterpret it) — see
 * that extension's `TableParser` for the same pattern. Multi-line terms and
 * indented multi-paragraph definitions aren't supported, the same kind of
 * simplifying trade-off already made for math/front-matter in this codebase.
 */

/** Highlight tag for a definition list's `:` marker. */
export const definitionMarkTag = Tag.define();
/** Highlight tag for a definition list's term line. */
export const definitionTermTag = Tag.define();

const defLineRe = /^:[ \t]+\S/;
const defPrefixRe = /^:[ \t]+/;

class DefinitionListParser implements LeafBlockParser {
  // `null` until the second line is seen, `false` once ruled out as a
  // definition list, or the accumulated child elements once confirmed.
  private defs: Element[] | false | null = null;

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    const text = line.text.slice(line.pos);
    const isDefLine = defLineRe.test(text);

    if (this.defs === null) {
      if (!isDefLine) {
        this.defs = false;
        return false;
      }
      this.defs = [
        cx.elt(
          "DefinitionListTerm",
          leaf.start,
          leaf.start + leaf.content.length,
          cx.parser.parseInline(leaf.content, leaf.start)
        )
      ];
      this.pushDefinition(cx, line, text);
      return false;
    }

    if (this.defs === false) {
      return false;
    }

    if (!isDefLine) {
      // Finished: don't consume this line, so it starts a fresh block.
      return true;
    }

    this.pushDefinition(cx, line, text);
    return false;
  }

  private pushDefinition(cx: BlockContext, line: Line, text: string): void {
    if (this.defs === false || this.defs === null) return;
    const markFrom = cx.lineStart + line.pos;
    const prefixLength = defPrefixRe.exec(text)![0].length;
    const contentFrom = markFrom + prefixLength;
    const contentTo = cx.lineStart + line.text.length;
    this.defs.push(cx.elt("DefinitionListMark", markFrom, markFrom + 1));
    this.defs.push(
      cx.elt("DefinitionListItem", contentFrom, contentTo, cx.parser.parseInline(text.slice(prefixLength), contentFrom))
    );
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!this.defs) return false;
    cx.addLeafElement(leaf, cx.elt("DefinitionList", leaf.start, cx.prevLineEnd(), this.defs));
    return true;
  }
}

const definitionListBlock: BlockParser = {
  name: "DefinitionList",
  leaf() {
    return new DefinitionListParser();
  },
  before: "SetextHeading"
};

export const DefinitionListExtension: MarkdownConfig = {
  defineNodes: [
    { name: "DefinitionList", block: true },
    { name: "DefinitionListTerm", style: { "DefinitionListTerm/...": definitionTermTag } },
    { name: "DefinitionListMark", style: definitionMarkTag },
    { name: "DefinitionListItem" }
  ],
  parseBlock: [definitionListBlock]
};
