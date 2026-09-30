/**
 * Synthetic Markdown document generator for performance testing.
 *
 * Produces a realistic mix of the constructs `livePreview.ts` decorates —
 * headings, paragraphs with inline emphasis/links/code, lists, blockquotes,
 * fenced code, a table, and a math expression — repeated until the target
 * byte size is reached. Deterministic (no `Math.random()`) so results are
 * reproducible run to run.
 *
 * Used by both `bench.html` (interactive, in a real browser, for manual
 * profiling during development) and `Tools/VerifyEditorBundle.swift` (an
 * automated regression guard, using an inline JS port of this same shape —
 * see the comment there for why it's duplicated rather than imported).
 */

const PARAGRAPH_UNIT = [
  "## Section {n}",
  "",
  "This is paragraph {n} with **bold text**, *italic text*, `inline code`,",
  "and a [link](https://example.com/{n}) to demonstrate inline styling at scale.",
  "",
  "- First item in list {n}",
  "- Second item with ~~strikethrough~~ and a :smile: emoji",
  "- [ ] An unchecked task",
  "- [x] A checked task",
  "",
  "> A blockquote for section {n}, spanning this single line.",
  "",
  "```js",
  "function example{n}() {",
  "  return {n} * 2;",
  "}",
  "```",
  "",
  "| Col A | Col B | Col C |",
  "| --- | --- | --- |",
  "| {n} | {n}0 | {n}00 |",
  "",
  "Inline math $x_{n}^2 + y_{n}^2 = z_{n}^2$ appears here too.",
  "",
  "---",
  ""
].join("\n");

/** Generates a Markdown document of approximately `targetBytes` in size. */
export function generateFixture(targetBytes: number): string {
  const chunks: string[] = ["# Benchmark Document", ""];
  let size = chunks.join("\n").length;
  let n = 0;
  while (size < targetBytes) {
    n += 1;
    const unit = PARAGRAPH_UNIT.replace(/\{n\}/g, String(n));
    chunks.push(unit);
    size += unit.length;
  }
  return chunks.join("\n");
}

export const FIXTURE_SIZES = {
  small: 100 * 1024,
  medium: 1024 * 1024,
  large: 5 * 1024 * 1024,
  huge: 20 * 1024 * 1024
} as const;
