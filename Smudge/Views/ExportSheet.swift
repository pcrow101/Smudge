//
//  ExportSheet.swift
//  Smudge
//

import SwiftUI

/// PDF export options: paper size and margins. HTML export has no options
/// of its own, so it skips straight to the save panel from the menu.
struct ExportSheet: View {
    @Bindable var coordinator: ExportCoordinator
    let bridge: EditorBridge
    let documentURL: URL?
    let suggestedName: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Export as PDF")
                .font(.headline)

            Picker("Paper Size", selection: $coordinator.pdfConfiguration.paperSize) {
                ForEach(PDFExportConfiguration.PaperSize.allCases) { size in
                    Text(size.label).tag(size)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Margins")
                    Spacer()
                    Text(String(format: "%.2f\"", coordinator.pdfConfiguration.marginInches))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Slider(value: $coordinator.pdfConfiguration.marginInches, in: 0.25...2.0, step: 0.25)
            }

            Spacer(minLength: 0)

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Export…") {
                    dismiss()
                    coordinator.confirmPDFExport(bridge: bridge, documentURL: documentURL, suggestedName: suggestedName)
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 320)
    }
}

#Preview {
    ExportSheet(
        coordinator: ExportCoordinator(),
        bridge: EditorBridge(),
        documentURL: nil,
        suggestedName: "Untitled"
    )
}
