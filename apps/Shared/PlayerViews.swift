import DesignSystem
import Domain
import Playback
import SwiftUI
#if os(macOS)
import AppKit
#endif

struct MiniPlayer: View {
    let app: AppState
    let open: () -> Void
    #if os(iOS)
    let showQueue: () -> Void
    #else
    let showsLyrics: Bool
    let toggleLyrics: () -> Void
    #endif
    @Environment(\.dynamicTypeSize) private var textSize
    private var player: Player { app.player }

    var body: some View {
        if player.hasContext {
            VStack(spacing: 0) {
                Divider()
                #if os(macOS)
                macControls
                #else
                HStack(spacing: 4) {
                    details
                    PlayButton(player: player)
                    if !textSize.isAccessibilitySize { next }
                }.padding(.horizontal, 8)
                #endif
            }
            .background(TuneTheme.raised)
            .foregroundStyle(TuneTheme.primary)
            .accessibilityIdentifier("mini-player")
        }
    }

    private var details: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                if !textSize.isAccessibilitySize {
                    ArtworkTile(artwork: player.current?.artwork, size: 36)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(player.current?.metadata.title ?? String(localized: "Ready to Play", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(TuneTheme.primary).lineLimit(textSize.isAccessibilitySize ? 3 : 1)
                    let feedback = PlaybackFeedback(app: app)
                    if let message = feedback.message {
                        message
                            .font(.caption)
                            .foregroundStyle(feedback.hasProblem ? TuneTheme.problem : TuneTheme.secondary)
                            .lineLimit(textSize.isAccessibilitySize ? 2 : 1)
                    } else if let track = player.current {
                        Text(track.subtitle).font(.caption).foregroundStyle(TuneTheme.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }.frame(minHeight: 51).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens Now Playing")
        .accessibilityIdentifier("open-player")
    }

    private var controls: some View {
        HStack(spacing: 0) {
            PlayerIcon("Previous Track", symbol: "backward.end.fill") { player.previous() }.disabled(player.current == nil)
            PlayButton(player: player)
            next
        }
    }

    private var next: some View {
        PlayerIcon("Next Track", symbol: "forward.end.fill") { player.next() }.disabled(!player.canGoNext)
    }

    #if os(macOS)
    private var macControls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                details.frame(minWidth: 108, idealWidth: 160)
                controls.fixedSize(horizontal: true, vertical: false)
                Scrubber(player: player).frame(minWidth: 170, idealWidth: 220)
                extras
            }
            .padding(.horizontal, 20)

            VStack(spacing: 4) {
                HStack(spacing: 12) {
                    details
                    controls.fixedSize(horizontal: true, vertical: false)
                    extras
                }
                Scrubber(player: player)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private var extras: some View {
        HStack(spacing: 8) {
            PlaybackModeButton(player: player)
            MacVolumeButton(player: player)
            PlayerIcon("Lyrics", symbol: "quote.bubble", action: toggleLyrics)
                .accessibilityAddTraits(showsLyrics ? .isSelected : [])
                .accessibilityIdentifier("show-lyrics")
                .disabled(player.current == nil && !showsLyrics)
            MacQueueButton(player: player)
        }
        .fixedSize(horizontal: true, vertical: false)
    }
    #endif
}

@MainActor
private struct PlaybackFeedback {
    let app: AppState
    private var player: Player { app.player }

    var hasProblem: Bool { player.phase == .failed || app.currentTrackUnavailable }

    var message: Text? {
        if player.exhaustedCandidates { Text("No playable songs") }
        else if hasProblem { Text("Could not play") }
        else if player.skippedTrackCount > 0 { Text("Skipped \(player.skippedTrackCount) songs") }
        else { nil }
    }
}

#if os(macOS)
private struct MacQueueButton: View {
    let player: Player
    @State private var isPresented = false

    var body: some View {
        PlayerIcon("Queue", symbol: "list.bullet") { isPresented.toggle() }
            .foregroundStyle(isPresented ? TuneTheme.accent : TuneTheme.primary)
            .background(isPresented ? TuneTheme.subtle : .clear, in: .rect(cornerRadius: 10))
            .popover(isPresented: $isPresented, arrowEdge: .bottom) {
                MacQueuePopover(player: player)
                    .tint(TuneTheme.accent)
                    .environment(\.locale, AppLanguage.locale)
            }
    }
}

private struct MacQueuePopover: View {
    let player: Player
    private let rowHeight: CGFloat = 40
    private let rowSpacing: CGFloat = 2
    private let maximumListHeight: CGFloat = 232

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Queue").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
                Text("\(player.upcoming.count) upcoming")
                    .font(.caption.monospacedDigit()).foregroundStyle(TuneTheme.secondary)
            }
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                heading("Now Playing")
                if let song = player.current { songRow(song) }
                else { emptyMessage("No current song") }
            }
            VStack(alignment: .leading, spacing: 4) {
                heading("Up Next")
                if player.upcoming.isEmpty {
                    emptyMessage("No upcoming songs")
                } else {
                    ScrollView {
                        LazyVStack(spacing: rowSpacing) {
                            ForEach(player.upcoming) { song in
                                HStack(spacing: 6) {
                                    Button { player.jump(to: song.id) } label: {
                                        songRow(song)
                                    }
                                    .buttonStyle(.plain)
                                    Button { player.removeUpcoming(song.id) } label: {
                                        Image(systemName: "minus.circle")
                                            .font(.system(size: 14))
                                            .foregroundStyle(TuneTheme.secondary)
                                            .frame(width: 28, height: rowHeight)
                                            .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Remove from Queue")
                                    .help("Remove from Queue")
                                }
                            }
                        }
                    }
                    .frame(height: min(maximumListHeight,
                                       CGFloat(player.upcoming.count) * (rowHeight + rowSpacing) - rowSpacing))
                }
            }
        }
        .foregroundStyle(TuneTheme.primary)
        .padding(14)
        .frame(width: 320)
    }

    private func heading(_ label: LocalizedStringKey) -> some View {
        Text(label).font(.caption.weight(.medium)).foregroundStyle(TuneTheme.secondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func emptyMessage(_ label: LocalizedStringKey) -> some View {
        Text(label).font(.callout).foregroundStyle(TuneTheme.secondary).padding(.vertical, 5)
    }

    private func songRow(_ song: Track) -> some View {
        HStack(spacing: 8) {
            ArtworkTile(artwork: song.artwork, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(song.metadata.title).font(.callout.weight(.semibold)).foregroundStyle(TuneTheme.primary)
                Text(song.subtitle).font(.caption).foregroundStyle(TuneTheme.secondary)
            }
            .lineLimit(1)
            Spacer(minLength: 4)
            Text(timeLabel(song.duration)).font(.caption.monospacedDigit())
                .foregroundStyle(TuneTheme.secondary).fixedSize(horizontal: true, vertical: false)
        }
        .frame(height: rowHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct MacVolumeButton: View {
    let player: Player
    @State private var showingVolume = false

    var body: some View {
        Button { showingVolume.toggle() } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(showingVolume ? TuneTheme.accent : TuneTheme.primary)
                .frame(width: 44, height: 44)
                .background(showingVolume ? TuneTheme.subtle : .clear, in: .rect(cornerRadius: 10))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Volume")
        .accessibilityValue(percentage)
        .help("Volume")
        .popover(isPresented: $showingVolume, arrowEdge: .bottom) {
            VStack(spacing: 8) {
                Text("Volume").font(.caption.weight(.semibold)).foregroundStyle(TuneTheme.secondary)
                VerticalVolumeSlider(value: Binding(get: { player.volume }, set: { player.volume = $0 }),
                                     dismiss: { showingVolume = false })
                    .frame(width: 32, height: 104)
                percentage.font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(TuneTheme.primary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 10)
            .environment(\.locale, AppLanguage.locale)
            .onExitCommand { showingVolume = false }
        }
    }

    private var percentage: Text { Text(player.volume, format: .percent.precision(.fractionLength(0))) }

    private var symbol: String {
        switch player.volume {
        case ...0: "speaker.slash.fill"
        case ..<0.34: "speaker.wave.1.fill"
        default: "speaker.wave.2.fill"
        }
    }
}

/// Use a natively vertical control so mouse, keyboard and accessibility share the same range.
private struct VerticalVolumeSlider: NSViewRepresentable {
    @Binding var value: Double
    let dismiss: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> FocusedSlider {
        let slider = FocusedSlider()
        slider.minValue = 0
        slider.maxValue = 1
        slider.target = context.coordinator
        slider.action = #selector(Coordinator.adjust(_:))
        slider.isVertical = true
        slider.isContinuous = true
        slider.trackFillColor = NSColor(TuneTheme.accent)
        slider.setAccessibilityLabel(String(localized: "Volume", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        return slider
    }

    func updateNSView(_ slider: FocusedSlider, context: Context) {
        context.coordinator.value = $value
        slider.dismiss = dismiss
        if slider.doubleValue != value { slider.doubleValue = value }
    }

    final class FocusedSlider: NSSlider {
        var dismiss: (() -> Void)?
        override var acceptsFirstResponder: Bool { true }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard window != nil else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.window?.makeFirstResponder(self)
            }
        }

        override func cancelOperation(_ sender: Any?) { dismiss?() }
    }

    final class Coordinator: NSObject {
        var value: Binding<Double>?

        @objc func adjust(_ slider: NSSlider) { value?.wrappedValue = slider.doubleValue }
    }
}
#endif

struct NowPlayingView: View {
    let app: AppState
    #if os(iOS)
    let showQueue: () -> Void
    @State private var showsLyrics = false
    #endif
    let showSources: () -> Void
    private var player: Player { app.player }
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                let width: CGFloat = textSize.isAccessibilitySize ? 190 : 320
                #if os(iOS)
                if showsLyrics {
                    LyricsPanel(app: app).frame(height: textSize.isAccessibilitySize ? 220 : 310)
                } else {
                    artwork(width: width)
                }
                #else
                artwork(width: width)
                #endif
                VStack(alignment: .leading, spacing: 4) {
                    Text(player.current?.metadata.title ?? String(localized: "Ready to Play", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                        .font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    if let subtitle = player.current?.subtitle {
                        Text(subtitle).font(.body).foregroundStyle(TuneTheme.secondary)
                    }
                }
                let feedback = PlaybackFeedback(app: app)
                if feedback.hasProblem {
                    VStack(alignment: .leading, spacing: 8) {
                        (player.exhaustedCandidates ? Text("No playable songs") : Text("Could not play this song."))
                            .foregroundStyle(TuneTheme.problem)
                        Button("Try Again") { player.resume() }.buttonStyle(.borderedProminent)
                        if player.canRestartFromBeginning {
                            Button("Play from Beginning") { player.restartFromBeginning() }.buttonStyle(.bordered)
                        }
                        Button("View Music Sources", action: showSources).buttonStyle(.bordered)
                    }
                } else if let message = feedback.message {
                    message.font(.subheadline).foregroundStyle(TuneTheme.secondary)
                }
                #if os(iOS)
                Scrubber(player: player)
                HStack {
                    Spacer()
                    PlayerIcon("Previous Track", symbol: "backward.end.fill", size: 24) { player.previous() }.disabled(player.current == nil)
                    Spacer()
                    PlayButton(player: player, prominent: true)
                    Spacer()
                    PlayerIcon("Next Track", symbol: "forward.end.fill", size: 24) { player.next() }.disabled(!player.canGoNext)
                    Spacer()
                }
                HStack(spacing: 8) {
                    PlaybackModeButton(player: player)
                    Spacer()
                    PlayerIcon("Lyrics", symbol: "quote.bubble") { showsLyrics.toggle() }
                        .accessibilityAddTraits(showsLyrics ? .isSelected : [])
                        .accessibilityIdentifier("show-lyrics")
                        .disabled(player.current == nil && !showsLyrics)
                    PlayerIcon("Queue", symbol: "list.bullet", action: showQueue)
                }
                #endif
            }
            .frame(maxWidth: 520)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(TuneTheme.primary)
        .background(TuneTheme.canvas)
        .navigationTitle(String(localized: "Now Playing", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func artwork(width: CGFloat) -> some View {
        ArtworkTile(artwork: player.current?.artwork)
            .frame(maxWidth: width)
            .frame(maxWidth: .infinity)
    }
}

#if os(iOS)
struct QueueView: View {
    let player: Player
    var body: some View {
        List {
            Section("Now Playing") {
                if let song = player.current {
                    TrackRowContent(title: song.metadata.title, detail: song.subtitle, duration: timeLabel(song.duration), state: nil, artwork: song.artwork)
                } else { Text("No current song").foregroundStyle(TuneTheme.secondary) }
            }
            Section("Up Next") {
                if player.upcoming.isEmpty { Text("No upcoming songs").foregroundStyle(TuneTheme.secondary) }
                ForEach(player.upcoming) { song in
                    HStack(spacing: 0) {
                        Button { player.jump(to: song.id) } label: {
                            TrackRowContent(title: song.metadata.title, detail: song.subtitle, duration: timeLabel(song.duration), state: nil, artwork: song.artwork)
                        }.buttonStyle(.plain)
                        PlayerIcon("Remove from Queue", symbol: "minus.circle") { player.removeUpcoming(song.id) }
                    }
                    .swipeActions { Button("Remove", role: .destructive) { player.removeUpcoming(song.id) } }
                }
            }
        }
        .navigationTitle(String(localized: "Queue", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

#endif

private struct Scrubber: View {
    let player: Player
    @State private var drag: Double?
    @State private var tracking = false
    var body: some View {
        VStack(spacing: 1) {
            Slider(value: Binding(get: { drag ?? min(player.position, max(1, player.duration)) }, set: { value in
                if tracking { drag = value }
                else { player.seek(value) }
            }), in: 0...max(1, player.duration)) { editing in
                tracking = editing
                if !editing, let value = drag { drag = nil; player.seek(value) }
            }
            .disabled(!player.seekingAvailable)
            .accessibilityLabel("Playback Position")
            .accessibilityValue(timeLabel(drag ?? player.position))
            HStack {
                Text(timeLabel(drag ?? player.position))
                Spacer()
                Text(player.duration > 0 ? timeLabel(player.duration) : "—:—")
            }.font(.caption.monospacedDigit()).foregroundStyle(TuneTheme.secondary).accessibilityHidden(true)
        }
        .frame(minWidth: 110)
        .onChange(of: player.current?.id) { drag = nil; tracking = false }
    }
}

private struct PlaybackModeButton: View {
    let player: Player

    private var symbol: String {
        switch player.mode {
        case .sequential: "list.number"
        case .repeatOne: "repeat.1"
        case .shuffle: "shuffle"
        }
    }

    private var title: LocalizedStringKey {
        switch player.mode {
        case .sequential: "Play in Order"
        case .repeatOne: "Repeat One"
        case .shuffle: "Shuffle"
        }
    }

    private var emphasized: Bool { player.mode != .sequential }

    var body: some View {
        Button { player.cyclePlaybackMode() } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: emphasized ? .semibold : .medium))
                .foregroundStyle(emphasized ? TuneTheme.accent : TuneTheme.secondary)
                .frame(width: 36, height: 30)
                .background(emphasized ? TuneTheme.subtle : .clear, in: .rect(cornerRadius: 8))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Playback Mode")
        .accessibilityValue(Text(title))
        .accessibilityHint("Cycles playback mode")
        .accessibilityIdentifier("playback-mode")
        .help(Text(title))
    }
}

private struct PlayButton: View {
    let player: Player
    var prominent = false
    var body: some View {
        Button { player.toggle() } label: {
            Group {
                if player.phase == .loading { ProgressView().controlSize(.small) }
                else {
                    Image(systemName: player.phase == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: prominent ? 27 : 17, weight: .semibold))
                }
            }
            .frame(width: prominent ? 65 : 44, height: prominent ? 65 : 44)
            .foregroundStyle(prominent ? TuneTheme.onAccent : TuneTheme.primary)
            .background(prominent ? TuneTheme.accent : Color.clear, in: Circle())
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(player.phase == .loading)
        .accessibilityLabel(player.phase == .loading ? Text("Loading…") : (player.phase == .playing ? Text("Pause") : Text("Play")))
        .accessibilityIdentifier("play-pause")
    }
}

struct PlayerIcon: View {
    let label: LocalizedStringKey
    let symbol: String
    var size: CGFloat = 16
    let action: () -> Void

    init(_ label: LocalizedStringKey, symbol: String, size: CGFloat = 16, action: @escaping () -> Void) {
        self.label = label; self.symbol = symbol; self.size = size; self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size, weight: .medium))
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(Text(label)).help(Text(label))
    }
}

struct LyricsPanel: View {
    let app: AppState

    var body: some View {
        if let track = app.player.current {
            TrackLyricsPanel(app: app, track: track).id(track)
        } else {
            Text("No lyrics for this song").foregroundStyle(TuneTheme.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct TrackLyricsPanel: View {
    private enum Content { case loading, missing, failed, loaded(LyricsDocument) }
    let app: AppState
    let track: Track
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var content = Content.loading
    @State private var follows = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Lyrics").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if case let .loaded(document) = content, !document.cues.isEmpty, !follows {
                    Button("Back to Current Line") { follows = true }
                        .font(.caption.weight(.medium)).buttonStyle(.bordered)
                        .accessibilityIdentifier("follow-lyrics")
                }
            }.padding(.horizontal, 16).frame(minHeight: 48)
            Divider()
            Group {
                switch content {
                case .loading:
                    ProgressView().accessibilityLabel(Text("Loading lyrics"))
                case .missing:
                    status("No lyrics for this song")
                case .failed:
                    status("Could not read lyrics")
                case .loaded(let document):
                    if document.cues.isEmpty {
                        ScrollView {
                            Text(document.plainText).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        }
                    } else {
                        timeline(document)
                    }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(TuneTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("lyrics-panel")
        .task { await load() }
    }

    private func load() async {
        do {
            let document = try await app.lyrics(for: track)
            try Task.checkCancellation()
            guard app.player.current == track else { return }
            content = document.map(Content.loaded) ?? .missing
        } catch {
            guard !Task.isCancelled, app.player.current == track else { return }
            content = .failed
        }
    }

    private func status(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.subheadline).foregroundStyle(TuneTheme.secondary)
            .multilineTextAlignment(.center).padding(16)
    }

    private func timeline(_ document: LyricsDocument) -> some View {
        let player = app.player
        let index = document.index(at: player.position)
        let scrollTarget = index ?? (player.position < (document.cues.first?.seconds ?? 0) ? -1 : nil)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 7) {
                    Color.clear.frame(height: 1).id(-1).accessibilityHidden(true)
                    ForEach(document.cues.indices, id: \.self) { i in
                        let cue = document.cues[i]
                        if !cue.lines.isEmpty {
                            Button {
                                if player.current == track && player.seekingAvailable { player.seek(cue.seconds) }
                            } label: {
                                Text(cue.lines.joined(separator: "\n"))
                                    .font(index == i ? .title3.weight(.bold) : .body.weight(.semibold))
                                    .foregroundStyle(index == i ? TuneTheme.primary : TuneTheme.secondary)
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .padding(.horizontal, 12)
                                    .background(index == i ? TuneTheme.subtle : .clear, in: RoundedRectangle(cornerRadius: 8))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(index == i ? .isSelected : [])
                            .accessibilityIdentifier("lyric-line-\(i)")
                            .disabled(!player.seekingAvailable || cue.seconds > player.duration)
                            .id(i)
                        }
                    }
                }.padding(12)
            }
            #if os(iOS)
            .simultaneousGesture(DragGesture(minimumDistance: 8).onChanged { movement in
                if abs(movement.translation.height) > abs(movement.translation.width) { follows = false }
            })
            #else
            .background(LyricsScrollObserver { follows = false }.allowsHitTesting(false))
            #endif
            .onChange(of: scrollTarget, initial: true) { _, target in
                if follows, let target { scroll(proxy, to: target) }
            }
            .onChange(of: follows) { _, enabled in
                if enabled, let scrollTarget { scroll(proxy, to: scrollTarget) }
            }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, to target: Int) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) {
            proxy.scrollTo(target, anchor: target == -1 ? .top : .center)
        }
    }
}

#if os(macOS)
private struct LyricsScrollObserver: NSViewRepresentable {
    let onScroll: () -> Void

    final class Area: NSView {
        var onScroll: (() -> Void)?
    }

    final class Coordinator {
        var monitor: Any?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> Area {
        let area = Area()
        context.coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak area] event in
            if let area, let window = area.window, event.window === window,
               event.scrollingDeltaY != 0, area.bounds.contains(area.convert(event.locationInWindow, from: nil)) {
                area.onScroll?()
            }
            return event
        }
        return area
    }

    func updateNSView(_ area: Area, context: Context) { area.onScroll = onScroll }

    static func dismantleNSView(_ area: Area, coordinator: Coordinator) {
        if let monitor = coordinator.monitor { NSEvent.removeMonitor(monitor) }
        coordinator.monitor = nil
    }
}
#endif
