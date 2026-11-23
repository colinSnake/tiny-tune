import Domain
import Foundation
import Library
import Observation
import Playback

struct ImportFlow: Identifiable {
    let id = UUID()
    let name: String
    var replaces: UUID?
    var progress = ScanProgressValue()
    var draft: ImportDraft?
    var change: ImportChange?
    var error: String?
    var committing = false

    var scanning: Bool { draft == nil && error == nil }
    var canCommit: Bool {
        guard draft != nil, let change else { return false }
        return change.added > 0 || change.updated > 0 || replaces != nil
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
    var reconnect: SourceReconnectPreview?
}

struct SourceReconnectPreview {
    let matched: Int
    let unmatched: Int
    let examples: [String]
}

@Observable @MainActor
final class AppState {
    let player = Player()
    private(set) var snapshot = LibrarySnapshot()
    private(set) var index = LibraryIndex(tracks: [])
    private(set) var starting = true
    private(set) var storeFailure = false
    private(set) var unavailable = Set<UUID>()
    private var unreachableTrackID: UUID?
    private(set) var removing = false
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
    @ObservationIgnored private var health: Task<Void, Never>?
    @ObservationIgnored private var library: LibraryStore?

    var canImport: Bool { !starting && library != nil && flow == nil && !removing && !choosingFolder }

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
                await apply(value, restorePlayback: true)
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

    private func begin(name: String, selected: URL?, saved: MusicSource?, target: MusicSource?) {
        guard canImport else { return }
        let session = ImportFlow(name: name, replaces: target?.id)
        flow = session
        let id = session.id
        let librarySnapshot = snapshot
        let sources = librarySnapshot.sources
        let libraryTracks = librarySnapshot.tracks
        scanner = Task { [weak self] in
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
                let paths = Dictionary(libraryTracks.filter { $0.rootID == sourceID }.map { (Data($0.path.rawValue.utf8), $0) },
                                       uniquingKeysWith: { first, _ in first })
                var changes = ImportChange(isFirstImport: sourceID == nil)
                let isMigration = target.map { $0.identity != candidate.identity } ?? false
                var matched = Set<Data>()
                var examples: [String] = []
                for audio in report.audio {
                    if let sourceID, librarySnapshot.isExcluded(audio.path, from: sourceID) { continue }
                    let path = Data(audio.path.rawValue.utf8)
                    guard let prior = paths[path] else { changes.added += 1; continue }
                    if isMigration, matched.insert(path).inserted, examples.count < 3 { examples.append(audio.path.rawValue) }
                    if prior.metadata == audio.metadata, prior.duration == audio.duration, prior.artworkKey == audio.artworkKey {
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
        guard flow?.committing != true else { return }
        scanner?.cancel()
        scanner = nil
        flow = nil
    }

    func confirm() {
        guard let library, let flow, let draft = flow.draft, flow.canCommit, !flow.committing else { return }
        self.flow?.committing = true
        self.flow?.error = nil
        Task {
            do {
                try await Task.detached(priority: .userInitiated) {
                    let lease = try FolderAccess.open(draft.source.bookmark)
                    withExtendedLifetime(lease) {}
                }.value
                let result = try await library.confirm(draft)
                await apply(result)
                self.flow = nil
            } catch {
                self.flow?.committing = false
                self.flow?.error = String(localized: "Changes were not saved. The original library is unchanged.", bundle: AppLanguage.bundle, locale: AppLanguage.locale) + " " + Self.message(for: error)
            }
        }
    }

    func remove(_ track: Track) {
        guard let library, canImport else { return }
        removing = true
        Task {
            defer { removing = false }
            do {
                let result = try await library.removeTrack(track.id)
                await apply(result, removing: [track.id])
            } catch {
                notice = String(localized: "Could not remove the song. The original library is unchanged.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
            }
        }
    }

    func remove(_ source: MusicSource) {
        guard let library, canImport else { return }
        removing = true
        Task {
            defer { removing = false }
            do {
                let result = try await library.removeSource(source.id)
                let deleted = Set(snapshot.tracks.filter { $0.rootID == source.id }.map(\.id))
                await apply(result, removing: deleted)
            } catch { notice = String(localized: "Could not remove the source. The original library is unchanged.", bundle: AppLanguage.bundle, locale: AppLanguage.locale) }
        }
    }

    func verifySources() {
        health?.cancel()
        let sources = snapshot.sources
        let track = player.current
        health = Task {
            let (badSources, unreachableTrack) = await Task.detached(priority: .utility) {
                var badSources = Set<UUID>()
                var unreachableTrack: UUID?
                for source in sources {
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
            }.value
            guard !Task.isCancelled else { return }
            unavailable = badSources
            unreachableTrackID = unreachableTrack
        }
    }

    func play(_ track: Track, in tracks: [Track]) {
        guard !unavailable.contains(track.rootID) else {
            notice = String(localized: "This source cannot be read. Open Music Sources and choose the original folder again.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
            return
        }
        player.play(track, in: tracks.filter { !unavailable.contains($0.rootID) })
    }

    private func apply(_ snapshot: LibrarySnapshot, restorePlayback: Bool = false, removing removedIDs: Set<UUID> = []) async {
        let newIndex = await Task.detached(priority: .userInitiated) {
            LibraryIndex(tracks: snapshot.tracks)
        }.value
        // Publish only when the matching index is ready. Mutations remain serialized by flow/removing.
        if !removedIDs.isEmpty { player.removeTracks(removedIDs) }
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
        if restorePlayback { player.restoreCheckpoint(tracks: snapshot.tracks) }
        verifySources()
    }

    func lyrics(for track: Track) async throws -> LyricsDocument? {
        guard let bookmark = snapshot.sources.first(where: { $0.id == track.rootID })?.bookmark else {
            throw FolderError.unavailable
        }
        let worker = Task.detached(priority: .utility) {
            try LyricsSidecar.read(bookmark: bookmark, audioPath: track.path)
        }
        return try await withTaskCancellationHandler {
            try await worker.value
        } onCancel: {
            worker.cancel()
        }
    }

    private static func message(for error: any Error) -> String {
        switch error as? FolderError {
        case .chooseAgain: String(localized: "Folder access could not be restored. Choose the original folder again in Music Sources.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        case .wrongSource: String(localized: "That is not the original folder. No source was replaced.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        case .overlappingSource: String(localized: "This folder overlaps an existing music source. Rescan the existing source instead.", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
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
