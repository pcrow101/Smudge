import { StateEffect, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { highlightTree } from "@lezer/highlight";
import { load as loadYaml } from "js-yaml";
import { smudgeHighlightStyle } from "./theme";

/**
 * Front-matter data model, collapsed-summary rendering, and the YAML overlay
 * used when the block is expanded. Detection of the block itself (the
 * `FrontMatter` syntax node) lives in `frontMatterSyntax.ts`; the "show
 * summary vs. raw YAML" decision lives in `livePreview.ts`, which is the only
 * place that knows about cursor position and the current performance
 * profile.
 */

/** How a configured front-matter key renders in the collapsed summary bar. */
export type FrontMatterFieldStyle = "text" | "date" | "chips" | "badge" | "hidden";

export interface FrontMatterField {
  key: string;
  label?: string;
  style: FrontMatterFieldStyle;
}

/**
 * Defaults until Phase 9 exposes a configurable list from Settings (global
 * scope, per the plan) via `setFrontMatterFields`.
 */
export const defaultFrontMatterFields: FrontMatterField[] = [
  { key: "title", style: "text" },
  { key: "date", style: "date" },
  { key: "tags", style: "chips" }
];

let currentFields: FrontMatterField[] = defaultFrontMatterFields;

export function setFrontMatterFieldConfig(fields: FrontMatterField[]): void {
  currentFields = fields.length > 0 ? fields : defaultFrontMatterFields;
}

export function getFrontMatterFieldConfig(): FrontMatterField[] {
  return currentFields;
}

/**
 * Forces the current document's front-matter block collapsed (`true`) or
 * expanded (`false`), or clears the override (`null`) so the block instead
 * follows the cursor — expanding while the selection is inside it, collapsing
 * as soon as the selection (or Escape) moves it away. Dispatched by clicking
 * the summary bar, the `toggleFrontMatter` command, and whenever the global
 * field configuration changes.
 */
export const setFrontMatterOverride = StateEffect.define<boolean | null>();

export interface FrontMatterSummaryEntry {
  label: string | null;
  value: string;
  chip: boolean;
}

export interface FrontMatterSummary {
  entries: FrontMatterSummaryEntry[];
  error: string | null;
}

/** Strips the opening/closing delimiter lines, returning just the YAML body. */
function innerYamlText(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length <= 1) {
    return "";
  }
  const last = lines[lines.length - 1] ?? "";
  const hasClosing = /^(-{3}|\+{3})[ \t]*$/.test(last);
  return lines.slice(1, hasClosing ? -1 : undefined).join("\n");
}

/**
 * Parses the front-matter block (as produced by the syntax node's raw text)
 * into the entries the collapsed summary bar shows, applying the configured
 * field list and falling back gracefully when none of it matches or the YAML
 * doesn't parse. Invalid YAML never blocks editing — it's surfaced as an
 * `error` string for the caller to style, with the raw source always left
 * exactly as typed.
 */
export function summarizeFrontMatter(raw: string, fields: FrontMatterField[] = currentFields): FrontMatterSummary {
  const inner = innerYamlText(raw);
  let data: unknown;
  try {
    data = inner.trim() === "" ? {} : loadYaml(inner);
  } catch (err) {
    return { entries: [], error: err instanceof Error ? err.message : "Invalid YAML" };
  }
  if (data === null || data === undefined) {
    return { entries: [], error: null };
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    return { entries: [], error: "Front matter must be a YAML mapping" };
  }

  const map = data as Record<string, unknown>;
  const entries: FrontMatterSummaryEntry[] = [];
  for (const field of fields) {
    if (field.style === "hidden") continue;
    const value = map[field.key];
    if (value === undefined || value === null) continue;
    if (field.style === "chips" || Array.isArray(value)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        entries.push({ label: null, value: String(item), chip: true });
      }
    } else {
      entries.push({ label: field.label ?? null, value: String(value), chip: field.style === "badge" });
    }
  }
  if (entries.length > 0) {
    return { entries, error: null };
  }

  // Fallback ladder (step 15): none of the configured keys were present.
  const scalarKeys = Object.keys(map).filter((k) => typeof map[k] !== "object");
  if (scalarKeys.length > 0) {
    return {
      entries: scalarKeys.slice(0, 2).map((k) => ({ label: k, value: String(map[k]), chip: false })),
      error: null
    };
  }
  const keyCount = Object.keys(map).length;
  if (keyCount > 0) {
    return {
      entries: [{ label: null, value: `Front matter \u00b7 ${keyCount} key${keyCount === 1 ? "" : "s"}`, chip: false }],
      error: null
    };
  }
  return { entries: [{ label: null, value: "Front matter", chip: false }], error: null };
}

/**
 * Highlights `source` (the front-matter body, without delimiter lines) as
 * YAML, reusing the editor's own `HighlightStyle` so the generated class
 * names — and their already-injected CSS — match ordinary syntax
 * highlighting exactly. Positions are offset to absolute document positions.
 */
export function highlightYaml(source: string, offset: number): { from: number; to: number; class: string }[] {
  const ranges: { from: number; to: number; class: string }[] = [];
  if (!source) {
    return ranges;
  }
  try {
    const tree = yamlLanguage.parser.parse(source);
    highlightTree(tree, smudgeHighlightStyle, (from, to, classes) => {
      ranges.push({ from: from + offset, to: to + offset, class: classes });
    });
  } catch {
    // Best-effort only; invalid/partial YAML still edits fine as plain text.
  }
  return ranges;
}

/** Locates the front-matter node, if the document has one, for commands that need its span. */
export function findFrontMatterNode(state: EditorState): { from: number; to: number } | null {
  const top = syntaxTree(state).topNode.firstChild;
  if (top && top.name === "FrontMatter" && top.from === 0) {
    return { from: top.from, to: top.to };
  }
  return null;
}

/**
 * Plain-string counterpart to the syntax-tree-based detection above, used by
 * `renderHTML`/export (which render from the raw document text, not a
 * CodeMirror state) to strip the block from output and recover its data for
 * HTML/PDF metadata (title, author, date — Phase 7).
 */
export function extractFrontMatterMeta(doc: string): { body: string; data: Record<string, unknown> | null } {
  const firstLineMatch = /^(-{3}|\+{3})[ \t]*\r?\n/.exec(doc);
  if (!firstLineMatch) {
    return { body: doc, data: null };
  }
  const delimiter = firstLineMatch[1];
  const lines = doc.split("\n");
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (closeRe(delimiter, lines[i])) {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) {
    return { body: doc, data: null };
  }
  const inner = lines.slice(1, closeIndex).join("\n");
  const body = lines.slice(closeIndex + 1).join("\n");
  try {
    const data = inner.trim() === "" ? {} : (loadYaml(inner) as unknown);
    return {
      body,
      data: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null
    };
  } catch {
    return { body, data: null };
  }
}

function closeRe(delimiter: string, line: string): boolean {
  return delimiter === "+++" ? /^\+{3}[ \t]*$/.test(line) : /^-{3}[ \t]*$/.test(line);
}
