import AppKit
import WebKit

/// Ad-hoc diagnostic: same technique as the earlier heading/HR investigations
/// — simulates real keyboard events in a real, visible `WKWebView` and reads
/// back the resulting cursor line via the existing `selectionChanged` bridge
/// message. This time focused on a GFM table, since the report is that the
/// cursor position becomes "out of sync by one line" after a table.

final class NavHarness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    var readyReceived = false
    var selectionLines: [Int] = []
    var selectionRanges: [(Int, Int, Int)] = [] // (line, from, to)

    override init() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .init(x: 0, y: 0, width: 800, height: 600), configuration: config)
        super.init()
        config.userContentController.add(self, name: "smudge")
        webView.navigationDelegate = self
    }

    func load(_ directory: URL) {
        let index = directory.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: directory)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "log", let level = body["level"] as? String, level == "error" {
            print("editor logged error: \(body["message"] ?? "")")
        }
        if type == "ready" {
            readyReceived = true
            print("• ready received")
            Task { @MainActor in await runTest() }
        }
        if type == "selectionChanged", let line = body["line"] as? Int,
           let from = body["from"] as? Int, let to = body["to"] as? Int {
            selectionLines.append(line)
            selectionRanges.append((line, from, to))
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("navigation failed: \(error.localizedDescription)")
        exit(1)
    }

    private func js(_ code: String) async -> Any? {
        return try? await webView.evaluateJavaScript(code)
    }

    private func dispatchArrow(_ key: String, count: Int = 1) async {
        let keyCode = key == "ArrowDown" ? 40 : (key == "ArrowUp" ? 38 : (key == "ArrowRight" ? 39 : 37))
        let single = """
            (() => {
              const el = document.querySelector('.cm-content');
              const ev = new KeyboardEvent('keydown', {
                key: '\(key)', code: '\(key)', keyCode: \(keyCode),
                which: \(keyCode), bubbles: true, cancelable: true
              });
              el.dispatchEvent(ev);
              return true;
            })()
            """
        for _ in 0..<count {
            _ = await js(single)
            try? await Task.sleep(nanoseconds: 60_000_000)
        }
    }

    private func typeChar(_ ch: String) async {
        _ = await js("document.execCommand('insertText', false, '\(ch)')")
        try? await Task.sleep(nanoseconds: 60_000_000)
    }

    func runTest() async {
        // Unambiguous per-line content, with blank lines around the table
        // (required — a table needs its own paragraph, not glued to
        // preceding/following text).
        let lines = [
            "before_A",                  // line 1
            "before_B",                  // line 2
            "",                          // line 3
            "| a | b |",                 // line 4 (table header)
            "| --- | --- |",             // line 5 (table delimiter)
            "| 1 | 2 |",                 // line 6 (table row)
            "| 3 | 4 |",                 // line 7 (table row)
            "",                          // line 8
            "after_A",                   // line 9
            "after_B"                    // line 10
        ]
        let doc = lines.joined(separator: "\\n")

        func offsets() -> [Int] {
            var pos = 0
            var starts: [Int] = []
            for l in lines {
                starts.append(pos)
                pos += l.count + 1
            }
            return starts
        }
        let lineStarts = offsets()

        let revision = Int.random(in: 1000...999999)
        _ = await js("window.SmudgeEditor.setDoc('\(doc)', \(revision))")
        _ = await js("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 300_000_000)

        let debugJS = """
            (() => JSON.stringify({
              mode: document.querySelector('.cm-editor').dataset.mode,
              tableCount: document.querySelectorAll('.cm-md-table table').length
            }))()
            """
        print("DOM state: \(String(describing: await js(debugJS)))")

        print("\n=== ArrowDown from line 1 to the end ===")
        // The table (lines 4-7) is a single collapsed block widget while not
        // the active line — like a folded region, one ArrowDown press steps
        // over the *entire* table in one go (3 -> 8), which is correct,
        // intentional behaviour (matching FrontMatter's own collapsed-block
        // stepping), not a bug. What actually matters — and is what the bug
        // report was about — is that ordinary line-by-line stepping
        // immediately *after* the table (8 -> 9 -> 10) stays correct instead
        // of drifting by one line.
        selectionLines.removeAll()
        await dispatchArrow("ArrowDown", count: 5) // 1->2->3->8(skips table)->9->10
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited: \(selectionLines)")
        let expectedDown = [2, 3, 8, 9, 10]
        if selectionLines != expectedDown {
            print("  ⚠️ MISMATCH — expected \(expectedDown)")
        } else {
            print("  ✅ matches expected")
        }

        print("\n=== ArrowUp from line 10 back to line 1 ===")
        selectionLines.removeAll()
        await dispatchArrow("ArrowUp", count: 5) // 10->9->8->3(skips table)->2->1
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited: \(selectionLines)")
        let expectedUp = [9, 8, 3, 2, 1]
        if selectionLines != expectedUp {
            print("  ⚠️ MISMATCH — expected \(expectedUp)")
        } else {
            print("  ✅ matches expected")
        }

        // Land on line 1, move down past the whole table to line 9 ("after_A"), then type.
        print("\n=== Type after moving DOWN through the table ===")
        _ = await js("window.SmudgeEditor.setDoc('\(doc)', \(revision + 1))")
        _ = await js("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 300_000_000)
        selectionLines.removeAll()
        selectionRanges.removeAll()
        await dispatchArrow("ArrowDown", count: 4) // 1->2->3->8(skips table)->9
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited: \(selectionLines)")
        print("ranges: \(selectionRanges)")

        let expectedPosAtLine9 = lineStarts[8]
        if let last = selectionRanges.last, last.0 == 9, last.1 == expectedPosAtLine9 {
            print("  ✅ cursor correctly at line 9 offset \(expectedPosAtLine9)")
        } else {
            print("  ⚠️ expected (9, \(expectedPosAtLine9), \(expectedPosAtLine9)), got \(String(describing: selectionRanges.last))")
        }

        await typeChar("X")
        let docAfterType = await js("window.SmudgeEditor.getDoc()") as? String ?? "<nil>"
        print("doc after typing 'X':")
        print(docAfterType.replacingOccurrences(of: "\n", with: "\\n"))
        let expectedLine9 = "Xafter_A"
        if docAfterType.contains(expectedLine9) {
            print("  ✅ 'X' landed at the start of after_A")
        } else {
            print("  ⚠️ MISMATCH — 'X' did not land where expected")
        }

        // Land on a row *inside* the table (activates it / shows raw pipes).
        print("\n=== Navigate onto a table row, then off it ===")
        _ = await js("window.SmudgeEditor.setDoc('\(doc)', \(revision + 2))")
        _ = await js("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 300_000_000)
        selectionLines.removeAll()
        selectionRanges.removeAll()
        await dispatchArrow("ArrowDown", count: 3) // 1->2->3->8(skips table; not yet inside it)
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited stepping over the table: \(selectionLines)")
        if let last = selectionLines.last, last == 8 {
            print("  ✅ landed on line 8 (right after the table)")
        } else {
            print("  ⚠️ expected line 8, got \(String(describing: selectionLines.last))")
        }

        await dispatchArrow("ArrowDown", count: 2) // -> 9, 10
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited continuing down: \(selectionLines)")
        let expectedContinuing = [8, 9, 10]
        if selectionLines == expectedContinuing {
            print("  ✅ matches expected \(expectedContinuing)")
        } else {
            print("  ⚠️ MISMATCH — expected \(expectedContinuing), got \(selectionLines)")
        }


        exit(0)
    }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let editorDirectory = root.appendingPathComponent("Resources/editor")

guard FileManager.default.fileExists(atPath: editorDirectory.appendingPathComponent("editor.js").path) else {
    print("❌ Resources/editor/editor.js missing — run `cd editor-src && npm run build` first.")
    exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let harness = NavHarness()

let window = NSWindow(
    contentRect: NSRect(x: 100, y: 100, width: 800, height: 600),
    styleMask: [.titled, .closable, .resizable],
    backing: .buffered,
    defer: false
)
window.title = "TableCursorDebug"
window.contentView = harness.webView
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)

harness.load(editorDirectory)

DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
    print("timed out")
    exit(1)
}

app.run()
