import Domain
import Foundation
@testable import Library
import XCTest

@MainActor
final class LibrarySearchTests: XCTestCase {
    func testSearchKeepsIndependentFieldsAndCatalogOrder() throws {
        let root = UUID()
        let tracks = [
            track(root, "Café", artist: "Guest", albumArtist: "城市樂團", album: "Night", file: "Night/03.wav"),
            track(root, "Ｓｋｙ \t Road", artist: "Road Guest", albumArtist: "城市樂團", album: "Night", file: "Night/02.wav"),
            track(root, "Sky Road (Live)", artist: nil, albumArtist: nil, album: "Day", file: "Day/01.wav"),
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

    func testAlbumsUseExactSourceAndDirectoryAndKeepDiscFoldersTogether() {
        let root = UUID()
        let sameArtist = "Beyond"
        let tracks = [
            track(root, "A", artist: sameArtist, albumArtist: sameArtist, album: "精选", file: "Beyond/精选/CD 1/A.wav"),
            track(root, "B", artist: "Guest", albumArtist: sameArtist, album: "精选", file: "Beyond/精选/Disc 2/B.wav"),
            track(root, "C", artist: sameArtist, albumArtist: sameArtist, album: "精选", file: "Backup/Beyond/精选/C.wav"),
            track(UUID(), "D", artist: sameArtist, albumArtist: sameArtist, album: "精选", file: "Beyond/精选/D.wav"),
        ]
        let results = LibraryIndex(tracks: tracks).search(.init("精选"))
        XCTAssertEqual(results.albums.count, 3)
        XCTAssertEqual(Set(results.albums.map(\.id)).count, 3)
        XCTAssertEqual(Set(results.albums.map { Set($0.tracks.map(\.id)) }),
                       [[tracks[0].id, tracks[1].id], [tracks[2].id], [tracks[3].id]])
    }

    func testPerformerSubsetRetainsCoverFromTheFullAlbum() throws {
        let root = UUID()
        let coverKey = String(repeating: "a", count: 64)
        let uncovered = track(root, "No Cover", artist: "Guest", albumArtist: "Compilation", album: "Night", file: "未归档歌曲/01.wav")
        let other = track(root, "Cover", artist: "Other", albumArtist: "Compilation", album: "Night", file: "未归档歌曲/02.wav")
        let covered = Track(id: other.id, rootID: other.rootID, path: other.path, metadata: other.metadata,
                            duration: other.duration, artworkKey: coverKey)
        let separate = track(root, "Different Album", artist: "Guest", albumArtist: "Guest", album: "Day", file: "Guest/01.wav")
        let index = LibraryIndex(tracks: [uncovered, covered, separate], artistGrouping: .folder)
        let guest = try XCTUnwrap(index.artists.first { $0.name == "Guest" })
        let night = try XCTUnwrap(guest.albums.first { $0.title == "Night" })
        XCTAssertEqual(night.tracks.map(\.id), [uncovered.id])
        XCTAssertEqual(night.artwork?.lastPathComponent, "\(coverKey).jpg")
        XCTAssertNil(try XCTUnwrap(guest.albums.first { $0.title == "Day" }).artwork)
    }

    func testSelectedFolderIsAnAlbumForItsOwnTracksAndDiscSubfolders() async throws {
        let store = try await LibraryStore.open(inMemory: true)
        let source = SourceDraft(name: "Beyond", identity: "directly-imported-folder", bookmark: Data([1]))
        let tracks = try ["灰色轨迹-Beyond.wav", "Disc 2/光辉岁月-Beyond.wav"].map { file in
            ScannedAudio(path: try XCTUnwrap(RelativeAudioPath(file)),
                         metadata: metadata("»ÒÉ«¹ì¼£", artist: "Garbled", albumArtist: nil, album: "Tag album"), duration: 10)
        }
        let imported = try await store.confirm(.init(source: source, audio: tracks))
        let index = LibraryIndex(tracks: imported.tracks)
        let album = try XCTUnwrap(index.albums.first)
        XCTAssertEqual(index.albums.count, 1)
        XCTAssertEqual(album.title, "Beyond")
        XCTAssertEqual(album.tracks.map(\.metadata.title), ["灰色轨迹", "光辉岁月"])
        XCTAssertEqual(album.tracks.last?.metadata.disc, 2)
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
        XCTAssertEqual(first.search(.init("Synthetic")).albums.count, 1)
        XCTAssertTrue(first.search(.init("old album")).isEmpty)

        let rescanned = try await store.confirm(.init(source: source, audio: [updated, other]))
        let second = LibraryIndex(tracks: rescanned.tracks)
        XCTAssertNotEqual(second.revision, first.revision)
        XCTAssertEqual(second.search(.init("after")).songs.map(\.id), [originalID])
        for oldQuery in ["before", "guest", "old artist", "old album"] {
            XCTAssertTrue(second.search(.init(oldQuery)).isEmpty, oldQuery)
        }
        XCTAssertEqual(second.search(.init("new artist")).artists.count, 1)
        XCTAssertEqual(second.search(.init("Synthetic")).albums.count, 1)
        XCTAssertTrue(second.search(.init("new album")).isEmpty)

        let afterSongRemoval = try await store.removeTrack(originalID)
        let third = LibraryIndex(tracks: afterSongRemoval.tracks)
        XCTAssertNotEqual(third.revision, second.revision)
        for removedQuery in ["after", "solo"] {
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

extension LibrarySearchTests {

    func testFolderGroupingSkipsAudioWrapperDirectory() throws {
        let root = UUID()
        let songs = [
            track(root, "不再犹豫", artist: "Beyond", albumArtist: nil, album: "Beyond", file: "audio/Beyond/不再犹豫.mp3"),
            track(root, "海阔天空", artist: "Beyond", albumArtist: nil, album: "Beyond精选", file: "audio/Beyond/Beyond精选/海阔天空.mp3"),
            track(root, "根目录歌曲", artist: "Root Singer", albumArtist: nil, album: nil, file: "audio/根目录歌曲.mp3"),
        ]
        let index = LibraryIndex(tracks: songs, sourceNames: [root: "Downloads"], artistGrouping: .folder)

        XCTAssertEqual(Set(index.artists.compactMap(\.name)), ["Beyond", "Root Singer"])
        XCTAssertTrue(index.artists.allSatisfy { $0.name != "audio" })
        XCTAssertEqual(Set(index.search(.init("Beyond")).artists.first?.tracks.map(\.id) ?? []), Set(songs.prefix(2).map(\.id)))
        XCTAssertEqual(index.search(.init("audio")).artists.count, 0)
        let album = try XCTUnwrap(index.albums.first(where: { $0.title == "Beyond" }))
        XCTAssertEqual(album.artist, "Beyond")
        XCTAssertFalse(album.showsArtistSubtitle)
        XCTAssertEqual(index.search(.init("Root Singer")).artists.first?.tracks.map(\.id), [songs[2].id])
    }

    func testReopenedLibrarySkipsAudioWrapperWithoutReimport() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let location = folder.appendingPathComponent("Library.store")
        let source = SourceDraft(name: "Downloads", identity: "audio-wrapper-regression", bookmark: Data([1]))
        let path = try XCTUnwrap(RelativeAudioPath("audio/Beyond/不再犹豫.mp3"))
        let trackID: UUID
        let rootID: UUID
        do {
            let store = try await LibraryStore.open(location: location)
            let scanned = ScannedAudio(path: path, metadata: metadata("不再犹豫", artist: "Beyond", albumArtist: nil, album: "犹豫"), duration: 10)
            let imported = try await store.confirm(.init(source: source, audio: [scanned]))
            let song = try XCTUnwrap(imported.tracks.first)
            trackID = song.id
            rootID = song.rootID
            _ = try await store.setDisplayNames(for: trackID, title: "自定义歌名", artist: nil)
        }
        let reopened = try await LibraryStore.open(location: location)
        let snapshot = try await reopened.snapshot()
        let names = Dictionary(uniqueKeysWithValues: snapshot.sources.map { ($0.id, $0.name) })
        let index = LibraryIndex(tracks: snapshot.tracks, sourceNames: names, artistGrouping: .folder)
        let album = try XCTUnwrap(index.albums.first)
        XCTAssertEqual(album.title, "Beyond")
        XCTAssertEqual(album.artist, "Beyond")
        XCTAssertFalse(album.showsArtistSubtitle)
        XCTAssertEqual(index.artists.compactMap(\.name), ["Beyond"])
        XCTAssertEqual(index.catalogTracks.first?.id, trackID)
        XCTAssertEqual(index.catalogTracks.first?.rootID, rootID)
        XCTAssertEqual(index.catalogTracks.first?.path, path)
        XCTAssertEqual(index.catalogTracks.first?.metadata.title, "自定义歌名")
    }

    func testArtistFolderCombinesSoloAndDuetAcrossAlbumsWithoutChangingSongCredits() throws {
        let root = UUID()
        let songs = [
            track(root, "独唱", artist: "黄诗扶", albumArtist: "黄诗扶", album: "黄诗扶", file: "黄诗扶/独唱.mp3"),
            track(root, "合唱", artist: "黄诗扶&妖扬&恋恋故人难", albumArtist: "多人", album: "黄诗扶", file: "黄诗扶/合唱.mp3"),
            track(root, "第二张专辑", artist: "其他演唱署名", albumArtist: nil, album: "精选", file: "黄诗扶/精选/Disc 2/新歌.mp3"),
        ]
        let index = LibraryIndex(tracks: songs, sourceNames: [root: "audio"], artistGrouping: .folder)
        XCTAssertEqual(index.artists.compactMap(\.name), ["黄诗扶"])
        let artist = try XCTUnwrap(index.artists.first)
        XCTAssertEqual(artist.albums.count, 2)
        XCTAssertEqual(Set(artist.tracks.map(\.id)), Set(songs.map(\.id)))
        let flatAlbum = try XCTUnwrap(index.albums.first(where: { $0.title == "黄诗扶" }))
        XCTAssertEqual(flatAlbum.artist, "黄诗扶")
        XCTAssertEqual(flatAlbum.location, "audio / 黄诗扶")
        XCTAssertFalse(flatAlbum.showsArtistSubtitle)
        let subAlbum = try XCTUnwrap(index.albums.first(where: { $0.title == "精选" }))
        XCTAssertEqual(subAlbum.artist, "黄诗扶")
        XCTAssertTrue(subAlbum.showsArtistSubtitle)
        XCTAssertEqual(index.search(.init("妖扬")).songs.map(\.id), [songs[1].id])
        XCTAssertTrue(index.search(.init("妖扬")).artists.isEmpty)
        XCTAssertEqual(index.catalogTracks, songs)
    }

    func testFolderModeFallsBackToTagsForRootDiscAndUnfiledSongs() throws {
        let root = UUID()
        let loose = track(root, "First", artist: "Studio", albumArtist: nil, album: "audio", file: "First.mp3")
        let disc = track(root, "Second", artist: nil, albumArtist: "Archive Band", album: "audio", file: "CD 1/Second.mp3")
        let unfiled = track(root, "稻香", artist: "周杰伦", albumArtist: "周杰伦", album: "未归档歌曲", file: "未归档歌曲/稻香.mp3")
        let index = LibraryIndex(tracks: [loose, disc, unfiled], sourceNames: [root: "audio"], artistGrouping: .folder)
        XCTAssertEqual(Set(index.artists.compactMap(\.name)), ["Studio", "Archive Band", "周杰伦"])
        XCTAssertEqual(index.search(.init("周杰伦")).artists.first?.tracks.map(\.id), [unfiled.id])
    }

    func testAlbumArtistSubtitleOnlyHidesEquivalentName() throws {
        let root = UUID()
        let name = track(root, "Song", artist: "Beyond", albumArtist: "Beyond", album: "ＢＥＹＯＮＤ", file: "ＢＥＹＯＮＤ/Song.mp3")
        let anonymous = track(root, "Instrumental", artist: nil, albumArtist: nil, album: "Score", file: "Score/Instrumental.mp3")
        let index = LibraryIndex(tracks: [name, anonymous])
        XCTAssertFalse(try XCTUnwrap(index.search(.init("beyond")).albums.first).showsArtistSubtitle)
        XCTAssertTrue(try XCTUnwrap(index.search(.init("score")).albums.first).showsArtistSubtitle)
    }

    func testAlbumArtistSubtitleHidesAudioWrapperName() throws {
        let root = UUID()
        let song = track(root, "Song", artist: "Singer", albumArtist: "AUDIO", album: "Gem", file: "audio/Song.mp3")
        let index = LibraryIndex(tracks: [song], sourceNames: [root: "audio"], artistGrouping: .folder)
        let album = try XCTUnwrap(index.albums.first)
        XCTAssertEqual(album.artist, "AUDIO", "Keep imported metadata intact")
        XCTAssertFalse(album.showsArtistSubtitle, "The audio folder is a container, not an artist credit")
    }
    func testFolderAlbumStaysTogetherButPerformersCanBrowseTheirOwnSongs() {
        let root = UUID()
        let songs = [track(root, "First", artist: "Band", albumArtist: "Various Artists", album: "Mix", file: "Mix/First.wav"),
                     track(root, "Second", artist: "Guest", albumArtist: "Various Artists", album: "Mix", file: "Mix/Second.wav")]
        let index = LibraryIndex(tracks: songs)
        XCTAssertEqual(index.albums.count, 1)
        XCTAssertEqual(Set(index.albums.first?.tracks.map(\.id) ?? []), Set(songs.map(\.id)))
        let guest = index.search(.init("Guest")).artists.first
        XCTAssertEqual(guest?.tracks.map(\.id), [songs[1].id])
        XCTAssertEqual(guest?.albums.first?.id, index.albums.first?.id)
    }

    func testSameNamedAlbumsHaveDistinctLocationsAndSongVersionsRemainSearchable() {
        let a = UUID(), b = UUID()
        let songs = [track(a, "春庭雪", artist: "邓寓君", albumArtist: "邓寓君", album: "精选", file: "精选/春庭雪.flac"),
                     track(a, "春庭雪", artist: "邓寓君", albumArtist: "邓寓君", album: "精选", file: "精选/春庭雪-高品.mp3"),
                     track(b, "春庭雪", artist: "邓寓君", albumArtist: "邓寓君", album: "精选", file: "精选/春庭雪.flac")]
        let index = LibraryIndex(tracks: songs, sourceNames: [a: "Music", b: "Music"])
        XCTAssertEqual(index.albums.count, 2)
        XCTAssertEqual(Set(index.albums.compactMap(\.location)).count, 2)
        let results = index.search(.init("春庭雪")).songs
        XCTAssertEqual(results.map(\.id), songs.map(\.id))
    }
}

final class CatalogQualityVariantsTests: XCTestCase {
    func testOptInCatalogFoldsSameRecordingAcrossExplicitQualityCopies() throws {
        let root = UUID()
        func song(_ path: String, root id: UUID = root, duration: Double = 240.879375) throws -> Track {
            let path = try XCTUnwrap(RelativeAudioPath(path))
            return Track(rootID: id, path: path, metadata: .resolve(path, tags: .init(artist: "Performer")), duration: duration)
        }
        let regular = try song("Performer/春庭雪-Performer.mp3")
        let high = try song("Performer/春庭雪-Performer-高品.mp3", duration: 240.879365)
        let lossless = try song("Performer/春庭雪-Performer-Hi-Res.flac")
        let live = try song("Performer/春庭雪-Performer-Live.flac")
        let differentLength = try song("Performer/春庭雪-Performer-无损.flac", duration: 214)
        let differentFolder = try song("Archive/春庭雪-Performer-Hi-Res.flac")
        let differentSource = try song("Performer/春庭雪-Performer-Hi-Res.flac", root: UUID())
        let all = [high, live, lossless, differentLength, regular, differentFolder, differentSource]
        let index = LibraryIndex(tracks: all, foldsQualityVariants: true)
        let visible = [live, differentLength, regular, differentFolder, differentSource].map(\.id)
        XCTAssertEqual(index.catalogTracks.map(\.id), visible)
        XCTAssertEqual(Set(index.albums.flatMap(\.tracks).map(\.id)), Set(visible))
        XCTAssertEqual(index.search(.init("春庭雪")).songs.map(\.id), visible)
        XCTAssertEqual(LibraryIndex(tracks: all).catalogTracks.map(\.id), all.map(\.id))
    }

    /// Optional local QA; only reads a caller-supplied metadata report, never a personal library database.
    func testCatalogProjectionForReadOnlyMetadataReportWhenOptedIn() throws {
        guard let file = ProcessInfo.processInfo.environment["TINYTUNE_AUDIO_METADATA_REPORT"] else {
            throw XCTSkip("Set TINYTUNE_AUDIO_METADATA_REPORT for read-only real-directory QA")
        }
        struct Report: Decodable {
            struct Audio: Decodable {
                let path: String
                let title: String?
                let artist: String?
                let albumArtist: String?
                let album: String?
                let duration: Double
            }
            let sourceName: String
            let audio: [Audio]
            let expectedVisible: Int
            let expectedFoldedPaths: [String]
        }
        let report = try JSONDecoder().decode(Report.self, from: Data(contentsOf: URL(fileURLWithPath: file)))
        let root = UUID()
        let tracks = try report.audio.map { audio in
            let path = try XCTUnwrap(RelativeAudioPath(audio.path))
            let tags = MusicTags(title: audio.title, artist: audio.artist, albumArtist: audio.albumArtist, album: audio.album)
            return Track(rootID: root, path: path, metadata: .resolve(path, tags: tags, sourceName: report.sourceName), duration: audio.duration)
        }
        let index = LibraryIndex(tracks: tracks, foldsQualityVariants: true)
        XCTAssertEqual(index.catalogTracks.count, report.expectedVisible)
        let visibleIDs = Set(index.catalogTracks.map { $0.id })
        XCTAssertEqual(Set(tracks.filter { !visibleIDs.contains($0.id) }.map { $0.path.rawValue }), Set(report.expectedFoldedPaths))
        XCTAssertEqual(Set(index.albums.flatMap(\.tracks).map(\.id)), Set(index.catalogTracks.map(\.id)))
        XCTAssertEqual(Set(index.artists.flatMap(\.tracks).map(\.id)), Set(index.catalogTracks.map(\.id)))
        XCTAssertTrue(Set(index.catalogTracks.map(\.id)).isSubset(of: Set(tracks.map(\.id))))
        print("Read-only catalog projection: \(tracks.count) files → \(index.catalogTracks.count) visible songs")
    }

    func testQualityCopyWithEditedMetadataIsNeverHidden() throws {
        let root = UUID()
        let originalPath = try XCTUnwrap(RelativeAudioPath("Album/Theme.mp3"))
        let copyPath = try XCTUnwrap(RelativeAudioPath("Album/Theme-高品.mp3"))
        let original = Track(rootID: root, path: originalPath, metadata: .resolve(originalPath, tags: .init()), duration: 60)
        let automatic = TrackMetadata.resolve(copyPath, tags: .init())
        let edited = TrackMetadata(title: "My alternate title", artist: automatic.artist, albumArtist: automatic.albumArtist, album: automatic.album)
        let copy = Track(rootID: root, path: copyPath, metadata: edited, duration: 60, automaticMetadata: automatic)
        XCTAssertEqual(LibraryIndex(tracks: [original, copy], foldsQualityVariants: true).catalogTracks, [original, copy])
    }

    func testUnmarkedFormatsAndDistinctRecordingsRemainAvailable() throws {
        let root = UUID()
        let tracks = try ["Album/01 Theme.mp3", "Album/01 Theme.flac", "Album/01 Theme (Live).flac"].map { name in
            let path = try XCTUnwrap(RelativeAudioPath(name))
            return Track(rootID: root, path: path, metadata: .resolve(path, tags: .init()), duration: 60)
        }
        XCTAssertEqual(LibraryIndex(tracks: tracks, foldsQualityVariants: true).catalogTracks, tracks)
    }
}
