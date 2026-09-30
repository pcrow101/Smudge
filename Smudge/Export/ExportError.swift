//
//  ExportError.swift
//  Smudge
//

import Foundation

/// Errors surfaced to the user when HTML/PDF export fails. Kept small and
/// user-facing — anything more specific is logged in DEBUG builds instead.
enum ExportError: LocalizedError {
    case editorNotReady
    case renderFailed(String)
    case assetMissing(String)
    case printFailed

    var errorDescription: String? {
        switch self {
        case .editorNotReady:
            "The editor isn't ready yet. Try again in a moment."
        case .renderFailed(let reason):
            "Couldn't render the document (\(reason))."
        case .assetMissing(let name):
            "Missing bundled resource: \(name)."
        case .printFailed:
            "Couldn't generate the PDF."
        }
    }
}
