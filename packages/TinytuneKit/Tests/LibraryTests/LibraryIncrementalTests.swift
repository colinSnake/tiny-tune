import Domain
import Foundation
@testable import Library
import XCTest

@MainActor
final class LibraryIncrementalTests: XCTestCase {
    func testReopenedHistoryIncrementallyImportsAndRestoresWithoutChangingOtherSources() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        let location = folder.appending(path: "Library.store")
        let old = SourceDraft(name: "Music", identity: "original", bookmark: Data([1]))
        let new = SourceDraft(name: "Music", identity: "added", bookmark: Data([2]))
        let a = song("Beyoncé/Album/Song 2.mp3", title: "Song 2")
        let copy = song("Beyoncé/Album/Song 2 - lossless.flac", title: "Song 2 - lossless")
        let b = song("Beyoncé/Album/Song 10.mp3", title: "Song 10")
        do {
            let store = try await LibraryStore.open(location: location)
            _ = try await store.confirm(.init(source: old, audio: [a, copy, b]))
        }
        let store = try await LibraryStore.open(location: location)
        let history = try await store.snapshot()
        let oldID = try XCTUnwrap(history.sources.first?.id)
        let archived = try XCTUnwrap(history.tracks.first { $0.path == b.path })
        let oldRevision = history.contents(for: oldID).revision
        let newDraft = ImportDraft(source: new, audio: [song("BEYONCÉ/Album/Song 1.mp3", title: "Song 1"),
                                                        song("Beyoncé/Album/Song 10.mp3", title: "Song 10")])
        let addition = try await store.confirmChanges(newDraft)
        let imported = history.applying(addition)
        let newID = try XCTUnwrap(imported.sources.first { $0.id != oldID }?.id)
        let newRevision = imported.contents(for: newID).revision
        XCTAssertEqual(imported.contents(for: oldID).revision, oldRevision)
        XCTAssertEqual(imported.contents(for: oldID).tracks.count, 3)
        XCTAssertEqual(imported.contents(for: newID).tracks.count, 2)
        XCTAssertEqual(imported.tracks.first?.metadata.title, "Song 1")
        try await assertMatchesStore(imported, store)
        assertIndexUpdate(from: history, to: imported)
        let folded = LibraryIndex(snapshot: history, foldsQualityVariants: true, artistGrouping: .folder).rebuilding(with: imported)
        XCTAssertEqual(folded.catalogTracks.count, 4)
        XCTAssertEqual(folded.artists.count, 1)
        XCTAssertTrue(folded.albums.allSatisfy { $0.location?.hasSuffix(")") == true })

        let edit = try await store.setDisplayNameChanges(for: archived.id, title: "Z renamed", artist: "Other singer")
        let edited = imported.applying(edit)
        XCTAssertEqual(edited.contents(for: newID).revision, newRevision)
        XCTAssertEqual(edited.tracks.last?.id, archived.id)
        try await assertMatchesStore(edited, store)
        assertIndexUpdate(from: imported, to: edited)

        let remove = try await store.removeTrackChanges([archived.id])
        let removed = edited.applying(remove)
        XCTAssertTrue(removed.isExcluded(b.path, from: oldID))
        XCTAssertEqual(removed.excludedCount(for: oldID), 1)
        let oldDraft = ImportDraft(source: old, audio: [a, copy, b])
        let rescan = try await store.confirmChanges(oldDraft)
        let rescanned = removed.applying(rescan)
        XCTAssertEqual(rescanned.excludedCount(for: oldID), 1)
        let rescannedA = try XCTUnwrap(rescanned.contents(for: oldID).tracks.first { $0.path == a.path })
        XCTAssertTrue(rescanned.isCurrent(rescannedA, comparedWith: a))
        let restore = try await store.restoreExcludedChanges([b.path], from: oldDraft)
        let restored = rescanned.applying(restore)
        XCTAssertEqual(restored.excludedCount(for: oldID), 0)
        XCTAssertFalse(restored.tracks.contains { $0.id == archived.id })
        XCTAssertEqual(restored.contents(for: newID).revision, newRevision)
        try await assertMatchesStore(restored, store)
        assertIndexUpdate(from: removed, to: restored)

        let deleteSource = try await store.removeSourceChanges(newID)
        let deleted = restored.applying(deleteSource)
        XCTAssertEqual(deleted.sources.map(\.id), [oldID])
        XCTAssertTrue(deleted.contents(for: newID).tracks.isEmpty)
        try await assertMatchesStore(deleted, store)
        assertIndexUpdate(from: restored, to: deleted)
    }

    func testPartialRescanRetainsTagsAndMovesUnavailableFilesOnlyInItsSource() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = SourceDraft(name: "Local", identity: "local-files", bookmark: Data())
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "Numbered", withExtension: "m4a", subdirectory: "Fixtures"))
        let retained = folder.appending(path: "01.m4a"), missing = folder.appending(path: "02.m4a"), damaged = folder.appending(path: "03.m4a")
        for file in [retained, missing, damaged] { try FileManager.default.copyItem(at: fixture, to: file) }
        let store = try await LibraryStore.open(inMemory: true)
        _ = try await store.confirm(.init(source: .init(name: "Archive", identity: "archive", bookmark: Data()),
                                          audio: [song("Artist/Album/Song 2.mp3", title: "Song 2")]))
        let initial = try await store.confirm(AudioScanner.scanDirectory(folder, source: source) { _ in })
        let root = try XCTUnwrap(initial.sources.first { $0.identity == source.identity }?.id)
        let archiveID = try XCTUnwrap(initial.sources.first { $0.id != root }?.id)
        let archiveRevision = initial.contents(for: archiveID).revision
        let scan = try await AudioScanner.scanDirectory(folder, source: source) { _ in }
        let change = try await store.confirmChanges(scan)
        let refreshed = initial.applying(change)
        let sample = try XCTUnwrap(scan.audio.first { $0.path.rawValue == retained.lastPathComponent })
        XCTAssertNotNil(sample.embeddedTags)
        let refreshedSample = try XCTUnwrap(refreshed.contents(for: root).tracks.first { $0.path == sample.path })
        XCTAssertTrue(refreshed.isCurrent(refreshedSample, comparedWith: sample))
        try FileManager.default.removeItem(at: missing)
        try Data("not audio".utf8).write(to: damaged, options: .atomic)
        let damagedChange = try await store.confirmChanges(AudioScanner.scanDirectory(folder, source: source) { _ in })
        let unavailable = refreshed.applying(damagedChange)
        let contents = unavailable.contents(for: root)
        XCTAssertEqual(contents.tracks.map(\.id), [refreshedSample.id])
        XCTAssertEqual(contents.missingTracks.map(\.path.rawValue), [missing.lastPathComponent])
        XCTAssertEqual(contents.unplayableTracks.map(\.path.rawValue), [damaged.lastPathComponent])
        XCTAssertEqual(unavailable.contents(for: archiveID).revision, archiveRevision)
        try await assertMatchesStore(unavailable, store)
        assertIndexUpdate(from: initial, to: unavailable)
    }

    private func song(_ path: String, title: String) -> ScannedAudio {
        .init(path: RelativeAudioPath(path)!, metadata: .init(title: title, artist: "Beyoncé", albumArtist: "Beyoncé", album: "Album"),
              duration: 20)
    }

    private func assertMatchesStore(_ actual: LibrarySnapshot, _ store: LibraryStore,
                                    file: StaticString = #filePath, line: UInt = #line) async throws {
        let full = try await store.snapshot()
        XCTAssertEqual(actual.sources, full.sources, file: file, line: line)
        XCTAssertEqual(actual.tracks, full.tracks, file: file, line: line)
        XCTAssertEqual(actual.missingTracks, full.missingTracks, file: file, line: line)
        XCTAssertEqual(actual.unplayableTracks, full.unplayableTracks, file: file, line: line)
    }

    private func assertIndexUpdate(from old: LibrarySnapshot, to new: LibrarySnapshot,
                                   file: StaticString = #filePath, line: UInt = #line) {
        for grouping: LibraryIndex.ArtistGrouping in [.folder, .performer] {
            for folds in [false, true] {
                let prior = LibraryIndex(snapshot: old, foldsQualityVariants: folds, artistGrouping: grouping)
                let actual = prior.rebuilding(with: new)
                let full = LibraryIndex(tracks: new.tracks, sourceNames: Dictionary(uniqueKeysWithValues: new.sources.map { ($0.id, $0.name) }),
                                        foldsQualityVariants: folds, artistGrouping: grouping)
                XCTAssertEqual(actual.catalogTracks, full.catalogTracks, file: file, line: line)
                XCTAssertEqual(actual.albums.map(AlbumSummary.init), full.albums.map(AlbumSummary.init), file: file, line: line)
                XCTAssertEqual(actual.artists.map(\.id), full.artists.map(\.id), file: file, line: line)
                XCTAssertEqual(actual.artists.map(\.name), full.artists.map(\.name), file: file, line: line)
                XCTAssertEqual(actual.artists.map { $0.albums.map(AlbumSummary.init) },
                               full.artists.map { $0.albums.map(AlbumSummary.init) }, file: file, line: line)
                for query in ["beyoncé", "song", "renamed", "album"] {
                    let a = actual.search(.init(query)), b = full.search(.init(query))
                    XCTAssertEqual(a.songs, b.songs, file: file, line: line)
                    XCTAssertEqual(a.albums.map(\.id), b.albums.map(\.id), file: file, line: line)
                    XCTAssertEqual(a.artists.map(\.id), b.artists.map(\.id), file: file, line: line)
                }
            }
        }
    }

    private struct AlbumSummary: Equatable {
        var id: String
        var title: String?
        var artist: String?
        var location: String?
        var tracks: [Track]
        init(_ album: AlbumGroup) {
            (id, title, artist, location, tracks) = (album.id, album.title, album.artist, album.location, album.tracks)
        }
    }
}
