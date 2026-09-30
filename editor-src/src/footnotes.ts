import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { footnoteLabel } from "./footnoteSyntax";
import { exportRenderer } from "./exportRender";
import { FootnoteRefWidget, FootnotesSectionWidget, type FootnoteItem } from "./widgets";
import { HIDE, activeLineSpan, activeLineSet, overlapsActiveLine, toDecorationSet, type Entry } from "./livePreview";

/**
 * Renders `[^label]` references / `[^label]: ...` definitions
 * (`footnoteSyntax.ts`) as an actual footnote system in live preview: each
 * reference becomes a small superscript number, and every *referenced*
 * definition — wherever it was written in the source — is hidden from its
 * original spot and instead collected into one aggregated section appended
 * after the very last line of the document, in reference order. This
 * mirrors `exportRender.ts`'s `markdown-it-footnote` behaviour for HTML/PDF
 * export, so preview and export agree.
 *
 * This intentionally lives in its **own** `StateField`, separate from
 * `livePreview.ts`'s main decoration field, rather than folding into its
 * per-range incremental rebuild. Footnote numbering and the aggregated
 * bottom section are inherently *global*: a single edit anywhere (a new
 * reference, a deleted definition) can change the reference-order numbering
 * of every other footnote and the aggregated section's contents. That's
 * fundamentally incompatible with reusing decorations for "the untouched
 * rest of the document", which is what the main field's dirty-range
 * optimization relies on — so this field always does a fresh, whole-document
 * syntax-tree walk instead. A second small `StateField` composes fine here:
 * CodeMirror merges decorations from every field/plugin that provides them.
 */

interface DefInfo {
  label: string;
  from: number;
  to: number;
  contentFrom: number;
}

interface RefInfo {
  label: string;
  from: number;
  to: number;
}

function collectFootnotes(state: EditorState): { defs: Map<string, DefInfo>; refs: RefInfo[] } {
  const defs = new Map<string, DefInfo>();
  const refs: RefInfo[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FootnoteRef") {
        refs.push({ label: footnoteLabel(state.doc.sliceString(node.from, node.to)), from: node.from, to: node.to });
      } else if (node.name === "FootnoteDef") {
        const mark = node.node.getChild("FootnoteDefMark");
        if (!mark) return;
        const label = footnoteLabel(state.doc.sliceString(mark.from, mark.to));
        defs.set(label, { label, from: node.from, to: node.to, contentFrom: mark.to });
      }
    }
  });
  return { defs, refs };
}

function buildFootnoteEntries(state: EditorState): Entry[] {
  const { defs, refs } = collectFootnotes(state);
  if (defs.size === 0 || refs.length === 0) {
    return [];
  }

  const active = activeLineSet(state);
  const isActive = (from: number, to: number) => overlapsActiveLine(state, active, from, to);

  const entries: Entry[] = [];
  const numbering = new Map<string, number>();
  const items: FootnoteItem[] = [];
  let nextIndex = 1;

  for (const ref of refs) {
    const def = defs.get(ref.label);
    if (!def) continue; // Broken reference (no matching definition): leave the literal `[^label]` visible.

    let index = numbering.get(ref.label);
    if (index === undefined) {
      index = nextIndex++;
      numbering.set(ref.label, index);
      const raw = state.doc.sliceString(def.contentFrom, def.to);
      items.push({ index, html: exportRenderer().renderInline(raw), refFrom: ref.from });
    }

    if (!isActive(ref.from, ref.to)) {
      entries.push({
        from: ref.from,
        to: ref.to,
        deco: Decoration.replace({ widget: new FootnoteRefWidget(index, def.from) })
      });
    }
  }

  // A referenced definition's raw source is hidden from its original
  // location — same as a heading's `#` or a blockquote's `>` — only while
  // its own line isn't the one being actively edited, since its rendered
  // form now lives in the aggregated section below. Unreferenced
  // definitions (no matching `[^label]` anywhere) are left visible in place
  // rather than silently vanished.
  for (const def of defs.values()) {
    if (!numbering.has(def.label) || isActive(def.from, def.to)) continue;
    entries.push({ from: def.from, to: def.to, deco: HIDE });
  }

  if (items.length > 0) {
    items.sort((a, b) => a.index - b.index);
    entries.push({
      from: state.doc.length,
      to: state.doc.length,
      deco: Decoration.widget({ widget: new FootnotesSectionWidget(items), side: 1, block: true })
    });
  }

  return entries;
}

interface FootnoteFieldValue {
  decorations: DecorationSet;
  activeFrom: number;
  activeTo: number;
}

function build(state: EditorState): FootnoteFieldValue {
  const span = activeLineSpan(state);
  return { decorations: toDecorationSet(buildFootnoteEntries(state)), activeFrom: span.from, activeTo: span.to };
}

export const footnoteField = StateField.define<FootnoteFieldValue>({
  create: build,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) {
      return value;
    }
    if (!tr.docChanged) {
      const span = activeLineSpan(tr.state);
      if (span.from === value.activeFrom && span.to === value.activeTo) {
        return value;
      }
    }
    return build(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});
