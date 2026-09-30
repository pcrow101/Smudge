//
//  SmudgeApp.swift
//  Smudge
//
//  Created by paucrow on 03/09/2026.
//

import SwiftUI

@main
struct SmudgeApp: App {
    @State private var settings = EditorSettings()

    var body: some Scene {
        DocumentGroup(newDocument: { MarkdownDocument() }) { configuration in
            DocumentView(document: configuration.document, fileURL: configuration.fileURL)
                .environment(settings)
        }
        .commands {
            SmudgeCommands(settings: settings)
        }

        Window("Smudge Help", id: "help") {
            HelpView()
        }
        .defaultSize(width: 560, height: 640)
        .windowResizability(.contentSize)
    }
}
