//
//  PDFExporter.swift
//  Smudge
//

import AppKit
@preconcurrency import WebKit

/// Renders standalone export HTML to a paginated, paper-sized PDF file.
///
/// This deliberately uses `NSPrintOperation` rather than
/// `WKWebView.createPDF`: `createPDF` produces a single PDF "page" as tall as
/// the entire content, with no pagination, paper size, or margins at all —
/// which would make the export sheet's paper-size/margin controls
/// meaningless. `NSPrintOperation`, configured with `jobDisposition = .save`,
/// runs fully headlessly (no print panel) and writes a properly paginated,
/// paper-sized PDF straight to disk, which is what "Export as PDF" from a
/// writing app should produce.
///
/// The export HTML itself is fully static — math is pre-rendered to
/// HTML/CSS by KaTeX at `renderHTML()` time and images are base64 `data:`
/// URIs — so there's no asynchronous rendering to wait for beyond the
/// web view's own navigation finishing.
@MainActor
enum PDFExporter {
    static func export(html: Data, configuration: PDFExportConfiguration, to destinationURL: URL) async throws {
        let webView = WKWebView(frame: NSRect(origin: .zero, size: configuration.paperSize.size))
        let delegate = NavigationContinuationDelegate()
        webView.navigationDelegate = delegate

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            delegate.completion = { result in
                continuation.resume(with: result)
            }
            webView.load(html, mimeType: "text/html", characterEncodingName: "utf-8", baseURL: URL(fileURLWithPath: "/"))
        }

        let printInfo = NSPrintInfo()
        printInfo.paperSize = configuration.paperSize.size
        printInfo.topMargin = configuration.marginPoints
        printInfo.bottomMargin = configuration.marginPoints
        printInfo.leftMargin = configuration.marginPoints
        printInfo.rightMargin = configuration.marginPoints
        printInfo.horizontalPagination = .fit
        printInfo.verticalPagination = .automatic
        printInfo.jobDisposition = .save
        printInfo.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = destinationURL as NSURL

        let operation = webView.printOperation(with: printInfo)
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false

        guard operation.run() else {
            throw ExportError.printFailed
        }
    }
}

/// Bridges `WKNavigationDelegate`'s callback-based API into a single
/// `async` load, kept alive for the duration by being retained in the
/// caller's suspended stack frame (`WKWebView.navigationDelegate` is weak).
private final class NavigationContinuationDelegate: NSObject, WKNavigationDelegate {
    var completion: ((Result<Void, Error>) -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        completion?(.success(()))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        completion?(.failure(error))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        completion?(.failure(error))
    }
}
