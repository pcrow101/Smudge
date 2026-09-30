import AppKit
import WebKit

final class MiniHarness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView

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
        if type == "ready" {
            Task { @MainActor in await runTest() }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("navigation failed: \(error.localizedDescription)")
        exit(1)
    }

    func runTest() async {
        let doc = "before_A\\nbefore_B\\n---\\nafter_A\\nafter_B"
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setDoc('\(doc)', 1)")
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.focus()")
        try? await Task.sleep(nanoseconds: 500_000_000)

        let debugJS = """
            (() => {
              const content = document.querySelector('.cm-content');
              return JSON.stringify({
                hrCount: document.querySelectorAll('.cm-md-hr').length,
                html: content ? content.innerHTML.slice(0, 800) : 'NO_CONTENT'
              });
            })()
            """
        let result = try? await webView.evaluateJavaScript(debugJS)
        print("fresh single setDoc result: \(String(describing: result))")
        exit(0)
    }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let editorDirectory = root.appendingPathComponent("Resources/editor")
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let harness = MiniHarness()
let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 800, height: 600), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.contentView = harness.webView
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
harness.load(editorDirectory)
DispatchQueue.main.asyncAfter(deadline: .now() + 15) { print("timed out"); exit(1) }
app.run()
