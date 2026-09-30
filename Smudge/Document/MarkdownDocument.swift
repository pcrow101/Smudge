//
//  MarkdownDocument.swift
//  Smudge
//

@preconcurrency import Combine
import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// The Markdown document model.
///
/// A reference type so that later phases (the CodeMirror bridge, incremental
/// `ChangeSet` application, and asset relocation) can mutate a single shared
/// instance rather than passing value copies across the web bridge.
///
/// Deliberately **non-isolated**: AppKit instantiates documents on a background
/// operation queue when opening files from disk, so this type cannot be bound
/// to the main actor. Storage is guarded by a lock instead, and change
/// notifications are hopped to the main thread for SwiftUI.
nonisolated final class MarkdownDocument: ReferenceFileDocument {

    typealias Snapshot = String

    static var readableContentTypes: [UTType] { UTType.smudgeReadableTypes }
    static var writableContentTypes: [UTType] { UTType.smudgeWritableTypes }

    let objectWillChange = ObservableObjectPublisher()

    private let lock = NSLock()
    nonisolated(unsafe) private var _text: String
    nonisolated(unsafe) private var _revision: Int = 0

    /// The full Markdown source. Source of truth for both raw and preview modes.
    var text: String {
        get { lock.withLock { _text } }
        set { replaceText(newValue) }
    }

    /// Monotonically increasing revision, used from Phase 6 onward to suppress
    /// echo when applying changes that originated in the editor web view.
    var revision: Int {
        lock.withLock { _revision }
    }

    /// Invoked after `text` changes for any reason, always on the main
    /// thread. `EditorBridge` uses this to keep the web editor in sync with
    /// changes that didn't originate from it (currently: initial load only;
    /// Phase 8's asset relocator will be a second caller). Not invoked for
    /// the bridge's own writes when it recognises its own revision — see
    /// `EditorBridge.handleDocumentChangedExternally`.
    ///
    /// `nonisolated(unsafe)` for the same reason as `_text`/`_revision`
    /// above: this type has no actor of its own, so callers are responsible
    /// for only touching this from the main thread, which every call site in
    /// this file already guarantees.
    nonisolated(unsafe) var onTextChanged: (() -> Void)?

    init(text: String = "") {
        self._text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self._text = MarkdownDocument.decode(data)
    }

    func snapshot(contentType: UTType) throws -> Snapshot {
        lock.withLock { _text }
    }

    func fileWrapper(snapshot: Snapshot, configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(snapshot.utf8))
    }

    // MARK: - Mutation

    /// Replaces the entire document text, bumping the revision counter.
    func replaceText(_ newText: String) {
        let changed: Bool = lock.withLock {
            guard newText != _text else { return false }
            _text = newText
            _revision &+= 1
            return true
        }
        guard changed else { return }
        notifyChange()
    }

    private func notifyChange() {
        if Thread.isMainThread {
            objectWillChange.send()
            onTextChanged?()
            return
        }
        // `ObservableObjectPublisher` (and `onTextChanged`) are not
        // `Sendable`, but sending from a single hop onto the main thread is
        // safe: both are only ever read/invoked there.
        nonisolated(unsafe) let publisher = objectWillChange
        nonisolated(unsafe) let handler = onTextChanged
        DispatchQueue.main.async {
            publisher.send()
            handler?()
        }
    }

    // MARK: - Decoding

    /// Decodes file data as UTF-8, falling back to lossy interpretations rather
    /// than refusing to open a file the user can plainly read elsewhere.
    private static func decode(_ data: Data) -> String {
        if let utf8 = String(data: data, encoding: .utf8) {
            return utf8
        }
        if let utf16 = String(data: data, encoding: .utf16) {
            return utf16
        }
        if let latin1 = String(data: data, encoding: .isoLatin1) {
            return latin1
        }
        return String(decoding: data, as: UTF8.self)
    }
}
