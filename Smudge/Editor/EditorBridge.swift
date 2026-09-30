//
//  EditorBridge.swift
//  Smudge
//

import Foundation
import SwiftUI
import WebKit

/// A performance profile once resolved by the editor against document size.
/// Mirrors `ResolvedPerfProfile` in `bridge.ts`.
enum ResolvedPerfProfile: String {
    case full
    case reduced
    case plain

    var label: String {
        switch self {
        case .full: "Full"
        case .reduced: "Reduced"
        case .plain: "Plain"
        }
    }
}

/// Coordinates the Swift ↔ JS bridge for a single document window.
///
/// One instance per open document, owned by `DocumentView` and exposed to
/// the menu bar for the *focused* window via `FocusedValues.editorBridge`
/// (see the extension at the bottom of this file) — each window's Format
/// menu / Undo / Redo commands act on whichever document is key.
///
/// Responsibilities:
/// - Pushes the document's text into the editor on load, and applies
///   `changes` messages back onto the document, using a revision counter to
///   avoid feeding a change back to the editor that originated there.
/// - Forwards menu/toolbar commands (mode, theme, perf profile, formatting,
///   front matter, undo/redo) into `window.SmudgeEditor` via
///   `evaluateJavaScript`.
/// - Surfaces live word/character/line counts and the resolved performance
///   profile for `StatusBarView`.
@MainActor
@Observable
final class EditorBridge: NSObject {

    static let handlerName = "smudge"

    // MARK: Live state for SwiftUI

    private(set) var isReady = false
    private(set) var wordCount = 0
    private(set) var characterCount = 0
    private(set) var lineCount = 1
    private(set) var resolvedPerfProfile: ResolvedPerfProfile = .full
    private(set) var perfIsAuto = true

    // MARK: Wiring

    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored private weak var document: MarkdownDocument?
    @ObservationIgnored private var pendingCalls: [() -> Void] = []
    @ObservationIgnored private var textSyncTask: Task<Void, Never>?
    /// The revision we expect `document.onTextChanged` to report back to us
    /// after we write JS-originated text into the document. When it matches,
    /// the change is our own echo, not an external edit, and shouldn't be
    /// pushed back into the editor.
    @ObservationIgnored private var pendingLocalRevision: Int?

    // MARK: Lifecycle

    /// Wires this bridge to a document and the web view hosting the editor.
    /// Call once, from `WebEditorView.makeNSView`.
    func attach(document: MarkdownDocument, webView: WKWebView) {
        self.document = document
        self.webView = webView
        document.onTextChanged = { [weak self] in
            self?.handleDocumentChangedExternally()
        }
    }

    /// Tears down the bridge's side effects. Call from
    /// `WebEditorView.dismantleNSView` so a closed window doesn't leak a
    /// retained `WKUserContentController` handler or keep firing into a
    /// deallocated document.
    func detach() {
        document?.onTextChanged = nil
        textSyncTask?.cancel()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
        webView = nil
        document = nil
    }

    // MARK: Document sync

    private func handleDocumentChangedExternally() {
        guard let document else { return }
        let revision = document.revision
        if let pendingLocalRevision, pendingLocalRevision == revision {
            self.pendingLocalRevision = nil
            return
        }
        pendingLocalRevision = nil
        call("window.SmudgeEditor.setDoc", [document.text, revision])
    }

    /// Debounces `changes` messages from the editor into a single `getDoc()`
    /// round trip. The wire format of a serialised CodeMirror `ChangeSet`
    /// (see `SerializedChanges` in `bridge.ts`) is deliberately not decoded
    /// here — reimplementing `ChangeSet` application in Swift would be a lot
    /// of surface area for no benefit, since asking the editor for its
    /// current text is a cheap, always-correct alternative.
    private func scheduleTextSync() {
        textSyncTask?.cancel()
        textSyncTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            await self?.syncTextFromEditor()
        }
    }

    private func syncTextFromEditor() async {
        guard let webView, let document else { return }
        guard let text = try? await webView.evaluateJavaScript("window.SmudgeEditor.getDoc()") as? String else {
            return
        }
        guard document.text != text else { return }
        pendingLocalRevision = document.revision + 1
        document.replaceText(text)
    }

    // MARK: Commands

    func setMode(_ mode: EditorMode) {
        call("window.SmudgeEditor.setMode", [mode.rawValue])
    }

    func pushTheme(appearance: String, fontSize: Double) {
        call("window.SmudgeEditor.setTheme", [["appearance": appearance, "fontSize": fontSize]])
    }

    func setPerfProfile(_ profile: String) {
        call("window.SmudgeEditor.setPerfProfile", [profile])
    }

    func setFrontMatterDefaultCollapsed(_ collapsed: Bool) {
        call("window.SmudgeEditor.setFrontMatterDefaultCollapsed", [collapsed])
    }

    func toggleBold() {
        call("window.SmudgeEditor.wrapSelection", ["**", "**"])
    }

    func toggleItalic() {
        call("window.SmudgeEditor.wrapSelection", ["*", "*"])
    }

    func insertLink() {
        call("window.SmudgeEditor.insertLink", [])
    }

    func insertFrontMatterTemplate() {
        call("window.SmudgeEditor.insertFrontMatterTemplate", [])
    }

    func toggleFrontMatter() {
        call("window.SmudgeEditor.toggleFrontMatter", [])
    }

    func undo() {
        call("window.SmudgeEditor.undo", [])
    }

    func redo() {
        call("window.SmudgeEditor.redo", [])
    }

    // MARK: Queries (export)

    /// Renders the current document to an HTML fragment (front matter
    /// excluded, math/emoji/task-lists included) for HTML/PDF export.
    func renderHTML() async throws -> String {
        guard isReady, let webView else { throw ExportError.editorNotReady }
        guard let html = try await webView.evaluateJavaScript("window.SmudgeEditor.renderHTML()") as? String else {
            throw ExportError.renderFailed("unexpected result type")
        }
        return html
    }

    /// The document's parsed front-matter data (empty if absent/invalid),
    /// used to fill in the exported document's `<title>` and metadata.
    func frontMatterMeta() async throws -> [String: Any] {
        guard isReady, let webView else { throw ExportError.editorNotReady }
        let result = try await webView.evaluateJavaScript("window.SmudgeEditor.getFrontMatterMeta()")
        return (result as? [String: Any]) ?? [:]
    }

    // MARK: JS invocation

    /// Calls a global JS function by name with JSON-safe arguments, queuing
    /// the call until the editor reports `ready` if necessary.
    private func call(_ function: String, _ args: [Any]) {
        guard isReady else {
            pendingCalls.append { [weak self] in self?.evaluate(function: function, args: args) }
            return
        }
        evaluate(function: function, args: args)
    }

    private func flushPendingCalls() {
        let calls = pendingCalls
        pendingCalls.removeAll()
        for call in calls { call() }
    }

    private func evaluate(function: String, args: [Any]) {
        guard let webView else { return }
        guard let js = Self.buildInvocation(function: function, args: args) else { return }
        webView.evaluateJavaScript(js) { _, error in
            if let error {
                #if DEBUG
                print("EditorBridge: \(function) failed: \(error)")
                #endif
            }
        }
    }

    /// Builds `function.apply(null, [...jsonArgs])` — arguments are JSON
    /// serialised rather than string-interpolated so arbitrary document text
    /// (quotes, backslashes, newlines) can never break out of the call.
    private static func buildInvocation(function: String, args: [Any]) -> String? {
        guard !args.isEmpty else { return "\(function)()" }
        guard JSONSerialization.isValidJSONObject(args),
              let data = try? JSONSerialization.data(withJSONObject: args),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return "\(function).apply(null, \(json))"
    }
}

// MARK: - WKScriptMessageHandler

extension EditorBridge: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }

        switch type {
        case "ready":
            handleReady()

        case "changes":
            scheduleTextSync()

        case "selectionChanged":
            break // reserved for future use (outline, status-bar position).

        case "metrics":
            wordCount = body["words"] as? Int ?? wordCount
            characterCount = body["characters"] as? Int ?? characterCount
            lineCount = body["lines"] as? Int ?? lineCount

        case "perf":
            if let raw = body["profile"] as? String, let profile = ResolvedPerfProfile(rawValue: raw) {
                resolvedPerfProfile = profile
            }
            perfIsAuto = body["auto"] as? Bool ?? perfIsAuto

        case "log":
            #if DEBUG
            print("[editor \(body["level"] ?? "info")] \(body["message"] ?? "")")
            #endif

        default:
            break
        }
    }

    private func handleReady() {
        isReady = true
        if let document {
            call("window.SmudgeEditor.setDoc", [document.text, document.revision])
        }
        flushPendingCalls()
    }
}

// MARK: - WKNavigationDelegate

extension EditorBridge: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        #if DEBUG
        print("EditorBridge: navigation failed: \(error.localizedDescription)")
        #endif
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        #if DEBUG
        print("EditorBridge: provisional navigation failed: \(error.localizedDescription)")
        #endif
    }
}

// MARK: - FocusedValue

/// Exposes the focused window's bridge to the menu bar, so Format/Undo/Redo
/// commands act on whichever document is key rather than a single global
/// instance.
private struct EditorBridgeFocusedValueKey: FocusedValueKey {
    typealias Value = EditorBridge
}

extension FocusedValues {
    var editorBridge: EditorBridge? {
        get { self[EditorBridgeFocusedValueKey.self] }
        set { self[EditorBridgeFocusedValueKey.self] = newValue }
    }
}
