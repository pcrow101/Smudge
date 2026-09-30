//
//  EditorSettings.swift
//  Smudge
//

import SwiftUI

/// Which face of the editor is showing.
///
/// Both modes are the same underlying editor; preview simply enables the
/// live-preview decoration set (Phase 3).
enum EditorMode: String, CaseIterable, Identifiable, Codable {
    case preview
    case raw

    var id: String { rawValue }

    var label: String {
        switch self {
        case .preview: "Preview"
        case .raw: "Raw"
        }
    }

    var systemImage: String {
        switch self {
        case .preview: "doc.richtext"
        case .raw: "chevron.left.forwardslash.chevron.right"
        }
    }

    var toggled: EditorMode {
        self == .preview ? .raw : .preview
    }
}

/// Appearance preference, independent of the system setting.
enum ThemePreference: String, CaseIterable, Identifiable, Codable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Global, app-wide preferences backed by `UserDefaults`.
///
/// Per-document state (performance profile, front-matter collapse) lives in the
/// central override store added in Phase 9 — deliberately not here.
@Observable
final class EditorSettings {

    private enum Key {
        static let editorMode = "editor.mode"
        static let fontSize = "editor.fontSize"
        static let theme = "editor.theme"
        static let frontMatterCollapsedByDefault = "frontMatter.collapsedByDefault"
    }

    @ObservationIgnored private let defaults: UserDefaults

    var editorMode: EditorMode {
        didSet { defaults.set(editorMode.rawValue, forKey: Key.editorMode) }
    }

    var fontSize: Double {
        didSet { defaults.set(fontSize, forKey: Key.fontSize) }
    }

    var theme: ThemePreference {
        didSet { defaults.set(theme.rawValue, forKey: Key.theme) }
    }

    var frontMatterCollapsedByDefault: Bool {
        didSet {
            defaults.set(frontMatterCollapsedByDefault, forKey: Key.frontMatterCollapsedByDefault)
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults

        defaults.register(defaults: [
            Key.editorMode: EditorMode.preview.rawValue,
            Key.fontSize: 15.0,
            Key.theme: ThemePreference.system.rawValue,
            Key.frontMatterCollapsedByDefault: true
        ])

        self.editorMode = EditorMode(rawValue: defaults.string(forKey: Key.editorMode) ?? "")
            ?? .preview
        self.fontSize = defaults.double(forKey: Key.fontSize)
        self.theme = ThemePreference(rawValue: defaults.string(forKey: Key.theme) ?? "")
            ?? .system
        self.frontMatterCollapsedByDefault = defaults.bool(
            forKey: Key.frontMatterCollapsedByDefault
        )
    }

    func toggleMode() {
        editorMode = editorMode.toggled
    }
}
