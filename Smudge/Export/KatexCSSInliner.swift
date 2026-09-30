//
//  KatexCSSInliner.swift
//  Smudge
//

import Foundation

/// Inlines `katex.min.css` (bundled at `Resources/editor/katex/`) as base64
/// `data:` URIs for its `.woff2` fonts, so exported HTML/PDF needs no
/// external files to render math correctly — the CSS as shipped references
/// fonts via relative `url(fonts/…)` paths, which only resolve when loaded
/// from inside the app bundle.
enum KatexCSSInliner {
    private static var cachedCSS: String?

    static func inlinedCSS() throws -> String {
        if let cachedCSS {
            return cachedCSS
        }
        guard let editorDirectory = Bundle.main.resourceURL?.appendingPathComponent("editor", isDirectory: true)
        else {
            throw ExportError.assetMissing("editor resources")
        }
        let cssURL = editorDirectory.appendingPathComponent("katex/katex.min.css")
        guard var css = try? String(contentsOf: cssURL, encoding: .utf8) else {
            throw ExportError.assetMissing("katex.min.css")
        }

        let fontsDirectory = editorDirectory.appendingPathComponent("katex/fonts")
        guard let regex = try? NSRegularExpression(pattern: #"url\(([^)]+\.woff2)\)"#) else {
            cachedCSS = css
            return css
        }
        let nsCSS = css as NSString
        let matches = regex.matches(in: css, range: NSRange(location: 0, length: nsCSS.length))

        // Reversed so earlier match offsets (computed against the original
        // string) stay valid as later ones are replaced in `css`.
        for match in matches.reversed() {
            let reference = nsCSS.substring(with: match.range(at: 1))
            let fontName = (reference as NSString).lastPathComponent
            let fontURL = fontsDirectory.appendingPathComponent(fontName)
            guard let data = try? Data(contentsOf: fontURL) else { continue }
            let dataURI = "url(data:font/woff2;base64,\(data.base64EncodedString()))"
            guard let range = Range(match.range(at: 0), in: css) else { continue }
            css.replaceSubrange(range, with: dataURI)
        }

        cachedCSS = css
        return css
    }
}
