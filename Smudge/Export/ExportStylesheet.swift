//
//  ExportStylesheet.swift
//  Smudge
//

import Foundation

/// A self-contained reading/print stylesheet for exported HTML and PDF.
///
/// Deliberately independent of the editor's own `editor.css` — that file
/// styles CodeMirror's decoration classes (`cm-md-*`) for on-screen live
/// preview; exported documents are plain semantic HTML (`<h1>`, `<table>`,
/// KaTeX markup, …) from `exportRender.ts` and need their own typography.
enum ExportStylesheet {
    static let reading = """
    :root {
      color-scheme: light;
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --rule: #d8d8dc;
      --surface: #f5f5f7;
      --accent: #0a63c9;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: var(--ink);
    }
    .smudge-export {
      max-width: 46rem;
      margin: 0 auto;
      padding: 2.5rem 1.75rem;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      font-size: 16px;
      line-height: 1.65;
    }
    .smudge-export h1, .smudge-export h2, .smudge-export h3,
    .smudge-export h4, .smudge-export h5, .smudge-export h6 {
      font-weight: 600;
      line-height: 1.25;
      margin: 1.6em 0 0.6em;
      break-after: avoid;
    }
    .smudge-export h1 { font-size: 1.9em; margin-top: 0; }
    .smudge-export h2 { font-size: 1.5em; border-bottom: 1px solid var(--rule); padding-bottom: 0.3em; }
    .smudge-export h3 { font-size: 1.25em; }
    .smudge-export h4 { font-size: 1.1em; }
    .smudge-export h5, .smudge-export h6 { font-size: 1em; color: var(--muted); }
    .smudge-export p { margin: 0.8em 0; }
    .smudge-export a { color: var(--accent); text-decoration: underline; }
    .smudge-export img { max-width: 100%; border-radius: 6px; }
    .smudge-export hr {
      border: none;
      border-top: 1px solid var(--rule);
      margin: 2em 0;
    }
    .smudge-export blockquote {
      margin: 1em 0;
      padding-left: 1em;
      border-left: 3px solid var(--rule);
      color: var(--muted);
    }
    .smudge-export code {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      background: var(--surface);
      border-radius: 4px;
      padding: 0.1em 0.35em;
      font-size: 0.9em;
    }
    .smudge-export pre {
      background: var(--surface);
      border-left: 3px solid var(--rule);
      border-radius: 8px;
      padding: 1em 1.2em;
      overflow-x: auto;
      break-inside: avoid;
    }
    .smudge-export pre code {
      background: none;
      padding: 0;
      font-size: 0.85em;
    }
    .smudge-export table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.95em;
      break-inside: avoid;
    }
    .smudge-export th, .smudge-export td {
      border: 1px solid var(--rule);
      padding: 0.5em 0.8em;
      text-align: left;
    }
    .smudge-export th { background: var(--surface); font-weight: 600; }
    .smudge-export ul.contains-task-list,
    .smudge-export .smudge-task-item {
      list-style: none;
    }
    .smudge-export .smudge-task-item {
      margin-left: -1.4em;
      padding-left: 1.4em;
    }
    .smudge-export input[type="checkbox"] {
      margin-right: 0.5em;
      accent-color: var(--accent);
    }
    .smudge-export .smudge-math-block {
      overflow-x: auto;
      margin: 1em 0;
      text-align: center;
    }
    .smudge-export .smudge-math-error {
      color: #c0392b;
    }
    .smudge-export .footnote-ref a {
      text-decoration: none;
      font-size: 0.8em;
      vertical-align: super;
      padding: 0 0.1em;
    }
    .smudge-export .footnotes-sep {
      margin: 2.5em 0 1em;
    }
    .smudge-export .footnotes {
      font-size: 0.9em;
      color: var(--muted);
    }
    .smudge-export .footnotes-list {
      padding-left: 1.3em;
    }
    .smudge-export .footnote-item {
      margin: 0.4em 0;
    }
    .smudge-export .footnote-item p {
      display: inline;
      margin: 0;
    }
    .smudge-export .footnote-backref {
      text-decoration: none;
      color: var(--accent);
      margin-left: 0.3em;
    }
    @media print {
      .smudge-export { max-width: none; padding: 0; }
      .smudge-export h1, .smudge-export h2, .smudge-export h3 { break-after: avoid; }
      .smudge-export table, .smudge-export pre, .smudge-export img { break-inside: avoid; }
      .smudge-export .footnotes { break-inside: avoid; }
    }
    """
}
