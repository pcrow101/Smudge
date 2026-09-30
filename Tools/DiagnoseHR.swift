import AppKit
import WebKit

/// Ad-hoc diagnostic: same technique as the earlier vertical-nav harness —
/// simulates real keyboard events in a real WKWebView (attached to a real,
/// visible window so layout/paint actually happens) and reads back the
/// resulting cursor line via the existing `selectionChanged` bridge message —
/// this time focused on a Horizontal Rule (`---`), since the report is that
/// cursor position gets "out of sync" around one.

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

    /// Dispatches real "type a character" input the way a user would: a
    /// `beforeinput`/`input` sequence is what contentEditable actually uses,
    /// but the simplest reliable way to insert real text through CodeMirror's
    /// own handling (rather than the bridge API, which would bypass whatever
    /// bug affects real typing) is `document.execCommand('insertText', ...)`
    /// after focusing — still goes through the real DOM input path.
    private func typeChar(_ ch: String) async {
        _ = await js("document.execCommand('insertText', false, '\(ch)')")
        try? await Task.sleep(nanoseconds: 60_000_000)
    }

    func runTest() async {
        // Unambiguous content per line number, so "line N" always means
        // both the 1-indexed line number *and* matches the text — avoids
        // self-inflicted confusion in the assertions below.
        // Blank lines around "---" are required for it to parse as a
        // genuine HorizontalRule — without them, "text\n---" is CommonMark
        // syntax for a *Setext heading underline* instead (verified via a
        // syntax-tree dump), which would make this test invalid.
        let doc = [
            "before_A", // line 1
            "before_B", // line 2
            "",         // line 3
            "---",      // line 4 (HR)
            "",         // line 5
            "after_A",  // line 6
            "after_B"   // line 7
        ].joined(separator: "\\n")

        func offsets() -> [Int] {
            let lines = ["before_A", "before_B", "", "---", "", "after_A", "after_B"]
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

        print("\n=== HR doc: 4x ArrowDown from line 1 ===")
        selectionLines.removeAll()
        await dispatchArrow("ArrowDown", count: 6)
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited: \(selectionLines)")
        let expectedDown = [2, 3, 4, 5, 6, 7]
        if selectionLines != expectedDown {
            print("  ⚠️ MISMATCH — expected \(expectedDown)")
        }

        print("\n=== HR doc: 6x ArrowUp from line 7 ===")
        selectionLines.removeAll()
        await dispatchArrow("ArrowUp", count: 6)
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited: \(selectionLines)")
        let expectedUp = [6, 5, 4, 3, 2, 1]
        if selectionLines != expectedUp {
            print("  ⚠️ MISMATCH — expected \(expectedUp)")
        }

        // Land on line 1, move down past the HR to line 4 ("after_A"), then
        // type a character — does it land at the true start of line 4?
        print("\n=== Type after moving DOWN through the HR ===")
        _ = await js("window.SmudgeEditor.setDoc('\(doc)', \(revision + 1))")
        _ = await js("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 300_000_000)
        selectionLines.removeAll()
        selectionRanges.removeAll()
        await dispatchArrow("ArrowDown", count: 5) // line1 -> line2 -> blank3 -> HR(line4) -> blank5 -> line6
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited getting to line 6: \(selectionLines)")
        print("ranges: \(selectionRanges)")
        let expectedPosAtLine6 = lineStarts[5]
        if let last = selectionRanges.last, last.0 == 6, last.1 == expectedPosAtLine6 {
            print("  ✅ cursor correctly at line 6 offset \(expectedPosAtLine6)")
        } else {
            print("  ⚠️ expected (6, \(expectedPosAtLine6), \(expectedPosAtLine6)), got \(String(describing: selectionRanges.last))")
        }

        await typeChar("X")
        let docAfterType = await js("window.SmudgeEditor.getDoc()") as? String ?? "<nil>"
        print("doc after typing 'X':")
        print(docAfterType.replacingOccurrences(of: "\n", with: "\\n"))
        let expectedDoc = "before_A\nbefore_B\n---\nXafter_A\nafter_B"
        if docAfterType != expectedDoc {
            print("  ⚠️ MISMATCH — expected: \(expectedDoc.replacingOccurrences(of: "\n", with: "\\n"))")
        } else {
            print("  ✅ matches expected")
        }

        // Land directly on the HR's own line (becomes active/raw "---")
        // and type into it.
        print("\n=== Type directly on the HR's own line ===")
        _ = await js("window.SmudgeEditor.setDoc('\(doc)', \(revision + 2))")
        _ = await js("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 300_000_000)
        selectionLines.removeAll()
        selectionRanges.removeAll()
        await dispatchArrow("ArrowDown", count: 3) // line1 -> line2 -> blank3 -> HR(line4, becomes active/raw)
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("lines visited getting to HR line: \(selectionLines)")
        print("ranges: \(selectionRanges)")
        let expectedHrStart = lineStarts[3]
        if let last = selectionRanges.last, last.0 == 4, last.1 == expectedHrStart {
            print("  ✅ cursor correctly at HR line start (\(expectedHrStart))")
        } else {
            print("  ⚠️ expected (3, \(expectedHrStart), \(expectedHrStart)), got \(String(describing: selectionRanges.last))")
        }
        await dispatchArrow("ArrowRight", count: 1)
        try? await Task.sleep(nanoseconds: 150_000_000)
        let afterRight = selectionRanges.last ?? (-1, -1, -1)
        print("range after ArrowRight on HR line: \(afterRight)")
        if afterRight.1 == expectedHrStart + 1 {
            print("  ✅ moved exactly one character right")
        } else {
            print("  ⚠️ expected offset \(expectedHrStart + 1), got \(afterRight.1)")
        }
        await typeChar("Y")
        let docAfterHrType = await js("window.SmudgeEditor.getDoc()") as? String ?? "<nil>"
        print("doc after typing 'Y' into the raw HR text:")
        print(docAfterHrType.replacingOccurrences(of: "\n", with: "\\n"))

        // --- Real mouse click near the HR widget (it's a block widget with
        // no per-character coordinate mapping, unlike text lines — this is
        // the most likely place for a genuine click-position mismatch). ---
        print("\n=== Mouse click on the rendered <hr> widget ===")
        _ = await js("window.SmudgeEditor.setDoc('\(doc)', \(revision + 3))")
        _ = await js("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 300_000_000)

        let debugJS = """
            (() => {
              const content = document.querySelector('.cm-content');
              return JSON.stringify({
                mode: document.querySelector('.cm-editor').dataset.mode,
                perf: document.querySelector('.cm-editor').dataset.perf,
                hrCount: document.querySelectorAll('.cm-md-hr').length,
                hrWidgetCount: document.querySelectorAll('hr').length,
                html: content ? content.innerHTML.slice(0, 800) : 'NO_CONTENT'
              });
            })()
            """
        let debugResult = await js(debugJS)
        print("DOM debug before click: \(String(describing: debugResult))")

        let clickJS = """
            (() => {
              const hr = document.querySelector('.cm-md-hr');
              if (!hr) return 'NO_HR_FOUND';
              const rect = hr.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              const target = document.elementFromPoint(x, y);
              const view = window.SmudgeEditor;
              // Simulate a real mousedown+mouseup at the hr's own coordinates,
              // dispatched at the actual DOM element under that point (as a
              // real click would hit), bubbling up to CodeMirror's handlers.
              for (const type of ['mousedown', 'mouseup', 'click']) {
                const ev = new MouseEvent(type, {
                  bubbles: true, cancelable: true, view: window,
                  clientX: x, clientY: y, button: 0
                });
                (target || hr).dispatchEvent(ev);
              }
              return JSON.stringify({ x, y, targetTag: target ? target.tagName : null, targetClass: target ? target.className : null });
            })()
            """
        let clickResult = await js(clickJS)
        print("click dispatch result: \(String(describing: clickResult))")
        try? await Task.sleep(nanoseconds: 200_000_000)
        print("selection after clicking the HR widget: \(selectionRanges.last ?? (-1, -1, -1))")

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
window.title = "DiagnoseHR"
window.contentView = harness.webView
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)

harness.load(editorDirectory)

DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
    print("timed out")
    exit(1)
}

app.run()
