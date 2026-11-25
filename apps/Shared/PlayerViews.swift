import DesignSystem
import Domain
import Library
import Playback
import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
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
                        Text(track.displayArtist).font(.caption).foregroundStyle(TuneTheme.secondary).lineLimit(1)
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
        PlayerIcon("Queue", symbol: "music.note.list") { isPresented.toggle() }
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
                Text(song.displayArtist).font(.caption).foregroundStyle(TuneTheme.secondary)
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
    #endif
    let showSources: () -> Void
    private var player: Player { app.player }
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var scrubPosition: Double?
    private let backdrop = Color(red: 0.09, green: 0.07, blue: 0.11)

    var body: some View {
        GeometryReader { viewport in
            let horizontal = usesWideLayout(at: viewport.size.width)
            ScrollView {
                Group {
                    if horizontal {
                        HStack(alignment: .center, spacing: 34) {
                            record
                            detail.frame(minWidth: 254, maxWidth: 370)
                        }
                    } else {
                        stackedContent
                    }
                }
                .frame(maxWidth: horizontal ? 828 : 426, minHeight: max(0, viewport.size.height - 32),
                       alignment: horizontal ? .center : .top)
                .padding(.horizontal, 22)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            playbackControls
                .frame(maxWidth: 426)
                .padding(.horizontal, 22)
                .padding(.top, 12)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity)
        }
        .background {
            RadialGradient(colors: [Color(red: 0.205, green: 0.154, blue: 0.245), backdrop],
                           center: .topLeading, startRadius: 10, endRadius: 560)
                .ignoresSafeArea()
            #if os(iOS)
            LibraryPageLandscape().opacity(0.68).ignoresSafeArea()
            #endif
        }
        .foregroundStyle(TuneTheme.primary)
        .tint(TuneTheme.accent)
        .environment(\.colorScheme, .dark)
        .onChange(of: player.current?.id) { scrubPosition = nil }
        .accessibilityIdentifier("now-playing-page")
        .navigationTitle(String(localized: "Now Playing", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        #endif
    }

    private var recordMaxWidth: CGFloat {
        #if os(iOS)
        340
        #else
        366
        #endif
    }

    private var record: some View {
        NowPlayingRecord(artwork: player.current?.artwork, playing: player.phase == .playing)
            .id(player.current?.id)
            .frame(maxWidth: textSize.isAccessibilitySize ? 190 : recordMaxWidth)
            .accessibilityIdentifier("now-playing-record")
    }

    private func usesWideLayout(at width: CGFloat) -> Bool {
        #if os(macOS)
        width >= 692 && !textSize.isAccessibilitySize
        #else
        false
        #endif
    }

    private var detail: some View {
        VStack(spacing: 12) {
            songHeading.frame(maxWidth: .infinity)
            if player.current != nil {
                LyricsPanel(app: app, inline: true, previewPosition: scrubPosition)
                    .padding(.top, 6)
            }
        }
        .multilineTextAlignment(.center)
    }

    private var playbackControls: some View {
        VStack(spacing: 12) {
            feedback
            Scrubber(player: player, onPreview: { scrubPosition = $0 })
            #if os(iOS)
            phoneTransport
            #else
            transport
            #endif
        }
    }

    private var songHeading: some View {
        VStack(alignment: .center, spacing: 4) {
            Text(player.current?.metadata.title ?? String(localized: "Ready to Play", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                .font(.title.bold()).accessibilityAddTraits(.isHeader)
            if let artist = player.current?.displayArtist {
                Text(artist).font(.body).foregroundStyle(TuneTheme.secondary)
            }
        }
    }

    @ViewBuilder private var feedback: some View {
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
    }

    private var stackedContent: some View {
        VStack(spacing: 12) {
            record
            detail.frame(maxWidth: 366)
            Spacer(minLength: 24)
        }
    }

    #if os(iOS)
    private var phoneTransportIconSize: CGFloat { 22 }

    private var phoneTransport: some View {
        HStack(spacing: 0) {
            phonePlaybackMode
                .frame(maxWidth: .infinity)
            PlayerIcon("Previous Track", symbol: "backward.end.fill", size: phoneTransportIconSize) { player.previous() }
                .disabled(player.current == nil)
                .frame(maxWidth: .infinity)
            PlayButton(player: player, prominent: true, diameter: 62)
            PlayerIcon("Next Track", symbol: "forward.end.fill", size: phoneTransportIconSize) { player.next() }
                .disabled(!player.canGoNext)
                .frame(maxWidth: .infinity)
            phoneQueue
                .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
        .frame(maxWidth: .infinity)
    }

    private var phonePlaybackMode: some View {
        PlaybackModeButton(player: player, transportIconSize: phoneTransportIconSize)
    }

    private var phoneQueue: some View {
        PlayerIcon("Queue", symbol: "music.note.list", size: phoneTransportIconSize) { showQueue() }
            .foregroundStyle(TuneTheme.secondary)
    }
    #else
    private var transport: some View {
        HStack(spacing: 2) {
            HStack(spacing: 2) {
                // Mirror the volume slot so the play button stays centered on the progress bar.
                Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
                    .allowsHitTesting(false)
                    .frame(maxWidth: .infinity)
                PlaybackModeButton(player: player).frame(maxWidth: .infinity)
                PlayerIcon("Previous Track", symbol: "backward.end.fill", size: 21) { player.previous() }
                    .disabled(player.current == nil).frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            PlayButton(player: player, prominent: true)
            HStack(spacing: 2) {
                PlayerIcon("Next Track", symbol: "forward.end.fill", size: 21) { player.next() }
                    .disabled(!player.canGoNext).frame(maxWidth: .infinity)
                MacQueueButton(player: player).frame(maxWidth: .infinity)
                MacVolumeButton(player: player).frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    #endif
}

#if os(iOS)
struct QueueView: View {
    let player: Player
    var body: some View {
        List {
            Section("Now Playing") {
                if let song = player.current {
                    TrackRowContent(title: song.metadata.title, artist: song.displayArtist, duration: timeLabel(song.duration), state: nil, artwork: song.artwork)
                } else { Text("No current song").foregroundStyle(TuneTheme.secondary) }
            }
            Section("Up Next") {
                if player.upcoming.isEmpty { Text("No upcoming songs").foregroundStyle(TuneTheme.secondary) }
                ForEach(player.upcoming) { song in
                    HStack(spacing: 0) {
                        Button { player.jump(to: song.id) } label: {
                            TrackRowContent(title: song.metadata.title, artist: song.displayArtist, duration: timeLabel(song.duration), state: nil, artwork: song.artwork)
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
    var onPreview: (Double?) -> Void = { _ in }
    @State private var drag: Double?
    private var position: Double { drag ?? player.position }
    private var upperBound: Double { max(1, player.duration) }

    var body: some View {
        VStack(spacing: 1) {
            slider
            HStack {
                Text(timeLabel(position))
                Spacer()
                Text(player.duration > 0 ? timeLabel(player.duration) : "—:—")
            }.font(.caption.monospacedDigit()).foregroundStyle(TuneTheme.secondary).accessibilityHidden(true)
        }
        .frame(minWidth: 110)
        .onChange(of: drag) { _, position in onPreview(position) }
        .onChange(of: player.current?.id) {
            drag = nil
        }
    }

    @ViewBuilder private var slider: some View {
        let trackID = player.current?.id
        PlaybackDotSlider(position: position, duration: upperBound, seekable: player.seekingAvailable) { preview in
            if player.current?.id == trackID { drag = preview }
        } seek: { seconds in
            if player.current?.id == trackID { player.seek(seconds) }
        }
        #if os(iOS)
        .frame(height: 44)
        #else
        .frame(height: 28)
        #endif
        .id(trackID)
    }
}

#if os(iOS)
/// Keep UIKit tracking and accessibility while styling just the playback thumb.
private struct PlaybackDotSlider: UIViewRepresentable {
    let position: Double
    let duration: Double
    let seekable: Bool
    let preview: (Double?) -> Void
    let seek: (Double) -> Void
    @Environment(\.colorScheme) private var colorScheme

    func makeUIView(context: Context) -> DotSlider {
        let slider = DotSlider()
        slider.isContinuous = false
        slider.addTarget(slider, action: #selector(DotSlider.commit), for: .valueChanged)
        let tap = UITapGestureRecognizer(target: slider, action: #selector(DotSlider.tapTrack(_:)))
        tap.cancelsTouchesInView = true
        slider.addGestureRecognizer(tap)
        return slider
    }

    func updateUIView(_ slider: DotSlider, context: Context) {
        slider.preview = preview
        slider.seek = seek
        slider.isEnabled = seekable
        if !slider.isTracking {
            slider.maximumValue = Float(duration)
            slider.value = Float(position)
        }
        let appearance = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
        let accent = UIColor(TuneTheme.accent).resolvedColor(with: appearance)
        slider.minimumTrackTintColor = accent
        slider.maximumTrackTintColor = accent.withAlphaComponent(0.25)
        slider.setDotColor(accent)
        slider.accessibilityLabel = String(localized: "Playback Position", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        slider.accessibilityValue = timeLabel(position)
    }

    final class DotSlider: UISlider {
        var preview: ((Double?) -> Void)?
        var seek: ((Double) -> Void)?
        private var dotColor: UIColor?

        func setDotColor(_ color: UIColor) {
            guard dotColor != color else { return }
            dotColor = color
            let size = CGSize(width: 14, height: 14)
            let dot = UIGraphicsImageRenderer(size: size).image { renderer in
                renderer.cgContext.setFillColor(color.cgColor)
                renderer.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
            }
            setThumbImage(dot, for: .normal)
            setThumbImage(dot, for: .highlighted)
        }

        @objc func tapTrack(_ recognizer: UITapGestureRecognizer) {
            guard isEnabled, recognizer.state == .ended else { return }
            let track = trackRect(forBounds: bounds)
            let minimumX = thumbRect(forBounds: bounds, trackRect: track, value: minimumValue).midX
            let maximumX = thumbRect(forBounds: bounds, trackRect: track, value: maximumValue).midX
            guard let target = PlaybackSliderPosition.value(
                at: Double(recognizer.location(in: self).x),
                minimumX: Double(minimumX), maximumX: Double(maximumX),
                minimumValue: Double(minimumValue), maximumValue: Double(maximumValue)
            ) else { return }
            value = Float(target)
            preview?(nil)
            sendActions(for: .valueChanged)
        }

        override func continueTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
            let tracking = super.continueTracking(touch, with: event)
            if tracking { preview?(Double(value)) }
            return tracking
        }

        override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
            super.endTracking(touch, with: event)
            preview?(nil)
        }

        override func cancelTracking(with event: UIEvent?) {
            super.cancelTracking(with: event)
            preview?(nil)
        }

        @objc func commit() { seek?(Double(value)) }
    }
}
#elseif os(macOS)
/// Use native tracking, keyboard and VoiceOver actions with the round player thumb.
private struct PlaybackDotSlider: NSViewRepresentable {
    let position: Double
    let duration: Double
    let seekable: Bool
    let preview: (Double?) -> Void
    let seek: (Double) -> Void
    @Environment(\.colorScheme) private var colorScheme

    func makeNSView(context: Context) -> DotSlider {
        let slider = DotSlider()
        slider.cell = DotCell()
        slider.isContinuous = true
        slider.target = slider
        slider.action = #selector(DotSlider.didAdjust)
        slider.setAccessibilityLabel(String(localized: "Playback Position", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        return slider
    }

    func updateNSView(_ slider: DotSlider, context: Context) {
        slider.preview = preview
        slider.seek = seek
        slider.isEnabled = seekable
        slider.setAccessibilityValueDescription(timeLabel(position))
        if !slider.tracking {
            slider.maxValue = duration
            slider.doubleValue = min(position, duration)
        }
        let appearance = NSAppearance(named: colorScheme == .dark ? .darkAqua : .aqua)
        appearance?.performAsCurrentDrawingAppearance {
            (slider.cell as? DotCell)?.accent = NSColor(TuneTheme.accent).usingColorSpace(.deviceRGB) ?? .controlAccentColor
        }
    }

    final class DotSlider: NSSlider {
        var preview: ((Double?) -> Void)?
        var seek: ((Double) -> Void)?
        private(set) var tracking = false
        private var changed = false

        override func mouseDown(with event: NSEvent) {
            guard isEnabled else { return }
            window?.makeFirstResponder(self)
            tracking = true
            changed = false
            super.mouseDown(with: event)
            tracking = false
            if changed { seek?(doubleValue) }
            preview?(nil)
        }

        @objc func didAdjust() {
            if tracking {
                changed = true
                preview?(doubleValue)
            } else {
                seek?(doubleValue)
            }
        }
    }

    final class DotCell: NSSliderCell {
        var accent = NSColor.controlAccentColor

        override func drawBar(inside rect: NSRect, flipped: Bool) {
            let bar = NSRect(x: rect.minX, y: rect.midY - 1.5, width: rect.width, height: 3)
            let track = NSBezierPath(roundedRect: bar, xRadius: 1.5, yRadius: 1.5)
            accent.withAlphaComponent(isEnabled ? 0.25 : 0.12).setFill()
            track.fill()
            let knob = min(max(knobRect(flipped: flipped).midX, bar.minX), bar.maxX)
            let rtl = controlView?.userInterfaceLayoutDirection == .rightToLeft
            let fill = NSRect(x: rtl ? knob : bar.minX, y: bar.minY,
                              width: rtl ? bar.maxX - knob : knob - bar.minX, height: bar.height)
            accent.withAlphaComponent(isEnabled ? 1 : 0.38).setFill()
            NSBezierPath(roundedRect: fill, xRadius: 1.5, yRadius: 1.5).fill()
        }

        override func drawKnob(_ knobRect: NSRect) {
            accent.withAlphaComponent(isEnabled ? 1 : 0.38).setFill()
            NSBezierPath(ovalIn: NSRect(x: knobRect.midX - 6, y: knobRect.midY - 6, width: 12, height: 12)).fill()
        }
    }
}
#endif

private struct PlaybackModeButton: View {
    let player: Player
    var transportIconSize: CGFloat? = nil

    private var isTransportIcon: Bool { transportIconSize != nil }

    private var symbol: String {
        switch player.mode {
        #if os(macOS)
        case .sequential: "list.bullet"
        #else
        case .sequential: "list.number"
        #endif
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
                .font(.system(size: transportIconSize ?? 16, weight: isTransportIcon ? .medium : (emphasized ? .semibold : .medium)))
                .foregroundStyle(emphasized ? TuneTheme.accent : TuneTheme.secondary)
                .frame(width: isTransportIcon ? 44 : 36, height: isTransportIcon ? 44 : 30)
                .background(emphasized && !isTransportIcon ? TuneTheme.subtle : .clear, in: .rect(cornerRadius: 8))
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
    var diameter: CGFloat = 48
    var body: some View {
        Button { player.toggle() } label: {
            Group {
                if player.phase == .loading { ProgressView().controlSize(.small) }
                else {
                    Image(systemName: player.phase == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: prominent ? 24 : 17, weight: .semibold))
                }
            }
            .frame(width: prominent ? diameter : 44, height: prominent ? diameter : 44)
            .foregroundStyle(prominent ? TuneTheme.onAccent : TuneTheme.primary)
            .background(prominent ? TuneTheme.accent : Color.clear, in: Circle())
            .frame(width: prominent ? diameter + 6 : 44, height: prominent ? diameter + 6 : 44)
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
    var inline = false
    var previewPosition: Double?

    var body: some View {
        if let track = app.player.current {
            TrackLyricsPanel(app: app, track: track, inline: inline, previewPosition: previewPosition).id(track)
        } else {
            Text("No lyrics for this song").foregroundStyle(TuneTheme.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct TrackLyricsPanel: View {
    private enum Content { case loading, missing, failed, loaded(ImportedLyricsStore.Resolved) }
    let app: AppState
    let track: Track
    let inline: Bool
    var previewPosition: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var content = Content.loading
    @State private var loadRevision = 0
    @State private var follows = true
    @State private var isPicking = false
    @State private var processingFile = false
    @State private var pendingImport: ImportedLyricsStore.Candidate?
    @State private var confirmsRemoval = false
    @State private var operationError: LocalizedStringKey?
    #if os(iOS)
    private enum LyricsAction { case importFile, remove }
    @State private var showsLyricsOptions = false
    @State private var pendingLyricsAction: LyricsAction?
    #endif

    private var isImported: Bool {
        if case .loaded(let lyrics) = content { return lyrics.isImported }
        return false
    }

    var body: some View {
        Group {
            if inline { summary }
            else { fullPanel }
        }
        .accessibilityIdentifier("lyrics-panel")
        .task(id: loadRevision) { await load() }
        .fileImporter(isPresented: $isPicking, allowedContentTypes: Self.lyricTypes, onCompletion: selectLyricsFile)
        .sheet(item: $pendingImport) { candidate in
            LyricImportPreview(track: track, candidate: candidate, replacesExisting: isImported) {
                try await app.saveLyrics(candidate, for: track)
                refresh()
            }
        }
        .confirmationDialog("Remove Imported Lyrics?", isPresented: $confirmsRemoval, titleVisibility: .visible) {
            Button("Remove Imported Lyrics", role: .destructive, action: removeLyrics)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Only the imported copy will be removed. The .lrc beside the audio file is not changed.")
        }
        .alert("Lyrics", isPresented: Binding(get: { operationError != nil }, set: { if !$0 { operationError = nil } })) {
            Button("OK", role: .cancel) { operationError = nil }
        } message: {
            if let operationError { Text(operationError) }
        }
    }

    // Some file providers identify .lrc as plain text. Validate the extension again on read.
    private static let lyricTypes = [UTType(filenameExtension: "lrc"), .plainText].compactMap { $0 }

    @ViewBuilder private var summary: some View {
        switch content {
        case .loading:
            ProgressView().controlSize(.small).accessibilityLabel(Text("Loading lyrics"))
        case .missing:
            missingStatus(compact: true)
        case .failed:
            retryStatus("Could not read lyrics", compact: true)
        case .loaded(let lyrics):
            let document = lyrics.document
            Group {
                if document.cues.isEmpty {
                    Text(document.plainText).font(.subheadline).foregroundStyle(TuneTheme.secondary).lineLimit(5)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                } else {
                    NowPlayingLyricStrip(document: document, position: previewPosition ?? app.player.position,
                                         animates: previewPosition == nil)
                }
            }
        }
    }

    private var fullPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Lyrics").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if case let .loaded(lyrics) = content, !lyrics.document.cues.isEmpty, !follows {
                    Button("Back to Current Line") { follows = true }
                        .font(.caption.weight(.medium)).buttonStyle(.bordered)
                        .accessibilityIdentifier("follow-lyrics")
                }
                if case .loaded = content { lyricsMenu }
            }.padding(.horizontal, 16).frame(minHeight: 48)
            Divider()
            Group {
                switch content {
                case .loading:
                    ProgressView().accessibilityLabel(Text("Loading lyrics")).padding(16)
                case .missing:
                    missingStatus(compact: false)
                case .failed:
                    retryStatus("Could not read lyrics")
                case .loaded(let lyrics):
                    let document = lyrics.document
                    Group {
                        if document.cues.isEmpty {
                            ScrollView {
                                Text(document.plainText).textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            }
                        } else {
                            timeline(document)
                        }
                    }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(TuneTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 12))
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

    private func refresh() {
        follows = true
        content = .loading
        loadRevision += 1
    }

    private func missingStatus(compact: Bool) -> some View {
        Text("No lyrics for this song")
            .font(compact ? .caption : .subheadline)
            .foregroundStyle(TuneTheme.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, compact ? 6 : 16)
    }

    private func retryStatus(_ text: LocalizedStringKey, compact: Bool = false) -> some View {
        VStack(alignment: compact ? .leading : .center, spacing: 4) {
            Text(text).font(compact ? .caption : .subheadline).foregroundStyle(TuneTheme.secondary)
                .multilineTextAlignment(compact ? .leading : .center)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    retryButton
                    if !inline { importButton }
                }
                VStack(alignment: compact ? .leading : .center, spacing: 4) {
                    retryButton
                    if !inline { importButton }
                }
            }
        }
        .padding(compact ? 0 : 16)
    }

    private var retryButton: some View {
        Button(action: refresh) { actionLabel("Reload Lyrics", symbol: "arrow.clockwise") }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("reload-lyrics")
    }

    private var importButton: some View {
        Button { isPicking = true } label: { actionLabel("Import Lyrics…", symbol: "doc.badge.plus") }
            .buttonStyle(.bordered)
            .disabled(!app.canImport || processingFile)
            .accessibilityIdentifier("import-lyrics")
    }

    private var lyricsMenu: some View {
        Group {
            #if os(iOS)
            Button { showsLyricsOptions = true } label: {
                Image(systemName: "ellipsis.circle")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(TuneTheme.accent)
            .accessibilityLabel("Lyrics Options")
            .popover(isPresented: $showsLyricsOptions, attachmentAnchor: .rect(.bounds)) {
                PhoneActionPopover {
                    GridRow {
                        PhonePopoverAction("Import Lyrics…", symbol: "doc.badge.plus") { selectLyricsAction(.importFile) }
                            .accessibilityIdentifier("import-lyrics")
                    }
                    if isImported {
                        PhonePopoverDivider()
                        GridRow {
                            PhonePopoverAction("Remove Imported Lyrics", symbol: "trash", role: .destructive) {
                                selectLyricsAction(.remove)
                            }
                            .accessibilityIdentifier("remove-imported-lyrics")
                        }
                    }
                }
                .disabled(!app.canImport || processingFile || pendingLyricsAction != nil)
                .onDisappear(perform: finishLyricsAction)
            }
            #else
            Menu {
                Button("Import Lyrics…", systemImage: "doc.badge.plus") { isPicking = true }
                    .accessibilityIdentifier("import-lyrics")
                if isImported {
                    Button("Remove Imported Lyrics", systemImage: "trash", role: .destructive) { confirmsRemoval = true }
                        .accessibilityIdentifier("remove-imported-lyrics")
                }
            } label: {
                Label("Lyrics Options", systemImage: "ellipsis.circle").labelStyle(.iconOnly)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            #endif
        }
        .disabled(!app.canImport || processingFile)
        .accessibilityIdentifier("lyrics-options")
    }

    #if os(iOS)
    private func selectLyricsAction(_ action: LyricsAction) {
        guard pendingLyricsAction == nil else { return }
        pendingLyricsAction = action
        showsLyricsOptions = false
    }

    private func finishLyricsAction() {
        guard let action = pendingLyricsAction else { return }
        pendingLyricsAction = nil
        // The picker and the destructive confirmation must wait for the options popover to close.
        Task { @MainActor in
            switch action {
            case .importFile: isPicking = true
            case .remove: confirmsRemoval = true
            }
        }
    }
    #endif

    private func actionLabel(_ title: LocalizedStringKey, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.caption.weight(.medium))
            #if os(iOS)
            .frame(minHeight: 44)
            #endif
    }

    private func selectLyricsFile(_ selection: Result<URL, any Error>) {
        guard app.player.current?.id == track.id else { return }
        processingFile = true
        Task {
            defer { processingFile = false }
            do {
                let candidate = try await app.importedLyrics.prepareImport(from: selection.get())
                guard app.player.current?.id == track.id else { return }
                pendingImport = candidate
            } catch {
                guard app.player.current?.id == track.id, !(error is CancellationError),
                      (error as? CocoaError)?.code != .userCancelled else { return }
                operationError = switch error as? LyricsImportError {
                case .wrongExtension: "Choose a file with the .lrc extension."
                case .invalidEncoding: "Save the .lrc file as UTF-8 and try again."
                case .empty: "This file does not contain any lyrics."
                case .tooLarge: "The .lrc file is larger than 1 MB."
                default: "Could not open the lyrics file. Make sure it is available on this device."
                }
            }
        }
    }

    private func removeLyrics() {
        Task {
            do {
                try await app.removeImportedLyrics(for: track)
                refresh()
            } catch {
                guard app.player.current?.id == track.id else { return }
                operationError = "Could not remove the imported copy."
            }
        }
    }

    private func timeline(_ document: LyricsDocument) -> some View {
        let player = app.player
        let cueIndex = document.cueIndex(at: previewPosition ?? player.position)
        let index = cueIndex.flatMap { document.cues[$0].lines.isEmpty ? nil : $0 }
        let scrollTarget = cueIndex ?? -1
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
                        } else {
                            Color.clear.frame(height: 1).id(i).accessibilityHidden(true)
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
                if follows { scroll(proxy, to: target) }
            }
            .onChange(of: follows) { _, enabled in
                if enabled { scroll(proxy, to: scrollTarget) }
            }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, to target: Int) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) {
            proxy.scrollTo(target, anchor: target == -1 ? .top : .center)
        }
    }
}

private struct LyricImportPreview: View {
    let track: Track
    let candidate: ImportedLyricsStore.Candidate
    let replacesExisting: Bool
    let save: () async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var failed = false

    var body: some View {
        VStack(spacing: 0) {
            Text("Import Lyrics").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading).padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Attach lyrics to this song").font(.headline)
                        Text(track.metadata.title).font(.title3.bold())
                        Text(track.displayArtist)
                        Text(track.path.rawValue).font(.caption).foregroundStyle(TuneTheme.secondary)
                    }
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        Label(candidate.filename, systemImage: "doc.text").font(.headline)
                        Text("Lyrics Preview").font(.caption).foregroundStyle(TuneTheme.secondary)
                        Text(previewText).font(.body).textSelection(.enabled)
                    }
                    Text(replacesExisting
                         ? "This replaces the previously imported copy. The original files are not changed."
                         : "The imported copy takes priority over the .lrc beside the audio file. The original files are not changed.")
                        .font(.footnote).foregroundStyle(TuneTheme.secondary)
                    if failed {
                        Text("Could not save the imported lyrics. No lyrics were replaced.")
                            .font(.footnote).foregroundStyle(TuneTheme.problem)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            Divider()
            HStack(spacing: 20) {
                Spacer(minLength: 0)
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Import", action: confirm).keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("confirm-lyrics-import")
            }
            .buttonStyle(.bordered)
            .disabled(saving)
            .padding(20)
        }
        // Now Playing uses a dark SwiftUI environment even when the system sheet is light.
        .foregroundStyle(TuneTheme.primary)
        .tint(TuneTheme.accent)
        .background { TuneTheme.canvas.ignoresSafeArea() }
        .interactiveDismissDisabled(saving)
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 370)
        #endif
    }

    private var previewText: String {
        let document = candidate.document
        if document.cues.isEmpty {
            return String(document.plainText.prefix(1200)) + (document.plainText.count > 1200 ? "…" : "")
        }
        let cues = document.cues.lazy.filter { !$0.lines.isEmpty }.prefix(12)
        let text = cues.map { "\(timeLabel($0.seconds))  \($0.lines.joined(separator: " / "))" }.joined(separator: "\n")
        return String(text.prefix(1200)) + (text.count > 1200 || document.cues.count > 12 ? "…" : "")
    }

    private func confirm() {
        saving = true
        failed = false
        Task {
            defer { saving = false }
            do {
                try await save()
                dismiss()
            } catch { failed = true }
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
