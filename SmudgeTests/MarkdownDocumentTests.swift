//
//  MarkdownDocumentTests.swift
//  SmudgeTests
//

import Foundation
import Testing
import UniformTypeIdentifiers
@testable import Smudge

struct MarkdownDocumentTests {

    @Test func snapshotPreservesContentExactly() throws {
        let source = "# Heading\n\nSome *emphasis* and an emoji 🖋️.\n"
        let document = MarkdownDocument(text: source)

        let snapshot = try document.snapshot(contentType: .markdown)
        #expect(snapshot == source)

        // The write path encodes the snapshot as UTF-8 verbatim.
        #expect(String(decoding: Data(snapshot.utf8), as: UTF8.self) == source)
    }

    @Test func replacingTextBumpsRevision() {
        let document = MarkdownDocument(text: "one")
        let initial = document.revision

        document.replaceText("two")
        #expect(document.revision == initial + 1)

        // Writing an identical value must not register a change.
        document.replaceText("two")
        #expect(document.revision == initial + 1)
    }

    @Test func readableTypesIncludeMarkdown() {
        #expect(MarkdownDocument.readableContentTypes.contains(.markdown))
    }

    @Test func writableTypesIncludeMarkdown() {
        #expect(MarkdownDocument.writableContentTypes.contains(.markdown))
    }

    @Test func markdownIdentifierIsCanonical() {
        #expect(UTType.markdown.identifier == "net.daringfireball.markdown")
    }

    @Test func markdownConformsToPlainText() {
        #expect(UTType.markdown.conforms(to: .plainText))
    }
}
