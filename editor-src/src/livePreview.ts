import { syntaxTree } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateField, Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { BulletWidget, CheckboxWidget, CollapsedWidget, EmojiWidgetView, FrontMatterSummaryWidget, HrWidget, ImageWidgetView, MathWidget } from "./widgets";
import { TableWidget } from "./tables";
import { getFrontMatterFieldConfig, highlightYaml, setFrontMatterOverride, summarizeFrontMatter } from "./frontMatter";
import { docSizeBytes, getPerfThresholds } from "./perf";

/**
 * The live-preview decoration layer: walks the syntax tree and produces two
 * kinds of decoration:
 *
 * - Styling marks (bold, italic, headings, links, …) that always apply.
 * - "Hide the raw syntax" replacements, which only apply to nodes whose line
 *   range does *not* intersect the current selection — so the line you're
 *   actively editing always shows its real Markdown source, and every other
 *   line shows the formatted result. This is the core Typora/Obsidian-style
 *   live-preview trick.
 *
 * This lives in a `StateField` rather than a `ViewPlugin`: CodeMirror only
 * allows block-level decorations (the `HrWidget`/`TableWidget`/block
 * `MathWidget`/standalone-image widgets below) to be supplied from a state
 * field — a plugin throws `RangeError: Block decorations may not be
 * specified via plugins` the moment one appears in the document.
 *
 * **Large-document performance.** A `StateField` can't restrict itself to
 * `view.visibleRanges` (that's only available to view plugins, which can't
 * hold block decorations), so instead this only *recomputes* the small
 * "dirty" span actually affected by a transaction — the changed lines, plus
 * whichever lines gained or lost "active" status (i.e. the line the cursor
 * left, and the line it entered) — and splices that back into the existing
 * `DecorationSet` via `RangeSet.update`. A keystroke in a 20 MB document costs
 * roughly the same as one in a 20 KB document: proportional to the edit, not
 * the file. Multi-cursor "is this node on an active line" checks still
 * consult every selection range (cheap — proportional to cursor count, not
 * document size), so correctness for multiple cursors is unaffected.
 */

export const HIDE = Decoration.replace({});

export interface Entry {
  from: number;
  to: number;
  deco: Decoration;
}

export interface LivePreviewOptions {
  /**
   * When true (the `reduced` performance profile), math/image/table widgets
   * render as lightweight static placeholders instead of running KaTeX,
   * decoding images, or building table DOM. Inline styling and marker-hiding
   * are unaffected.
   */
  collapseWidgets: boolean;
  /**
   * Whether a document's front-matter block starts collapsed. Only affects
   * the field's initial value (`create`) — once a document is open, the
   * front-matter block's actual collapse state is tracked per-document in
   * `FieldValue.frontMatterOverride`, not re-derived from this option.
   */
  frontMatterDefaultCollapsed: boolean;
}

const defaultOptions: LivePreviewOptions = { collapseWidgets: false, frontMatterDefaultCollapsed: true };

/** Every document line number touched by any selection range. */
export function activeLineSet(state: EditorState): Set<number> {
  const lines = new Set<number>();
  const { doc } = state;
  for (const range of state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.to).number;
    for (let n = fromLine; n <= toLine; n++) lines.add(n);
  }
  return lines;
}

/** Document-position span covering every active line, expanded to full lines. */
export function activeLineSpan(state: EditorState): { from: number; to: number } {
  const { doc } = state;
  let minLine = Infinity;
  let maxLine = -Infinity;
  for (const range of state.selection.ranges) {
    minLine = Math.min(minLine, doc.lineAt(range.from).number);
    maxLine = Math.max(maxLine, doc.lineAt(range.to).number);
  }
  if (minLine === Infinity) {
    minLine = 1;
    maxLine = 1;
  }
  return { from: doc.line(minLine).from, to: doc.line(Math.min(maxLine, doc.lines)).to };
}

function expandToLines(doc: Text, from: number, to: number): { from: number; to: number } {
  const clampedFrom = Math.max(0, Math.min(from, doc.length));
  const clampedTo = Math.max(clampedFrom, Math.min(Math.max(to, from), doc.length));
  return { from: doc.lineAt(clampedFrom).from, to: doc.lineAt(clampedTo).to };
}

export function overlapsActiveLine(state: EditorState, active: Set<number>, from: number, to: number): boolean {
  const { doc } = state;
  const fromLine = doc.lineAt(from).number;
  const toLine = doc.lineAt(Math.max(from, to - 1)).number;
  for (let n = fromLine; n <= toLine; n++) {
    if (active.has(n)) return true;
  }
  return false;
}

/** Splits a node's direct children into delimiter ("...Mark") and content nodes. */
function markChildren(node: SyntaxNode): SyntaxNode[] {
  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name.endsWith("Mark")) marks.push(child);
  }
  return marks;
}

function headingClass(name: string): string {
  const level = name.match(/\d/)?.[0] ?? "1";
  return `cm-md-heading cm-md-h${level}`;
}

const inlineStyleClass: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
  Subscript: "cm-md-sub",
  Superscript: "cm-md-sup",
  Highlight: "cm-md-highlight"
};

function buildDecorations(
  state: EditorState,
  from: number,
  to: number,
  options: LivePreviewOptions,
  frontMatterOverride: boolean | null
): Entry[] {
  const entries: Entry[] = [];
  const { doc } = state;
  const active = activeLineSet(state);
  const isActive = (nodeFrom: number, nodeTo: number) => overlapsActiveLine(state, active, nodeFrom, nodeTo);

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const style = inlineStyleClass[node.name];
      if (style) {
        entries.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: style }) });
        if (!isActive(node.from, node.to)) {
          for (const mark of markChildren(node.node)) {
            entries.push({ from: mark.from, to: mark.to, deco: HIDE });
          }
        }
        return;
      }

      switch (node.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          const line = doc.lineAt(node.from);
          entries.push({ from: line.from, to: line.from, deco: Decoration.line({ class: headingClass(node.name) }) });
          if (!isActive(node.from, node.to)) {
            const mark = node.node.getChild("HeaderMark");
            if (mark) {
              entries.push({ from: mark.from, to: Math.min(mark.to + 1, node.to), deco: HIDE });
            }
          }
          return;
        }

        case "Link": {
          if (isActive(node.from, node.to)) return;
          const marks = node.node.getChildren("LinkMark");
          if (marks.length < 2) return;
          const labelFrom = marks[0].to;
          const labelTo = marks[1].from;
          entries.push({ from: node.from, to: labelFrom, deco: HIDE });
          entries.push({ from: labelFrom, to: labelTo, deco: Decoration.mark({ class: "cm-md-link-text" }) });
          entries.push({ from: labelTo, to: node.to, deco: HIDE });
          return;
        }

        case "Image": {
          const marks = node.node.getChildren("LinkMark");
          if (isActive(node.from, node.to)) return false;
          const urlNode = node.node.getChild("URL");
          const url = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : "";
          const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
          const line = doc.lineAt(node.from);
          const alone = line.text.trim() === doc.sliceString(node.from, node.to).trim();
          const widget = options.collapseWidgets
            ? new CollapsedWidget(`\u{1F5BC}\uFE0F ${alt || "Image"}`, "image")
            : new ImageWidgetView(url, alt, alone);
          if (alone) {
            entries.push({ from: line.from, to: line.to, deco: Decoration.replace({ widget, block: true }) });
          } else {
            entries.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget }) });
          }
          return false;
        }

        case "Blockquote": {
          const startLine = doc.lineAt(node.from).number;
          const endLine = doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            entries.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-md-quote-line" }) });
          }
          return;
        }

        // A Blockquote's `>` markers show up as their own node once per
        // line — either as a direct child of the Blockquote (its first
        // line) or nested inside a continuing Paragraph (lazy-continuation
        // lines) — so handling them here, independent of Blockquote's own
        // walk above, covers both. `cm-md-quote-line`'s border-left already
        // conveys "this line is quoted", so (like a heading's `#`) the
        // literal `>` only needs to stay visible on the line being edited.
        case "QuoteMark": {
          if (isActive(node.from, node.to)) return;
          const line = doc.lineAt(node.from);
          entries.push({ from: node.from, to: Math.min(node.to + 1, line.to), deco: HIDE });
          return;
        }

        // An unordered list item's marker (`-`/`*`/`+`) is redundant once
        // rendered — replace it with an actual bullet glyph, the same way a
        // heading's `#` or a blockquote's `>` is hidden on lines that aren't
        // being actively edited. Ordered lists keep their literal `1.`/`2.`
        // (real content, not decoration), so this only fires for `ListMark`
        // nodes whose list is a `BulletList`. Task items (`- [ ] …`) already
        // get a checkbox as their marker via the `TaskMarker` case below, so
        // they just lose the raw `-` without gaining a redundant bullet too.
        case "ListMark": {
          const item = node.node.parent;
          const list = item?.parent;
          if (!item || !list || list.name !== "BulletList") return;
          if (isActive(node.from, node.to)) return;
          const line = doc.lineAt(node.from);
          const to = Math.min(node.to + 1, line.to);
          const isTask = !!item.getChild("Task");
          entries.push({ from: node.from, to, deco: isTask ? HIDE : Decoration.replace({ widget: new BulletWidget() }) });
          return;
        }

        // A definition list's term line is styled directly (bold, like a
        // small heading) and always applied, mirroring how a heading's own
        // `cm-md-heading` class is unconditional while only its `#` marker
        // hiding depends on the active line.
        case "DefinitionListTerm": {
          const line = doc.lineAt(node.from);
          entries.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-md-dt-line" }) });
          return;
        }

        // A definition's own line gets an indented "dd"-style treatment;
        // its leading `:` marker (see below) is what actually gets hidden.
        case "DefinitionListItem": {
          const line = doc.lineAt(node.from);
          entries.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-md-dd-line" }) });
          return;
        }

        // The `:` marker introducing a definition — hidden on lines that
        // aren't being actively edited, just like a heading's `#` or a
        // blockquote's `>`; `cm-md-dd-line`'s indent already conveys "this
        // is a definition" without it.
        case "DefinitionListMark": {
          if (isActive(node.from, node.to)) return;
          const line = doc.lineAt(node.from);
          entries.push({ from: node.from, to: Math.min(node.to + 1, line.to), deco: HIDE });
          return;
        }

        case "FencedCode": {
          const startLine = doc.lineAt(node.from).number;
          const endLine = doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            entries.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-md-code-block-line" }) });
          }
          return;
        }

        case "HorizontalRule": {
          if (isActive(node.from, node.to)) return;
          const line = doc.lineAt(node.from);
          entries.push({ from: line.from, to: line.to, deco: Decoration.replace({ widget: new HrWidget(), block: true }) });
          return false;
        }

        case "TaskMarker": {
          if (isActive(node.from, node.to)) return false;
          const checked = /x/i.test(doc.sliceString(node.from, node.to));
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) })
          });
          return false;
        }

        case "Emoji": {
          if (isActive(node.from, node.to)) return false;
          const shortcode = doc.sliceString(node.from, node.to).replace(/^:|:$/g, "");
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new EmojiWidgetView(shortcode) })
          });
          return false;
        }

        case "InlineMath": {
          if (isActive(node.from, node.to)) return false;
          const source = doc.sliceString(node.from + 1, node.to - 1);
          const widget = options.collapseWidgets
            ? new CollapsedWidget(`\u2211 ${source.slice(0, 24)}`, "math")
            : new MathWidget(source, false);
          entries.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget }) });
          return false;
        }

        case "BlockMath": {
          if (isActive(node.from, node.to)) return false;
          const text = doc.sliceString(node.from, node.to);
          const source = text.replace(/^\$\$\s*\n?/, "").replace(/\n?\$\$\s*$/, "");
          const startLine = doc.lineAt(node.from);
          const endLine = doc.lineAt(Math.max(node.from, node.to - 1));
          const widget = options.collapseWidgets
            ? new CollapsedWidget(`\u2211 ${source.trim().slice(0, 24) || "Formula"}`, "math")
            : new MathWidget(source, true);
          entries.push({ from: startLine.from, to: endLine.to, deco: Decoration.replace({ widget, block: true }) });
          return false;
        }

        case "Table": {
          if (isActive(node.from, node.to)) return false;
          const startLine = doc.lineAt(node.from);
          const endLine = doc.lineAt(Math.max(node.from, node.to - 1));
          const source = doc.sliceString(startLine.from, endLine.to);
          const rows = Math.max(0, source.split("\n").filter((l) => l.trim()).length - 2);
          const widget = options.collapseWidgets
            ? new CollapsedWidget(`\u25A6 Table (${rows} row${rows === 1 ? "" : "s"})`, "table")
            : new TableWidget(source);
          entries.push({ from: startLine.from, to: endLine.to, deco: Decoration.replace({ widget, block: true }) });
          return false;
        }

        case "FrontMatter": {
          const collapsed = frontMatterOverride === null ? !isActive(node.from, node.to) : frontMatterOverride;
          const startLine = doc.lineAt(node.from);
          const endLine = doc.lineAt(Math.max(node.from, node.to - 1));
          const raw = doc.sliceString(node.from, node.to);
          const summary = summarizeFrontMatter(raw, getFrontMatterFieldConfig());

          if (collapsed) {
            entries.push({
              from: startLine.from,
              to: endLine.to,
              deco: Decoration.replace({
                widget: new FrontMatterSummaryWidget(raw, summary.entries, summary.error, node.from),
                block: true
              })
            });
            return false;
          }

          // Expanded: keep the raw YAML visible (Escape/clicking elsewhere
          // moves the cursor away, collapsing it again via the isActive
          // check above), styling the delimiter lines and overlaying real
          // YAML syntax highlighting on the body in between.
          const delimClass = summary.error
            ? "cm-md-frontmatter-delim cm-md-frontmatter-invalid"
            : "cm-md-frontmatter-delim";
          entries.push({ from: startLine.from, to: startLine.from, deco: Decoration.line({ class: delimClass }) });
          if (endLine.number !== startLine.number) {
            entries.push({ from: endLine.from, to: endLine.from, deco: Decoration.line({ class: delimClass }) });
          }
          if (endLine.number > startLine.number + 1) {
            const innerFrom = doc.line(startLine.number + 1).from;
            const innerTo = doc.line(endLine.number - 1).to;
            const source = doc.sliceString(innerFrom, innerTo);
            for (const range of highlightYaml(source, innerFrom)) {
              entries.push({ from: range.from, to: range.to, deco: Decoration.mark({ class: range.class }) });
            }
          }
          return false;
        }

        default:
          return;
      }
    }
  });

  // The builder requires ascending `from`, and for ties, larger ranges before
  // the smaller ranges they contain (so an outer mark wraps its own hidden
  // delimiter correctly). Any range the builder still rejects — which can
  // happen for pathological nesting — is dropped rather than crashing the
  // view.
  return entries;
}

/** Turns entries into a standalone `DecorationSet`, dropping any range the builder rejects. */
export function toDecorationSet(entries: Entry[]): DecorationSet {
  // `RangeSetBuilder` requires calls to `add()` to arrive in non-decreasing
  // (`from`, `startSide`) order. Every `Decoration` instance already carries
  // the correct `startSide` for this (e.g. `Decoration.line` ≈ -2e8 so it
  // always sorts first at its position; `Decoration.replace` ≈ 5e8 - 1 so it
  // sorts just before a `Decoration.mark` ≈ 5e8 wrapping it) — sorting by
  // that real value directly, instead of guessing from `to`/nesting depth,
  // is what actually satisfies the builder for every combination of
  // same-position decorations this module produces (a heading's line class
  // vs. its hidden `#`, a blockquote line vs. its hidden `>`, an emphasis
  // mark vs. its own hidden delimiter, etc.) Anything the builder still
  // rejects (pathological/overlapping nesting) is dropped rather than
  // crashing the view.
  entries.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) {
    try {
      builder.add(entry.from, entry.to, entry.deco);
    } catch {
      // Skipped: overlapping/out-of-order for this builder pass.
    }
  }
  return builder.finish();
}

/** Recomputes decorations for `[from, to]` only, merging the result with the untouched rest of `existing`. */
function rebuildRange(
  state: EditorState,
  existing: DecorationSet,
  from: number,
  to: number,
  options: LivePreviewOptions,
  frontMatterOverride: boolean | null
): DecorationSet {
  const clampedFrom = Math.max(0, Math.min(from, state.doc.length));
  const clampedTo = Math.max(clampedFrom, Math.min(to, state.doc.length));

  // Re-extracting existing entries outside the dirty range and re-inserting
  // them alongside the freshly computed ones (all through one sorted builder
  // pass, same as a full rebuild) avoids `RangeSet.update`'s stricter
  // same-position `startSide` ordering requirement — which entries pulled out
  // via `.between()` don't reliably satisfy — while still skipping the
  // expensive part entirely: no syntax-tree walk and no widget construction
  // happens outside `[clampedFrom, clampedTo]`. `Decoration.eq()` still makes
  // CodeMirror reuse the actual DOM for every untouched widget.
  // Only keep existing entries that fall *entirely* outside the dirty range.
  // Anything merely overlapping it (e.g. a multi-line blockquote/table that
  // starts before the dirty range but extends into it) is dropped here and
  // recomputed fresh instead — Lezer's `iterate({from, to})` still visits
  // any node overlapping the boundary, so the fresh pass produces the
  // correct decoration for it; keeping the stale one too would duplicate it.
  const merged: Entry[] = [];
  existing.between(0, clampedFrom, (rangeFrom, rangeTo, value) => {
    if (rangeTo <= clampedFrom) merged.push({ from: rangeFrom, to: rangeTo, deco: value });
  });
  merged.push(...buildDecorations(state, clampedFrom, clampedTo, options, frontMatterOverride));
  existing.between(clampedTo, state.doc.length, (rangeFrom, rangeTo, value) => {
    if (rangeFrom >= clampedTo) merged.push({ from: rangeFrom, to: rangeTo, deco: value });
  });

  return toDecorationSet(merged);
}

interface FieldValue {
  decorations: DecorationSet;
  /** Full-line span covering the previous transaction's active selection lines. */
  activeFrom: number;
  activeTo: number;
  /**
   * Front-matter collapse override for this document: `true` forces
   * collapsed, `false` forces expanded, `null` defers to cursor position
   * (the default, dynamic behaviour).
   */
  frontMatterOverride: boolean | null;
}

function fullRebuild(state: EditorState, options: LivePreviewOptions, frontMatterOverride: boolean | null): FieldValue {
  const span = activeLineSpan(state);
  return {
    decorations: toDecorationSet(buildDecorations(state, 0, state.doc.length, options, frontMatterOverride)),
    activeFrom: span.from,
    activeTo: span.to,
    frontMatterOverride
  };
}

const optionsEqual = (a: LivePreviewOptions, b: LivePreviewOptions) =>
  a.collapseWidgets === b.collapseWidgets && a.frontMatterDefaultCollapsed === b.frontMatterDefaultCollapsed;

function makeLivePreviewField(options: LivePreviewOptions) {
  return StateField.define<FieldValue>({
    create(state) {
      return fullRebuild(state, options, options.frontMatterDefaultCollapsed ? true : null);
    },

    update(value, tr) {
      let frontMatterOverride = value.frontMatterOverride;
      let overrideChanged = false;
      for (const effect of tr.effects) {
        if (effect.is(setFrontMatterOverride)) {
          frontMatterOverride = effect.value;
          overrideChanged = true;
        }
      }

      // A forced collapse/expand isn't tied to any particular document
      // range, so — rather than re-deriving the front-matter node's exact
      // span — just do a full rebuild. This only happens on a deliberate
      // click/command, never per keystroke, so it doesn't affect the
      // large-document typing-latency guarantee below.
      if (overrideChanged) {
        return fullRebuild(tr.state, options, frontMatterOverride);
      }

      if (!tr.docChanged && !tr.selection) {
        return value;
      }

      const newActive = activeLineSpan(tr.state);

      if (!tr.docChanged) {
        // Selection-only transaction: skip entirely if the active lines
        // didn't actually change (e.g. horizontal cursor movement within a
        // line, or a selection that stays on the same line(s)).
        if (newActive.from === value.activeFrom && newActive.to === value.activeTo) {
          return value;
        }
        // Below the "full" perf-profile size threshold — i.e. the
        // overwhelming majority of real documents — always do a full
        // rebuild here rather than the incremental dirty-range one below.
        // The two produce *identical* decorations (verified directly), but
        // the incremental path deliberately reuses old `Decoration` object
        // instances for every untouched region so CodeMirror can skip
        // re-rendering their DOM — and that reuse also seems to make
        // CodeMirror skip re-measuring their contribution to the document's
        // height map in some cases. The visible symptom was ArrowUp/ArrowDown
        // computing wildly wrong target lines (ultimately relying on stale
        // cumulative line-height bookkeeping) on *any* document containing a
        // hidden marker (a heading's `#`, a blockquote's `>`, a list's `-`,
        // bold/italic delimiters, …) once the selection had crossed it at
        // least once. A full rebuild sidesteps this by never reusing old
        // `Decoration` instances, at the cost of repeating the syntax-tree
        // walk on every cursor move — cheap for any document under a couple
        // of MB, which is why the incremental path below still exists for
        // documents large enough that per-keystroke cost genuinely matters.
        if (docSizeBytes(tr.state.doc.length) < getPerfThresholds().reducedThresholdBytes) {
          return fullRebuild(tr.state, options, frontMatterOverride);
        }

        const dirtyFrom = Math.min(newActive.from, value.activeFrom);
        const dirtyTo = Math.max(newActive.to, value.activeTo);
        return {
          decorations: rebuildRange(tr.state, value.decorations, dirtyFrom, dirtyTo, options, frontMatterOverride),
          activeFrom: newActive.from,
          activeTo: newActive.to,
          frontMatterOverride
        };
      }

      // Doc changed: dirty range = the edited lines (mapped to the new
      // document), plus wherever the active-line span was before the edit
      // (mapped forward) and is now — covering both "markers need to
      // reappear where the cursor left" and "markers need to hide where it
      // arrived".
      let changedFromB = Infinity;
      let changedToB = -Infinity;
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        changedFromB = Math.min(changedFromB, fromB);
        changedToB = Math.max(changedToB, toB);
      });
      if (changedFromB > changedToB) {
        changedFromB = 0;
        changedToB = 0;
      }
      const expandedChanged = expandToLines(tr.state.doc, changedFromB, changedToB);
      const mappedOldFrom = tr.changes.mapPos(value.activeFrom, -1);
      const mappedOldTo = tr.changes.mapPos(value.activeTo, 1);

      const dirtyFrom = Math.min(expandedChanged.from, newActive.from, mappedOldFrom);
      const dirtyTo = Math.max(expandedChanged.to, newActive.to, mappedOldTo);

      const mapped = value.decorations.map(tr.changes);
      return {
        decorations: rebuildRange(tr.state, mapped, dirtyFrom, dirtyTo, options, frontMatterOverride),
        activeFrom: newActive.from,
        activeTo: newActive.to,
        frontMatterOverride
      };
    },

    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  });
}

/** Cache so repeated calls with equal options (the common case) reuse the same extension. */
let cachedOptions: LivePreviewOptions | undefined;
let cachedField: ReturnType<typeof makeLivePreviewField> | undefined;

export function livePreviewExtension(options: LivePreviewOptions = defaultOptions) {
  if (!cachedField || !cachedOptions || !optionsEqual(cachedOptions, options)) {
    cachedOptions = options;
    cachedField = makeLivePreviewField(options);
  }
  return cachedField;
}

/** Reads the current front-matter override for the live-preview field installed in `state`, if any. */
export function getLivePreviewFieldValue(state: EditorState): FieldValue | undefined {
  return cachedField ? state.field(cachedField, false) : undefined;
}

