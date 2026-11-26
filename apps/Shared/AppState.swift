import DesignSystem
import Domain
import Foundation
import Library
import Observation
import Playback
import SwiftUI

struct ImportFlow: Identifiable {
    let id = UUID()
    let name: String
    var replaces: UUID?
    var restoringRemoved = false
    var progress = ScanProgressValue()
    var draft: ImportDraft?
    var change: ImportChange?
    var error: String?
    var committing = false
    var requiresRescan = false
    var selectedRecovery = Set<Data>()

    var recoveryPaths: [RelativeAudioPath] {
        (change?.recoverable ?? []).filter { selectedRecovery.contains($0.id) }.map(\.path)
    }

    var scanning: Bool { draft == nil && error == nil }
    var canCommit: Bool {
        guard draft != nil, let change, !requiresRescan else { return false }
        if restoringRemoved { return !selectedRecovery.isEmpty }
        return change.added > 0 || change.updated > 0 || !change.missing.isEmpty || !change.unplayable.isEmpty || replaces != nil
    }
}

struct ScanProgressValue {
    var checked = 0
    var accepted = 0
}

struct ImportChange {
    let isFirstImport: Bool
    var added = 0
    var updated = 0
    var unchanged = 0
    var accepted: [RelativeAudioPath] = []
    var missing: [RelativeAudioPath] = []
    var unplayable: [RelativeAudioPath] = []
    var reconnect: SourceReconnectPreview?
    var recoverable: [RecoveryCandidate] = []
    var removedCount = 0
}

struct RecoveryCandidate: Identifiable {
    let path: RelativeAudioPath
    var id: Data { Data(path.rawValue.utf8) }
}

struct SourceReconnectPreview {
    let matched: Int
    let unmatched: Int
    let examples: [String]
}

@Observable @MainActor
final class AppState {
    let player = Player(artworkURL: { $0.artwork }, fallbackArtwork: {
        ImageRenderer(content: ArtworkTile(size: 512).environment(\.colorScheme, .light)).cgImage
    })
    private(set) var snapshot = LibrarySnapshot()
    #if os(iOS)
    private(set) var index = LibraryIndex(snapshot: .init(), foldsQualityVariants: true, artistGrouping: .folder)
    #else
    private(set) var index = LibraryIndex(snapshot: .init(), artistGrouping: .folder)
    #endif
    private(set) var starting = true
    private(set) var storeFailure = false
    private(set) var unavailable = Set<UUID>()
    private var unreachableTrackID: UUID?
    private var mutatingLibrary = false
    var flow: ImportFlow?
    var notice: String?
    #if os(iOS)
    var choosingFolder = false
    #else
    private var choosingFolder = false
    #endif
    var selectionTarget: MusicSource?

    @ObservationIgnored private var loading: Task<Void, Never>?
    @ObservationIgnored private var scanner: Task<Void, Never>?
    @ObservationIgnored private var cacheCleanup: Task<Void, Never>?
    @ObservationIgnored private var health: Task<Void, Never>?
    @ObservationIgnored private var library: LibraryStore?
    let importedLyrics: ImportedLyricsStore

    init(importedLyrics: ImportedLyricsStore = .init()) {
        self.importedLyrics = importedLyrics
    }

    var canImport: Bool { !starting && library != nil && flow == nil && !mutatingLibrary && !choosingFolder }

    var currentTrackUnavailable: Bool {
        guard let track = player.current, player.phase == .ended || (player.phase == .paused && !player.seekingAvailable) else { return false }
        return unavailable.contains(track.rootID) || unreachableTrackID == track.id
    }

    func start() {
        guard loading == nil, library == nil else { return }
        starting = true
        storeFailure = false
        player.connectSystemControls()
        loading = Task {
            defer { loading = nil; starting = false }
            do {
                let candidate = try await LibraryStore.open()
                let value = try await candidate.snapshot()
                library = candidate
                let previousIndex = index
                let initialIndex = await Task.detached(priority: .userInitiated) {
                    previousIndex.rebuilding(with: value)
                }.value
                publish(value, index: initialIndex)
                scheduleCacheCleanup()
            } catch { storeFailure = true }
        }
    }

    func choose(_ target: MusicSource? = nil) {
        guard canImport else { return }
        selectionTarget = target
        choosingFolder = true
        #if os(macOS)
        showMacPicker()
        #endif
    }

    func receiveSelection(_ selection: Result<URL, any Error>) {
        let target = selectionTarget
        selectionTarget = nil
        choosingFolder = false
        switch selection {
        case .success(let url): begin(name: url.lastPathComponent, selected: url, saved: nil, target: target)
        case .failure(let error):
            let ns = error as NSError
            guard ns.domain != NSCocoaErrorDomain || ns.code != NSUserCancelledError else { return }
            notice = String(localized: "Could not open that folder. Choose a local folder and try again.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        }
    }

    func rescan(_ source: MusicSource) {
        guard canImport else { return }
        begin(name: source.name, selected: nil, saved: source, target: nil)
    }

    func restoreRemoved(in source: MusicSource) {
        guard canImport, snapshot.excludedCount(for: source.id) > 0 else { return }
        begin(name: source.name, selected: nil, saved: source, target: nil, restoringRemoved: true)
    }

    func selectRecovery(_ candidate: RecoveryCandidate, selected: Bool) {
        guard flow?.restoringRemoved == true, flow?.committing == false, flow?.requiresRescan == false else { return }
        if selected { flow?.selectedRecovery.insert(candidate.id) }
        else { flow?.selectedRecovery.remove(candidate.id) }
    }

    func selectAllRecovery(_ selected: Bool) {
        guard let flow, flow.restoringRemoved, !flow.committing, !flow.requiresRescan else { return }
        self.flow?.selectedRecovery = selected ? Set((flow.change?.recoverable ?? []).map(\.id)) : []
    }

    private func begin(name: String, selected: URL?, saved: MusicSource?, target: MusicSource?, restoringRemoved: Bool = false) {
        guard canImport else { return }
        let session = ImportFlow(name: name, replaces: target?.id, restoringRemoved: restoringRemoved)
        flow = session
        let id = session.id
        let librarySnapshot = snapshot
        let sources = librarySnapshot.sources
        let priorScan = scanner
        let priorCleanup = cacheCleanup
        priorCleanup?.cancel()
        scanner = Task { [weak self] in
            // A cancelled scan may still be unwinding an AVFoundation call or writing a thumbnail.
            await priorScan?.value
            await priorCleanup?.value
            guard !Task.isCancelled else { return }
            let worker = Task.detached(priority: .userInitiated) { [weak self] in
                try Task.checkCancellation()
                let candidate: SourceDraft
                if let selected { candidate = try FolderAccess.prepare(selected) }
                else if let saved { candidate = saved.draft }
                else { throw FolderError.unavailable }
                let indexedSource = sources.first { $0.identity == candidate.identity }
                if let target, let indexedSource, indexedSource.id != target.id { throw FolderError.overlappingSource }
                let report = try await AudioScanner.scan(candidate, replaces: target?.id, existing: sources) { [weak self] tick in
                    Task { @MainActor [weak self] in
                        guard self?.flow?.id == id, self?.flow?.scanning == true else { return }
                        self?.flow?.progress = .init(checked: tick.checked, accepted: tick.accepted)
                    }
                }
                let sourceID = target?.id ?? indexedSource?.id
                var changes = ImportChange(isFirstImport: sourceID == nil)
                if restoringRemoved {
                    guard let sourceID else { throw FolderError.scanChanged }
                    changes.removedCount = librarySnapshot.excludedCount(for: sourceID)
                    changes.recoverable = report.audio.compactMap { audio in
                        librarySnapshot.isExcluded(audio.path, from: sourceID) ? RecoveryCandidate(path: audio.path) : nil
                    }.sorted {
                        let comparison = $0.path.rawValue.localizedStandardCompare($1.path.rawValue)
                        return comparison == .orderedSame ? $0.id.lexicographicallyPrecedes($1.id) : comparison == .orderedAscending
                    }
                    return (report, changes)
                }
                let contents = sourceID.map { librarySnapshot.contents(for: $0) }
                let indexedTracks = contents.map { $0.tracks + $0.missingTracks + $0.unplayableTracks } ?? []
                let missingIDs = Set(contents?.missingTracks.map(\.id) ?? [])
                let unplayableIDs = Set(contents?.unplayableTracks.map(\.id) ?? [])
                let paths = Dictionary(indexedTracks.map { (Data($0.path.rawValue.utf8), $0) },
                                       uniquingKeysWith: { first, _ in first })
                let isMigration = target.map { $0.identity != candidate.identity } ?? false
                changes.missing = indexedTracks.filter { !missingIDs.contains($0.id) && report.provesMissing($0.path) }.map(\.path)
                changes.unplayable = indexedTracks.filter { !unplayableIDs.contains($0.id) && report.provesUnplayable($0.path) }.map(\.path)
                var matched = Set<Data>()
                var examples: [String] = []
                for audio in report.audio {
                    if let sourceID, librarySnapshot.isExcluded(audio.path, from: sourceID) { continue }
                    changes.accepted.append(audio.path)
                    let path = Data(audio.path.rawValue.utf8)
                    guard let prior = paths[path] else { changes.added += 1; continue }
                    if isMigration, matched.insert(path).inserted, examples.count < 3 { examples.append(audio.path.rawValue) }
                    if librarySnapshot.isCurrent(prior, comparedWith: audio) {
                        changes.unchanged += 1
                    } else { changes.updated += 1 }
                }
                if isMigration {
                    guard !matched.isEmpty else { throw FolderError.wrongSource }
                    changes.reconnect = .init(matched: matched.count, unmatched: paths.count - matched.count,
                                              examples: examples)
                }
                return (report, changes)
            }
            do {
                let (report, changes) = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                guard let self, !Task.isCancelled, flow?.id == id else { return }
                flow?.draft = report
                flow?.change = changes
                scanner = nil
            } catch {
                guard let self, !Task.isCancelled, flow?.id == id else { return }
                if let saved, (error as? FolderError) == .chooseAgain || (error as? FolderError) == .unavailable { unavailable.insert(saved.id) }
                flow?.error = Self.message(for: error)
                scanner = nil
            }
        }
    }

    func cancelFlow() {
        guard let flow, !flow.committing else { return }
        scanner?.cancel()
        // Keep the task until it drains; both idle cleanup and a new scan must wait for it.
        self.flow = nil
        scheduleCacheCleanup()
    }

    func confirm() {
        guard let library, let flow, let draft = flow.draft, let change = flow.change, flow.canCommit, !flow.committing else { return }
        let recover = flow.restoringRemoved ? flow.recoveryPaths : nil
        let accepted = recover ?? change.accepted
        let missing = change.missing
        let unplayable = change.unplayable
        self.flow?.committing = true
        self.flow?.error = nil
        Task {
            do {
                try await Task.detached(priority: .userInitiated) {
                    let lease = try FolderAccess.open(draft.source.bookmark)
                    try AudioScanner.verifyMissing(missing, in: lease)
                    try await AudioScanner.verifyUnplayable(unplayable, in: lease)
                    try AudioScanner.verifyAccepted(draft, paths: accepted, in: lease)
                }.value
                let result: LibraryChanges
                if let recover { result = try await library.restoreExcludedChanges(recover, from: draft) }
                else { result = try await library.confirmChanges(draft) }
                await apply(result)
                self.flow = nil
                scheduleCacheCleanup()
            } catch {
                self.flow?.committing = false
                self.flow?.requiresRescan = (error as? FolderError) == .scanChanged
                self.flow?.error = String(localized: "Changes were not saved. The original library is unchanged.", bundle: AppLanguage.bundle, locale: AppLanguage.locale) + " " + Self.message(for: error)
            }
        }
    }

    func remove(_ track: Track) {
        guard let library, canImport else { return }
        mutatingLibrary = true
        Task {
            defer { mutatingLibrary = false }
            do {
                let result = try await library.removeTrackChanges([track.id])
                await apply(result)
                await importedLyrics.removeDeletedTracks([track.id])
                scheduleCacheCleanup()
            } catch {
                notice = String(localized: "Could not remove the song. The original library is unchanged.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
            }
        }
    }

    func remove(_ source: MusicSource) {
        guard let library, canImport else { return }
        let contents = snapshot.contents(for: source.id)
        let removedSongIDs = Set((contents.tracks + contents.missingTracks + contents.unplayableTracks).map(\.id))
        mutatingLibrary = true
        Task {
            defer { mutatingLibrary = false }
            do {
                let result = try await library.removeSourceChanges(source.id)
                await apply(result)
                await importedLyrics.removeDeletedTracks(removedSongIDs)
                scheduleCacheCleanup()
            } catch { notice = String(localized: "Could not remove the source. The original library is unchanged.", bundle: AppLanguage.bundle, locale: AppLanguage.locale) }
        }
    }

    func saveDisplayNames(_ track: Track, title: String?, artist: String?) async -> Bool {
        guard let library, canImport else { return false }
        mutatingLibrary = true
        defer { mutatingLibrary = false }
        do {
            let result = try await library.setDisplayNameChanges(for: track.id, title: title, artist: artist)
            await apply(result)
            return true
        } catch { return false }
    }

    func verifySources() {
        health?.cancel()
        let sources = snapshot.sources
        let track = player.current
        let worker = Task.detached(priority: .utility) {
            var badSources = Set<UUID>()
            var unreachableTrack: UUID?
            for source in sources {
                guard !Task.isCancelled else { break }
                guard let lease = try? FolderAccess.open(source.bookmark) else {
                    badSources.insert(source.id)
                    continue
                }
                // Only test path metadata, never open or decode the audio on startup.
                if let track, track.rootID == source.id, (try? lease.audioURL(for: track.path)) == nil {
                    unreachableTrack = track.id
                }
                withExtendedLifetime(lease) {}
            }
            return (badSources, unreachableTrack)
        }
        health = Task {
            let (badSources, unreachableTrack) = await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
            guard !Task.isCancelled else { return }
            unavailable = badSources
            unreachableTrackID = unreachableTrack
        }
    }

    func playAll(_ tracks: [Track], allowsSongsHandoff: Bool = false) {
        player.playAll(playableTracks(in: tracks), allowsSongsHandoff: allowsSongsHandoff)
    }

    func play(_ track: Track, in tracks: [Track], allowsSongsHandoff: Bool = false) {
        guard !unavailable.contains(track.rootID) else {
            notice = String(localized: "This source cannot be read. Open Music Sources and choose the original folder again.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
            return
        }
        player.play(track, in: playableTracks(in: tracks), allowsSongsHandoff: allowsSongsHandoff)
    }

    func continueInSongs(_ tracks: [Track]) {
        player.continueInSongs(tracks, excludingUnavailableSources: unavailable)
    }

    private func playableTracks(in tracks: [Track]) -> [Track] {
        tracks.filter { !unavailable.contains($0.rootID) }
    }

    private func apply(_ changes: LibraryChanges) async {
        guard !changes.affectedSourceIDs.isEmpty else { return }
        let previous = snapshot, previousIndex = index
        let (snapshot, newIndex, removedIDs, updatedTracks) = await Task.detached(priority: .userInitiated) {
            let result = previous.applying(changes)
            var removedIDs = Set<UUID>(), updatedTracks: [Track] = []
            for root in changes.affectedSourceIDs {
                let tracks = result.contents(for: root).tracks
                updatedTracks.append(contentsOf: tracks)
                let currentIDs = Set(tracks.map(\.id))
                removedIDs.formUnion(previous.contents(for: root).tracks.lazy.map(\.id).filter { !currentIDs.contains($0) })
            }
            return (result, previousIndex.rebuilding(with: result), removedIDs, updatedTracks)
        }.value
        // Publish only when the matching index is ready; mutations are serialized by the app.
        if !removedIDs.isEmpty { player.removeTracks(removedIDs) }
        publish(snapshot, index: newIndex, updatedTracks: updatedTracks)
    }

    private func publish(_ snapshot: LibrarySnapshot, index newIndex: LibraryIndex, updatedTracks: [Track]? = nil) {
        self.snapshot = snapshot
        index = newIndex
        unavailable.formIntersection(snapshot.sources.map(\.id))
        let sources = Dictionary(uniqueKeysWithValues: snapshot.sources.map { ($0.id, $0.bookmark) })
        player.configure { track in
            try await Task.detached(priority: .userInitiated) {
                guard let bookmark = sources[track.rootID] else { throw FolderError.unavailable }
                let lease = try FolderAccess.open(bookmark)
                return PlayableResource(url: try lease.audioURL(for: track.path), retaining: lease)
            }.value
        }
        if let updatedTracks { player.refreshCatalogMetadata(updatedTracks) }
        else { player.restoreCheckpoint(tracks: snapshot.tracks) }
        verifySources()
    }

    private func scheduleCacheCleanup() {
        let previous = cacheCleanup
        previous?.cancel()
        let scan = scanner, catalog = snapshot, lyrics = importedLyrics
        cacheCleanup = Task.detached(priority: .utility) {
            // Drain any older sweep even if this task is cancelled before it gets to run.
            // A scanner awaiting the latest cleanup must never overtake an older sweep.
            await previous?.value
            // Coalesce successive updates. Startup and import confirmation do not await maintenance.
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            await scan?.value
            guard !Task.isCancelled else { return }
            var ids = Set<UUID>(), artwork = Set<String>()
            // Missing/unplayable recordings still own their lyrics and shared artwork.
            for tracks in [catalog.tracks, catalog.missingTracks, catalog.unplayableTracks] {
                for track in tracks {
                    guard !Task.isCancelled else { return }
                    ids.insert(track.id)
                    if let key = track.artworkKey { artwork.insert(key) }
                }
            }
            await lyrics.removeUnreferenced(keeping: ids)
            ArtworkCache.removeUnreferenced(keeping: artwork)
        }
    }

    func lyrics(for track: Track) async throws -> ImportedLyricsStore.Resolved? {
        try await importedLyrics.resolve(for: track.id, bookmark: snapshot.sources.first { $0.id == track.rootID }?.bookmark,
                                         audioPath: track.path)
    }

    func saveLyrics(_ candidate: ImportedLyricsStore.Candidate, for track: Track) async throws {
        guard canImport, player.current?.id == track.id else { throw FolderError.unavailable }
        // Serialize with catalog mutations so deleting a track cannot leave a newly imported orphan.
        mutatingLibrary = true
        let cleanup = cacheCleanup
        cleanup?.cancel()
        defer { mutatingLibrary = false; scheduleCacheCleanup() }
        await cleanup?.value
        try await importedLyrics.save(candidate, for: track.id)
    }

    func removeImportedLyrics(for track: Track) async throws {
        guard canImport, player.current?.id == track.id else { throw FolderError.unavailable }
        mutatingLibrary = true
        defer { mutatingLibrary = false }
        try await importedLyrics.remove(for: track.id)
    }

    private static func message(for error: any Error) -> String {
        switch error as? FolderError {
        case .chooseAgain: String(localized: "Folder access could not be restored. Choose the original folder again in Music Sources.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        case .wrongSource: String(localized: "That is not the original folder. No source was replaced.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        case .overlappingSource: String(localized: "This folder overlaps an existing music source. Rescan the existing source instead.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        case .scanChanged: String(localized: "The folder changed after scanning. Cancel this preview and rescan.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        case .unsafePath: String(localized: "Choose a real, local folder rather than a shortcut or link.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        default: String(localized: "This folder could not be read. Make sure it is available on this device.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        }
    }
}

#if os(macOS)
import AppKit
extension AppState {
    fileprivate func showMacPicker() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.treatsFilePackagesAsDirectories = false
        panel.prompt = String(localized: "Choose Folder", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        panel.message = String(localized: "Choose a local folder containing your music.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        let completion: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            if response == .OK, let url = panel.url { receiveSelection(.success(url)) }
            else { choosingFolder = false; selectionTarget = nil }
        }
        if let window = NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: completion) }
        else { panel.begin(completionHandler: completion) }
    }
}
#endif
