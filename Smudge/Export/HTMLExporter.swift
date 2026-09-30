//
//  HTMLExporter.swift
//  Smudge
//

import Foundation

/// Renders a document to a standalone, portable HTML file.
///
/// "Standalone" means genuinely so: KaTeX's CSS and fonts are inlined as
/// base64 (`KatexCSSInliner`), and local image references are resolved
/// against the document's own folder and inlined the same way
/// (`ImageInliner`) — the exported file has no external dependencies and
/// can be opened, emailed, or moved anywhere without broken links.
@MainActor
enum HTMLExporter {
    /// Renders `bridge`'s current document to a complete HTML document.
    /// `documentURL` is used both to resolve relative image paths and, when
    /// no `title` front-matter field is present, to name the document.
    static func export(bridge: EditorBridge, documentURL: URL?) async throws -> Data {
        let bodyHTML = try await bridge.renderHTML()
        let meta = try? await bridge.frontMatterMeta()

        let inlinedBody = ImageInliner.inline(html: bodyHTML, relativeTo: documentURL)
        let needsKatex = bodyHTML.contains("class=\"katex")
        let styleBlock = try styleBlock(includeKatex: needsKatex)

        let title = titleString(from: meta, documentURL: documentURL)
        let document = standaloneDocument(title: title, styleBlock: styleBlock, bodyHTML: inlinedBody)

        guard let data = document.data(using: .utf8) else {
            throw ExportError.renderFailed("couldn't encode as UTF-8")
        }
        return data
    }

    private static func styleBlock(includeKatex: Bool) throws -> String {
        guard includeKatex else { return ExportStylesheet.reading }
        return ExportStylesheet.reading + "\n" + (try KatexCSSInliner.inlinedCSS())
    }

    private static func titleString(from meta: [String: Any]?, documentURL: URL?) -> String {
        if let title = meta?["title"] as? String, !title.trimmingCharacters(in: .whitespaces).isEmpty {
            return title
        }
        return documentURL?.deletingPathExtension().lastPathComponent ?? "Untitled"
    }

    private static func standaloneDocument(title: String, styleBlock: String, bodyHTML: String) -> String {
        """
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>\(escapeHTML(title))</title>
        <style>
        \(styleBlock)
        </style>
        </head>
        <body>
        <article class="smudge-export">
        \(bodyHTML)
        </article>
        </body>
        </html>
        """
    }

    private static func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
