//
//  WebEditorView.swift
//  Smudge
//

import SwiftUI
import WebKit

/// Hosts the vendored CodeMirror editor bundle (`Resources/editor/`) for a
/// single document.
///
/// All state flows through `EditorBridge`, not SwiftUI view updates —
/// `updateNSView` deliberately does nothing. Mode/theme/perf-profile changes
/// are pushed by calling bridge methods directly from `DocumentView`'s
/// `.onChange` handlers, which is also what keeps a single `WKWebView`
/// instance alive across those changes instead of recreating it.
struct WebEditorView: NSViewRepresentable {
    let document: MarkdownDocument
    let bridge: EditorBridge

    func makeNSView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller

        let webView = ContextMenuWebView(frame: .zero, configuration: configuration)
        controller.add(bridge, name: EditorBridge.handlerName)
        webView.navigationDelegate = bridge

        #if DEBUG
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif

        bridge.attach(document: document, webView: webView)

        if let directory = Bundle.main.resourceURL?.appendingPathComponent("editor", isDirectory: true) {
            let index = directory.appendingPathComponent("index.html")
            webView.loadFileURL(index, allowingReadAccessTo: directory)
        }

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}

    static func dismantleNSView(_ webView: WKWebView, coordinator: ()) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: EditorBridge.handlerName)
    }
}

/// A `WKWebView` subclass that replaces WebKit's default contextual menu
/// (Reload, Open Link, Inspect Element, …) with a minimal native one: cut,
/// copy, paste, select all, and the standard spelling & grammar submenu.
///
/// WKWebView already forwards these standard edit-action selectors to
/// whatever editable content is focused inside the page, so no custom
/// targets are needed — only the menu WebKit would otherwise build needs
/// replacing.
final class ContextMenuWebView: WKWebView {
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        menu.removeAllItems()

        menu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Select All", action: #selector(NSResponder.selectAll(_:)), keyEquivalent: "a")
        menu.addItem(.separator())
        menu.addItem(spellingSubmenuItem())
    }

    private func spellingSubmenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: "Spelling and Grammar", action: nil, keyEquivalent: "")
        let submenu = NSMenu(title: "Spelling and Grammar")
        submenu.addItem(
            withTitle: "Show Spelling and Grammar",
            action: #selector(NSText.showGuessPanel(_:)),
            keyEquivalent: ";"
        )
        submenu.addItem(
            withTitle: "Check Document Now",
            action: #selector(NSText.checkSpelling(_:)),
            keyEquivalent: ":"
        )
        submenu.addItem(.separator())
        submenu.addItem(
            withTitle: "Check Spelling While Typing",
            action: #selector(NSTextView.toggleContinuousSpellChecking(_:)),
            keyEquivalent: ""
        )
        submenu.addItem(
            withTitle: "Check Grammar With Spelling",
            action: #selector(NSTextView.toggleGrammarChecking(_:)),
            keyEquivalent: ""
        )
        submenu.addItem(
            withTitle: "Correct Spelling Automatically",
            action: #selector(NSTextView.toggleAutomaticSpellingCorrection(_:)),
            keyEquivalent: ""
        )
        item.submenu = submenu
        return item
    }
}
