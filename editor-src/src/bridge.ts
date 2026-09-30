/**
 * The contract between Swift and the editor core.
 *
 * Every message crossing the bridge is defined here so the Swift side
 * (`EditorBridge`, Phase 6) has a single place to mirror.
 */

import type { FrontMatterField } from "./frontMatter";

/** Editor display mode. Mirrors Swift's `EditorMode`. */
export type EditorMode = "preview" | "raw";

/** A performance profile once resolved against document size. */
export type ResolvedPerfProfile = "full" | "reduced" | "plain";

/**
 * What Swift asks for. `auto` defers to the size-based thresholds in
 * `perf.ts`; the other three pin the profile regardless of document size.
 * Mirrors Swift's `PerfProfile`.
 */
export type PerfProfileOverride = "auto" | ResolvedPerfProfile;

/** Theme variables pushed from Swift when the system appearance changes. */
export interface ThemePayload {
  /** `light` or `dark`; drives the `data-theme` attribute on `<html>`. */
  appearance: "light" | "dark";
  /** Editor base font size in points. */
  fontSize: number;
  /** Optional CSS custom property overrides, applied to `:root`. */
  variables?: Record<string, string>;
}

/** A serialised CodeMirror `ChangeSet`, as produced by `ChangeSet.toJSON()`. */
export type SerializedChanges = unknown;

/** Messages sent from the editor to Swift. */
export type OutboundMessage =
  | { type: "ready"; version: string }
  | { type: "changes"; revision: number; changes: SerializedChanges; docLength: number }
  | { type: "selectionChanged"; from: number; to: number; line: number }
  | { type: "metrics"; words: number; characters: number; lines: number }
  | {
      type: "perf";
      profile: ResolvedPerfProfile;
      auto: boolean;
      bytes: number;
    }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

/** The global API Swift calls into via `evaluateJavaScript`. */
export interface SmudgeEditorAPI {
  /** Replaces the whole document. Used on load and external file changes. */
  setDoc(text: string, revision: number): void;
  /** Applies a serialised `ChangeSet` produced elsewhere. */
  applyChanges(changes: SerializedChanges, revision: number): void;
  /** Returns the full document text. */
  getDoc(): string;
  /** Switches between live preview and raw source. */
  setMode(mode: EditorMode): void;
  /** Applies appearance and typography. */
  setTheme(theme: ThemePayload): void;
  /**
   * Requests a performance profile. `auto` (the default) resolves against
   * document size on every doc change; an explicit profile pins it. Emits a
   * `perf` message with the resolved profile whenever it changes.
   */
  setPerfProfile(profile: PerfProfileOverride): void;
  /** Inserts text at the cursor, replacing any selection. */
  insertText(text: string): void;
  /** Wraps the selection in the given delimiters, toggling if already wrapped. */
  wrapSelection(before: string, after?: string): void;
  /** Wraps the selection as a link (`[label](url)`), leaving `url` selected. Mirrors the ⌘K shortcut. */
  insertLink(): void;
  /**
   * Configures which front-matter keys appear in the collapsed summary bar
   * and how (Phase 9 wires this from a global Settings pane).
   */
  setFrontMatterFields(fields: FrontMatterField[]): void;
  /** Whether a document's front-matter block starts collapsed. */
  setFrontMatterDefaultCollapsed(collapsed: boolean): void;
  /**
   * Inserts a `title`/`date`/`tags` front-matter template if the document
   * doesn't already have one; otherwise reveals the existing block.
   */
  insertFrontMatterTemplate(): void;
  /** Toggles the current document's front-matter block between forced-collapsed and forced-expanded. */
  toggleFrontMatter(): void;
  /** Parsed front-matter data (empty object if absent/invalid), for export metadata (Phase 7). */
  getFrontMatterMeta(): Record<string, unknown>;
  /** Renders the current document to HTML for export. Phase 7. */
  renderHTML(): string;
  /** Focuses the editor. */
  focus(): void;
  /** Undo/redo, driven by the document's `NSUndoManager`. */
  undo(): boolean;
  redo(): boolean;
}

declare global {
  interface Window {
    SmudgeEditor: SmudgeEditorAPI;
    webkit?: {
      messageHandlers?: Record<string, { postMessage(body: unknown): void }>;
    };
  }
}

/** Name of the `WKScriptMessageHandler` registered on the Swift side. */
export const BRIDGE_HANDLER = "smudge";

/** Posts a message to Swift, silently no-oping in a plain browser. */
export function postToSwift(message: OutboundMessage): void {
  const handler = window.webkit?.messageHandlers?.[BRIDGE_HANDLER];
  if (handler) {
    handler.postMessage(message);
  } else if (message.type !== "metrics" && message.type !== "selectionChanged") {
    // Useful when running the bundle in a browser during development.
    console.debug("[smudge bridge]", message);
  }
}
