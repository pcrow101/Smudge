//
//  ImageInliner.swift
//  Smudge
//

import Foundation
import UniformTypeIdentifiers

/// Rewrites `<img src="…">` references in exported HTML to base64 `data:`
/// URIs, so the exported file is fully portable with no dangling relative
/// image links.
///
/// Remote (`http`/`https`) images and already-inlined `data:` URIs are left
/// untouched. Local references are resolved relative to the document's own
/// folder — the only base we have, since `renderHTML()` runs inside a
/// sandboxed `WKWebView` with no filesystem access of its own. A reference
/// that can't be read (unsaved document, moved/missing file) is left as-is
/// rather than failing the whole export.
enum ImageInliner {
    static func inline(html: String, relativeTo documentURL: URL?) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"src="([^"]+)""#) else {
            return html
        }
        var result = html
        let nsHTML = html as NSString
        let matches = regex.matches(in: html, range: NSRange(location: 0, length: nsHTML.length))

        // Reversed so earlier match offsets (computed against the original
        // string) stay valid as later ones are replaced in `result`.
        for match in matches.reversed() {
            guard match.numberOfRanges > 1 else { continue }
            let src = nsHTML.substring(with: match.range(at: 1))
            guard let dataURI = dataURI(forSrc: src, relativeTo: documentURL) else { continue }
            guard let range = Range(match.range(at: 0), in: result) else { continue }
            result.replaceSubrange(range, with: "src=\"\(dataURI)\"")
        }
        return result
    }

    private static func dataURI(forSrc src: String, relativeTo documentURL: URL?) -> String? {
        guard !src.hasPrefix("data:"), !src.hasPrefix("http://"), !src.hasPrefix("https://") else {
            return nil
        }

        let fileURL: URL
        if src.hasPrefix("file://"), let url = URL(string: src) {
            fileURL = url
        } else if let base = documentURL?.deletingLastPathComponent(),
                  let decoded = src.removingPercentEncoding {
            fileURL = base.appendingPathComponent(decoded)
        } else {
            return nil
        }

        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return "data:\(mimeType(for: fileURL));base64,\(data.base64EncodedString())"
    }

    private static func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}
