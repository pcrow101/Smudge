//
//  ExportCoordinator.swift
//  Smudge
//

import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Drives export for a single document window: presents the save location
/// picker, runs the appropriate exporter, and surfaces errors.
///
/// One instance per window, owned by `DocumentView` alongside its
/// `EditorBridge`, and exposed to the menu bar via `FocusedValues.exportContext`
/// so "Export as HTML…"/"Export as PDF…" always act on the focused document.
@MainActor
@Observable
final class ExportCoordinator {
    var isPresentingPDFOptions = false
    var pdfConfiguration = PDFExportConfiguration()
    var errorMessage: String?
    private(set) var isExporting = false

    /// HTML export has no user-facing options, so the menu command goes
    /// straight to the save panel.
    func exportHTML(bridge: EditorBridge, documentURL: URL?, suggestedName: String) {
        Task { await runHTMLExport(bridge: bridge, documentURL: documentURL, suggestedName: suggestedName) }
    }

    /// PDF export has paper size/margins to choose, so this only opens the
    /// options sheet; `confirmPDFExport` does the actual work once the user
    /// confirms it.
    func requestPDFExport() {
        isPresentingPDFOptions = true
    }

    func confirmPDFExport(bridge: EditorBridge, documentURL: URL?, suggestedName: String) {
        isPresentingPDFOptions = false
        Task { await runPDFExport(bridge: bridge, documentURL: documentURL, suggestedName: suggestedName) }
    }

    private func runHTMLExport(bridge: EditorBridge, documentURL: URL?, suggestedName: String) async {
        guard let destination = await chooseDestination(suggestedName: suggestedName, contentType: .html) else {
            return
        }
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await HTMLExporter.export(bridge: bridge, documentURL: documentURL)
            try data.write(to: destination, options: .atomic)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func runPDFExport(bridge: EditorBridge, documentURL: URL?, suggestedName: String) async {
        guard let destination = await chooseDestination(suggestedName: suggestedName, contentType: .pdf) else {
            return
        }
        isExporting = true
        defer { isExporting = false }
        do {
            let html = try await HTMLExporter.export(bridge: bridge, documentURL: documentURL)
            try await PDFExporter.export(html: html, configuration: pdfConfiguration, to: destination)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func chooseDestination(suggestedName: String, contentType: UTType) async -> URL? {
        await withCheckedContinuation { continuation in
            let panel = NSSavePanel()
            panel.nameFieldStringValue = suggestedName
            panel.allowedContentTypes = [contentType]
            panel.canCreateDirectories = true
            panel.begin { response in
                continuation.resume(returning: response == .OK ? panel.url : nil)
            }
        }
    }
}

/// Everything the menu bar needs to trigger export for the focused window,
/// bundled into a single `FocusedValue` since `Commands` live outside any
/// particular window's view hierarchy.
struct ExportContext {
    let coordinator: ExportCoordinator
    let bridge: EditorBridge
    let documentURL: URL?
    let suggestedName: String
}

private struct ExportContextFocusedValueKey: FocusedValueKey {
    typealias Value = ExportContext
}

extension FocusedValues {
    var exportContext: ExportContext? {
        get { self[ExportContextFocusedValueKey.self] }
        set { self[ExportContextFocusedValueKey.self] = newValue }
    }
}
