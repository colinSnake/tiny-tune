import Domain
import SwiftUI

struct NowPlayingLyricWindow: Equatable {
    static let visibleLineCount = 5
    let cue: Int?
    let current: Int?
    let upcoming: Int?
    let visible: [Int]

    init(document: LyricsDocument, position: Double) {
        cue = document.cueIndex(at: position)
        current = cue.flatMap { document.cues[$0].lines.isEmpty ? nil : $0 }
        upcoming = document.cues.indices.dropFirst((cue ?? -1) + 1)
            .first { !document.cues[$0].lines.isEmpty }

        let populated = document.cues.indices.filter { !document.cues[$0].lines.isEmpty }
        guard let anchor = current ?? upcoming, let offset = populated.firstIndex(of: anchor) else {
            visible = []
            return
        }
        // During an instrumental gap, show only future lyrics rather than stale sung lines.
        let start = current == nil ? offset
            : min(max(0, offset - Self.visibleLineCount / 2), max(0, populated.count - Self.visibleLineCount))
        visible = Array(populated.dropFirst(start).prefix(Self.visibleLineCount))
    }
}

/// Five-line, automatically following preview; transcript management stays in the separate lyrics panel.
public struct NowPlayingLyricStrip: View {
    private let document: LyricsDocument
    private let window: NowPlayingLyricWindow
    private let animates: Bool
    @ScaledMetric(relativeTo: .body) private var rowHeight = 28.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(document: LyricsDocument, position: Double, animates: Bool = true) {
        self.document = document
        self.animates = animates
        self.window = NowPlayingLyricWindow(document: document, position: position)
    }

    public var body: some View {
        VStack(alignment: .center, spacing: 0) {
            ForEach(window.visible, id: \.self) { index in
                line(index)
            }
        }
        .id(window.visible)
        .transition(reduceMotion ? .identity : .asymmetric(
            insertion: .offset(y: rowHeight).combined(with: .opacity),
            removal: .offset(y: -rowHeight).combined(with: .opacity)))
        .frame(height: CGFloat(NowPlayingLyricWindow.visibleLineCount) * rowHeight)
        .clipped()
        .animation(reduceMotion || !animates ? nil : .easeOut(duration: 0.23), value: window)
        .accessibilityElement(children: .combine)
    }

    private func line(_ index: Int) -> some View {
        let emphasized = index == window.current
        return Text(document.cues[index].lines.joined(separator: " · "))
            .font(emphasized ? .body.weight(.semibold) : .subheadline)
            .foregroundStyle(emphasized ? TuneTheme.accent : TuneTheme.secondary)
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .accessibilityAddTraits(emphasized ? .isSelected : [])
            .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .center)
    }
}
