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
    private let duration: Double
    private let canSeek: Bool
    private let onSelect: ((Double) -> Void)?
    #if os(macOS)
    @ScaledMetric(relativeTo: .subheadline) private var inactiveSize = 15.0
    @ScaledMetric(relativeTo: .body) private var currentSize = 18.0
    @ScaledMetric(relativeTo: .body) private var rowHeight = 32.0
    #else
    @ScaledMetric(relativeTo: .body) private var rowHeight = 28.0
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(document: LyricsDocument, position: Double, duration: Double = .infinity,
                canSeek: Bool = false, animates: Bool = true, onSelect: ((Double) -> Void)? = nil) {
        self.document = document
        self.animates = animates
        self.duration = duration
        self.canSeek = canSeek
        self.onSelect = onSelect
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
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func line(_ index: Int) -> some View {
        let seconds = document.cues[index].seconds
        if canSeek, seconds <= duration, let onSelect {
            Button { onSelect(seconds) } label: { lineText(index) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("lyric-preview-line-\(index)")
        } else {
            lineText(index)
        }
    }

    private func lineText(_ index: Int) -> some View {
        let emphasized = index == window.current
        return Text(document.cues[index].lines.joined(separator: " · "))
            #if os(macOS)
            .font(.system(size: emphasized ? currentSize : inactiveSize,
                          weight: emphasized ? .semibold : .regular))
            .minimumScaleFactor(0.86)
            #else
            .font(emphasized ? .body.weight(.semibold) : .subheadline)
            #endif
            .foregroundStyle(emphasized ? TuneTheme.accent : TuneTheme.secondary)
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .accessibilityAddTraits(emphasized ? .isSelected : [])
            .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .center)
    }
}
