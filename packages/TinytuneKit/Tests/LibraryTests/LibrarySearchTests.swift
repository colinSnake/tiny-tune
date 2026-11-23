import Domain
import Foundation
@testable import Library
import XCTest

@MainActor
final class LibrarySearchTests: XCTestCase {
    func testSearchKeepsIndependentFieldsAndCatalogOrder() throws {
        let root = UUID()
        let tracks = [
            track(root, "Café", artist: "Guest", albumArtist: "城市樂團", album: "Night", file: "03.wav"),
            track(root, "Ｓｋｙ \t Road", artist: "Road Guest", albumArtist: "城市樂團", album: "Night", file: "02.wav"),
            track(root, "Sky Road (Live)", artist: nil, albumArtist: nil, album: "Day", file: "01.wav"),
        ]
        let index = LibraryIndex(tracks: tracks)
        for query in ["ＳＫＹ  road", "城市", "GUEST", "NIGHT", " \t Café \n", "cafe", "Guest Night", "not found"] {
            let key = MusicOrdering.key(query)
            let result = index.search(.init(query))
            XCTAssertEqual(result.songs.map(\.id), tracks.filter { $0.matches(key) }.map(\.id), query)
            XCTAssertEqual(result.artists.map(\.id), index.artists.filter {
                $0.name.map(MusicOrdering.key)?.contains(key) == true
            }.map(\.id), query)
            XCTAssertEqual(result.albums.map(\.id), index.albums.filter {
                $0.title.map(MusicOrdering.key)?.contains(key) == true
            }.map(\.id), query)
        }
        XCTAssertEqual(index.search(.init("sky road")).songs.map(\.id), [tracks[1].id, tracks[2].id])
        XCTAssertTrue(index.search(.init("Guest Night")).isEmpty, "Search must not cross field boundaries")
        XCTAssertTrue(index.search(.init(" \t\n")).isEmpty, "Blank queries do not enumerate the catalog")
    }

    func testRebuildingFromImportRescanAndRemovalReplacesSearchKeys() async throws {
        let store = try await LibraryStore.open(inMemory: true)
        let source = SourceDraft(name: "Synthetic", identity: "search-fixture", bookmark: Data([1]))
        let path = try XCTUnwrap(RelativeAudioPath("01.wav"))
        let otherPath = try XCTUnwrap(RelativeAudioPath("02.wav"))
        let old = ScannedAudio(path: path, metadata: metadata("Before", artist: "Guest", albumArtist: "Old Artist", album: "Old Album"), duration: 10)
        let updated = ScannedAudio(path: path, metadata: metadata("After", artist: "Solo", albumArtist: "New Artist", album: "New Album"), duration: 10)
        let other = ScannedAudio(path: otherPath, metadata: metadata("Other", artist: nil, albumArtist: nil, album: nil), duration: 10)

        let empty = LibraryIndex(tracks: [])
        XCTAssertTrue(empty.search(.init("before")).isEmpty)
        let imported = try await store.confirm(.init(source: source, audio: [old, other]))
        let first = LibraryIndex(tracks: imported.tracks)
        let originalID = try XCTUnwrap(first.search(.init("before")).songs.first?.id)
        XCTAssertNotEqual(first.revision, empty.revision)
        XCTAssertEqual(first.search(.init("old artist")).artists.count, 1)
        XCTAssertEqual(first.search(.init("old album")).albums.count, 1)

        let rescanned = try await store.confirm(.init(source: source, audio: [updated, other]))
        let second = LibraryIndex(tracks: rescanned.tracks)
        XCTAssertNotEqual(second.revision, first.revision)
        XCTAssertEqual(second.search(.init("after")).songs.map(\.id), [originalID])
        for oldQuery in ["before", "guest", "old artist", "old album"] {
            XCTAssertTrue(second.search(.init(oldQuery)).isEmpty, oldQuery)
        }
        XCTAssertEqual(second.search(.init("new artist")).artists.count, 1)
        XCTAssertEqual(second.search(.init("new album")).albums.count, 1)

        let afterSongRemoval = try await store.removeTrack(originalID)
        let third = LibraryIndex(tracks: afterSongRemoval.tracks)
        XCTAssertNotEqual(third.revision, second.revision)
        for removedQuery in ["after", "solo", "new artist", "new album"] {
            XCTAssertTrue(third.search(.init(removedQuery)).isEmpty, removedQuery)
        }
        XCTAssertEqual(third.search(.init("other")).songs.count, 1)

        let sourceID = try XCTUnwrap(imported.sources.first?.id)
        let afterSourceRemoval = try await store.removeSource(sourceID)
        let fourth = LibraryIndex(tracks: afterSourceRemoval.tracks)
        XCTAssertNotEqual(fourth.revision, third.revision)
        XCTAssertTrue(fourth.search(.init("other")).isEmpty)
    }

    private func track(_ root: UUID, _ title: String, artist: String?, albumArtist: String?, album: String?, file: String) -> Track {
        .init(rootID: root, path: RelativeAudioPath(file)!,
              metadata: metadata(title, artist: artist, albumArtist: albumArtist, album: album), duration: 10)
    }

    private func metadata(_ title: String, artist: String?, albumArtist: String?, album: String?) -> TrackMetadata {
        .init(title: title, artist: artist, albumArtist: albumArtist, album: album)
    }
}
