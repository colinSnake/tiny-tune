import Domain
import Foundation
import SwiftData

public struct MusicSource: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let identity: String
    public let bookmark: Data
    public let lastScan: Date

    public var draft: SourceDraft { .init(name: name, identity: identity, bookmark: bookmark) }
}

public struct LibrarySnapshot: Sendable {
    public struct SourceContents: Sendable {
        public fileprivate(set) var tracks: [Track] = []
        public fileprivate(set) var missingTracks: [Track] = []
        public fileprivate(set) var unplayableTracks: [Track] = []
        let revision = UUID()
        fileprivate var originalTags: [UUID: MusicTags] = [:]
        fileprivate var exclusions: Set<String> = []
        fileprivate var inactiveIDs: Set<UUID> = []
    }

    public let sources: [MusicSource]
    public let tracks: [Track]
    public let missingTracks: [Track]
    public let unplayableTracks: [Track]
    let bySource: [UUID: SourceContents]

    public init(sources: [MusicSource] = [], tracks: [Track] = []) {
        let tracks = tracks.sorted(by: MusicOrdering.byTitle)
        self.init(sources: sources, tracks: tracks, missingTracks: [], unplayableTracks: [],
                  bySource: Dictionary(grouping: tracks, by: \.rootID)
                    .mapValues { SourceContents(tracks: $0) })
    }

    fileprivate init(sources: [MusicSource], tracks: [Track], missingTracks: [Track], unplayableTracks: [Track],
                     bySource: [UUID: SourceContents]) {
        self.sources = sources
        self.tracks = tracks
        self.missingTracks = missingTracks
        self.unplayableTracks = unplayableTracks
        self.bySource = bySource
    }

    public func contents(for sourceID: UUID) -> SourceContents { bySource[sourceID] ?? SourceContents() }

    public func isExcluded(_ path: RelativeAudioPath, from sourceID: UUID) -> Bool {
        bySource[sourceID]?.exclusions.contains(AudioRecord.key(sourceID, path)) == true
    }

    public func excludedCount(for sourceID: UUID) -> Int { bySource[sourceID]?.exclusions.count ?? 0 }

    /// Raw tags can change without affecting their current presentation (e.g. a newly explicit album credit).
    public func isCurrent(_ track: Track, comparedWith audio: ScannedAudio) -> Bool {
        let source = bySource[track.rootID]
        return source?.inactiveIDs.contains(track.id) != true &&
            (audio.embeddedTags == nil || source?.originalTags[track.id] == audio.embeddedTags) &&
            track.automaticMetadata == audio.metadata && track.duration == audio.duration && track.artworkKey == audio.artworkKey
    }

    /// Apply a committed store change to the preceding snapshot, in transaction order.
    public func applying(_ changes: LibraryChanges) -> LibrarySnapshot {
        guard !changes.affectedSourceIDs.isEmpty else { return self }
        let updated = changes.snapshot
        var contents = bySource
        for id in changes.affectedSourceIDs { contents[id] = updated.bySource[id] }
        func replace(_ tracks: [Track], with incoming: [Track]) -> [Track] {
            let kept = tracks.filter { !changes.affectedSourceIDs.contains($0.rootID) }
            return Self.merge(kept, incoming, by: MusicOrdering.byTitle)
        }
        return .init(sources: (sources.filter { !changes.affectedSourceIDs.contains($0.id) } + updated.sources).sorted(by: Self.sourceOrder),
                     tracks: replace(tracks, with: updated.tracks), missingTracks: replace(missingTracks, with: updated.missingTracks),
                     unplayableTracks: replace(unplayableTracks, with: updated.unplayableTracks), bySource: contents)
    }

    fileprivate static func sourceOrder(_ a: MusicSource, _ b: MusicSource) -> Bool {
        if a.name.utf8.elementsEqual(b.name.utf8) { return a.id.uuidString < b.id.uuidString }
        return a.name.utf8.lexicographicallyPrecedes(b.name.utf8)
    }

    private static func merge(_ kept: [Track], _ incoming: [Track], by before: (Track, Track) -> Bool) -> [Track] {
        guard !incoming.isEmpty else { return kept }
        guard !kept.isEmpty else { return incoming }
        var result: [Track] = []
        result.reserveCapacity(kept.count + incoming.count)
        var i = 0
        // Avoid comparing every historical title for a small import into a large library.
        if incoming.count <= kept.count / 16 {
            for track in incoming {
                var lo = i, hi = kept.count
                while lo < hi {
                    let middle = lo + (hi - lo) / 2
                    if before(track, kept[middle]) { hi = middle } else { lo = middle + 1 }
                }
                result.append(contentsOf: kept[i..<lo])
                result.append(track)
                i = lo
            }
        } else {
            for track in incoming {
                while i < kept.count, !before(track, kept[i]) {
                    result.append(kept[i])
                    i += 1
                }
                result.append(track)
            }
        }
        result.append(contentsOf: kept[i...])
        return result
    }
}

/// Only the affected source projections, including IDs of sources removed in the transaction.
public struct LibraryChanges: Sendable {
    public let affectedSourceIDs: Set<UUID>
    fileprivate let snapshot: LibrarySnapshot
}

enum SchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] { [SourceRecord.self, AudioRecord.self] }
}

enum SchemaV2: VersionedSchema {
    static let versionIdentifier = Schema.Version(2, 0, 0)
    static var models: [any PersistentModel.Type] { SchemaV1.models + [ExcludedAudioRecord.self] }
}

enum SchemaV3: VersionedSchema {
    static let versionIdentifier = Schema.Version(3, 0, 0)
    static var models: [any PersistentModel.Type] { SchemaV2.models + [TrackCatalogState.self] }
}

private enum SchemaV4: VersionedSchema {
    static let versionIdentifier = Schema.Version(4, 0, 0)
    static var models: [any PersistentModel.Type] { SchemaV3.models + [TrackScanFacts.self] }
}

private enum LibraryMigrations: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [SchemaV1.self, SchemaV2.self, SchemaV3.self, SchemaV4.self] }
    static var stages: [MigrationStage] { [
        .lightweight(fromVersion: SchemaV1.self, toVersion: SchemaV2.self),
        .lightweight(fromVersion: SchemaV2.self, toVersion: SchemaV3.self),
        .lightweight(fromVersion: SchemaV3.self, toVersion: SchemaV4.self),
    ] }
}

@Model
final class SourceRecord {
    @Attribute(.unique) var id: UUID
    @Attribute(.unique) var identity: String
    var name: String
    var bookmark: Data
    var lastScan: Date

    init(_ source: SourceDraft) {
        id = UUID()
        identity = source.identity
        name = source.name
        bookmark = source.bookmark
        lastScan = Date()
    }

    var value: MusicSource { .init(id: id, name: name, identity: identity, bookmark: bookmark, lastScan: lastScan) }
}

@Model
final class AudioRecord {
    @Attribute(.unique) var key: String
    var id: UUID
    var rootID: UUID
    var path: String
    var title: String
    var artist: String?
    var albumArtist: String?
    var album: String?
    var track: Int?
    var disc: Int?
    var duration: Double
    var dateAdded: Date
    var artworkKey: String?

    init(_ audio: ScannedAudio, rootID: UUID) {
        key = Self.key(rootID, audio.path)
        id = UUID()
        self.rootID = rootID
        path = audio.path.rawValue
        title = audio.metadata.title
        duration = audio.duration
        dateAdded = Date()
        update(audio)
    }

    static func key(_ root: UUID, _ path: RelativeAudioPath) -> String {
        // Encode the exact file-system spelling (including canonical Unicode variants).
        "\(root.uuidString):\(Data(path.rawValue.utf8).base64EncodedString())"
    }

    func update(_ audio: ScannedAudio) {
        if let tags = audio.embeddedTags {
            // Persist original tags, not inferred artist/track values. Projection is then idempotent.
            title = tags.title ?? ""
            artist = tags.artist
            albumArtist = tags.albumArtist
            album = tags.album
            track = tags.track
            disc = tags.disc
        } else {
            title = audio.metadata.title
            artist = audio.metadata.artist
            albumArtist = audio.metadata.albumArtist
            album = audio.metadata.album
            track = audio.metadata.track
            disc = audio.metadata.disc
        }
        duration = audio.duration
        artworkKey = audio.artworkKey
    }

    var storedTags: MusicTags {
        .init(title: title.isEmpty ? nil : title, artist: artist, albumArtist: albumArtist, album: album, track: track, disc: disc)
    }

    func value(sourceName: String?, state: TrackCatalogState? = nil, hasOriginalTags: Bool = false) -> Track? {
        guard let path = RelativeAudioPath(path) else { return nil }
        // Apply the same presentation rules to existing rows without rescanning or changing their IDs.
        let directory = path.albumDirectory
        // The old resolver copied single-level folder names into the credit. Treat this exact legacy
        // pattern as provisional when it conflicts with the performer; a rescan restores real credits.
        let folderEcho = !hasOriginalTags && !directory.isEmpty && !directory.contains("/") &&
            album == directory && albumArtist == directory && artist != albumArtist
        var saved = storedTags
        if folderEcho { saved.albumArtist = nil }
        let automatic = TrackMetadata.resolve(path, tags: saved, sourceName: sourceName)
        let artist = state?.displayArtist ?? automatic.artist
        // An explicit album credit is separate from the performer shown on this song.
        let albumCredit = saved.readableAlbumArtist ?? artist
        let metadata = TrackMetadata(title: state?.displayTitle ?? automatic.title,
                                     artist: artist, albumArtist: albumCredit,
                                     album: automatic.album, track: automatic.track, disc: automatic.disc)
        return .init(id: id, rootID: rootID, path: path, metadata: metadata,
                     duration: duration, dateAdded: dateAdded, artworkKey: artworkKey, automaticMetadata: automatic)
    }
}

// Reuse the index key so exclusions retain exact path spelling and are scoped to the source.
@Model
final class ExcludedAudioRecord {
    @Attribute(.unique) var key: String
    var rootID: UUID

    init(key: String, rootID: UUID) {
        self.key = key
        self.rootID = rootID
    }
}

// Keep the old SwiftData models unchanged so both historical schemas can still migrate.
@Model
final class TrackCatalogState {
    @Attribute(.unique) var trackID: UUID
    var rootID: UUID
    var missing: Bool
    var displayTitle: String?
    var displayArtist: String?
    var isEmpty: Bool { !missing && displayTitle == nil && displayArtist == nil }

    init(trackID: UUID, rootID: UUID) {
        self.trackID = trackID
        self.rootID = rootID
        missing = false
    }
}

/// Separate from historical models so the existing SwiftData schema checksums remain stable.
@Model
final class TrackScanFacts {
    @Attribute(.unique) var trackID: UUID
    var rootID: UUID
    var hasOriginalTags: Bool
    var unplayable: Bool

    init(trackID: UUID, rootID: UUID) {
        self.trackID = trackID
        self.rootID = rootID
        hasOriginalTags = false
        unplayable = false
    }
}

@ModelActor
public actor LibraryStore {
    public static func open(inMemory: Bool = false, location: URL? = nil) async throws -> LibraryStore {
        try await Task.detached(priority: .userInitiated) {
            let schema = Schema(versionedSchema: SchemaV4.self)
            let config: ModelConfiguration
            if let location {
                config = .init(schema: schema, url: location, cloudKitDatabase: .none)
            } else {
                config = .init("TinytuneLibrary", schema: schema, isStoredInMemoryOnly: inMemory, cloudKitDatabase: .none)
            }
            let container = try ModelContainer(for: schema, migrationPlan: LibraryMigrations.self, configurations: config)
            let library = LibraryStore(modelContainer: container)
            try await library.prepareForUse()
            return library
        }.value
    }

    private func prepareForUse() throws {
        modelContext.autosaveEnabled = false
        do {
            try removeOrphanedRecords()
            if modelContext.hasChanges { try modelContext.save() }
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    // These historical models use IDs rather than cascade relationships. Repair old partial
    // removals on open so adding the same folder cannot resurrect its detached catalog rows.
    private func removeOrphanedRecords() throws {
        let roots = Set(try modelContext.fetch(FetchDescriptor<SourceRecord>()).map(\.id))
        let records = try modelContext.fetch(FetchDescriptor<AudioRecord>())
        let retained = records.filter { roots.contains($0.rootID) }
        let trackRoots = Dictionary(retained.map { ($0.id, $0.rootID) }, uniquingKeysWith: { first, _ in first })
        records.filter { !roots.contains($0.rootID) }.forEach(modelContext.delete)
        try modelContext.fetch(FetchDescriptor<TrackCatalogState>())
            .filter { trackRoots[$0.trackID] != $0.rootID }.forEach(modelContext.delete)
        try modelContext.fetch(FetchDescriptor<TrackScanFacts>())
            .filter { trackRoots[$0.trackID] != $0.rootID }.forEach(modelContext.delete)
        try modelContext.fetch(FetchDescriptor<ExcludedAudioRecord>())
            .filter { !roots.contains($0.rootID) }.forEach(modelContext.delete)
    }

    public func snapshot() throws -> LibrarySnapshot { try readSnapshot(for: nil) }

    private func changes(for roots: Set<UUID>) throws -> LibraryChanges {
        .init(affectedSourceIDs: roots, snapshot: roots.isEmpty ? .init() : try readSnapshot(for: Array(roots)))
    }

    private func fetch<Model: PersistentModel>(matching roots: [UUID]?,
                                               predicate: ([UUID]) -> Predicate<Model>) throws -> [Model] {
        guard let roots else { return try modelContext.fetch(FetchDescriptor<Model>()) }
        return try stride(from: 0, to: roots.count, by: 250).flatMap { start in
            let batch = Array(roots[start..<min(start + 250, roots.count)])
            return try modelContext.fetch(FetchDescriptor<Model>(predicate: predicate(batch)))
        }
    }

    private func readSnapshot(for roots: [UUID]?) throws -> LibrarySnapshot {
        let sources = try fetch(matching: roots) { batch in #Predicate<SourceRecord> { batch.contains($0.id) } }
            .map(\.value).sorted(by: LibrarySnapshot.sourceOrder)
        let sourceNames = Dictionary(uniqueKeysWithValues: sources.map { ($0.id, $0.name) })
        let states = try fetch(matching: roots) { batch in #Predicate<TrackCatalogState> { batch.contains($0.rootID) } }
        let stateByID = Dictionary(uniqueKeysWithValues: states.map { ($0.trackID, $0) })
        let facts = try fetch(matching: roots) { batch in #Predicate<TrackScanFacts> { batch.contains($0.rootID) } }
        let factsByID = Dictionary(uniqueKeysWithValues: facts.map { ($0.trackID, $0) })
        let records = try fetch(matching: roots) { batch in #Predicate<AudioRecord> { batch.contains($0.rootID) } }
        var contents = Dictionary(uniqueKeysWithValues: sources.map { ($0.id, LibrarySnapshot.SourceContents()) })
        var tracks: [Track] = [], missing: [Track] = [], unplayable: [Track] = []
        for record in records {
            let id = record.id, root = record.rootID
            let state = stateByID[id], facts = factsByID[id]
            let hasOriginalTags = facts?.hasOriginalTags == true
            guard let sourceName = sourceNames[root],
                  let value = record.value(sourceName: sourceName, state: state, hasOriginalTags: hasOriginalTags) else { continue }
            if hasOriginalTags { contents[root]?.originalTags[id] = record.storedTags }
            if state?.missing == true {
                missing.append(value)
                contents[root]?.inactiveIDs.insert(id)
            } else if facts?.unplayable == true {
                unplayable.append(value)
                contents[root]?.inactiveIDs.insert(id)
            } else { tracks.append(value) }
        }
        let exclusions = try fetch(matching: roots) { batch in #Predicate<ExcludedAudioRecord> { batch.contains($0.rootID) } }
        for record in exclusions { contents[record.rootID]?.exclusions.insert(record.key) }
        tracks.sort(by: MusicOrdering.byTitle)
        missing.sort(by: MusicOrdering.byTitle)
        unplayable.sort(by: MusicOrdering.byTitle)
        // Per-source slices keep the identical presentation order without sorting twice.
        let tracksByRoot = Dictionary(grouping: tracks, by: \.rootID)
        let missingByRoot = Dictionary(grouping: missing, by: \.rootID)
        let unplayableByRoot = Dictionary(grouping: unplayable, by: \.rootID)
        for source in sources {
            contents[source.id]?.tracks = tracksByRoot[source.id] ?? []
            contents[source.id]?.missingTracks = missingByRoot[source.id] ?? []
            contents[source.id]?.unplayableTracks = unplayableByRoot[source.id] ?? []
        }
        return .init(sources: sources, tracks: tracks, missingTracks: missing, unplayableTracks: unplayable, bySource: contents)
    }

    public func confirm(_ draft: ImportDraft) throws -> LibrarySnapshot {
        try confirm(draft) { _ in try snapshot() }
    }

    public func confirmChanges(_ draft: ImportDraft) throws -> LibraryChanges {
        try confirm(draft, project: changes(for:))
    }

    private func confirm<Result>(_ draft: ImportDraft, project: (Set<UUID>) throws -> Result) throws -> Result {
        // Query before inserting so an implicit upsert cannot replace stable IDs.
        let key = draft.source.identity
        let matches = try modelContext.fetch(FetchDescriptor<SourceRecord>(predicate: #Predicate { $0.identity == key }))
        let destination = matches.first
        let existing: SourceRecord?
        if let oldID = draft.replaces {
            if let destination, destination.id != oldID { throw FolderError.overlappingSource }
            if let destination {
                existing = destination
            } else {
                guard let original = try modelContext.fetch(FetchDescriptor<SourceRecord>(predicate: #Predicate { $0.id == oldID })).first else {
                    throw FolderError.wrongSource
                }
                let indexed = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.rootID == oldID }))
                let keys = Set(indexed.map(\.key))
                guard draft.audio.contains(where: { keys.contains(AudioRecord.key(oldID, $0.path)) }) else {
                    throw FolderError.wrongSource
                }
                existing = original
            }
        } else {
            existing = destination
        }
        if existing == nil && draft.audio.isEmpty { throw FolderError.nothingToImport }
        do {
            let source: SourceRecord
            if let existing {
                source = existing
                source.identity = key
                source.name = draft.source.name
                source.bookmark = draft.source.bookmark
                source.lastScan = Date()
            } else {
                source = SourceRecord(draft.source)
                modelContext.insert(source)
            }
            let root = source.id
            let records = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.rootID == root }))
            var byPath = Dictionary(records.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
            let excluded = try modelContext.fetch(FetchDescriptor<ExcludedAudioRecord>(predicate: #Predicate { $0.rootID == root }))
            let excludedKeys = Set(excluded.map(\.key))
            let states = try modelContext.fetch(FetchDescriptor<TrackCatalogState>(predicate: #Predicate { $0.rootID == root }))
            let stateByID = Dictionary(uniqueKeysWithValues: states.map { ($0.trackID, $0) })
            let facts = try modelContext.fetch(FetchDescriptor<TrackScanFacts>(predicate: #Predicate { $0.rootID == root }))
            var factsByID = Dictionary(uniqueKeysWithValues: facts.map { ($0.trackID, $0) })
            func scanFacts(for id: UUID) -> TrackScanFacts {
                if let facts = factsByID[id] { return facts }
                let facts = TrackScanFacts(trackID: id, rootID: root)
                modelContext.insert(facts)
                factsByID[id] = facts
                return facts
            }
            func clearMissing(_ id: UUID) {
                if let state = stateByID[id], state.missing {
                    state.missing = false
                    if state.isEmpty { modelContext.delete(state) }
                }
            }
            let scannedKeys = Set(draft.audio.map { AudioRecord.key(root, $0.path) })
            for record in records where !scannedKeys.contains(record.key) {
                guard let path = RelativeAudioPath(record.path) else { continue }
                if draft.provesUnplayable(path) {
                    clearMissing(record.id)
                    scanFacts(for: record.id).unplayable = true
                } else if draft.provesMissing(path) {
                    if let state = stateByID[record.id] { state.missing = true }
                    else {
                        let state = TrackCatalogState(trackID: record.id, rootID: root)
                        state.missing = true
                        modelContext.insert(state)
                    }
                }
            }
            for song in draft.audio {
                let key = AudioRecord.key(root, song.path)
                guard !excludedKeys.contains(key) else { continue }
                let record: AudioRecord
                if let old = byPath[key] {
                    record = old
                    record.update(song)
                    clearMissing(record.id)
                } else {
                    record = AudioRecord(song, rootID: root)
                    modelContext.insert(record)
                    byPath[key] = record
                }
                if song.embeddedTags != nil || factsByID[record.id] != nil {
                    let facts = scanFacts(for: record.id)
                    facts.hasOriginalTags = song.embeddedTags != nil
                    facts.unplayable = false
                }
            }
            let result = try project([root])
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Only changes the local catalog. Nil, blank or unchanged input uses the automatic value.
    public func setDisplayNames(for id: UUID, title: String?, artist: String?) throws -> LibrarySnapshot {
        try setDisplayNames(for: id, title: title, artist: artist) { _ in try snapshot() }
    }

    public func setDisplayNameChanges(for id: UUID, title: String?, artist: String?) throws -> LibraryChanges {
        try setDisplayNames(for: id, title: title, artist: artist, project: changes(for:))
    }

    private func setDisplayNames<Result>(for id: UUID, title: String?, artist: String?,
                                         project: (Set<UUID>) throws -> Result) throws -> Result {
        do {
            guard let record = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.id == id })).first else {
                return try project([])
            }
            let root = record.rootID
            let source = try modelContext.fetch(FetchDescriptor<SourceRecord>(predicate: #Predicate { $0.id == root })).first
            let existing = try modelContext.fetch(FetchDescriptor<TrackCatalogState>(predicate: #Predicate { $0.trackID == id })).first
            let facts = try modelContext.fetch(FetchDescriptor<TrackScanFacts>(predicate: #Predicate { $0.trackID == id })).first
            let automatic = record.value(sourceName: source?.name, hasOriginalTags: facts?.hasOriginalTags == true)?.automaticMetadata
            func override(_ value: String?, replacing fallback: String?) -> String? {
                guard let name = value?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty, name != fallback else { return nil }
                return name
            }
            let state = existing ?? TrackCatalogState(trackID: id, rootID: root)
            state.displayTitle = override(title, replacing: automatic?.title)
            state.displayArtist = override(artist, replacing: automatic?.artist)
            if state.isEmpty {
                if existing != nil { modelContext.delete(state) }
            } else if existing == nil { modelContext.insert(state) }
            let result = try project([root])
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    public func removeTrack(_ id: UUID) throws -> LibrarySnapshot { try removeTracks([id]) }

    /// Album and artist removal share one atomic transaction with single-track removal.
    public func removeTracks(_ ids: Set<UUID>) throws -> LibrarySnapshot {
        try removeTracks(ids) { _ in try snapshot() }
    }

    public func removeTrackChanges(_ ids: Set<UUID>) throws -> LibraryChanges {
        try removeTracks(ids, project: changes(for:))
    }

    private func removeTracks<Result>(_ ids: Set<UUID>, project: (Set<UUID>) throws -> Result) throws -> Result {
        do {
            let requested = Array(ids)
            var roots = Set<UUID>()
            // Keep SQL bindings bounded even when removing a large catalog group.
            for offset in stride(from: 0, to: requested.count, by: 250) {
                let batch = Array(requested[offset..<min(offset + 250, requested.count)])
                let records = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { batch.contains($0.id) }))
                try modelContext.fetch(FetchDescriptor<TrackCatalogState>(predicate: #Predicate { batch.contains($0.trackID) }))
                    .forEach(modelContext.delete)
                try modelContext.fetch(FetchDescriptor<TrackScanFacts>(predicate: #Predicate { batch.contains($0.trackID) }))
                    .forEach(modelContext.delete)
                for record in records {
                    roots.insert(record.rootID)
                    modelContext.insert(ExcludedAudioRecord(key: record.key, rootID: record.rootID))
                    modelContext.delete(record)
                }
            }
            let result = try project(roots)
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Restore selected, successfully scanned exclusions without applying other scan changes.
    public func restoreExcluded(_ paths: [RelativeAudioPath], from draft: ImportDraft) throws -> LibrarySnapshot {
        try restoreExcluded(paths, from: draft) { _ in try snapshot() }
    }

    public func restoreExcludedChanges(_ paths: [RelativeAudioPath], from draft: ImportDraft) throws -> LibraryChanges {
        try restoreExcluded(paths, from: draft, project: changes(for:))
    }

    private func restoreExcluded<Result>(_ paths: [RelativeAudioPath], from draft: ImportDraft,
                                         project: (Set<UUID>) throws -> Result) throws -> Result {
        let identity = draft.source.identity
        guard draft.replaces == nil, !paths.isEmpty,
              let source = try modelContext.fetch(FetchDescriptor<SourceRecord>(predicate: #Predicate { $0.identity == identity })).first else {
            throw FolderError.scanChanged
        }
        let root = source.id
        let keys = Set(paths.map { AudioRecord.key(root, $0) })
        let exclusions = try modelContext.fetch(FetchDescriptor<ExcludedAudioRecord>(predicate: #Predicate { $0.rootID == root }))
        let selected = exclusions.filter { keys.contains($0.key) }
        let scanned = draft.audio.filter { keys.contains(AudioRecord.key(root, $0.path)) }
        let indexed = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.rootID == root }))
        guard selected.count == keys.count, scanned.count == keys.count,
              Set(scanned.map { AudioRecord.key(root, $0.path) }) == keys,
              !indexed.contains(where: { keys.contains($0.key) }) else { throw FolderError.scanChanged }
        do {
            selected.forEach(modelContext.delete)
            for song in scanned {
                let record = AudioRecord(song, rootID: root)
                modelContext.insert(record)
                if song.embeddedTags != nil {
                    let facts = TrackScanFacts(trackID: record.id, rootID: root)
                    facts.hasOriginalTags = true
                    modelContext.insert(facts)
                }
            }
            let result = try project([root])
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    public func removeSource(_ id: UUID) throws -> LibrarySnapshot {
        try removeSource(id) { _ in try snapshot() }
    }

    public func removeSourceChanges(_ id: UUID) throws -> LibraryChanges {
        try removeSource(id, project: changes(for:))
    }

    private func removeSource<Result>(_ id: UUID, project: (Set<UUID>) throws -> Result) throws -> Result {
        do {
            let tracks = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.rootID == id }))
            let sources = try modelContext.fetch(FetchDescriptor<SourceRecord>(predicate: #Predicate { $0.id == id }))
            let exclusions = try modelContext.fetch(FetchDescriptor<ExcludedAudioRecord>(predicate: #Predicate { $0.rootID == id }))
            try modelContext.fetch(FetchDescriptor<TrackCatalogState>(predicate: #Predicate { $0.rootID == id }))
                .forEach(modelContext.delete)
            try modelContext.fetch(FetchDescriptor<TrackScanFacts>(predicate: #Predicate { $0.rootID == id }))
                .forEach(modelContext.delete)
            tracks.forEach(modelContext.delete)
            exclusions.forEach(modelContext.delete)
            sources.forEach(modelContext.delete)
            try removeOrphanedRecords()
            let result = try project([id])
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
