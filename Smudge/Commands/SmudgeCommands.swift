//
//  SmudgeCommands.swift
//  Smudge
//

import SwiftUI

/// Menu bar commands for Smudge.
///
/// Format/Undo/Redo/Export act on whichever document window is focused, via
/// `FocusedValue` (see `EditorBridge.swift` and `ExportCoordinator.swift`) —
/// so a command invoked from the menu bar always reaches the key window's
/// editor, even with several documents open.
struct SmudgeCommands: Commands {
    @Bindable var settings: EditorSettings
    @FocusedValue(\.editorBridge) private var bridge
    @FocusedValue(\.exportContext) private var exportContext
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(after: .saveItem) {
            Divider()

            Button("Export as HTML…") {
                if let exportContext {
                    exportContext.coordinator.exportHTML(
                        bridge: exportContext.bridge,
                        documentURL: exportContext.documentURL,
                        suggestedName: exportContext.suggestedName
                    )
                }
            }
            .disabled(exportContext == nil)

            Button("Export as PDF…") {
                exportContext?.coordinator.requestPDFExport()
            }
            .disabled(exportContext == nil)
        }

        CommandGroup(before: .toolbar) {
            Button(settings.editorMode.toggled.label) {
                settings.toggleMode()
            }
            .keyboardShortcut("p", modifiers: [.command, .shift])

            Divider()
        }

        CommandGroup(replacing: .undoRedo) {
            Button("Undo") { bridge?.undo() }
                .keyboardShortcut("z", modifiers: .command)
                .disabled(bridge == nil)

            Button("Redo") { bridge?.redo() }
                .keyboardShortcut("z", modifiers: [.command, .shift])
                .disabled(bridge == nil)
        }

        CommandMenu("Format") {
            Button("Bold") { bridge?.toggleBold() }
                .keyboardShortcut("b", modifiers: .command)
                .disabled(bridge == nil)

            Button("Italic") { bridge?.toggleItalic() }
                .keyboardShortcut("i", modifiers: .command)
                .disabled(bridge == nil)

            Button("Insert Link") { bridge?.insertLink() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(bridge == nil)

            Divider()

            Button("Insert Front Matter") { bridge?.insertFrontMatterTemplate() }
                .keyboardShortcut("y", modifiers: [.command, .shift])
                .disabled(bridge == nil)

            Button("Toggle Front Matter") { bridge?.toggleFrontMatter() }
                .disabled(bridge == nil)
        }

        CommandGroup(replacing: .help) {
            Button("Smudge Help") {
                openWindow(id: "help")
            }
            .keyboardShortcut("?", modifiers: .command)
        }
    }
}
