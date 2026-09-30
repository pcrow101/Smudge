import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { python } from "@codemirror/legacy-modes/mode/python";

/**
 * A curated set of fenced-code-block languages.
 *
 * `@codemirror/language-data` is deliberately avoided: it relies on dynamic
 * imports, which Rollup must inline when producing the single-file IIFE bundle
 * the web view loads, inflating it by well over a megabyte. This list covers
 * the languages a Markdown author realistically fences.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["js", "jsx", "typescript", "ts", "tsx"],
    load: async () => javascript()
  }),
  LanguageDescription.of({
    name: "json",
    load: async () => json()
  }),
  LanguageDescription.of({
    name: "html",
    alias: ["xml"],
    load: async () => html()
  }),
  LanguageDescription.of({
    name: "css",
    load: async () => css()
  }),
  LanguageDescription.of({
    name: "yaml",
    alias: ["yml"],
    load: async () => yaml()
  }),
  LanguageDescription.of({
    name: "swift",
    load: async () => new LanguageSupport(StreamLanguage.define(swift))
  }),
  LanguageDescription.of({
    name: "python",
    alias: ["py"],
    load: async () => new LanguageSupport(StreamLanguage.define(python))
  }),
  LanguageDescription.of({
    name: "shell",
    alias: ["bash", "sh", "zsh", "console"],
    load: async () => new LanguageSupport(StreamLanguage.define(shell))
  })
];
