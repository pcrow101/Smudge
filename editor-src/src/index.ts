import { EditorState, Compartment, ChangeSet, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  rectangularSelection,
  highlightSpecialChars
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM, Subscript, Superscript, Emoji } from "@lezer/markdown";

import { postToSwift, type EditorMode, type PerfProfileOverride, type ResolvedPerfProfile, type SmudgeEditorAPI, type ThemePayload } from "./bridge";
import { codeLanguages } from "./languages";
import { themeExtensions, applyThemeVariables } from "./theme";
import { livePreviewExtension, getLivePreviewFieldValue } from "./livePreview";
import { markdownShortcutsExtension, toggleWrap, insertLink } from "./shortcuts";
import { MathExtension } from "./mathSyntax";
import { FrontMatterExtension } from "./frontMatterSyntax";
import { HighlightExtension } from "./highlightSyntax";
import { DefinitionListExtension } from "./definitionListSyntax";
import { FootnoteExtension } from "./footnoteSyntax";
import { footnoteField } from "./footnotes";
import {
  extractFrontMatterMeta,
  findFrontMatterNode,
  setFrontMatterFieldConfig,
  setFrontMatterOverride,
  type FrontMatterField
} from "./frontMatter";
import { docSizeBytes, resolveProfile } from "./perf";
import { exportRenderer } from "./exportRender";
import "./styles.css";

const VERSION = "phase-7";

/** Swaps the live-preview decorations in and out when the mode or profile changes. */
const modeCompartment = new Compartment();

/** Content-level attributes (currently: spellcheck) that vary by perf profile. */
const perfCompartment = new Compartment();

let view: EditorView;
let mode: EditorMode = "preview";
let perfOverride: PerfProfileOverride = "auto";
let resolvedProfile: ResolvedPerfProfile = "full";

/**
 * Revision counter shared with Swift. Bumped locally on user edits and
 * overwritten when Swift pushes a document, which is how each side recognises
 * and ignores its own echo.
 */
let revision = 0;

/** True while applying a Swift-originated transaction, to suppress echo. */
let applyingRemote = false;

let metricsHandle: number | undefined;

/** Whether a newly created/opened document's front matter starts collapsed. Pushed from Swift's `EditorSettings`. */
let frontMatterDefaultCollapsed = true;

function markdownExtensions() {
  return markdown({
    base: markdownLanguage,
    codeLanguages,
    extensions: [GFM, Subscript, Superscript, Emoji, MathExtension, FrontMatterExtension, HighlightExtension, DefinitionListExtension, FootnoteExtension],
    addKeymap: true
  });
}

/**
 * Extensions that vary by mode *and* performance profile: preview mode adds
 * the live-preview decorations, unless the resolved profile is `plain` (in
 * which case the document behaves like raw mode — syntax highlighting only,
 * no marker-hiding, no widgets — regardless of the requested mode). `reduced`
 * keeps live preview but swaps math/image/table widgets for static
 * placeholders.
 */
function modeExtensions(currentMode: EditorMode, profile: ResolvedPerfProfile) {
  const attrs = EditorView.editorAttributes.of({ "data-mode": currentMode, "data-perf": profile });
  if (currentMode !== "preview" || profile === "plain") {
    return [attrs];
  }
  return [attrs, livePreviewExtension({ collapseWidgets: profile === "reduced", frontMatterDefaultCollapsed }), footnoteField];
}

/** Content attributes driven by performance profile — spellcheck is expensive on huge plain-text documents. */
function perfContentExtensions(profile: ResolvedPerfProfile) {
  return EditorView.contentAttributes.of({ spellcheck: profile === "plain" ? "false" : "true" });
}

function baseExtensions() {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    highlightSpecialChars(),
    highlightSelectionMatches(),
    indentOnInput(),
    bracketMatching(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    Prec.highest(markdownShortcutsExtension()),
    markdownExtensions(),
    themeExtensions(),
    modeCompartment.of(modeExtensions(mode, resolvedProfile)),
    perfCompartment.of(perfContentExtensions(resolvedProfile)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingRemote) {
        revision += 1;
        postToSwift({
          type: "changes",
          revision,
          changes: update.changes.toJSON(),
          docLength: update.state.doc.length
        });
        scheduleMetrics();
        reresolveProfile();
      }
      if (update.selectionSet) {
        const head = update.state.selection.main;
        postToSwift({
          type: "selectionChanged",
          from: head.from,
          to: head.to,
          line: update.state.doc.lineAt(head.head).number
        });
      }
    })
  ];
}

/**
 * Re-resolves the performance profile against the current document size and,
 * if it changed, reconfigures the mode/perf compartments and tells Swift.
 * Only relevant when `perfOverride === "auto"` — an explicit override never
 * changes on its own.
 */
function reresolveProfile(): void {
  const { profile } = resolveProfile(perfOverride, docSizeBytes(view.state.doc.length));
  if (profile === resolvedProfile) return;
  resolvedProfile = profile;
  applyProfile();
}

/** Pushes the current `resolvedProfile` into the compartments and notifies Swift. */
function applyProfile(): void {
  view.dispatch({
    effects: [
      modeCompartment.reconfigure(modeExtensions(mode, resolvedProfile)),
      perfCompartment.reconfigure(perfContentExtensions(resolvedProfile))
    ]
  });
  postToSwift({
    type: "perf",
    profile: resolvedProfile,
    auto: perfOverride === "auto",
    bytes: docSizeBytes(view.state.doc.length)
  });
}

/** Word/character counts are non-critical, so they run when the UI is idle. */
function scheduleMetrics(): void {
  if (metricsHandle !== undefined) {
    return;
  }
  const idle =
    window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 500));
  metricsHandle = idle(() => {
    metricsHandle = undefined;
    const text = view.state.doc.toString();
    const words = text.split(/\s+/u).filter(Boolean).length;
    postToSwift({
      type: "metrics",
      words,
      characters: text.length,
      lines: view.state.doc.lines
    });
  }) as unknown as number;
}

/** Toggles `before`/`after` delimiters around the selection on each range. */
function wrapSelectionWithDelimiters(before: string, after: string = before): void {
  toggleWrap(view, before, after);
}

const api: SmudgeEditorAPI = {
  setDoc(text, newRevision) {
    applyingRemote = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: false
      });
      revision = newRevision;
    } finally {
      applyingRemote = false;
    }
    scheduleMetrics();
    reresolveProfile();
  },

  applyChanges(changes, newRevision) {
    applyingRemote = true;
    try {
      view.dispatch({
        changes: ChangeSet.fromJSON(changes as never),
        scrollIntoView: false
      });
      revision = newRevision;
    } finally {
      applyingRemote = false;
    }
    scheduleMetrics();
    reresolveProfile();
  },

  getDoc() {
    return view.state.doc.toString();
  },

  setMode(next) {
    mode = next;
    view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode, resolvedProfile)) });
  },

  setTheme(theme: ThemePayload) {
    applyThemeVariables(theme.appearance, theme.fontSize, theme.variables);
  },

  setPerfProfile(override) {
    perfOverride = override;
    const { profile } = resolveProfile(perfOverride, docSizeBytes(view.state.doc.length));
    resolvedProfile = profile;
    applyProfile();
  },

  insertText(text) {
    view.dispatch(view.state.replaceSelection(text), {
      scrollIntoView: true,
      userEvent: "input.paste"
    });
  },

  wrapSelection(before, after = before) {
    wrapSelectionWithDelimiters(before, after);
  },

  insertLink() {
    insertLink(view);
  },

  setFrontMatterFields(fields: FrontMatterField[]) {
    setFrontMatterFieldConfig(fields);
    // Clear any forced override so the new field list is reflected
    // immediately, regardless of which document/collapse state was active.
    view.dispatch({ effects: setFrontMatterOverride.of(null) });
  },

  setFrontMatterDefaultCollapsed(collapsed: boolean) {
    frontMatterDefaultCollapsed = collapsed;
    view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode, resolvedProfile)) });
  },

  insertFrontMatterTemplate() {
    const existing = findFrontMatterNode(view.state);
    if (existing) {
      // Already has front matter — just make sure it's visible rather than
      // inserting a second block.
      view.dispatch({
        effects: setFrontMatterOverride.of(null),
        selection: { anchor: Math.min(existing.from + 4, view.state.doc.length) },
        scrollIntoView: true
      });
      view.focus();
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const template = `---\ntitle: \ndate: ${today}\ntags: []\n---\n\n`;
    const titleAnchor = template.indexOf("title: ") + "title: ".length;
    view.dispatch({
      changes: { from: 0, insert: template },
      effects: setFrontMatterOverride.of(false),
      selection: { anchor: titleAnchor },
      scrollIntoView: true,
      userEvent: "input.frontmatter"
    });
    view.focus();
  },

  toggleFrontMatter() {
    if (!findFrontMatterNode(view.state)) {
      return;
    }
    const current = getLivePreviewFieldValue(view.state)?.frontMatterOverride ?? true;
    view.dispatch({ effects: setFrontMatterOverride.of(current === false ? true : false) });
  },

  getFrontMatterMeta() {
    return extractFrontMatterMeta(view.state.doc.toString()).data ?? {};
  },

  renderHTML() {
    const { body } = extractFrontMatterMeta(view.state.doc.toString());
    return exportRenderer().render(body);
  },

  focus() {
    view.focus();
  },

  undo() {
    return undo(view);
  },

  redo() {
    return redo(view);
  }
};

function boot(): void {
  const parent = document.getElementById("smudge-root");
  if (!parent) {
    postToSwift({ type: "log", level: "error", message: "Missing #smudge-root element." });
    return;
  }

  view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: baseExtensions() })
  });

  window.SmudgeEditor = api;
  postToSwift({ type: "ready", version: VERSION });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
