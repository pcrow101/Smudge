//
//  ExportTests.swift
//  SmudgeTests
//

import Foundation
import Testing
@testable import Smudge

struct ExportTests {

    // MARK: ImageInliner

    @Test func inlinesLocalImageRelativeToDocument() throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let imageData = Data([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes; content doesn't need to be a valid image.
        let imageURL = tempDir.appendingPathComponent("pic.png")
        try imageData.write(to: imageURL)

        let documentURL = tempDir.appendingPathComponent("doc.md")
        let html = "<img src=\"pic.png\" alt=\"\">"

        let result = ImageInliner.inline(html: html, relativeTo: documentURL)

        #expect(result.contains("data:image/png;base64,"))
        #expect(result.contains(imageData.base64EncodedString()))
        #expect(!result.contains("src=\"pic.png\""))
    }

    @Test func leavesRemoteImagesUntouched() {
        let html = "<img src=\"https://example.com/pic.png\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: nil)
        #expect(result == html)
    }

    @Test func leavesAlreadyInlinedImagesUntouched() {
        let html = "<img src=\"data:image/png;base64,AAAA\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: nil)
        #expect(result == html)
    }

    @Test func leavesUnresolvableLocalImageUntouched() {
        // No document URL to resolve against, and not remote/data: either.
        let html = "<img src=\"missing.png\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: nil)
        #expect(result == html)
    }

    // MARK: ImageInliner — path containment

    /// Builds `<documentDir>/doc.md` with a secret one level above it, and
    /// returns both so a test can try to reach the secret from the document.
    private func makeEscapeFixture() throws -> (documentURL: URL, secretURL: URL, cleanup: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let documentDir = root.appendingPathComponent("notes")
        try FileManager.default.createDirectory(at: documentDir, withIntermediateDirectories: true)

        let secretURL = root.appendingPathComponent("secret.png")
        try Data("SUPER SECRET".utf8).write(to: secretURL)

        return (documentDir.appendingPathComponent("doc.md"), secretURL, root)
    }

    @Test func doesNotInlineImageOutsideDocumentDirectory() throws {
        let fixture = try makeEscapeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.cleanup) }

        let html = "<img src=\"../secret.png\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: fixture.documentURL)

        #expect(result == html)
        #expect(!result.contains("base64"))
    }

    @Test func doesNotInlinePercentEncodedTraversal() throws {
        let fixture = try makeEscapeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.cleanup) }

        let html = "<img src=\"%2e%2e/secret.png\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: fixture.documentURL)

        #expect(result == html)
    }

    @Test func doesNotInlineAbsoluteFileURLOutsideDocumentDirectory() throws {
        let fixture = try makeEscapeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.cleanup) }

        let html = "<img src=\"\(fixture.secretURL.absoluteString)\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: fixture.documentURL)

        #expect(result == html)
        #expect(!result.contains("base64"))
    }

    @Test func doesNotInlineSymlinkPointingOutsideDocumentDirectory() throws {
        let fixture = try makeEscapeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.cleanup) }

        // A symlink that lives inside the document folder but resolves out.
        let link = fixture.documentURL.deletingLastPathComponent().appendingPathComponent("link.png")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixture.secretURL)

        let html = "<img src=\"link.png\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: fixture.documentURL)

        #expect(result == html)
    }

    @Test func doesNotInlineNonImageFileBesideDocument() throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let secret = tempDir.appendingPathComponent("id_rsa")
        try Data("PRIVATE KEY".utf8).write(to: secret)

        let html = "<img src=\"id_rsa\" alt=\"\">"
        let result = ImageInliner.inline(html: html, relativeTo: tempDir.appendingPathComponent("doc.md"))

        #expect(result == html)
    }

    // MARK: EditorBridge — navigation policy

    @Test @MainActor func onlyBundledEditorURLsAreTreatedAsInternal() throws {
        let editorDir = try #require(
            Bundle.main.resourceURL?.appendingPathComponent("editor", isDirectory: true)
        )

        #expect(EditorBridge.isEditorBundleURL(editorDir.appendingPathComponent("index.html")))
        #expect(!EditorBridge.isEditorBundleURL(URL(string: "https://example.com")!))
        #expect(!EditorBridge.isEditorBundleURL(URL(fileURLWithPath: "/etc/passwd")))
        // `../` escape out of the bundle directory.
        #expect(!EditorBridge.isEditorBundleURL(editorDir.appendingPathComponent("../../secret.html")))
    }

    // MARK: KatexCSSInliner

    @Test func katexCSSFontsAreInlinedAsBase64() throws {
        let css = try KatexCSSInliner.inlinedCSS()
        #expect(css.contains("data:font/woff2;base64,"))
        // Every .woff2 reference should have been rewritten to a data: URI —
        // none should still point at a relative "fonts/…woff2" path. (The
        // .woff/.ttf fallback references legitimately stay relative: they're
        // never fetched since woff2 — which comes first — is supported.)
        let regex = try NSRegularExpression(pattern: #"url\(fonts/[^)]+\.woff2\)"#)
        let matchCount = regex.numberOfMatches(in: css, range: NSRange(css.startIndex..., in: css))
        #expect(matchCount == 0)
    }

    // MARK: HTMLExporter (title/escaping helpers via the public entry point)

    @Test func exportProducesStandaloneDocumentStructure() async throws {
        // `HTMLExporter.export` itself needs a live `EditorBridge` backed by
        // a `ready` `WKWebView` — bringing up WebKit's content process
        // reliably needs the app's real GUI event loop, which the unit-test
        // host process doesn't run, unlike `Tools/VerifyEditorBundle.swift`
        // (a standalone GUI-capable process) which already exercises
        // `renderHTML()`/`getFrontMatterMeta()` end to end, including math,
        // emoji, and task-lists. Here we just check the pieces `HTMLExporter`
        // composes on its own.
        #expect(ExportStylesheet.reading.contains(".smudge-export"))
        #expect(ExportStylesheet.reading.contains("@media print"))
    }
}
