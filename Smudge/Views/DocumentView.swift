//
//  DocumentView.swift
//  Smudge
//

import SwiftUI

/// Root view for a single Markdown document window.
///
/// Hosts the CodeMirror-backed `WebEditorView`; `EditorBridge` is the single
/// source of truth for everything that crosses into the web view — mode,
/// theme, performance profile, and formatting commands are all pushed
/// through it rather than through view state, and it's exposed to the menu
/// bar for the focused window via `.focusedValue(\.editorBridge, bridge)`.
struct DocumentView: View {
    @ObservedObject var document: MarkdownDocument
    let fileURL: URL?
    @Environment(EditorSettings.self) private var settings
    @Environment(\.colorScheme) private var systemColorScheme

    @State private var bridge = EditorBridge()
    @State private var exportCoordinator = ExportCoordinator()

    var body: some View {
        @Bindable var settings = settings

        VStack(spacing: 0) {
            WebEditorView(document: document, bridge: bridge)
            StatusBarView(bridge: bridge)
        }
        .frame(minWidth: 480, minHeight: 320)
        .preferredColorScheme(settings.theme.colorScheme)
        .focusedValue(\.editorBridge, bridge)
        .focusedValue(\.exportContext, ExportContext(
            coordinator: exportCoordinator,
            bridge: bridge,
            documentURL: fileURL,
            suggestedName: suggestedExportName
        ))
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View Mode", selection: $settings.editorMode) {
                    ForEach(EditorMode.allCases) { mode in
                        Label(mode.label, systemImage: mode.systemImage)
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .help("Switch between preview and raw Markdown")
            }
        }
        .onChange(of: settings.editorMode, initial: true) { _, mode in
            bridge.setMode(mode)
        }
        .onChange(of: settings.fontSize, initial: true) { _, fontSize in
            bridge.pushTheme(appearance: effectiveAppearance, fontSize: fontSize)
        }
        .onChange(of: settings.theme, initial: true) { _, _ in
            bridge.pushTheme(appearance: effectiveAppearance, fontSize: settings.fontSize)
        }
        .onChange(of: systemColorScheme, initial: true) { _, _ in
            bridge.pushTheme(appearance: effectiveAppearance, fontSize: settings.fontSize)
        }
        .onChange(of: settings.frontMatterCollapsedByDefault, initial: true) { _, collapsed in
            bridge.setFrontMatterDefaultCollapsed(collapsed)
        }
        .onDisappear {
            bridge.detach()
        }
        .sheet(isPresented: $exportCoordinator.isPresentingPDFOptions) {
            ExportSheet(
                coordinator: exportCoordinator,
                bridge: bridge,
                documentURL: fileURL,
                suggestedName: suggestedExportName
            )
        }
        .alert(
            "Export Failed",
            isPresented: Binding(
                get: { exportCoordinator.errorMessage != nil },
                set: { isPresented in
                    if !isPresented { exportCoordinator.errorMessage = nil }
                }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(exportCoordinator.errorMessage ?? "")
        }
    }

    /// `settings.theme` overrides the system appearance when set explicitly;
    /// otherwise the window follows `systemColorScheme`.
    private var effectiveAppearance: String {
        (settings.theme.colorScheme ?? systemColorScheme) == .dark ? "dark" : "light"
    }

    private var suggestedExportName: String {
        fileURL?.deletingPathExtension().lastPathComponent ?? "Untitled"
    }
}

#Preview {
    DocumentView(document: MarkdownDocument(text: "# Hello\n\nSmudge."), fileURL: nil)
        .environment(EditorSettings())
}
