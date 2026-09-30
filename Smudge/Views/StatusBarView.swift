//
//  StatusBarView.swift
//  Smudge
//

import SwiftUI

/// Thin status strip along the bottom of the document window.
///
/// Word/character counts and the performance chip are driven live by
/// `EditorBridge`'s `metrics`/`perf` bridge messages; Phase 9 makes the chip
/// an interactive override menu.
struct StatusBarView: View {
    let bridge: EditorBridge

    var body: some View {
        HStack(spacing: 12) {
            Text("^[\(bridge.wordCount) word](inflect: true)")
            Text("^[\(bridge.characterCount) character](inflect: true)")

            Spacer()

            Text(perfLabel)
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(.quaternary, in: Capsule())
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) {
            Divider()
        }
    }

    private var perfLabel: String {
        bridge.perfIsAuto ? bridge.resolvedPerfProfile.label : "\(bridge.resolvedPerfProfile.label) \u{2022} Manual"
    }
}

#Preview {
    StatusBarView(bridge: EditorBridge())
}
