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
///
/// Security: the `src` of an `<img>` is attacker-controlled whenever the
/// user opens a document they didn't write, and whatever this reads gets
/// base64'd into a file the user is likely to share. Two rules contain that:
///
/// 1. The resolved path must sit *inside* the document's own folder. `../`
///    escapes, absolute `file://` paths, and symlinks pointing outside are
///    all rejected — hence `standardizedFileURL.resolvingSymlinksInPath()`
///    before the check, and a component-wise comparison rather than a string
///    prefix (so `/docs-private/secret` doesn't pass as being under `/docs`).
/// 2. The extension must map to a UTI conforming to `public.image`, so a
///    stray `![](notes.txt)` or `![](id_rsa)` sitting next to the document
///    can't be swept in either.
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

        // An unsaved document has no folder to resolve against, so there is
        // no safe base and nothing can be inlined.
        guard let base = documentURL?
            .deletingLastPathComponent()
            .standardizedFileURL
            .resolvingSymlinksInPath()
        else {
            return nil
        }

        guard let fileURL = resolvedImageURL(forSrc: src, in: base),
              let mime = imageMIMEType(for: fileURL),
              let data = try? Data(contentsOf: fileURL)
        else {
            return nil
        }
        return "data:\(mime);base64,\(data.base64EncodedString())"
    }

    /// Resolves `src` to a real file inside `base`, or `nil` if it escapes.
    /// `base` is expected to be already standardized and symlink-resolved.
    private static func resolvedImageURL(forSrc src: String, in base: URL) -> URL? {
        let candidate: URL
        if src.hasPrefix("file://") {
            guard let url = URL(string: src), url.isFileURL else { return nil }
            candidate = url
        } else {
            guard let decoded = src.removingPercentEncoding else { return nil }
            candidate = base.appendingPathComponent(decoded)
        }

        // Resolve *before* checking: `../` segments and symlinks both only
        // reveal where a path actually lands once collapsed.
        let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
        guard isContained(resolved, in: base) else { return nil }
        return resolved
    }

    /// Component-wise containment — `/docs` must not be seen to contain
    /// `/docs-private/secret.png`, which a plain string-prefix test would
    /// happily allow.
    private static func isContained(_ url: URL, in directory: URL) -> Bool {
        let target = url.pathComponents
        let base = directory.pathComponents
        guard target.count > base.count else { return false }
        return Array(target.prefix(base.count)) == base
    }

    /// The MIME type for `url`, but only if it's genuinely an image type.
    /// Anything else returns `nil` and is left as a plain link.
    private static func imageMIMEType(for url: URL) -> String? {
        guard let type = UTType(filenameExtension: url.pathExtension),
              type.conforms(to: .image),
              let mime = type.preferredMIMEType
        else {
            return nil
        }
        return mime
    }
}
