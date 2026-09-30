//
//  UTType+Markdown.swift
//  Smudge
//

import UniformTypeIdentifiers

extension UTType {
    /// The canonical Markdown type, exported by Smudge in Info.plist.
    nonisolated static let markdown = UTType(exportedAs: "net.daringfireball.markdown")

    /// Every content type Smudge is willing to open.
    nonisolated static var smudgeReadableTypes: [UTType] { [.markdown, .plainText] }

    /// Every content type Smudge is willing to write.
    nonisolated static var smudgeWritableTypes: [UTType] { [.markdown, .plainText] }
}
