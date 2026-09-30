/**
 * `markdown-it-footnote` ships no TypeScript types. This ambient module
 * declaration covers the only thing we use it for: registering it as a
 * markdown-it plugin via `.use(footnote)`.
 */
declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const footnote: (md: MarkdownIt) => void;
  export default footnote;
}
