import SwiftUI

public enum TrackRowStatusIcon: Equatable, Sendable {
    case playing, paused
    case system(String)

    var symbolName: String {
        switch self {
        case .playing: "waveform"
        case .paused: "play.fill"
        case .system(let name): name
        }
    }

    func animates(scenePhase: ScenePhase, reduceMotion: Bool) -> Bool {
        self == .playing && scenePhase == .active && !reduceMotion
    }
}

struct TrackRowStatusGlyph: View {
    let icon: TrackRowStatusIcon
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if icon.animates(scenePhase: scenePhase, reduceMotion: reduceMotion) {
                TimelineView(.animation(minimumInterval: 1.0 / 24)) { context in
                    let seconds = context.date.timeIntervalSinceReferenceDate
                    let phase = seconds.truncatingRemainder(dividingBy: 0.9) * 2 * .pi / 0.9
                    HStack(spacing: 1.5) {
                        ForEach(Array(TrackRowWaveform.heights(phase: phase).enumerated()), id: \.offset) { _, height in
                            Capsule().frame(width: 2, height: height)
                        }
                    }
                }
            } else {
                Image(systemName: icon.symbolName)
            }
        }
        .frame(minWidth: 16, minHeight: 14)
    }
}

enum TrackRowWaveform {
    static func heights(phase: Double) -> [CGFloat] {
        [7.0, 10, 14, 11, 8].enumerated().map { index, peak in
            let amplitude = (1 + sin(phase + Double(index) * 1.35)) / 2
            return 3 + (peak - 3) * amplitude
        }
    }
}
