//
//  PDFExportConfiguration.swift
//  Smudge
//

import AppKit

/// User-configurable PDF export options, set in `ExportSheet`.
struct PDFExportConfiguration: Equatable {
    var paperSize: PaperSize = .usLetter
    var marginInches: Double = 1.0

    /// Margin in points (72pt = 1 inch), as `NSPrintInfo` expects.
    var marginPoints: CGFloat {
        CGFloat(marginInches * 72)
    }

    enum PaperSize: String, CaseIterable, Identifiable, Equatable {
        case usLetter
        case a4
        case legal

        var id: String { rawValue }

        var label: String {
            switch self {
            case .usLetter: "US Letter"
            case .a4: "A4"
            case .legal: "Legal"
            }
        }

        /// Size in points (72pt = 1 inch).
        var size: NSSize {
            switch self {
            case .usLetter: NSSize(width: 612, height: 792)
            case .a4: NSSize(width: 595, height: 842)
            case .legal: NSSize(width: 612, height: 1008)
            }
        }
    }
}
