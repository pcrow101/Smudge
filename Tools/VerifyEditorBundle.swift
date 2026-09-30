import AppKit
import WebKit

/// Standalone verification harness for the vendored editor bundle.
///
/// Loads `Resources/editor/index.html` in a real `WKWebView`, waits for the
/// `ready` bridge message, then exercises the API surface. Run with:
///
///     swift Tools/VerifyEditorBundle.swift
///
/// Exits non-zero on any failure so it can be wired into CI later.

final class Harness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    var failures: [String] = []
    var readyReceived = false

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

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        if type == "log", let level = body["level"] as? String, level == "error" {
            failures.append("editor logged error: \(body["message"] ?? "")")
        }
        if type == "ready" {
            readyReceived = true
            print("• ready received (version: \(body["version"] ?? "?"))")
            runChecks()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failures.append("navigation failed: \(error.localizedDescription)")
        finish()
    }

    private func check(_ name: String, _ js: String, expect: String) async {
        do {
            let result = try await webView.evaluateJavaScript(js)
            let actual = String(describing: result ?? "nil")
            if actual == expect {
                print("• \(name): \(actual)")
            } else {
                failures.append("\(name): expected \(expect), got \(actual)")
            }
        } catch {
            failures.append("\(name): threw \(error.localizedDescription)")
        }
    }

    private func runChecks() {
        Task { @MainActor in
            await check("api exposed", "typeof window.SmudgeEditor", expect: "object")
            await check("editor mounted", "document.querySelectorAll('.cm-editor').length", expect: "1")

            _ = try? await webView.evaluateJavaScript(
                "window.SmudgeEditor.setDoc('# Title\\n\\nHello **world**.\\n', 1)"
            )
            await check(
                "round trip",
                "window.SmudgeEditor.getDoc()",
                expect: "# Title\n\nHello **world**.\n"
            )
            await check(
                "renders html",
                "window.SmudgeEditor.renderHTML().includes('<strong>world</strong>')",
                expect: "1"
            )
            await check(
                "mode switch",
                "window.SmudgeEditor.setMode('raw'), document.querySelector('.cm-editor').dataset.mode",
                expect: "raw"
            )
            _ = try? await webView.evaluateJavaScript(
                "window.SmudgeEditor.setTheme({appearance:'dark', fontSize:17})"
            )
            await check(
                "theme applied",
                "document.documentElement.dataset.theme",
                expect: "dark"
            )
            await check(
                "font size applied",
                "document.documentElement.style.getPropertyValue('--smudge-font-size')",
                expect: "17px"
            )

            // --- Phase 3: live-preview decorations & widgets ---
            _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setMode('preview')")
            _ = try? await webView.evaluateJavaScript(
                """
                window.SmudgeEditor.setDoc(
                  '# Title\\n\\n' +
                  'Some **bold** and *em* text.\\n\\n' +
                  '- [ ] todo item\\n\\n' +
                  '---\\n\\n' +
                  'Inline math $x^2$ here.\\n\\n' +
                  '| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n',
                  2
                )
                """
            )
            await check(
                "heading decorated",
                "document.querySelectorAll('.cm-md-heading').length > 0",
                expect: "1"
            )
            await check(
                "bold decorated",
                "document.querySelectorAll('.cm-md-strong').length > 0",
                expect: "1"
            )
            await check(
                "checkbox widget rendered",
                "document.querySelectorAll('.cm-md-checkbox').length > 0",
                expect: "1"
            )
            await check(
                "hr widget rendered",
                "document.querySelectorAll('.cm-md-hr').length > 0",
                expect: "1"
            )
            await check(
                "math widget rendered via katex",
                "document.querySelectorAll('.cm-md-math .katex').length > 0",
                expect: "1"
            )
            await check(
                "table widget rendered",
                "document.querySelectorAll('.cm-md-table table').length > 0",
                expect: "1"
            )

            // --- Phase 4: large-document performance ---
            await runPerfChecks()

            // --- Phase 5: front-matter editing UX ---
            await runFrontMatterChecks()

            // --- Phase 7: export rendering ---
            await runExportRenderChecks()
            finish()
        }
    }

    /// Generates a synthetic Markdown fixture of roughly `targetBytes`, mirroring
    /// `editor-src/bench/fixtures.ts`'s shape (headings, bold/italic, a list, a
    /// table, inline math) but defined inline here rather than imported, since
    /// this harness runs standalone via `swift Tools/VerifyEditorBundle.swift`
    /// against the *built* bundle, with no access to the editor-src TypeScript.
    private static let fixtureGenerator = """
        window.__smudgeFixture = function(targetBytes) {
          const unit = (n) => (
            '## Section ' + n + '\\n\\n' +
            'Paragraph ' + n + ' with **bold** and *em* text and a [link](https://example.com/' + n + ').\\n\\n' +
            '- item ' + n + '\\n- [ ] todo ' + n + '\\n\\n' +
            '| a | b |\\n| --- | --- |\\n| ' + n + ' | ' + (n * 2) + ' |\\n\\n' +
            'Inline math $x_' + n + '^2$ here.\\n\\n---\\n\\n'
          );
          let out = '# Fixture\\n\\n';
          let n = 0;
          while (out.length < targetBytes) { n += 1; out += unit(n); }
          return out;
        };
        """

    private func runPerfChecks() async {
        _ = try? await webView.evaluateJavaScript(Self.fixtureGenerator)

        // --- Auto-resolution against the default thresholds (2 MB / 10 MB) ---
        await checkPerfProfile(sizeMB: 0.5, expectedProfile: "full", label: "auto: small doc → full")
        await checkPerfProfile(sizeMB: 4, expectedProfile: "reduced", label: "auto: 4 MB doc → reduced")

        // Reduced profile should collapse widgets to placeholders, not full renders.
        // (Checked here, before the doc grows further, while it's still the 4 MB "reduced" one.)
        await check(
            "reduced profile collapses math widgets",
            "document.querySelectorAll('.cm-md-collapsed').length > 0 && document.querySelectorAll('.cm-md-math .katex').length === 0",
            expect: "1"
        )

        await checkPerfProfile(sizeMB: 12, expectedProfile: "plain", label: "auto: 12 MB doc → plain")

        // Plain profile should disable live preview entirely (no heading/widget decorations).
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc(window.__smudgeFixture(12 * 1024 * 1024), 90)"
        )
        await check(
            "plain profile disables live preview",
            "document.querySelectorAll('.cm-md-heading').length === 0 && document.querySelectorAll('.cm-md-collapsed').length === 0",
            expect: "1"
        )
        await check(
            "plain profile disables spellcheck",
            "document.querySelector('.cm-content').getAttribute('spellcheck')",
            expect: "false"
        )

        // Explicit override pins the profile regardless of size.
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setPerfProfile('full')")
        await check(
            "explicit override pins profile",
            "document.querySelector('.cm-editor').dataset.perf",
            expect: "full"
        )
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setPerfProfile('auto')")

        // --- Keystroke latency regression guard on a large document ---
        // Not a strict micro-benchmark (real hardware / CI variance), but the
        // dirty-range incremental rebuild (vs. a full-document rebuild on every
        // keystroke) should keep this in the low tens of milliseconds even at
        // several megabytes; a regression back to whole-document rebuilds would
        // blow well past this threshold.
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc(window.__smudgeFixture(5 * 1024 * 1024), 91)"
        )
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.focus()")
        do {
            // Synchronous timing only: this harness's `WKWebView` is never
            // added to a window, so `requestAnimationFrame` callbacks aren't
            // guaranteed to fire (nothing is being composited/displayed) —
            // measuring the dispatch cost directly avoids depending on that.
            let js = """
                (() => {
                  try {
                    const samples = [];
                    for (let i = 0; i < 30; i++) {
                      const start = performance.now();
                      window.SmudgeEditor.insertText('x');
                      samples.push(performance.now() - start);
                    }
                    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
                    return String(avg);
                  } catch (e) {
                    return 'ERROR:' + (e && e.stack ? e.stack : String(e));
                  }
                })()
                """
            let result = try await webView.evaluateJavaScript(js)
            let resultString = result as? String ?? String(describing: result)
            print("• keystroke latency raw result: \(resultString)")
            let avgMs = Double(resultString) ?? -1
            print("• keystroke latency on 5 MB doc: \(String(format: "%.2f", avgMs)) ms avg")
            if avgMs < 0 {
                failures.append("keystroke latency: couldn't read a numeric result (\(String(describing: result)))")
            } else if avgMs > 100 {
                failures.append("keystroke latency: \(avgMs) ms avg exceeds 100 ms regression threshold")
            }
        } catch {
            failures.append("keystroke latency: threw \(error.localizedDescription)")
        }
    }

    private func checkPerfProfile(sizeMB: Double, expectedProfile: String, label: String) async {
        let bytes = Int(sizeMB * 1024 * 1024)
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc(window.__smudgeFixture(\(bytes)), \(bytes))"
        )
        await check(label, "document.querySelector('.cm-editor').dataset.perf", expect: expectedProfile)
    }

    private func runFrontMatterChecks() async {
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setPerfProfile('auto')")
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setMode('preview')")

        // --- Collapsed by default, with configured fields summarised ---
        _ = try? await webView.evaluateJavaScript(
            """
            window.SmudgeEditor.setDoc(
              '---\\ntitle: My Post\\ndate: 2024-01-01\\ntags: [swift, markdown]\\n---\\n\\n# Body\\n',
              100
            )
            """
        )
        await check(
            "front matter collapsed by default",
            "document.querySelectorAll('.cm-md-frontmatter-bar').length",
            expect: "1"
        )
        await check(
            "front matter summary shows title",
            "document.querySelector('.cm-md-frontmatter-bar').textContent.includes('My Post')",
            expect: "1"
        )
        await check(
            "front matter summary shows tag chips",
            "document.querySelectorAll('.cm-md-frontmatter-chip').length",
            expect: "2"
        )

        // --- Toggling reveals raw YAML with highlighting, then re-collapses ---
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.toggleFrontMatter()")
        await check(
            "toggle expands front matter",
            "document.querySelectorAll('.cm-md-frontmatter-bar').length === 0 && " +
                "document.querySelectorAll('.cm-md-frontmatter-delim').length === 2",
            expect: "1"
        )
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.toggleFrontMatter()")
        await check(
            "toggle re-collapses front matter",
            "document.querySelectorAll('.cm-md-frontmatter-bar').length",
            expect: "1"
        )

        // --- Invalid YAML never blocks editing, just flags the bar ---
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc('---\\ntitle: [oops\\n---\\n\\nBody\\n', 101)"
        )
        await check(
            "invalid front matter flags error state",
            "document.querySelectorAll('.cm-md-frontmatter-error').length",
            expect: "1"
        )

        // --- Insert-template on a document without front matter ---
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.setDoc('# No front matter\\n', 102)")
        _ = try? await webView.evaluateJavaScript("window.SmudgeEditor.insertFrontMatterTemplate()")
        await check(
            "insert template creates front matter",
            "window.SmudgeEditor.getDoc().startsWith('---\\ntitle: ')",
            expect: "1"
        )

        // --- Export metadata and stripped rendering ---
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc('---\\ntitle: Meta Test\\n---\\n\\nHello **world**.\\n', 103)"
        )
        await check(
            "front matter metadata exposed",
            "window.SmudgeEditor.getFrontMatterMeta().title",
            expect: "Meta Test"
        )
        await check(
            "rendered HTML excludes front matter",
            "!window.SmudgeEditor.renderHTML().includes('title:') && " +
                "window.SmudgeEditor.renderHTML().includes('<strong>world</strong>')",
            expect: "1"
        )
    }

    private func runExportRenderChecks() async {
        // --- GFM: tables and strikethrough render without any plugin config ---
        _ = try? await webView.evaluateJavaScript(
            """
            window.SmudgeEditor.setDoc(
              '~~gone~~\\n\\n| a | b |\\n| --- | --- |\\n| 1 | 2 |\\n',
              200
            )
            """
        )
        await check(
            "export renders strikethrough",
            "window.SmudgeEditor.renderHTML().includes('<s>gone</s>') || window.SmudgeEditor.renderHTML().includes('<del>gone</del>')",
            expect: "1"
        )
        await check(
            "export renders tables",
            "window.SmudgeEditor.renderHTML().includes('<table>')",
            expect: "1"
        )

        // --- Math renders via KaTeX, same as live preview ---
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc('Inline $x^2$ and:\\n\\n$$\\ny = mx + b\\n$$\\n', 201)"
        )
        await check(
            "export renders inline math via katex",
            "window.SmudgeEditor.renderHTML().includes('class=\"katex\"')",
            expect: "1"
        )
        await check(
            "export renders block math",
            "window.SmudgeEditor.renderHTML().includes('smudge-math-block')",
            expect: "1"
        )

        // --- Emoji shortcodes resolve to glyphs; unknown ones pass through ---
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc('Nice :tada: work, but :not_a_real_emoji: stays.', 202)"
        )
        await check(
            "export resolves known emoji shortcode",
            "window.SmudgeEditor.renderHTML().includes('\\u{1F389}')",
            expect: "1"
        )
        await check(
            "export leaves unknown shortcode as text",
            "window.SmudgeEditor.renderHTML().includes(':not_a_real_emoji:')",
            expect: "1"
        )

        // --- GFM task-list checkboxes become real (disabled) checkboxes ---
        _ = try? await webView.evaluateJavaScript(
            "window.SmudgeEditor.setDoc('- [ ] todo\\n- [x] done\\n', 203)"
        )
        await check(
            "export renders task-list checkboxes",
            "(window.SmudgeEditor.renderHTML().match(/<input type=\"checkbox\" disabled/g) || []).length",
            expect: "2"
        )
        await check(
            "export marks checked task item",
            "window.SmudgeEditor.renderHTML().includes('checked>')",
            expect: "1"
        )
        await check(
            "export strips raw checkbox syntax from text",
            "!window.SmudgeEditor.renderHTML().includes('[ ] todo') && !window.SmudgeEditor.renderHTML().includes('[x] done')",
            expect: "1"
        )
    }

    func finish() {
        if failures.isEmpty {
            print("\n✅ editor bundle verified")
            exit(0)
        } else {
            print("\n❌ failures:")
            for failure in failures { print("   - \(failure)") }
            exit(1)
        }
    }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let editorDirectory = root.appendingPathComponent("Resources/editor")

guard FileManager.default.fileExists(atPath: editorDirectory.appendingPathComponent("editor.js").path) else {
    print("❌ Resources/editor/editor.js missing — run `cd editor-src && npm run build` first.")
    exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let harness = Harness()
harness.load(editorDirectory)

DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
    harness.failures.append("timed out waiting for editor")
    harness.finish()
}

app.run()
