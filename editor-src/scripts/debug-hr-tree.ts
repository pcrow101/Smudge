import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM, Subscript, Superscript, Emoji } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import { MathExtension } from "../src/mathSyntax";
import { FrontMatterExtension } from "../src/frontMatterSyntax";
import { HighlightExtension } from "../src/highlightSyntax";
import { DefinitionListExtension } from "../src/definitionListSyntax";

function dump(label: string, doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({
        base: markdownLanguage,
        extensions: [GFM, Subscript, Superscript, Emoji, MathExtension, FrontMatterExtension, HighlightExtension, DefinitionListExtension],
        addKeymap: true
      })
    ]
  });
  console.log(`=== ${label} ===`);
  syntaxTree(state).iterate({
    enter: (node) => {
      console.log(node.name, node.from, node.to, JSON.stringify(state.doc.sliceString(node.from, node.to)).slice(0, 40));
    }
  });
}

dump("no blank line before ---", ["before_A", "before_B", "---", "after_A", "after_B"].join("\n"));
dump("WITH blank line before ---", ["before_A", "before_B", "", "---", "", "after_A", "after_B"].join("\n"));
