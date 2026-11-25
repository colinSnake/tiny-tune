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

    func testReopeningExistingSchemaUsesFileNamesWithoutChangingTrackIdentity() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let location = directory.appending(path: "Library.store")
        let path = try XCTUnwrap(RelativeAudioPath("Beyond/灰色轨迹-Beyond.wav"))
        let tagged = TrackMetadata(title: "»ÒÉ«¹ì¼£", artist: "Beyond£¨»Æ¼Ò¾Ô£©", albumArtist: "Tag artist", album: "Tag album")
        let audio = ScannedAudio(path: path, metadata: tagged, duration: 3)
        let source = SourceDraft(name: "Original", identity: "original", bookmark: Data([1]))
        let originalTrackID: UUID
        let originalSourceID: UUID
        do {
            let schema = Schema(versionedSchema: SchemaV1.self)
            let config = ModelConfiguration(schema: schema, url: location, cloudKitDatabase: .none)
            let container = try ModelContainer(for: schema, configurations: config)
            let context = ModelContext(container)
            let root = SourceRecord(source)
            let record = AudioRecord(audio, rootID: root.id)
            context.insert(root)
            context.insert(record)
            try context.save()
            originalTrackID = record.id
            originalSourceID = root.id
        }
        let migrated = try await LibraryStore.open(location: location)
        let current = try await migrated.snapshot()
        XCTAssertEqual(current.sources.first?.id, originalSourceID)
        let track = try XCTUnwrap(current.tracks.first)
        XCTAssertEqual(track.id, originalTrackID)
        XCTAssertEqual(track.metadata.title, "灰色轨迹")
        XCTAssertEqual(track.metadata.artist, "Beyond")
        XCTAssertEqual(track.metadata.album, "Beyond")
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

extension LibraryTests {
    func testReadsEmbeddedTrackAndDiscAcrossFormatsAndKeepsFileOrderPriority() async throws {
        for (ext, number) in [("m4a", 1), ("mp3", 3), ("flac", 3)] {
            let file = try XCTUnwrap(Bundle.module.url(forResource: "Numbered", withExtension: ext, subdirectory: "Fixtures"))
            let path = try XCTUnwrap(RelativeAudioPath("Album/Numbered.\(ext)"))
            let result = try await AudioScanner.inspect(file, path: path)
            XCTAssertEqual(result.metadata.track, number, ext)
            XCTAssertEqual(result.metadata.disc, 2, ext)
            let numbered = try XCTUnwrap(RelativeAudioPath("Album/CD 4/05 Numbered.\(ext)"))
            let overridden = try await AudioScanner.inspect(file, path: numbered)
            XCTAssertEqual(overridden.metadata.track, 5, ext)
            XCTAssertEqual(overridden.metadata.disc, 4, ext)
        }
    }
}

extension LibraryTests {
    func testRescanOnlyMarksProvenMissingPathsAndRestoresIDsAfterReopen() async throws {
        let fm = FileManager.default
        let directory = fm.temporaryDirectory.appending(component: UUID().uuidString, directoryHint: .isDirectory)
        let root = directory.appending(component: "Music", directoryHint: .isDirectory)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: directory) }
        let location = directory.appending(component: "Library.store")
        let source = SourceDraft(name: "Music", identity: "scan-coverage", bookmark: Data())
        let files = ["Gone/Old.mp3", "Present/Corrupt.mp3", "Cloud/Offline.mp3", "Linked/Unseen.mp3"]
        let original = try files.map { file in
            let path = try XCTUnwrap(RelativeAudioPath(file))
            return ScannedAudio(path: path, metadata: .resolve(path, tags: .init()), duration: 3)
        }
        let store = try await LibraryStore.open(location: location)
        let initial = try await store.confirm(.init(source: source, audio: original))
        let vanished = try XCTUnwrap(initial.tracks.first { $0.path.rawValue == files[0] })
        let edited = try await store.setDisplayNames(for: vanished.id, title: "Kept after restore", artist: nil)
        let emptyDraft = try await store.confirm(.init(source: source, audio: []))
        XCTAssertEqual(emptyDraft.tracks, edited.tracks, "A draft without enumeration does not prove absence")
        for folder in ["Present", "Cloud"] {
            try fm.createDirectory(at: root.appending(component: folder), withIntermediateDirectories: false)
        }
        try Data([1]).write(to: root.appending(path: files[1]))
        try Data().write(to: root.appending(path: "Cloud/.Offline.mp3.icloud"))
        try fm.createSymbolicLink(at: root.appending(component: "Linked"), withDestinationURL: directory)
        let report = try await AudioScanner.scanDirectory(root, source: source) { _ in }
        XCTAssertTrue(report.audio.isEmpty)
        XCTAssertTrue(report.provesMissing(vanished.path))
        XCTAssertNoThrow(try AudioScanner.verifyMissing([vanished.path], in: root))
        let missing = try await store.confirm(report)
        XCTAssertEqual(Set(missing.tracks.map(\.path.rawValue)), [files[2], files[3]])
        XCTAssertEqual(missing.unplayableTracks.map(\.path.rawValue), [files[1]])
        XCTAssertEqual(missing.missingTracks.map(\.id), [vanished.id])
        let reopened = try await LibraryStore.open(location: location)
        let afterRestart = try await reopened.snapshot()
        XCTAssertEqual(afterRestart.missingTracks, missing.missingTracks)
        let folder = root.appending(component: "Gone")
        try fm.createDirectory(at: folder, withIntermediateDirectories: false)
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "Numbered", withExtension: "mp3", subdirectory: "Fixtures"))
        try fm.copyItem(at: fixture, to: root.appending(path: vanished.path.rawValue))
        XCTAssertThrowsError(try AudioScanner.verifyMissing([vanished.path], in: root)) {
            XCTAssertEqual($0 as? FolderError, .scanChanged)
        }
        let restored = try await reopened.confirm(AudioScanner.scanDirectory(root, source: source) { _ in })
        XCTAssertTrue(restored.missingTracks.isEmpty)
        let returned = restored.tracks.first { $0.path == vanished.path }
        XCTAssertEqual(returned?.id, vanished.id)
        XCTAssertEqual(returned?.metadata.title, "Kept after restore")

        let renamed = root.appending(path: "Gone/Renamed.mp3")
        try fm.moveItem(at: root.appending(path: vanished.path.rawValue), to: renamed)
        let renamedDraft = try await AudioScanner.scanDirectory(root, source: source) { _ in }
        XCTAssertNoThrow(try AudioScanner.verifyMissing([vanished.path], in: root))
        let renamedLibrary = try await reopened.confirm(renamedDraft)
        XCTAssertFalse(renamedLibrary.tracks.contains { $0.id == vanished.id })
        XCTAssertTrue(renamedLibrary.tracks.contains { $0.path.rawValue == "Gone/Renamed.mp3" })
        XCTAssertEqual(renamedLibrary.missingTracks.map(\.id), [vanished.id])
    }
}

extension LibraryTests {
    func testV2MigrationPreservesExclusionsAndDisplayEditsSurviveRescan() async throws {
        let fm = FileManager.default
        let directory = fm.temporaryDirectory.appending(path: UUID().uuidString)
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: directory) }
        let location = directory.appending(path: "Library.store")
        let source = SourceDraft(name: "Source", identity: "v2", bookmark: Data([1]))
        let path = try XCTUnwrap(RelativeAudioPath("Album/01.wav"))
        let excluded = try XCTUnwrap(RelativeAudioPath("Album/Excluded.wav"))
        let original = ScannedAudio(path: path, metadata: .resolve(path, tags: .init(title: "Before", artist: "Former")), duration: 3)
        let rootID: UUID
        let trackID: UUID
        do {
            let schema = Schema(versionedSchema: SchemaV2.self)
            let config = ModelConfiguration(schema: schema, url: location, cloudKitDatabase: .none)
            let container = try ModelContainer(for: schema, configurations: config)
            let context = ModelContext(container)
            let root = SourceRecord(source)
            let record = AudioRecord(original, rootID: root.id)
            rootID = root.id
            trackID = record.id
            context.insert(root)
            context.insert(record)
            context.insert(ExcludedAudioRecord(key: AudioRecord.key(rootID, excluded), rootID: rootID))
            try context.save()
        }
        let store = try await LibraryStore.open(location: location)
        let before = try await store.snapshot()
        XCTAssertEqual(before.tracks.map(\.id), [trackID])
        XCTAssertTrue(before.isExcluded(excluded, from: rootID))
        let edited = try await store.setDisplayNames(for: trackID, title: "  手动歌名  ", artist: "手动歌手")
        XCTAssertEqual(edited.tracks.first?.metadata.title, "手动歌名")
        XCTAssertEqual(LibraryIndex(tracks: edited.tracks).search(.init("手动歌手")).artists.first?.tracks.map(\.id), [trackID])
        let changed = ScannedAudio(path: path, metadata: .resolve(path, tags: .init(title: "After", artist: "New")), duration: 4)
        let rescan = try await store.confirm(.init(source: source, audio: [changed]))
        let row = try XCTUnwrap(rescan.tracks.first)
        XCTAssertEqual(row.id, trackID)
        XCTAssertEqual(row.metadata.title, "手动歌名")
        XCTAssertEqual(row.metadata.artist, "手动歌手")
        XCTAssertEqual(row.metadata.album, "Album")
        XCTAssertEqual(row.automaticMetadata.title, "After")
        let reopened = try await LibraryStore.open(location: location)
        let persisted = try await reopened.snapshot()
        XCTAssertEqual(persisted.tracks, rescan.tracks)
        let reset = try await reopened.setDisplayNames(for: trackID, title: nil, artist: nil)
        XCTAssertEqual(reset.tracks.first?.metadata.title, "After")
        XCTAssertEqual(reset.tracks.first?.metadata.artist, "New")
        XCTAssertTrue(reset.isExcluded(excluded, from: rootID))
    }
}
