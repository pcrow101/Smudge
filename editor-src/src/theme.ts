import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { mathTag } from "./mathSyntax";
import { highlightTag } from "./highlightSyntax";
import { definitionMarkTag, definitionTermTag } from "./definitionListSyntax";
import { footnoteRefTag, footnoteDefMarkTag } from "./footnoteSyntax";

/**
 * CodeMirror theme expressed entirely through CSS custom properties, so Swift
 * can repaint by setting variables on `:root` rather than swapping extensions.
 */
export const smudgeTheme = EditorView.theme({
  "&": {
    color: "var(--smudge-fg)",
    backgroundColor: "var(--smudge-bg)"
  },
  ".cm-content": {
    caretColor: "var(--smudge-cursor)"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--smudge-cursor)"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--smudge-selection)"
  },
  ".cm-activeLine": {
    backgroundColor: "transparent"
  },
  ".cm-gutters": {
    backgroundColor: "var(--smudge-bg)",
    color: "var(--smudge-faint)",
    border: "none"
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--smudge-surface)"
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--smudge-surface)",
    outline: "1px solid var(--smudge-rule)"
  }
});

/**
 * Syntax colours for raw mode. Phase 3 adds the live-preview decorations that
 * sit on top of this for preview mode.
 */
export const smudgeHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--smudge-fg)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--smudge-accent)" },
  { tag: tags.url, color: "var(--smudge-accent)" },
  { tag: tags.monospace, fontFamily: "var(--smudge-font-mono)" },
  { tag: tags.quote, color: "var(--smudge-muted)" },
  { tag: tags.list, color: "var(--smudge-muted)" },
  { tag: tags.comment, color: "var(--smudge-muted)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--smudge-accent)" },
  { tag: tags.string, color: "var(--smudge-fg)" },
  { tag: tags.processingInstruction, color: "var(--smudge-faint)" },
  { tag: tags.meta, color: "var(--smudge-faint)" },
  { tag: mathTag, color: "var(--smudge-accent)", fontFamily: "var(--smudge-font-mono)" },
  { tag: highlightTag, backgroundColor: "#fef08a", color: "#1d1d1f" },
  { tag: definitionTermTag, fontWeight: "600" },
  { tag: definitionMarkTag, color: "var(--smudge-faint)" },
  { tag: footnoteRefTag, color: "var(--smudge-accent)" },
  { tag: footnoteDefMarkTag, color: "var(--smudge-faint)" }
]);

export function themeExtensions(): Extension {
  return [smudgeTheme, syntaxHighlighting(smudgeHighlightStyle)];
}

/** Applies appearance, font size, and any custom variables to the document. */
export function applyThemeVariables(
  appearance: "light" | "dark",
  fontSize: number,
  variables?: Record<string, string>
): void {
  const root = document.documentElement;
  root.dataset.theme = appearance;
  root.style.setProperty("--smudge-font-size", `${fontSize}px`);
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      root.style.setProperty(key.startsWith("--") ? key : `--${key}`, value);
    }
  }
}
