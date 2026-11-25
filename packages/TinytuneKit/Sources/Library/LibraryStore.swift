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
    public let sources: [MusicSource]
    public let tracks: [Track]
    public let missingTracks: [Track]
    public let unplayableTracks: [Track]
    private let inactiveIDs: Set<UUID>
    private let originalTags: [UUID: MusicTags]
    private let exclusions: Set<String>
    private let exclusionCounts: [UUID: Int]

    public init(sources: [MusicSource] = [], tracks: [Track] = []) {
        self.init(sources: sources, tracks: tracks, missingTracks: [], unplayableTracks: [], exclusions: [], exclusionCounts: [:], originalTags: [:])
    }

    fileprivate init(sources: [MusicSource], tracks: [Track], missingTracks: [Track], unplayableTracks: [Track],
                     exclusions: Set<String>, exclusionCounts: [UUID: Int], originalTags: [UUID: MusicTags]) {
        self.sources = sources
        self.tracks = tracks
        self.missingTracks = missingTracks
        self.unplayableTracks = unplayableTracks
        inactiveIDs = Set(missingTracks.map(\.id)).union(unplayableTracks.map(\.id))
        self.originalTags = originalTags
        self.exclusions = exclusions
        self.exclusionCounts = exclusionCounts
    }

    public func isExcluded(_ path: RelativeAudioPath, from sourceID: UUID) -> Bool {
        exclusions.contains(AudioRecord.key(sourceID, path))
    }

    public func excludedCount(for sourceID: UUID) -> Int { exclusionCounts[sourceID, default: 0] }

    /// Raw tags can change without affecting their current presentation (e.g. a newly explicit album credit).
    public func isCurrent(_ track: Track, comparedWith audio: ScannedAudio) -> Bool {
        !inactiveIDs.contains(track.id) && (audio.embeddedTags == nil || originalTags[track.id] == audio.embeddedTags) &&
            track.automaticMetadata == audio.metadata && track.duration == audio.duration && track.artworkKey == audio.artworkKey
    }
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

    public func snapshot() throws -> LibrarySnapshot {
        let sources = try modelContext.fetch(FetchDescriptor<SourceRecord>(sortBy: [SortDescriptor(\.name)])).map(\.value)
        let sourceNames = Dictionary(uniqueKeysWithValues: sources.map { ($0.id, $0.name) })
        let states = try modelContext.fetch(FetchDescriptor<TrackCatalogState>())
        let stateByID = Dictionary(uniqueKeysWithValues: states.map { ($0.trackID, $0) })
        let facts = try modelContext.fetch(FetchDescriptor<TrackScanFacts>())
        let originalTagIDs = Set(facts.filter(\.hasOriginalTags).map(\.trackID))
        let unplayableIDs = Set(facts.filter(\.unplayable).map(\.trackID))
        let records = try modelContext.fetch(FetchDescriptor<AudioRecord>())
        var originalTags: [UUID: MusicTags] = [:]
        var tracks: [Track] = []
        var missing: [Track] = []
        var unplayable: [Track] = []
        for record in records {
            let state = stateByID[record.id]
            let hasOriginalTags = originalTagIDs.contains(record.id)
            guard let sourceName = sourceNames[record.rootID],
                  let value = record.value(sourceName: sourceName, state: state,
                                           hasOriginalTags: hasOriginalTags) else { continue }
            if hasOriginalTags { originalTags[record.id] = record.storedTags }
            if state?.missing == true { missing.append(value) }
            else if unplayableIDs.contains(record.id) { unplayable.append(value) }
            else { tracks.append(value) }
        }
        let exclusions = try modelContext.fetch(FetchDescriptor<ExcludedAudioRecord>())
            .filter { sourceNames[$0.rootID] != nil }
        return .init(sources: sources, tracks: tracks.sorted(by: MusicOrdering.byTitle),
                     missingTracks: missing.sorted(by: MusicOrdering.byTitle),
                     unplayableTracks: unplayable.sorted(by: MusicOrdering.byTitle),
                     exclusions: Set(exclusions.map(\.key)),
                     exclusionCounts: Dictionary(grouping: exclusions, by: \.rootID).mapValues(\.count),
                     originalTags: originalTags)
    }

    public func confirm(_ draft: ImportDraft) throws -> LibrarySnapshot {
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
            let result = try snapshot()
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Only changes the local catalog. Nil, blank or unchanged input uses the automatic value.
    public func setDisplayNames(for id: UUID, title: String?, artist: String?) throws -> LibrarySnapshot {
        do {
            guard let record = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.id == id })).first else {
                return try snapshot()
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
            let result = try snapshot()
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
        do {
            let requested = Array(ids)
            // Keep SQL bindings bounded even when removing a large catalog group.
            for offset in stride(from: 0, to: requested.count, by: 250) {
                let batch = Array(requested[offset..<min(offset + 250, requested.count)])
                let records = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { batch.contains($0.id) }))
                try modelContext.fetch(FetchDescriptor<TrackCatalogState>(predicate: #Predicate { batch.contains($0.trackID) }))
                    .forEach(modelContext.delete)
                try modelContext.fetch(FetchDescriptor<TrackScanFacts>(predicate: #Predicate { batch.contains($0.trackID) }))
                    .forEach(modelContext.delete)
                for record in records {
                    modelContext.insert(ExcludedAudioRecord(key: record.key, rootID: record.rootID))
                    modelContext.delete(record)
                }
            }
            let result = try snapshot()
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Restore selected, successfully scanned exclusions without applying other scan changes.
    public func restoreExcluded(_ paths: [RelativeAudioPath], from draft: ImportDraft) throws -> LibrarySnapshot {
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
            let result = try snapshot()
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    public func removeSource(_ id: UUID) throws -> LibrarySnapshot {
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
            let result = try snapshot()
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
