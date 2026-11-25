import Domain
import Foundation
@testable import Library
import SwiftData
import XCTest

@MainActor
final class SourceRemovalTests: XCTestCase {
    func testReopeningPurgesRecordsWhoseSourceNoLongerExists() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let location = directory.appending(path: "Library.store")
        let path = try XCTUnwrap(RelativeAudioPath("Beyond/Album/Song.wav"))
        let song = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
        let source = SourceDraft(name: "Music", identity: "kept-source", bookmark: Data([1]))
        let orphanRoot = UUID()
        let keptID: UUID
        do {
            let library = try await LibraryStore.open(location: location)
            let first = try await library.confirm(.init(source: source, audio: [song]))
            keptID = try XCTUnwrap(first.tracks.first?.id)
            try await library.seedOrphan(song, rootID: orphanRoot)
            let current = try await library.snapshot()
            XCTAssertEqual(current.tracks.map(\.id), [keptID])
            XCTAssertTrue(current.missingTracks.isEmpty)
            XCTAssertTrue(current.unplayableTracks.isEmpty)
        }
        let reopened = try await LibraryStore.open(location: location)
        let snapshot = try await reopened.snapshot()
        XCTAssertEqual(snapshot.tracks.map(\.id), [keptID])
        XCTAssertTrue(snapshot.missingTracks.isEmpty)
        XCTAssertTrue(snapshot.unplayableTracks.isEmpty)
        XCTAssertEqual(snapshot.excludedCount(for: orphanRoot), 0)
        let counts = try await reopened.recordCounts(for: orphanRoot)
        XCTAssertEqual(counts, [0, 0, 0, 0], "Delete persisted orphans, not just their presentation")
        let imported = try await reopened.confirm(.init(
            source: .init(name: "Old folder", identity: "removed-source", bookmark: Data([2])), audio: [song]))
        XCTAssertEqual(imported.tracks.count, 2)
        XCTAssertFalse(imported.tracks.contains { $0.rootID == orphanRoot })
    }

    func testRemovingThenReimportingSourceStartsFreshAndPreservesOtherSources() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let location = directory.appending(path: "Library.store")
        let path = try XCTUnwrap(RelativeAudioPath("Beyond/Album/Song.wav"))
        let removedPath = try XCTUnwrap(RelativeAudioPath("Beyond/Album/Removed.wav"))
        let song = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
        let excluded = ScannedAudio(path: removedPath, metadata: .resolve(removedPath, tags: .init()), duration: 5)
        let source = SourceDraft(name: "Music", identity: "reimported-source", bookmark: Data([1]))
        let rootID: UUID
        let originalIDs: Set<UUID>
        let keptID: UUID
        do {
            let library = try await LibraryStore.open(location: location)
            let first = try await library.confirm(.init(source: source, audio: [song, excluded]))
            rootID = try XCTUnwrap(first.sources.first?.id)
            originalIDs = Set(first.tracks.map(\.id))
            let row = try XCTUnwrap(first.tracks.first { $0.path == path })
            _ = try await library.setDisplayNames(for: row.id, title: "Old title", artist: "Old artist")
            _ = try await library.removeTrack(try XCTUnwrap(first.tracks.first { $0.path == removedPath }?.id))
            let other = try await library.confirm(.init(
                source: .init(name: "Other", identity: "other-source", bookmark: Data([2])), audio: [song]))
            keptID = try XCTUnwrap(other.tracks.first { $0.rootID != rootID }?.id)
            let removed = try await library.removeSource(rootID)
            XCTAssertEqual(removed.tracks.map(\.id), [keptID])
            XCTAssertEqual(removed.excludedCount(for: rootID), 0)
            let counts = try await library.recordCounts(for: rootID)
            XCTAssertEqual(counts, [0, 0, 0, 0])
        }
        let reopened = try await LibraryStore.open(location: location)
        let before = try await reopened.snapshot()
        XCTAssertEqual(before.tracks.map(\.id), [keptID])
        let reimported = try await reopened.confirm(.init(source: source, audio: [song, excluded]))
        let fresh = reimported.tracks.filter { $0.rootID != before.sources.first?.id }
        XCTAssertEqual(fresh.count, 2)
        XCTAssertFalse(fresh.contains { originalIDs.contains($0.id) || $0.rootID == rootID })
        XCTAssertFalse(fresh.contains { $0.metadata.title == "Old title" || $0.metadata.artist == "Old artist" })
        XCTAssertEqual(reimported.tracks.filter { $0.id == keptID }.count, 1)
    }
}

private extension LibraryStore {
    func seedOrphan(_ song: ScannedAudio, rootID: UUID) throws {
        let record = AudioRecord(song, rootID: rootID)
        modelContext.insert(record)
        let state = TrackCatalogState(trackID: record.id, rootID: rootID)
        state.displayArtist = "Old orphan artist"
        modelContext.insert(state)
        modelContext.insert(TrackScanFacts(trackID: record.id, rootID: rootID))
        let excluded = RelativeAudioPath("Removed.wav")!
        modelContext.insert(ExcludedAudioRecord(key: AudioRecord.key(rootID, excluded), rootID: rootID))
        for missing in [true, false] {
            let path = RelativeAudioPath(missing ? "Missing.wav" : "Unplayable.wav")!
            let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
            let inactive = AudioRecord(audio, rootID: rootID)
            modelContext.insert(inactive)
            let inactiveState = TrackCatalogState(trackID: inactive.id, rootID: rootID)
            inactiveState.missing = missing
            modelContext.insert(inactiveState)
            let facts = TrackScanFacts(trackID: inactive.id, rootID: rootID)
            facts.unplayable = !missing
            modelContext.insert(facts)
        }
        try modelContext.save()
    }

    func recordCounts(for root: UUID) throws -> [Int] {
        try [
            modelContext.fetchCount(FetchDescriptor<AudioRecord>(predicate: #Predicate { $0.rootID == root })),
            modelContext.fetchCount(FetchDescriptor<TrackCatalogState>(predicate: #Predicate { $0.rootID == root })),
            modelContext.fetchCount(FetchDescriptor<TrackScanFacts>(predicate: #Predicate { $0.rootID == root })),
            modelContext.fetchCount(FetchDescriptor<ExcludedAudioRecord>(predicate: #Predicate { $0.rootID == root })),
        ]
    }
}
