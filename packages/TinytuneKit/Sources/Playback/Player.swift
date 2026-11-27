import AVFoundation
import CoreGraphics
import Domain
import Foundation
import MediaPlayer
import Observation

public struct PlayableResource: Sendable {
    public let url: URL
    private let scope: any Sendable

    public init(url: URL, retaining scope: any Sendable) {
        self.url = url
        self.scope = scope
    }
}

public enum PlaybackPhase: Sendable { case idle, loading, playing, paused, ended, failed }

public enum PlaybackMode: Sendable { case sequential, repeatOne, shuffle }

@Observable @MainActor
public final class Player {
    public typealias Resolver = @Sendable (Track) async throws -> PlayableResource
    public typealias ArtworkURLResolver = @Sendable (Track) -> URL?
    public private(set) var phase: PlaybackPhase = .idle
    public private(set) var position: Double = 0
    public private(set) var duration: Double = 0
    public private(set) var current: Track?
    public private(set) var upcoming: [Track] = []
    public private(set) var mode: PlaybackMode = .sequential
    private var repeatMode: RepeatMode { mode == .repeatOne ? .one : .off }
    public private(set) var seekingAvailable = false
    public private(set) var skippedTrackCount = 0
    public var exhaustedCandidates: Bool { retryDirection != nil }
    public var volume: Double = 1 { didSet { engine.volume = Float(max(0, min(1, volume))) } }

    @ObservationIgnored private let engine = AVPlayer()
    private var queue = PlaybackQueue()
    private struct SongsHandoff {
        struct Request {
            var tracks: [Track]
            let unavailableSourceIDs: Set<UUID>
        }

        var checkpoint = PlaybackSnapshot.SongsHandoff()
        var request: Request?
    }

    @ObservationIgnored private var songsHandoff: SongsHandoff?
    @ObservationIgnored private var tracks: [UUID: Track] = [:]
    @ObservationIgnored private var resolver: Resolver?
    @ObservationIgnored private let artworkURL: ArtworkURLResolver
    @ObservationIgnored private let systemArtwork: SystemPlaybackArtwork
    @ObservationIgnored private var opened: PlayableResource?
    @ObservationIgnored private var status: NSKeyValueObservation?
    @ObservationIgnored private var end: NSObjectProtocol?
    @ObservationIgnored private var failure: NSObjectProtocol?
    @ObservationIgnored private var clock: Any?
    @ObservationIgnored private var opening: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var wantsSound = false
    private struct PendingNavigation {
        var cursor: PlaybackQueue.Navigation
        let direction: PlaybackQueue.Direction
        var skipped = 0
    }

    @ObservationIgnored private var navigation: PendingNavigation?
    private var retryDirection: PlaybackQueue.Direction?
    @ObservationIgnored private var seekRequest: UUID?
    @ObservationIgnored private let snapshotStore: PlaybackSnapshotStore
    @ObservationIgnored private var hasCheckpointContext = false
    @ObservationIgnored private var lastSaved: PlaybackSnapshot?
    @ObservationIgnored private var lastCheckpoint: ContinuousClock.Instant?
    @ObservationIgnored private var remoteTargets: [(MPRemoteCommand, Any)] = []
    @ObservationIgnored private var sessionObservers: [NSObjectProtocol] = []

    public convenience init(artworkURL: @escaping ArtworkURLResolver = { _ in nil },
                            fallbackArtwork: @escaping @MainActor () -> CGImage? = { nil }) {
        self.init(snapshotStore: .local, artworkURL: artworkURL, fallbackArtwork: fallbackArtwork)
    }

    init(snapshotStore: PlaybackSnapshotStore, artworkURL: @escaping ArtworkURLResolver = { _ in nil },
         fallbackArtwork: @escaping @MainActor () -> CGImage? = { nil }) {
        self.snapshotStore = snapshotStore
        self.artworkURL = artworkURL
        systemArtwork = SystemPlaybackArtwork(fallback: fallbackArtwork)
    }

    /// Reconcile the saved queue against the first successfully loaded library without opening audio.
    public func restoreCheckpoint(tracks libraryTracks: [Track]) {
        guard !hasCheckpointContext, let saved = try? snapshotStore.load() else { return }
        let available = Dictionary(libraryTracks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var restored = saved.queue
        restored.removeTracks(Set(restored.ids.filter { available[$0] == nil }))
        queue = restored
        current = restored.current.flatMap { available[$0] }
        tracks = Dictionary(uniqueKeysWithValues: restored.ids.compactMap { id in available[id].map { (id, $0) } })
        updateUpcoming()
        // Prefer the actual shuffled order in legacy combinations. Former list repeat
        // otherwise becomes sequential, without changing the current track or position.
        mode = restored.isShuffled ? .shuffle : (saved.repeatMode == .one ? .repeatOne : .sequential)
        if let current {
            songsHandoff = saved.songsHandoff.map { SongsHandoff(checkpoint: $0) }
            position = saved.position
            duration = current.duration
            phase = saved.ended ? .ended : .paused
        }
        hasCheckpointContext = true
        lastSaved = saved
        publishSystemState()
        // Do not leave removed library entries in the on-disk checkpoint until the next action.
        if restored != saved.queue { persistCheckpoint() }
    }

    public func checkpoint() {
        samplePosition()
        persistCheckpoint()
    }

    private func persistCheckpoint() {
        guard hasCheckpointContext else { return }
        lastCheckpoint = .now
        let saved = PlaybackSnapshot(queue: queue, position: position, repeatMode: repeatMode, ended: phase == .ended,
                                     songsHandoff: songsHandoff?.checkpoint)
        guard saved != lastSaved else { return }
        // Persistence is best-effort: a write failure must not interrupt playback.
        if (try? snapshotStore.save(saved)) != nil { lastSaved = saved }
    }

    public func configure(resolver: @escaping Resolver) { self.resolver = resolver }

    public func connectSystemControls() {
        guard clock == nil else { return }
        clock = engine.addPeriodicTimeObserver(forInterval: .init(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        let center = MPRemoteCommandCenter.shared()
        remoteTargets = [
            (center.playCommand, center.playCommand.addTarget { [weak self] _ in
                Task { @MainActor in self?.resume() }; return .success
            }),
            (center.pauseCommand, center.pauseCommand.addTarget { [weak self] _ in
                Task { @MainActor in self?.pause() }; return .success
            }),
            (center.togglePlayPauseCommand, center.togglePlayPauseCommand.addTarget { [weak self] _ in
                Task { @MainActor in self?.toggle() }; return .success
            }),
            (center.nextTrackCommand, center.nextTrackCommand.addTarget { [weak self] _ in
                Task { @MainActor in self?.next() }; return .success
            }),
            (center.previousTrackCommand, center.previousTrackCommand.addTarget { [weak self] _ in
                Task { @MainActor in self?.previous() }; return .success
            }),
            (center.changePlaybackPositionCommand, center.changePlaybackPositionCommand.addTarget { [weak self] event in
                guard let move = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
                let seconds = move.positionTime
                Task { @MainActor in self?.seek(seconds) }; return .success
            }),
        ]
        #if os(iOS)
        let notifications = NotificationCenter.default
        sessionObservers = [
            notifications.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                let kind = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if kind == AVAudioSession.InterruptionType.began.rawValue { Task { @MainActor in self?.pause() } }
            },
            notifications.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
                let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
                if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { Task { @MainActor in self?.pause() } }
            },
        ]
        #endif
        publishSystemState()
    }

    public var canGoNext: Bool { queue.canAdvance(mode: repeatMode) }
    public var hasContext: Bool { current != nil || !upcoming.isEmpty }
    public var canRestartFromBeginning: Bool { phase == .failed && !exhaustedCandidates && current != nil && position > 0 }

    public func restartFromBeginning() {
        guard canRestartFromBeginning, let current else { return }
        load(current)
    }

    public func playAll(_ collection: [Track], allowsSongsHandoff: Bool = false) {
        guard let first = collection.first else { return }
        replaceQueue(with: collection, startingAt: first, allowsSongsHandoff: allowsSongsHandoff)
    }

    /// Activating the paused song from any list resumes its existing queue.
    public func play(_ track: Track, in collection: [Track], allowsSongsHandoff: Bool = false) {
        if phase == .paused, current?.id == track.id {
            resume()
            return
        }
        replaceQueue(with: collection, startingAt: track, allowsSongsHandoff: allowsSongsHandoff)
    }

    /// Opening Songs adopts the library order once per group queue, without reopening the audio.
    public func continueInSongs(_ collection: [Track], excludingUnavailableSources sourceIDs: Set<UUID> = []) {
        guard songsHandoff != nil, songsHandoff?.request == nil,
              phase == .loading || phase == .playing || phase == .paused else { return }
        songsHandoff?.request = .init(tracks: collection, unavailableSourceIDs: sourceIDs)
        guard applyRequestedSongsHandoff() else { return }
        updateUpcoming()
        checkpoint()
        publishSystemState()
    }

    /// Do not rebase an in-flight cursor. Once it settles, keep its committed current track as the anchor.
    private func applyRequestedSongsHandoff() -> Bool {
        guard navigation == nil, let handoff = songsHandoff, let request = handoff.request else { return false }
        songsHandoff?.request = nil
        let anchor = queue.current
        // Filter only after the anchor is known: an item that already opened may outlast its source access.
        let collection = request.tracks.filter {
            $0.id == anchor || (!request.unavailableSourceIDs.contains($0.rootID) && !handoff.checkpoint.excludedTrackIDs.contains($0.id))
        }
        guard let replacement = queue.replacingSourceOrder(with: collection.map(\.id)) else { return false }
        songsHandoff = nil
        queue = replacement
        tracks = Dictionary(collection.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return true
    }

    private func replaceQueue(with collection: [Track], startingAt track: Track, allowsSongsHandoff: Bool) {
        let selections = collection.contains(where: { $0.id == track.id }) ? collection : [track]
        tracks = Dictionary(selections.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var replacement = PlaybackQueue(ids: selections.map(\.id), start: track.id)
        replacement.setShuffle(mode == .shuffle)
        queue = replacement
        songsHandoff = allowsSongsHandoff ? SongsHandoff() : nil
        load(track)
    }

    public func next() {
        navigate(.next, sound: current == nil || wantsSound || phase == .failed)
    }

    @discardableResult
    private func navigate(_ direction: PlaybackQueue.Direction, sound: Bool) -> Bool {
        var cursor = PlaybackQueue.Navigation(queue, direction: direction, mode: repeatMode)
        guard let id = cursor.next(), let track = tracks[id] else { return false }
        samplePosition()
        resetNavigation()
        navigation = PendingNavigation(cursor: cursor, direction: direction)
        wantsSound = sound
        phase = .loading
        openItem(track, from: 0)
        publishSystemState()
        return true
    }

    private func reachedEnd(_ epoch: UUID) {
        guard generation == epoch, phase == .playing else { return }
        guard !navigate(.automatic, sound: true) else { return }
        wantsSound = false
        engine.pause()
        phase = .ended
        position = duration
        publishSystemState()
        persistCheckpoint()
    }

    public func previous() {
        guard current != nil else { return }
        if position > 3 || !queue.hasPrevious {
            if seekingAvailable { seek(0) }
            else if engine.currentItem == nil, phase != .loading {
                position = 0
                publishSystemState()
                persistCheckpoint()
            }
            return
        }
        navigate(.previous, sound: wantsSound)
    }

    public func jump(to id: UUID) {
        guard let track = tracks[id], queue.jump(to: id) else { return }
        load(track)
    }

    /// Refresh displayed metadata without touching order, media, or position.
    public func refreshCatalogMetadata(_ libraryTracks: [Track]) {
        guard !tracks.isEmpty else { return }
        if let requestedSongs = songsHandoff?.request?.tracks {
            let available = Dictionary(libraryTracks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            songsHandoff?.request?.tracks = requestedSongs.map { available[$0.id] ?? $0 }
        }
        var changed = false
        for track in libraryTracks where tracks[track.id].map({ $0 != track }) == true {
            tracks[track.id] = track
            if current?.id == track.id { current = track }
            changed = true
        }
        if changed { updateUpcoming() }
        // Rescanning can rebuild a missing thumbnail at the same URL (same content hash).
        let retryArtwork = systemArtwork.retryIfMissing()
        if changed || retryArtwork { publishSystemState() }
    }

    public func removeUpcoming(_ id: UUID) {
        guard queue.upcoming.contains(id) else { return }
        songsHandoff?.checkpoint.excludedTrackIDs.insert(id)
        removeTracks([id])
    }

    public func removeTracks(_ ids: Set<UUID>) {
        songsHandoff?.request?.tracks.removeAll { ids.contains($0.id) }
        guard queue.ids.contains(where: { ids.contains($0) }) else { return }
        let targetRemoved = navigation?.cursor.selectedID.map(ids.contains) ?? false
        navigation?.cursor.removeTracks(ids)
        queue.removeTracks(ids)
        for id in ids { tracks.removeValue(forKey: id) }
        if let current, ids.contains(current.id) {
            songsHandoff = nil
            clearItem()
            resetNavigation()
            self.current = nil
            phase = .idle
            wantsSound = false
            position = 0
            duration = 0
        } else if targetRemoved {
            cancelNavigation()
        }
        updateUpcoming()
        publishSystemState()
        checkpoint()
    }

    public func cyclePlaybackMode() {
        let nextMode: PlaybackMode = switch mode {
        case .sequential: .repeatOne
        case .repeatOne: .shuffle
        case .shuffle: .sequential
        }
        let shuffles = nextMode == .shuffle
        if queue.isShuffled != shuffles {
            cancelNavigation()
            queue.setShuffle(shuffles)
            updateUpcoming()
        }
        mode = nextMode
        hasCheckpointContext = true
        publishSystemState()
        checkpoint()
    }

    public func toggle() { wantsSound ? pause() : resume() }

    public func pause() {
        cancelNavigation()
        wantsSound = false
        engine.pause()
        if phase == .playing { phase = .paused }
        checkpoint()
        publishSystemState()
    }

    public func resume() {
        if phase == .loading { wantsSound = true; return }
        if let retryDirection {
            if navigate(retryDirection, sound: true) { return }
            // The queue may have been edited so the failed path no longer exists.
            resetNavigation()
        }
        guard let current else { navigate(.next, sound: true); return }
        wantsSound = true
        if phase == .ended { load(current); return }
        if engine.currentItem == nil { load(current, from: position); return }
        if engine.currentItem?.status == .readyToPlay { startAudio() }
    }

    public func seek(_ target: Double) {
        guard seekingAvailable, target.isFinite else { return }
        let time = min(duration, max(target, 0))
        position = time
        if phase == .ended { phase = .paused }
        requestSeek(to: time, restoring: false)
    }

    public func seekAndResume(_ target: Double) {
        guard seekingAvailable, target.isFinite else { return }
        let time = min(duration, max(target, 0))
        position = time
        if phase == .ended { phase = .paused }
        wantsSound = true
        requestSeek(to: time, restoring: false, resumesPlayback: true)
    }

    private func requestSeek(to time: Double, restoring: Bool, resumesPlayback: Bool = false) {
        let request = UUID()
        seekRequest = request
        engine.seek(to: .init(seconds: time, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, generation] finished in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, seekRequest == request else { return }
                seekRequest = nil
                if restoring {
                    guard finished else { fail(); return }
                    finishLoading()
                } else {
                    guard finished else {
                        if resumesPlayback && phase != .playing { wantsSound = false }
                        samplePosition()
                        publishSystemState()
                        persistCheckpoint()
                        return
                    }
                    samplePosition()
                    if resumesPlayback && wantsSound && phase != .playing { startAudio() }
                    publishSystemState()
                    persistCheckpoint()
                }
            }
        }
    }

    private func load(_ track: Track, from start: Double = 0) {
        resetNavigation()
        current = track
        position = start
        duration = track.duration
        phase = .loading
        wantsSound = true
        hasCheckpointContext = true
        _ = applyRequestedSongsHandoff()
        openItem(track, from: start)
        updateUpcoming()
        publishSystemState()
        persistCheckpoint()
    }

    private func openItem(_ track: Track, from start: Double) {
        clearItem()
        let epoch = generation
        guard let resolver else { fail(); return }
        opening = Task { [weak self] in
            do {
                let resource = try await resolver(track)
                try Task.checkCancellation()
                let asset = AVURLAsset(url: resource.url)
                // Verify the real duration when resuming; the indexed file may have changed.
                let actualDuration = start > 0 ? try await asset.load(.duration).seconds : nil
                try Task.checkCancellation()
                guard let self, generation == epoch else { return }
                if let actualDuration, actualDuration.isFinite, actualDuration > 0 {
                    duration = actualDuration
                }
                opened = resource
                let item = AVPlayerItem(asset: asset)
                status = item.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
                    Task { @MainActor in self?.itemStatusChanged(epoch) }
                }
                let center = NotificationCenter.default
                end = center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                    Task { @MainActor in
                        self?.reachedEnd(epoch)
                    }
                }
                failure = center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                    Task { @MainActor in
                        guard self?.generation == epoch else { return }
                        self?.mediaFailed()
                    }
                }
                engine.replaceCurrentItem(with: item)
            } catch {
                guard let self, generation == epoch, !Task.isCancelled else { return }
                mediaFailed()
            }
        }
    }

    private func itemStatusChanged(_ epoch: UUID) {
        guard generation == epoch, let item = engine.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            guard phase == .loading, seekRequest == nil else { return }
            if let navigation {
                guard let selected = navigation.cursor.selectedQueue(), let id = selected.current, let track = tracks[id] else {
                    fail()
                    return
                }
                queue = selected
                current = track
                position = 0
                duration = track.duration
                skippedTrackCount = navigation.skipped
                self.navigation = nil
                hasCheckpointContext = true
                _ = applyRequestedSongsHandoff()
                updateUpcoming()
            }
            let seconds = item.duration.seconds
            if seconds.isFinite && seconds > 0 { duration = seconds }
            if duration > 0 && position >= duration { position = 0 }
            if position > 0 { requestSeek(to: position, restoring: true) }
            else { finishLoading() }
        case .failed: mediaFailed()
        default: break
        }
    }

    private func finishLoading() {
        seekingAvailable = duration > 0 && !(engine.currentItem?.seekableTimeRanges.isEmpty ?? true)
        if wantsSound { startAudio() }
        else { phase = .paused; publishSystemState() }
        persistCheckpoint()
    }

    private func startAudio() {
        #if os(iOS)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch { fail(); return }
        #endif
        engine.play()
        phase = .playing
        publishSystemState()
    }

    private func mediaFailed() {
        guard let direction = navigation?.direction else { fail(); return }
        navigation?.skipped += 1
        while let id = navigation?.cursor.next() {
            guard let track = tracks[id] else { continue }
            openItem(track, from: 0)
            return
        }
        fail(retrying: direction)
    }

    private func resetNavigation() {
        navigation = nil
        skippedTrackCount = 0
        retryDirection = nil
    }

    private func cancelNavigation() {
        guard navigation != nil else { return }
        clearItem()
        resetNavigation()
        phase = current == nil ? .idle : .paused
        wantsSound = false
        if applyRequestedSongsHandoff() { updateUpcoming() }
    }

    private func fail(retrying direction: PlaybackQueue.Direction? = nil) {
        samplePosition()
        clearItem()
        resetNavigation()
        retryDirection = direction
        wantsSound = false
        phase = .failed
        // A navigation that exhausted its old scope can now be retried in Songs, but never autoplay here.
        if applyRequestedSongsHandoff() { updateUpcoming() }
        publishSystemState()
        persistCheckpoint()
    }

    private func clearItem() {
        generation = UUID()
        seekRequest = nil
        opening?.cancel()
        opening = nil
        status?.invalidate()
        status = nil
        if let end { NotificationCenter.default.removeObserver(end) }
        if let failure { NotificationCenter.default.removeObserver(failure) }
        end = nil
        failure = nil
        engine.pause()
        engine.replaceCurrentItem(with: nil)
        opened = nil
        seekingAvailable = false
    }

    private func tick() {
        samplePosition()
        if phase == .playing, lastCheckpoint.map({ $0.duration(to: .now) >= .seconds(5) }) ?? true {
            persistCheckpoint()
        }
    }

    private func samplePosition() {
        // The engine may still report time zero before a restored position has been applied.
        guard let item = engine.currentItem, item.status == .readyToPlay,
              phase != .loading, phase != .ended, seekRequest == nil else { return }
        let seconds = item.currentTime().seconds
        if seconds.isFinite { position = max(0, seconds) }
        let seekable = duration > 0 && !item.seekableTimeRanges.isEmpty
        if seekingAvailable != seekable { seekingAvailable = seekable; publishSystemState() }
    }

    private func updateUpcoming() {
        upcoming = queue.upcoming.compactMap { tracks[$0] }
    }

    private func publishSystemState() {
        guard clock != nil else { return }
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = hasContext
        center.togglePlayPauseCommand.isEnabled = hasContext
        center.pauseCommand.isEnabled = phase == .playing || phase == .loading
        center.previousTrackCommand.isEnabled = current != nil
        center.nextTrackCommand.isEnabled = canGoNext
        center.changePlaybackPositionCommand.isEnabled = seekingAvailable
        let now = MPNowPlayingInfoCenter.default()
        guard let current, phase != .failed else {
            systemArtwork.update(url: nil) {}
            now.nowPlayingInfo = nil
            #if os(macOS)
            now.playbackState = .stopped
            #endif
            return
        }
        var info: [String: Any] = [MPMediaItemPropertyTitle: current.metadata.title,
                                   MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                                   MPNowPlayingInfoPropertyPlaybackRate: phase == .playing ? 1.0 : 0.0,
                                   MPMediaItemPropertyPlaybackDuration: duration]
        info[MPMediaItemPropertyArtist] = current.metadata.artist
        info[MPMediaItemPropertyAlbumTitle] = current.metadata.album
        systemArtwork.update(url: artworkURL(current)) { [weak self] in self?.publishSystemState() }
        info[MPMediaItemPropertyArtwork] = systemArtwork.value
        now.nowPlayingInfo = info
        #if os(macOS)
        now.playbackState = phase == .playing ? .playing : .paused
        #endif
    }
}
