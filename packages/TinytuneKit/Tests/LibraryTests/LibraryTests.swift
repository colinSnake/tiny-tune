import Domain
import Foundation
@testable import Library
import SwiftData
import XCTest

@MainActor
final class LibraryTests: XCTestCase {
    func testRemovedTrackStaysExcludedAfterReopenAndRescanButCanReturnWithNewSource() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let location = directory.appending(path: "Library.store")
        let path = try XCTUnwrap(RelativeAudioPath("Album/Track.wav"))
        let originalFile = directory.appending(path: path.rawValue)
        try FileManager.default.createDirectory(at: originalFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        let fileContents = Data([12, 34, 56])
        try fileContents.write(to: originalFile)
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
        let source = SourceDraft(name: "Music", identity: "folder-A", bookmark: Data([12]))
        let other = SourceDraft(name: "Other", identity: "folder-B", bookmark: Data([34]))
        let draft = ImportDraft(source: source, audio: [audio])
        let removedID: UUID
        let sourceID: UUID
        do {
            let library = try await LibraryStore.open(location: location)
            let first = try await library.confirm(draft)
            let track = try XCTUnwrap(first.tracks.first)
            removedID = track.id
            sourceID = track.rootID
            let removed = try await library.removeTrack(track.id)
            XCTAssertEqual(removed.sources, first.sources)
            XCTAssertTrue(removed.tracks.isEmpty)
            XCTAssertTrue(removed.isExcluded(path, from: sourceID))
            XCTAssertEqual(try Data(contentsOf: originalFile), fileContents)
        }
        let reopened = try await LibraryStore.open(location: location)
        let rescan = try await reopened.confirm(draft)
        XCTAssertTrue(rescan.tracks.isEmpty)
        XCTAssertTrue(rescan.isExcluded(path, from: sourceID))
        let otherImport = try await reopened.confirm(.init(source: other, audio: [audio]))
        XCTAssertEqual(otherImport.tracks.count, 1)
        XCTAssertNotEqual(otherImport.tracks.first?.rootID, sourceID)
        let removedSource = try await reopened.removeSource(sourceID)
        XCTAssertFalse(removedSource.isExcluded(path, from: sourceID))
        let addedAgain = try await reopened.confirm(draft)
        XCTAssertEqual(addedAgain.tracks.count, 2)
        XCTAssertFalse(addedAgain.tracks.contains { $0.id == removedID })
    }

    func testExistingSchemaKeepsTracksAndSourceIDsWhenOpeningWithExclusions() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let location = directory.appending(path: "Library.store")
        let path = try XCTUnwrap(RelativeAudioPath("Existing.wav"))
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 3)
        let source = SourceDraft(name: "Original", identity: "original", bookmark: Data([1]))
        let original: LibrarySnapshot
        do {
            let schema = Schema(versionedSchema: SchemaV1.self)
            let config = ModelConfiguration(schema: schema, url: location, cloudKitDatabase: .none)
            let container = try ModelContainer(for: schema, configurations: config)
            let library = LibraryStore(modelContainer: container)
            let context = ModelContext(container)
            let root = SourceRecord(source)
            context.insert(root)
            context.insert(AudioRecord(audio, rootID: root.id))
            try context.save()
            original = try await library.snapshot()
        }
        let migrated = try await LibraryStore.open(location: location)
        let current = try await migrated.snapshot()
        XCTAssertEqual(current.sources, original.sources)
        XCTAssertEqual(current.tracks, original.tracks)
        let track = try XCTUnwrap(current.tracks.first)
        let after = try await migrated.removeTrack(track.id)
        XCTAssertTrue(after.tracks.isEmpty)
        XCTAssertTrue(after.isExcluded(path, from: track.rootID))
    }

    func testDraftAndDuplicateImportPreserveIdentity() async throws {
        let library = try await LibraryStore.open(inMemory: true)
        let path = try XCTUnwrap(RelativeAudioPath("Artist/Album/03 Track.wav"))
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
        let source = SourceDraft(name: "Music", identity: "folder-A", bookmark: Data([12, 34]))
        let before = try await library.snapshot()
        XCTAssertTrue(before.tracks.isEmpty)
        let first = try await library.confirm(.init(source: source, audio: [audio]))
        let second = try await library.confirm(.init(source: source, audio: [audio]))
        XCTAssertEqual(first.tracks.count, 1)
        XCTAssertEqual(second.tracks.count, 1)
        XCTAssertEqual(first.tracks.first?.id, second.tracks.first?.id)
        XCTAssertEqual(first.tracks.first?.dateAdded, second.tracks.first?.dateAdded)
        XCTAssertEqual(first.sources.first?.id, second.sources.first?.id)
    }

    func testRejectWrongReauthorizationWithoutChangingLibrary() async throws {
        let library = try await LibraryStore.open(inMemory: true)
        let path = try XCTUnwrap(RelativeAudioPath("test.wav"))
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
        let before = try await library.confirm(.init(source: .init(name: "Music", identity: "original", bookmark: Data([1])), audio: [audio]))
        let sourceID = try XCTUnwrap(before.sources.first?.id)
        let unrelated = try XCTUnwrap(RelativeAudioPath("Other/test.wav"))
        let unrelatedAudio = ScannedAudio(path: unrelated, metadata: .resolve(unrelated, tags: .init()), duration: 5)
        do {
            _ = try await library.confirm(.init(source: .init(name: "Other", identity: "different", bookmark: Data([2])), audio: [unrelatedAudio], replaces: sourceID))
            XCTFail("The same basename at an unrelated path must not replace the existing source")
        } catch FolderError.wrongSource { }
        let after = try await library.snapshot()
        XCTAssertEqual(before.sources, after.sources)
    }

    func testReconnectRebuiltFolderPreservesSourceAndTrackIDs() async throws {
        let library = try await LibraryStore.open(inMemory: true)
        let path = try XCTUnwrap(RelativeAudioPath("Album/tone.mp3"))
        let missing = try XCTUnwrap(RelativeAudioPath("Album/missing.mp3"))
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 63)
        let oldAudio = ScannedAudio(path: missing, metadata: .resolve(missing, tags: .init()), duration: 8)
        let old = SourceDraft(name: "Original", identity: "old-container", bookmark: Data([1]))
        let rebuilt = SourceDraft(name: "Rebuilt", identity: "new-container", bookmark: Data([2]))
        let before = try await library.confirm(.init(source: old, audio: [audio, oldAudio]))
        let sourceID = try XCTUnwrap(before.sources.first?.id)
        let draft = ImportDraft(source: rebuilt, audio: [audio], replaces: sourceID)
        let after = try await library.confirm(draft)
        XCTAssertEqual(after.sources.count, 1)
        XCTAssertEqual(after.sources.first?.id, sourceID)
        XCTAssertEqual(after.sources.first?.name, rebuilt.name)
        XCTAssertEqual(after.sources.first?.identity, rebuilt.identity)
        XCTAssertEqual(after.sources.first?.bookmark, rebuilt.bookmark)
        XCTAssertEqual(after.tracks, before.tracks)
        let rescan = try await library.confirm(.init(source: rebuilt, audio: [audio]))
        XCTAssertEqual(rescan.sources.count, 1)
        XCTAssertEqual(rescan.tracks, before.tracks)
    }

    func testReconnectCannotTakeOverAnotherIndexedSource() async throws {
        let library = try await LibraryStore.open(inMemory: true)
        let path = try XCTUnwrap(RelativeAudioPath("tone.mp3"))
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 63)
        let old = SourceDraft(name: "Original", identity: "old-container", bookmark: Data([1]))
        let other = SourceDraft(name: "Other", identity: "other-container", bookmark: Data([2]))
        let first = try await library.confirm(.init(source: old, audio: [audio]))
        let before = try await library.confirm(.init(source: other, audio: [audio]))
        let id = try XCTUnwrap(first.sources.first?.id)
        do {
            _ = try await library.confirm(.init(source: other, audio: [audio], replaces: id))
            XCTFail("A matching relative path must not take over another indexed source")
        } catch FolderError.overlappingSource { }
        let after = try await library.snapshot()
        XCTAssertEqual(after.sources, before.sources)
        XCTAssertEqual(Set(after.tracks.map(\.id)), Set(before.tracks.map(\.id)))
    }

    func testRejectPathThatTraversesSymlink() throws {
        let fm = FileManager.default
        let temp = fm.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? fm.removeItem(at: temp) }
        let root = temp.appending(path: "root", directoryHint: .isDirectory)
        let other = temp.appending(path: "other", directoryHint: .isDirectory)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        try fm.createDirectory(at: other, withIntermediateDirectories: true)
        try Data([1]).write(to: other.appending(path: "tone.mp3"))
        try fm.createSymbolicLink(at: root.appending(path: "link"), withDestinationURL: other)
        let path = try XCTUnwrap(RelativeAudioPath("link/tone.mp3"))
        XCTAssertThrowsError(try FolderAccess.readableFile(in: root, at: path))
    }
}

extension LibraryTests {
    func testReadsRealPCMAndRejectsBrokenAudio() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        // Mono 16-bit PCM, 8 kHz, a half-second of silence.
        let bytes: [UInt8] = [82, 73, 70, 70, 100, 31, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
                              16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0,
                              2, 0, 16, 0, 100, 97, 116, 97, 64, 31, 0, 0]
        let valid = try XCTUnwrap(RelativeAudioPath("01 Track.wav"))
        let file = folder.appending(path: valid.rawValue)
        try (Data(bytes) + Data(count: 8_000)).write(to: file)
        let result = try await AudioScanner.inspect(file, path: valid)
        XCTAssertEqual(result.metadata.title, "Track")
        XCTAssertEqual(result.duration, 0.5, accuracy: 0.05)
        try Data("not a wave file".utf8).write(to: file, options: .atomic)
        do {
            _ = try await AudioScanner.inspect(file, path: valid)
            XCTFail("Rejected audio was accepted based only on its extension")
        } catch { }
    }

    func testLibraryReopensFromDiskAndRemovingSourceDoesNotRemoveOriginal() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let original = folder.appending(path: "test.wav")
        let bytes = Data("read-only original fixture".utf8)
        try bytes.write(to: original)
        let store = folder.appending(path: "test.store")
        let path = try XCTUnwrap(RelativeAudioPath("test.wav"))
        let audio = ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 5)
        let draft = ImportDraft(source: .init(name: "Music", identity: "source", bookmark: Data([1, 2])), audio: [audio])
        let first = try await storeDraft(draft, location: store)
        let reopened = try await LibraryStore.open(location: store)
        let before = try await reopened.snapshot()
        XCTAssertEqual(first.tracks, before.tracks)
        XCTAssertEqual(first.sources, before.sources)
        let removed = try await reopened.removeSource(try XCTUnwrap(before.sources.first?.id))
        XCTAssertTrue(removed.sources.isEmpty)
        XCTAssertTrue(removed.tracks.isEmpty)
        XCTAssertEqual(try Data(contentsOf: original), bytes)
    }

    private func storeDraft(_ draft: ImportDraft, location: URL) async throws -> LibrarySnapshot {
        try await LibraryStore.open(location: location).confirm(draft)
    }
}
