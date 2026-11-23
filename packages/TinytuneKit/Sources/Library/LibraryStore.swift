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
    private let exclusions: Set<String>

    public init(sources: [MusicSource] = [], tracks: [Track] = []) {
        self.init(sources: sources, tracks: tracks, exclusions: [])
    }

    fileprivate init(sources: [MusicSource], tracks: [Track], exclusions: Set<String>) {
        self.sources = sources
        self.tracks = tracks
        self.exclusions = exclusions
    }

    public func isExcluded(_ path: RelativeAudioPath, from sourceID: UUID) -> Bool {
        exclusions.contains(AudioRecord.key(sourceID, path))
    }
}

enum SchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] { [SourceRecord.self, AudioRecord.self] }
}

private enum SchemaV2: VersionedSchema {
    static let versionIdentifier = Schema.Version(2, 0, 0)
    static var models: [any PersistentModel.Type] { SchemaV1.models + [ExcludedAudioRecord.self] }
}

private enum LibraryMigrations: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [SchemaV1.self, SchemaV2.self] }
    static var stages: [MigrationStage] { [.lightweight(fromVersion: SchemaV1.self, toVersion: SchemaV2.self)] }
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
        title = audio.metadata.title
        artist = audio.metadata.artist
        albumArtist = audio.metadata.albumArtist
        album = audio.metadata.album
        track = audio.metadata.track
        disc = audio.metadata.disc
        duration = audio.duration
        artworkKey = audio.artworkKey
    }

    var value: Track? {
        guard let path = RelativeAudioPath(path) else { return nil }
        return .init(id: id, rootID: rootID, path: path,
                     metadata: .init(title: title, artist: artist, albumArtist: albumArtist, album: album, track: track, disc: disc),
                     duration: duration, dateAdded: dateAdded, artworkKey: artworkKey)
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

@ModelActor
public actor LibraryStore {
    public static func open(inMemory: Bool = false, location: URL? = nil) async throws -> LibraryStore {
        try await Task.detached(priority: .userInitiated) {
            let schema = Schema(versionedSchema: SchemaV2.self)
            let config: ModelConfiguration
            if let location {
                config = .init(schema: schema, url: location, cloudKitDatabase: .none)
            } else {
                config = .init("TinytuneLibrary", schema: schema, isStoredInMemoryOnly: inMemory, cloudKitDatabase: .none)
            }
            let container = try ModelContainer(for: schema, migrationPlan: LibraryMigrations.self, configurations: config)
            let library = LibraryStore(modelContainer: container)
            await library.disableAutosave()
            return library
        }.value
    }

    private func disableAutosave() { modelContext.autosaveEnabled = false }

    public func snapshot() throws -> LibrarySnapshot {
        let sources = try modelContext.fetch(FetchDescriptor<SourceRecord>(sortBy: [SortDescriptor(\.name)])).map(\.value)
        let tracks = try modelContext.fetch(FetchDescriptor<AudioRecord>()).compactMap(\.value).sorted(by: MusicOrdering.byTitle)
        let exclusions = try modelContext.fetch(FetchDescriptor<ExcludedAudioRecord>())
        return .init(sources: sources, tracks: tracks, exclusions: Set(exclusions.map(\.key)))
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
            for song in draft.audio {
                let key = AudioRecord.key(root, song.path)
                guard !excludedKeys.contains(key) else { continue }
                if let record = byPath[key] { record.update(song) }
                else {
                    let record = AudioRecord(song, rootID: root)
                    modelContext.insert(record)
                    byPath[key] = record
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

    public func removeTrack(_ id: UUID) throws -> LibrarySnapshot {
        do {
            guard let record = try modelContext.fetch(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.id == id })).first else {
                return try snapshot()
            }
            modelContext.insert(ExcludedAudioRecord(key: record.key, rootID: record.rootID))
            modelContext.delete(record)
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
            tracks.forEach(modelContext.delete)
            exclusions.forEach(modelContext.delete)
            sources.forEach(modelContext.delete)
            let result = try snapshot()
            try modelContext.save()
            return result
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
