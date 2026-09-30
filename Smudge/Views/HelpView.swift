//
//  HelpView.swift
//  Smudge
//

import SwiftUI

/// A single row in the Markdown syntax reference table.
private struct SyntaxExample: Identifiable {
    let id = UUID()
    let syntax: String
    let description: String
}

/// A collapsible group of syntax examples, shown as its own section.
private struct SyntaxGroup: Identifiable {
    let id = UUID()
    let title: String
    let examples: [SyntaxExample]
}

private let syntaxGroups: [SyntaxGroup] = [
    SyntaxGroup(title: "Headings", examples: [
        SyntaxExample(syntax: "# Heading 1", description: "Through ###### for Heading 6"),
        SyntaxExample(syntax: "## Heading 2", description: "")
    ]),
    SyntaxGroup(title: "Emphasis", examples: [
        SyntaxExample(syntax: "**bold**", description: "Bold text"),
        SyntaxExample(syntax: "*italic*", description: "Italic text"),
        SyntaxExample(syntax: "~~strikethrough~~", description: "Strikethrough"),
        SyntaxExample(syntax: "==highlight==", description: "Highlighted text"),
        SyntaxExample(syntax: "`inline code`", description: "Inline code span")
    ]),
    SyntaxGroup(title: "Links & Images", examples: [
        SyntaxExample(syntax: "[link text](https://example.com)", description: "Link"),
        SyntaxExample(syntax: "![alt text](image.png)", description: "Image")
    ]),
    SyntaxGroup(title: "Lists", examples: [
        SyntaxExample(syntax: "- item", description: "Bullet list (- * or +)"),
        SyntaxExample(syntax: "1. item", description: "Numbered list"),
        SyntaxExample(syntax: "- [ ] todo", description: "Task list item"),
        SyntaxExample(syntax: "- [x] done", description: "Completed task item")
    ]),
    SyntaxGroup(title: "Blocks", examples: [
        SyntaxExample(syntax: "> Quoted text", description: "Blockquote"),
        SyntaxExample(syntax: "```\ncode block\n```", description: "Fenced code block"),
        SyntaxExample(syntax: "---", description: "Horizontal rule"),
        SyntaxExample(syntax: "| a | b |\n| --- | --- |\n| 1 | 2 |", description: "Table")
    ]),
    SyntaxGroup(title: "Definition Lists", examples: [
        SyntaxExample(syntax: "Term\n: Definition", description: "One or more `:` lines per term")
    ]),
    SyntaxGroup(title: "Footnotes", examples: [
        SyntaxExample(syntax: "Some text.[^1]\n\n[^1]: The note.", description: "Rendered at the bottom of the document")
    ]),
    SyntaxGroup(title: "Math (KaTeX)", examples: [
        SyntaxExample(syntax: "Inline $x^2$", description: "Inline math"),
        SyntaxExample(syntax: "$$\ny = mx + b\n$$", description: "Block math")
    ]),
    SyntaxGroup(title: "Front Matter", examples: [
        SyntaxExample(syntax: "---\ntitle: My Post\ndate: 2024-01-01\n---", description: "YAML metadata block at the top of the document")
    ]),
    SyntaxGroup(title: "Emoji", examples: [
        SyntaxExample(syntax: ":tada:", description: "Shortcode → 🎉")
    ])
]

private struct ShortcutRow: Identifiable {
    let id = UUID()
    let keys: String
    let action: String
}

private let editingShortcuts: [ShortcutRow] = [
    ShortcutRow(keys: "⌘B", action: "Toggle bold"),
    ShortcutRow(keys: "⌘I", action: "Toggle italic"),
    ShortcutRow(keys: "⌘K", action: "Insert link"),
    ShortcutRow(keys: "⇧⌘Y", action: "Insert front matter template"),
    ShortcutRow(keys: "⌘Z", action: "Undo"),
    ShortcutRow(keys: "⇧⌘Z", action: "Redo")
]

private let viewShortcuts: [ShortcutRow] = [
    ShortcutRow(keys: "⇧⌘P", action: "Toggle Preview / Raw mode")
]

private let documentShortcuts: [ShortcutRow] = [
    ShortcutRow(keys: "⌘N", action: "New document"),
    ShortcutRow(keys: "⌘O", action: "Open…"),
    ShortcutRow(keys: "⌘S", action: "Save"),
    ShortcutRow(keys: "⌘W", action: "Close window")
]

/// A standalone Help window: a quick-reference for Markdown syntax and
/// keyboard shortcuts, plus a short overview of preview/raw mode and export.
/// Opened from the Help menu (`SmudgeCommands`) via `openWindow(id: "help")`,
/// so it's available from any document window and isn't tied to a
/// particular document's state.
struct HelpView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                overview

                VStack(alignment: .leading, spacing: 4) {
                    Text("Keyboard Shortcuts")
                        .font(.title2.bold())
                    shortcutSection(title: "Editing", rows: editingShortcuts)
                    shortcutSection(title: "View", rows: viewShortcuts)
                    shortcutSection(title: "Document", rows: documentShortcuts)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Markdown Syntax Reference")
                        .font(.title2.bold())
                    ForEach(syntaxGroups) { group in
                        syntaxSection(group)
                    }
                }
            }
            .padding(24)
        }
        .frame(minWidth: 480, idealWidth: 560, minHeight: 420, idealHeight: 640)
        .navigationTitle("Smudge Help")
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Smudge Help")
                .font(.largeTitle.bold())
            Text(
                "Smudge is a Markdown editor with a live preview: formatting is " +
                "rendered directly in the editor as you type, while the raw " +
                "Markdown source stays fully editable. Switch between Preview " +
                "and Raw mode at any time with the toolbar picker or ⇧⌘P — " +
                "clicking or moving the cursor into any formatted element " +
                "always reveals its raw source for editing."
            )
            .fixedSize(horizontal: false, vertical: true)
            Text(
                "Use File ▸ Export as HTML… or Export as PDF… to save a " +
                "standalone rendered copy of the document."
            )
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(.secondary)
        }
    }

    private func shortcutSection(title: String, rows: [ShortcutRow]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            ForEach(rows) { row in
                HStack {
                    Text(row.keys)
                        .font(.system(.body, design: .monospaced))
                        .frame(width: 90, alignment: .leading)
                    Text(row.action)
                    Spacer()
                }
            }
        }
    }

    private func syntaxSection(_ group: SyntaxGroup) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(group.title)
                .font(.headline)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            ForEach(group.examples) { example in
                HStack(alignment: .top) {
                    Text(example.syntax)
                        .font(.system(.body, design: .monospaced))
                        .frame(width: 220, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(example.description)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
    }
}

#Preview {
    HelpView()
}
