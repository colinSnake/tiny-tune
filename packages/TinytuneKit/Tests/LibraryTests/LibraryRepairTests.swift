import Domain
import Foundation
@testable import Library
import SwiftData
import XCTest

@MainActor
final class LibraryRepairTests: XCTestCase {
    func testDamagedFileIsNotMissingOrPlayableAndRecoversItsIdentity() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let root = folder.appending(component: "Music", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        let original = try XCTUnwrap(Bundle.module.url(forResource: "Numbered", withExtension: "mp3", subdirectory: "Fixtures"))
        let file = root.appending(component: "Song.mp3")
        let originalData = try Data(contentsOf: original)
        try originalData.write(to: file)
        let location = folder.appending(component: "Library.store")
        let source = SourceDraft(name: "Music", identity: "test-damage", bookmark: Data())
        let store = try await LibraryStore.open(location: location)
        let first = try await store.confirm(AudioScanner.scanDirectory(root, source: source) { _ in })
        let row = try XCTUnwrap(first.tracks.first)
        _ = try await store.setDisplayNames(for: row.id, title: "Edited", artist: nil)

        try Data("not audio".utf8).write(to: file, options: .atomic)
        let draft = try await AudioScanner.scanDirectory(root, source: source) { _ in }
        XCTAssertTrue(draft.audio.isEmpty)
        XCTAssertTrue(draft.provesUnplayable(row.path))
        XCTAssertFalse(draft.provesMissing(row.path))
        try await AudioScanner.verifyUnplayable([row.path], in: root)
        let damaged = try await store.confirm(draft)
        XCTAssertTrue(damaged.tracks.isEmpty)
        XCTAssertTrue(damaged.missingTracks.isEmpty)
        XCTAssertEqual(damaged.unplayableTracks.map(\.id), [row.id])
        XCTAssertFalse(damaged.isExcluded(row.path, from: row.rootID))

        let reopened = try await LibraryStore.open(location: location)
        let persisted = try await reopened.snapshot()
        XCTAssertEqual(persisted.unplayableTracks.map(\.id), [row.id])
        try originalData.write(to: file, options: .atomic)
        do {
            try await AudioScanner.verifyUnplayable([row.path], in: root)
            XCTFail("A repaired file must invalidate the damage preview")
        } catch FolderError.scanChanged { }
        let repaired = try await reopened.confirm(AudioScanner.scanDirectory(root, source: source) { _ in })
        XCTAssertTrue(repaired.unplayableTracks.isEmpty)
        XCTAssertEqual(repaired.tracks.first?.id, row.id)
        XCTAssertEqual(repaired.tracks.first?.metadata.title, "Edited")
        XCTAssertEqual(try Data(contentsOf: file), originalData)
    }

    func testLegacyFolderCreditIsProvisionalAndSameVisibleTagsCanBeRefreshed() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let location = folder.appending(component: "Library.store")
        let source = SourceDraft(name: "Music", identity: "test-legacy", bookmark: Data())
        let path = try XCTUnwrap(RelativeAudioPath("精选/Song.mp3"))
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "Numbered", withExtension: "mp3", subdirectory: "Fixtures"))
        let fresh = try await AudioScanner.inspect(fixture, path: path, sourceName: source.name)
        let stale = ScannedAudio(path: path, metadata: .init(title: "Song", artist: "Beyoncé", albumArtist: "精选", album: "精选", track: 3, disc: 2), duration: fresh.duration)
        let excluded = try XCTUnwrap(RelativeAudioPath("精选/Excluded.mp3"))
        let id: UUID
        do {
            let schema = Schema(versionedSchema: SchemaV2.self)
            let config = ModelConfiguration(schema: schema, url: location, cloudKitDatabase: .none)
            let container = try ModelContainer(for: schema, configurations: config)
            let context = ModelContext(container)
            let original = SourceRecord(source)
            let row = AudioRecord(stale, rootID: original.id)
            id = row.id
            context.insert(original)
            context.insert(row)
            context.insert(ExcludedAudioRecord(key: AudioRecord.key(original.id, excluded), rootID: original.id))
            try context.save()
        }
        let store = try await LibraryStore.open(location: location)
        let before = try await store.snapshot()
        let row = try XCTUnwrap(before.tracks.first)
        XCTAssertEqual(row.id, id)
        XCTAssertEqual(row.automaticMetadata, fresh.metadata)
        XCTAssertTrue(LibraryIndex(tracks: before.tracks).search(.init("精选")).artists.isEmpty)
        XCTAssertFalse(before.isCurrent(row, comparedWith: fresh), "Even unchanged display metadata must allow a one-time tag refresh")
        _ = try await store.setDisplayNames(for: id, title: "Edited", artist: nil)
        let refreshed = try await store.confirm(.init(source: source, audio: [fresh]))
        let after = try XCTUnwrap(refreshed.tracks.first)
        XCTAssertEqual(after.id, id)
        XCTAssertEqual(after.metadata.title, "Edited")
        XCTAssertTrue(refreshed.isExcluded(excluded, from: after.rootID))
        XCTAssertTrue(refreshed.isCurrent(after, comparedWith: fresh))
    }

    func testRescanPreservesRealAlbumCreditThatMatchesTheFolderName() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "AlbumCredit", withExtension: "m4a", subdirectory: "Fixtures"))
        let path = try XCTUnwrap(RelativeAudioPath("精选/Song.m4a"))
        let source = SourceDraft(name: "Music", identity: "test-album-credit", bookmark: Data())
        let audio = try await AudioScanner.inspect(fixture, path: path, sourceName: source.name)
        let store = try await LibraryStore.open(inMemory: true)
        let first = try await store.confirm(.init(source: source, audio: [audio]))
        let row = try XCTUnwrap(first.tracks.first)
        XCTAssertEqual(row.metadata.artist, "Beyoncé")
        XCTAssertEqual(row.metadata.albumArtist, "精选")
        let edited = try await store.setDisplayNames(for: row.id, title: nil, artist: "Edited performer")
        XCTAssertEqual(edited.tracks.first?.metadata.artist, "Edited performer")
        XCTAssertEqual(edited.tracks.first?.metadata.albumArtist, "精选")
    }

    func testV3MigrationPreservesMissingRecordsAndTheirCustomNames() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let location = folder.appending(component: "Library.store")
        let source = SourceDraft(name: "Music", identity: "test-v3", bookmark: Data())
        let path = try XCTUnwrap(RelativeAudioPath("Album/Song.mp3"))
        let id: UUID
        do {
            let schema = Schema(versionedSchema: SchemaV3.self)
            let config = ModelConfiguration(schema: schema, url: location, cloudKitDatabase: .none)
            let container = try ModelContainer(for: schema, configurations: config)
            let context = ModelContext(container)
            let original = SourceRecord(source)
            let row = AudioRecord(.init(path: path, metadata: .resolve(path, tags: .init()), duration: 5), rootID: original.id)
            id = row.id
            let state = TrackCatalogState(trackID: id, rootID: original.id)
            state.missing = true
            state.displayTitle = "Original custom title"
            context.insert(original)
            context.insert(row)
            context.insert(state)
            try context.save()
        }
        let after = try await LibraryStore.open(location: location).snapshot()
        XCTAssertTrue(after.tracks.isEmpty)
        XCTAssertTrue(after.unplayableTracks.isEmpty)
        XCTAssertEqual(after.missingTracks.first?.id, id)
        XCTAssertEqual(after.missingTracks.first?.metadata.title, "Original custom title")
    }

    func testNumericFilenamesStayOrderedBeyondNineWithoutTreatingYearsAsTrackNumbers() throws {
        let root = UUID()
        let rows = try [("09", "Middle"), ("10", "Zebra"), ("11", "Apple")].map { file, title in
            let path = try XCTUnwrap(RelativeAudioPath("Album/\(file).wav"))
            return Track(rootID: root, path: path, metadata: .resolve(path, tags: .init(title: title)), duration: 1)
        }
        XCTAssertEqual(LibraryIndex(tracks: rows).albums.first?.tracks.map(\.id), rows.map(\.id))
        let ten = rows[1].path
        XCTAssertEqual(TrackMetadata.resolve(ten, tags: .init(title: "Zebra", track: 12)).track, 12)
        XCTAssertNil(TrackMetadata.resolve(ten, tags: .init()).track)
        XCTAssertNil(TrackMetadata.resolve(try XCTUnwrap(RelativeAudioPath("Album/1989.wav")), tags: .init(title: "A Title")).track)
    }

    func testRescanDetectsNewExplicitAlbumCreditEvenWithIdenticalDisplayValues() async throws {
        let source = SourceDraft(name: "Music", identity: "credit-change", bookmark: Data())
        let path = try XCTUnwrap(RelativeAudioPath("Album/Song.m4a"))
        let before = try await AudioScanner.inspect(fixture("Review-base"), path: path, sourceName: source.name)
        let after = try await AudioScanner.inspect(fixture("Review-explicit"), path: path, sourceName: source.name)
        XCTAssertEqual(before.metadata, after.metadata)
        XCTAssertEqual(before.duration, after.duration)
        XCTAssertNil(before.embeddedTags?.albumArtist)
        XCTAssertEqual(after.embeddedTags?.albumArtist, "Original")
        let store = try await LibraryStore.open(inMemory: true)
        let original = try await store.confirm(.init(source: source, audio: [before]))
        let track = try XCTUnwrap(original.tracks.first)
        XCTAssertTrue(original.isCurrent(track, comparedWith: before))
        XCTAssertFalse(original.isCurrent(track, comparedWith: after))
        let edited = try await store.setDisplayNames(for: track.id, title: nil, artist: "Edited")
        XCTAssertFalse(edited.isCurrent(try XCTUnwrap(edited.tracks.first), comparedWith: after))
        let latest = try await store.confirm(.init(source: source, audio: [after]))
        let refreshed = try XCTUnwrap(latest.tracks.first)
        XCTAssertEqual(refreshed.id, track.id)
        XCTAssertEqual(refreshed.metadata.artist, "Edited")
        XCTAssertEqual(refreshed.metadata.albumArtist, "Original")
        XCTAssertTrue(latest.isCurrent(refreshed, comparedWith: after))
    }

    func testEditingPerformerDoesNotRetainFallbackCreditFromUnreadableAlbumTag() async throws {
        let path = try XCTUnwrap(RelativeAudioPath("Album/Song.m4a"))
        let source = SourceDraft(name: "Music", identity: "unreadable-credit", bookmark: Data())
        let audio = try await AudioScanner.inspect(fixture("Review-broken-tag"), path: path, sourceName: source.name)
        XCTAssertEqual(audio.embeddedTags?.albumArtist, "»ÒÉ«¹ì¼£")
        XCTAssertEqual(audio.metadata.albumArtist, "Original")
        let store = try await LibraryStore.open(inMemory: true)
        let snapshot = try await store.confirm(.init(source: source, audio: [audio]))
        let edited = try await store.setDisplayNames(for: try XCTUnwrap(snapshot.tracks.first?.id), title: nil, artist: "Edited")
        XCTAssertEqual(edited.tracks.first?.metadata.albumArtist, "Edited")
        XCTAssertEqual(LibraryIndex(tracks: edited.tracks).artists.compactMap(\.name), ["Edited"])
    }

    func testRescanDetectsDirectoryOrFileReplacedWithTheWrongType() async throws {
        let root = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = SourceDraft(name: "Music", identity: "type-change", bookmark: Data())
        let album = root.appending(component: "Album")
        try FileManager.default.createDirectory(at: album, withIntermediateDirectories: false)
        let child = album.appending(component: "Song.m4a")
        let standalone = root.appending(component: "Other.m4a")
        try FileManager.default.copyItem(at: fixture("Review-base"), to: child)
        try FileManager.default.copyItem(at: fixture("Review-base"), to: standalone)
        let store = try await LibraryStore.open(inMemory: true)
        let first = try await store.confirm(AudioScanner.scanDirectory(root, source: source) { _ in })
        let paths = first.tracks.map(\.path)
        XCTAssertEqual(paths.count, 2)
        try FileManager.default.removeItem(at: album)
        try Data([1]).write(to: album)
        try FileManager.default.removeItem(at: standalone)
        try FileManager.default.createDirectory(at: standalone, withIntermediateDirectories: false)
        let draft = try await AudioScanner.scanDirectory(root, source: source) { _ in }
        XCTAssertTrue(paths.allSatisfy(draft.provesMissing))
        try AudioScanner.verifyMissing(paths, in: root)
        let missing = try await store.confirm(draft)
        XCTAssertEqual(missing.missingTracks.map(\.id), first.tracks.map(\.id))
        XCTAssertTrue(missing.tracks.isEmpty)
        try FileManager.default.removeItem(at: album)
        try FileManager.default.createDirectory(at: album, withIntermediateDirectories: false)
        try FileManager.default.copyItem(at: fixture("Review-base"), to: child)
        let restored = try XCTUnwrap(RelativeAudioPath("Album/Song.m4a"))
        XCTAssertThrowsError(try AudioScanner.verifyMissing([restored], in: root)) {
            XCTAssertEqual($0 as? FolderError, .scanChanged)
        }
    }

    func testConfirmPreflightRejectsAcceptedFileDeletionAndSameSizeReplacement() async throws {
        let root = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = SourceDraft(name: "Music", identity: "stale-preview", bookmark: Data())
        let first = root.appending(component: "A.m4a")
        let second = root.appending(component: "B.m4a")
        let data = try Data(contentsOf: fixture("Review-base"))
        try data.write(to: first)
        try data.write(to: second)
        let draft = try await AudioScanner.scanDirectory(root, source: source) { _ in }
        XCTAssertEqual(draft.audio.count, 2)
        try AudioScanner.verifyAccepted(draft, in: root)
        try FileManager.default.removeItem(at: second)
        XCTAssertThrowsError(try AudioScanner.verifyAccepted(draft, in: root)) { XCTAssertEqual($0 as? FolderError, .scanChanged) }
        let path = try XCTUnwrap(RelativeAudioPath("A.m4a"))
        try AudioScanner.verifyAccepted(draft, paths: [path], in: root)

        let mtime = try XCTUnwrap(try first.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
        try data.write(to: first, options: .atomic)
        try FileManager.default.setAttributes([.modificationDate: mtime], ofItemAtPath: first.path(percentEncoded: false))
        XCTAssertThrowsError(try AudioScanner.verifyAccepted(draft, paths: [path], in: root)) {
            XCTAssertEqual($0 as? FolderError, .scanChanged)
        }
    }

    func testConfirmPreflightRejectsCaseOnlyPathChanges() async throws {
        let root = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = SourceDraft(name: "Music", identity: "renamed-preview", bookmark: Data())
        let original = root.appending(component: "Album")
        let intermediate = root.appending(component: "Move")
        let renamed = root.appending(component: "ALBUM")
        try FileManager.default.createDirectory(at: original, withIntermediateDirectories: false)
        try FileManager.default.copyItem(at: fixture("Review-base"), to: original.appending(component: "Song.m4a"))
        let damaged = try XCTUnwrap(RelativeAudioPath("Album/Damaged.mp3"))
        try Data("not audio".utf8).write(to: root.appending(path: damaged.rawValue))
        let draft = try await AudioScanner.scanDirectory(root, source: source) { _ in }
        XCTAssertEqual(draft.audio.map(\.path.rawValue), ["Album/Song.m4a"])
        XCTAssertTrue(draft.provesUnplayable(damaged))
        try await AudioScanner.verifyUnplayable([damaged], in: root)
        try FileManager.default.moveItem(at: original, to: intermediate)
        try FileManager.default.moveItem(at: intermediate, to: renamed)
        XCTAssertThrowsError(try AudioScanner.verifyAccepted(draft, in: root)) { XCTAssertEqual($0 as? FolderError, .scanChanged) }
        do {
            try await AudioScanner.verifyUnplayable([damaged], in: root)
            XCTFail("The old path must no longer be accepted for an unplayable update")
        } catch FolderError.scanChanged { }
    }

    func testBatchRemovalAndSelectiveRestoreOnlyAffectChosenPathsInTheirSource() async throws {
        let root = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: root) }
        let folder = root.appending(component: "Music")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        let source = SourceDraft(name: "Music", identity: "selective-restore", bookmark: Data())
        let otherSource = SourceDraft(name: "Other music", identity: "other-source", bookmark: Data())
        let a = try XCTUnwrap(RelativeAudioPath("A.m4a"))
        let b = try XCTUnwrap(RelativeAudioPath("B.m4a"))
        let neverImported = try XCTUnwrap(RelativeAudioPath("C.m4a"))
        let fixture = try fixture("Review-base")
        let data = try Data(contentsOf: fixture)
        try data.write(to: folder.appending(path: a.rawValue))
        try data.write(to: folder.appending(path: b.rawValue))
        let location = root.appending(component: "Store.sqlite")
        let store = try await LibraryStore.open(location: location)
        let added = try await store.confirm(AudioScanner.scanDirectory(folder, source: source) { _ in })
        let sourceID = try XCTUnwrap(added.sources.first?.id)
        let originalIDs = Set(added.tracks.map(\.id))
        let otherAudio = try await AudioScanner.inspect(fixture, path: a, sourceName: otherSource.name)
        let both = try await store.confirm(.init(source: otherSource, audio: [otherAudio]))
        let other = try XCTUnwrap(both.tracks.first { $0.rootID != sourceID })
        _ = try await store.setDisplayNames(for: try XCTUnwrap(added.tracks.first?.id), title: "Old override", artist: nil)
        let removed = try await store.removeTracks(originalIDs.union([UUID()]))
        XCTAssertEqual(removed.tracks.map(\.id), [other.id])
        XCTAssertEqual(removed.excludedCount(for: sourceID), 2)
        XCTAssertTrue(removed.isExcluded(a, from: sourceID))
        XCTAssertTrue(removed.isExcluded(b, from: sourceID))
        XCTAssertFalse(removed.isExcluded(a, from: other.rootID))
        let normal = try await store.confirm(AudioScanner.scanDirectory(folder, source: source) { _ in })
        XCTAssertEqual(normal.tracks.map(\.id), [other.id])

        try data.write(to: folder.appending(path: neverImported.rawValue))
        try FileManager.default.removeItem(at: folder.appending(path: b.rawValue))
        let preview = try await AudioScanner.scanDirectory(folder, source: source) { _ in }
        let beforeRestore = try await store.snapshot()
        XCTAssertEqual(beforeRestore.excludedCount(for: sourceID), 2)
        do {
            _ = try await store.restoreExcluded([a, b], from: preview)
            XCTFail("An invalid selection must fail without clearing any exclusions")
        } catch FolderError.scanChanged { }
        do {
            _ = try await store.restoreExcluded([a, neverImported], from: preview)
            XCTFail("The restore path may not import unrelated new songs")
        } catch FolderError.scanChanged { }
        let afterFailedRestore = try await store.snapshot()
        XCTAssertEqual(afterFailedRestore.excludedCount(for: sourceID), 2)
        XCTAssertEqual(afterFailedRestore.tracks.map(\.id), [other.id])

        let restored = try await store.restoreExcluded([a], from: preview)
        let new = try XCTUnwrap(restored.tracks.first { $0.rootID == sourceID })
        XCTAssertEqual(new.path, a)
        XCTAssertFalse(originalIDs.contains(new.id))
        XCTAssertEqual(new.metadata.title, "A")
        XCTAssertFalse(restored.isExcluded(a, from: sourceID))
        XCTAssertTrue(restored.isExcluded(b, from: sourceID))
        XCTAssertEqual(restored.excludedCount(for: sourceID), 1)
        XCTAssertEqual(try Data(contentsOf: folder.appending(path: a.rawValue)), data)
        let reopened = try await LibraryStore.open(location: location).snapshot()
        XCTAssertEqual(Set(reopened.tracks.map(\.id)), [new.id, other.id])
        XCTAssertTrue(reopened.isExcluded(b, from: sourceID))
    }

    private func fixture(_ name: String) throws -> URL {
        try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "m4a", subdirectory: "Fixtures"))
    }

    private func temporaryFolder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(component: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}
