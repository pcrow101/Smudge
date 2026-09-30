import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { type Command, type KeyBinding, EditorView, keymap } from "@codemirror/view";

/**
 * Toggles `before`/`after` delimiters around each selection range, removing
 * them instead of doubling up if the selection is already wrapped. Shared by
 * the ⌘B/⌘I shortcuts below and the `wrapSelection` bridge API in
 * `index.ts`.
 */
export function toggleWrap(view: EditorView, before: string, after: string = before): void {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const outerFrom = range.from - before.length;
    const outerTo = range.to + after.length;
    const alreadyWrapped =
      outerFrom >= 0 &&
      outerTo <= view.state.doc.length &&
      view.state.sliceDoc(outerFrom, range.from) === before &&
      view.state.sliceDoc(range.to, outerTo) === after;

    if (alreadyWrapped) {
      return {
        changes: [
          { from: outerFrom, to: range.from },
          { from: range.to, to: outerTo }
        ],
        range: EditorSelection.range(outerFrom, outerFrom + selected.length)
      };
    }

    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after }
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length)
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input.wrap" });
}

function wrapCommand(before: string, after: string = before): Command {
  return (view) => {
    toggleWrap(view, before, after);
    return true;
  };
}

/** Wraps the selection as a link, leaving `url` selected for quick replacement. */
export const insertLink: Command = (view) => {
  const changes = view.state.changeByRange((range) => {
    const label = view.state.sliceDoc(range.from, range.to) || "text";
    const insert = `[${label}](url)`;
    const urlStart = range.from + label.length + 3; // "[" + label + "]("
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3)
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input.link" });
  return true;
};

const bulletRe = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?/;
const orderedRe = /^(\s*)(\d+)([.)])(\s+)/;
const quoteRe = /^(\s*)(>+)(\s*)/;

/**
 * Continues lists and blockquotes on Enter: a new bullet/number/`>` prefix is
 * inserted on the next line, matching the current item. Pressing Enter on an
 * already-empty item ends the list instead of continuing it, mirroring the
 * behaviour of most Markdown editors.
 */
const smartListEnter: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return false;
  }
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  if (pos !== line.to) {
    // Only take over Enter at the end of the line; mid-line Enter is a plain split.
    return false;
  }

  const text = line.text;
  const bullet = bulletRe.exec(text);
  const ordered = orderedRe.exec(text);
  const quote = quoteRe.exec(text);

  if (bullet) {
    const rest = text.slice(bullet[0].length);
    if (rest.trim() === "") {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        userEvent: "delete.list"
      });
      return true;
    }
    const checkbox = bullet[4] ? "[ ] " : "";
    const prefix = `${bullet[1]}${bullet[2]}${bullet[3]}${checkbox}`;
    view.dispatch({
      changes: { from: pos, insert: `\n${prefix}` },
      selection: { anchor: pos + prefix.length + 1 },
      userEvent: "input.list"
    });
    return true;
  }

  if (ordered) {
    const rest = text.slice(ordered[0].length);
    if (rest.trim() === "") {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, userEvent: "delete.list" });
      return true;
    }
    const next = Number(ordered[2]) + 1;
    const prefix = `${ordered[1]}${next}${ordered[3]}${ordered[4]}`;
    view.dispatch({
      changes: { from: pos, insert: `\n${prefix}` },
      selection: { anchor: pos + prefix.length + 1 },
      userEvent: "input.list"
    });
    return true;
  }

  if (quote) {
    const rest = text.slice(quote[0].length);
    if (rest.trim() === "") {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, userEvent: "delete.list" });
      return true;
    }
    const prefix = `${quote[1]}${quote[2]} `;
    view.dispatch({
      changes: { from: pos, insert: `\n${prefix}` },
      selection: { anchor: pos + prefix.length + 1 },
      userEvent: "input.list"
    });
    return true;
  }

  return false;
};

const listLineRe = /^(\s*)([-*+]|\d+[.)]|>+)(\s+)/;
const INDENT = "  ";

/** Indents every list/quote line touched by the selection by one step. */
const listIndentMore: Command = (view) => {
  const { state } = view;
  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lineNumbers.add(n);
  }
  let matched = false;
  const changes: ChangeSpec[] = [];
  for (const n of lineNumbers) {
    const line = state.doc.line(n);
    if (listLineRe.test(line.text)) {
      matched = true;
      changes.push({ from: line.from, insert: INDENT });
    }
  }
  if (!matched) {
    return false;
  }
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
};

/** Dedents every list/quote line touched by the selection by one step. */
const listIndentLess: Command = (view) => {
  const { state } = view;
  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lineNumbers.add(n);
  }
  let matched = false;
  const changes: ChangeSpec[] = [];
  for (const n of lineNumbers) {
    const line = state.doc.line(n);
    if (!listLineRe.test(line.text)) continue;
    const leading = /^\s{1,2}/.exec(line.text);
    if (leading) {
      matched = true;
      changes.push({ from: line.from, to: line.from + leading[0].length, insert: "" });
    }
  }
  if (!matched) {
    return false;
  }
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
};

/** Home toggles between the first non-marker character and column 0. */
const smartHome: Command = (view) => {
  const { state } = view;
  const changes = state.selection.ranges.map((range) => {
    const line = state.doc.lineAt(range.head);
    const match = listLineRe.exec(line.text) ?? quoteRe.exec(line.text);
    const contentStart = line.from + (match ? match[0].length : 0);
    const target = range.head === contentStart ? line.from : contentStart;
    return EditorSelection.cursor(target);
  });
  view.dispatch({ selection: EditorSelection.create(changes) });
  return true;
};

export function markdownShortcuts(): KeyBinding[] {
  return [
    { key: "Mod-b", run: wrapCommand("**"), preventDefault: true },
    { key: "Mod-i", run: wrapCommand("*"), preventDefault: true },
    { key: "Mod-k", run: insertLink, preventDefault: true },
    { key: "Mod-Shift-x", run: wrapCommand("~~"), preventDefault: true },
    { key: "Enter", run: smartListEnter },
    { key: "Tab", run: listIndentMore },
    { key: "Shift-Tab", run: listIndentLess },
    { key: "Home", run: smartHome }
  ];
}

export function markdownShortcutsExtension() {
  return keymap.of(markdownShortcuts());
}
