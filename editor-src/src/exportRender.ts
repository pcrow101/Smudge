import MarkdownIt from "markdown-it";
// markdown-it 15 ships its own types and exports the rule-state classes by
// name. The default export is a *value* (a callable class), so the instance
// type has to be imported separately and aliased to avoid colliding with it.
import type {
  MarkdownIt as MarkdownItInstance,
  StateBlock,
  StateCore,
  StateInline,
  Token
} from "markdown-it";
import katex from "katex";
import footnotePlugin from "markdown-it-footnote";
import { emojiForShortcode } from "./emoji";
import { sanitizeBlockHTML, sanitizeInlineHTML } from "./sanitize";

/**
 * The export-time Markdown → HTML renderer, used by `renderHTML()` for
 * HTML/PDF export (Phase 7).
 *
 * This is deliberately a *separate* renderer from live preview: preview
 * renders via CodeMirror decorations over the source text, while export
 * needs a real, standalone HTML document. markdown-it's `default` preset
 * already covers CommonMark plus GFM tables and strikethrough; the three
 * extensions below (math, emoji, task-list checkboxes) bring it in line with
 * what live preview additionally supports, using the same conventions as
 * `mathSyntax.ts` (Pandoc-style `$…$`/`$$…$$`) and `emoji.ts`'s shortcode
 * table, so a document renders consistently between editing and export.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMath(source: string, display: boolean): string {
  try {
    return katex.renderToString(source, { displayMode: display, throwOnError: true, strict: "ignore" });
  } catch {
    const raw = display ? `$$${source}$$` : `$${source}$`;
    return `<code class="smudge-math-error">${escapeHtml(raw)}</code>`;
  }
}

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

/** Inline `$…$`, mirroring `mathSyntax.ts`'s inline rule for the editor. */
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== DOLLAR || src.charCodeAt(start + 1) === DOLLAR) {
    return false;
  }
  const afterOpen = src[start + 1];
  if (afterOpen === undefined || /\s/.test(afterOpen)) {
    return false;
  }

  let pos = start + 1;
  while (pos < src.length) {
    const code = src.charCodeAt(pos);
    if (code === BACKSLASH) {
      pos += 2;
      continue;
    }
    if (code === DOLLAR) break;
    pos++;
  }
  if (pos >= src.length || src.charCodeAt(pos) !== DOLLAR) {
    return false;
  }
  const beforeClose = src[pos - 1];
  if (beforeClose === undefined || /\s/.test(beforeClose)) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = src.slice(start + 1, pos);
  }
  state.pos = pos + 1;
  return true;
}

/** Block `$$ … $$`, mirroring `mathSyntax.ts`'s block rule for the editor. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(pos, pos + 2) !== "$$" || state.src.slice(pos + 2, max).trim().length > 0) {
    return false;
  }
  if (silent) return true;

  let nextLine = startLine;
  let content = "";
  let closed = false;
  for (;;) {
    nextLine++;
    if (nextLine >= endLine) break;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineMax = state.eMarks[nextLine];
    const line = state.src.slice(pos, lineMax);
    if (line.trim() === "$$") {
      closed = true;
      break;
    }
    content += `${line}\n`;
  }
  state.line = nextLine + (closed ? 1 : 0);
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content;
  token.map = [startLine, state.line];
  return true;
}

function mathPlugin(md: MarkdownItInstance): void {
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "blockquote", "list"] });
  md.renderer.rules.math_inline = (tokens: Token[], idx: number) =>
    renderMath(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens: Token[], idx: number) =>
    `<p class="smudge-math-block">${renderMath(tokens[idx].content, true)}</p>\n`;
}

const emojiShortcodeRe = /^:([a-zA-Z0-9_+-]+):/;

/** `:shortcode:` → Unicode glyph, reusing the same lookup table live preview uses. */
function emojiPlugin(md: MarkdownItInstance): void {
  const emojiRule = (state: StateInline, silent: boolean): boolean => {
    if (state.src.charCodeAt(state.pos) !== 0x3a /* : */) {
      return false;
    }
    const match = emojiShortcodeRe.exec(state.src.slice(state.pos));
    if (!match) return false;
    const glyph = emojiForShortcode(match[1]);
    if (!glyph) return false; // Unknown shortcode: fall through and render as plain text.
    if (!silent) {
      const token = state.push("emoji", "", 0);
      token.content = glyph;
      token.markup = match[1];
    }
    state.pos += match[0].length;
    return true;
  };
  md.inline.ruler.before("escape", "emoji", emojiRule);
  md.renderer.rules.emoji = (tokens: Token[], idx: number) => tokens[idx].content;
}

const taskItemRe = /^\[([ xX])\]\s(.*)$/s;

/**
 * GFM task-list checkboxes (`- [ ] …` / `- [x] …`). markdown-it has no
 * built-in support for these; this walks the token stream after inline
 * parsing (the same technique the `markdown-it-task-lists` plugin uses) and
 * replaces the literal `[ ]`/`[x]` text with a disabled `<input>` checkbox.
 */
function taskListsPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after("inline", "smudge_task_lists", (state: StateCore) => {
    const { tokens } = state;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "list_item_open") continue;

      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== "inline") j++;
      const inline = tokens[j];
      const first = inline?.children?.[0];
      if (!first || first.type !== "text") continue;

      const match = taskItemRe.exec(first.content);
      if (!match) continue;

      const checked = match[1].toLowerCase() === "x";
      first.content = match[2];
      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input type="checkbox" disabled${checked ? " checked" : ""}> `;
      inline.children?.unshift(checkbox);
      tokens[i].attrSet("class", "smudge-task-item");
    }
  });
}

const EQUALS = 0x3d;

/**
 * `==highlighted text==`, mirroring `highlightSyntax.ts`'s CodeMirror
 * extension: single-pass matching of one delimiter pair, no nested inline
 * formatting, and a run of 3+ `=` never matches (so `===` isn't misread).
 * Renders as `<mark>…</mark>` via markdown-it's default token rendering —
 * no custom renderer rule needed since `mark_open`/`mark_close` are a
 * plain open/close tag pair.
 */
function highlightInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== EQUALS || src.charCodeAt(start + 1) !== EQUALS || src.charCodeAt(start + 2) === EQUALS) {
    return false;
  }
  const afterOpen = src[start + 2];
  if (afterOpen === undefined || /\s/.test(afterOpen)) {
    return false;
  }

  let pos = start + 2;
  while (pos < src.length) {
    if (src.charCodeAt(pos) === EQUALS && src.charCodeAt(pos + 1) === EQUALS && src.charCodeAt(pos + 2) !== EQUALS) {
      break;
    }
    pos++;
  }
  if (pos >= src.length) {
    return false;
  }
  const beforeClose = src[pos - 1];
  if (beforeClose === undefined || /\s/.test(beforeClose)) {
    return false;
  }

  if (!silent) {
    state.push("mark_open", "mark", 1);
    const token = state.push("text", "", 0);
    token.content = src.slice(start + 2, pos);
    state.push("mark_close", "mark", -1);
  }
  state.pos = pos + 2;
  return true;
}

function highlightPlugin(md: MarkdownItInstance): void {
  md.inline.ruler.before("emphasis", "highlight", highlightInline);
}

const defLineRe = /^:[ \t]+\S/;
const defPrefixRe = /^:[ \t]+/;

/**
 * Pandoc/PHP-Markdown-Extra/markdown-it-deflist style definition lists,
 * mirroring `definitionListSyntax.ts`'s CodeMirror extension: a single-line
 * term immediately followed (no blank line) by one or more `: definition`
 * lines. Renders via plain `<dl>`/`<dt>`/`<dd>` open/close tokens, which
 * markdown-it's default renderer already handles generically from `tag` +
 * `nesting` — no custom renderer rule needed.
 */
function deflistBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const termPos = state.bMarks[startLine] + state.tShift[startLine];
  const termMax = state.eMarks[startLine];
  if (termPos >= termMax) return false; // Blank line: no term.

  const secondLine = startLine + 1;
  if (secondLine >= endLine) return false;
  const secondPos = state.bMarks[secondLine] + state.tShift[secondLine];
  const secondMax = state.eMarks[secondLine];
  if (!defLineRe.test(state.src.slice(secondPos, secondMax))) return false;

  if (silent) return true;

  const dlOpen = state.push("dl_open", "dl", 1);
  dlOpen.map = [startLine, secondLine];

  state.push("dt_open", "dt", 1);
  const termInline = state.push("inline", "", 0);
  termInline.content = state.src.slice(termPos, termMax);
  termInline.map = [startLine, startLine + 1];
  termInline.children = [];
  state.push("dt_close", "dt", -1);

  let line = secondLine;
  while (line < endLine) {
    const pos = state.bMarks[line] + state.tShift[line];
    const max = state.eMarks[line];
    const text = state.src.slice(pos, max);
    if (!defLineRe.test(text)) break;
    const prefixLength = defPrefixRe.exec(text)![0].length;

    state.push("dd_open", "dd", 1);
    const ddInline = state.push("inline", "", 0);
    ddInline.content = text.slice(prefixLength);
    ddInline.map = [line, line + 1];
    ddInline.children = [];
    state.push("dd_close", "dd", -1);
    line++;
  }

  const dlClose = state.push("dl_close", "dl", -1);
  dlClose.map = [startLine, line];

  state.line = line;
  return true;
}

function deflistPlugin(md: MarkdownItInstance): void {
  md.block.ruler.before("paragraph", "deflist", deflistBlock, { alt: ["paragraph", "blockquote", "list"] });
}

let cached: MarkdownItInstance | undefined;

/**
 * The shared export renderer instance — configuration only needs building
 * once.
 *
 * Note `html: true`: raw HTML in the source is passed through, which is
 * deliberate (people embed `<figure>`, `<details>` and `<kbd>` in Markdown
 * and expect it to work) but means a document the user did not write
 * controls the markup. Nothing this returns is safe to assign to
 * `innerHTML` or to write into an exported file as-is — go through
 * `renderDocumentHTML()` or `renderInlineHTML()` below, which sanitize.
 * This stays exported only so benchmarks can measure parse cost in
 * isolation.
 */
export function exportRenderer(): MarkdownItInstance {
  if (!cached) {
    cached = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false })
      .use(mathPlugin)
      .use(emojiPlugin)
      .use(taskListsPlugin)
      .use(highlightPlugin)
      .use(deflistPlugin)
      // `[^1]` references + `[^1]: ...` definitions. markdown-it-footnote
      // already does exactly what's needed here: definitions are collected
      // and rendered once, in numeric order, inside a `<section
      // class="footnotes">` appended at the very end of the document — i.e.
      // the bottom of the page — regardless of where in the source the
      // `[^1]: ...` definition itself appears, with backlinks from each
      // footnote back up to its reference.
      .use(footnotePlugin);
  }
  return cached;
}

/**
 * Renders a whole document to sanitized HTML. This is what `renderHTML()`
 * hands back to Swift for HTML/PDF export.
 *
 * Sanitizing matters most here: an exported file is opened outside the app,
 * where the editor's CSP does not apply, and it is the artefact users
 * forward to other people. A `<script>` surviving this call would run with
 * `file://` privileges on someone else's machine.
 */
export function renderDocumentHTML(body: string): string {
  return sanitizeBlockHTML(exportRenderer().render(body));
}

/**
 * Renders a fragment (no block wrapper) to sanitized HTML — used for
 * footnote previews, which are assigned to `innerHTML` in the live editor.
 */
export function renderInlineHTML(source: string): string {
  return sanitizeInlineHTML(exportRenderer().renderInline(source));
}
