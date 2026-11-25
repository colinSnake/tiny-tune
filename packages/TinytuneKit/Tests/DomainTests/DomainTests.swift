import Domain
import Foundation
import XCTest

final class DomainTests: XCTestCase {
    func testDirectoryAlbumAndFileNameOverrideTagsAndPreserveVersions() throws {
        let path = try XCTUnwrap(RelativeAudioPath("华语/周杰伦/叶惠美/Disc 2/02 晴天 (Live) [320k].mp3"))
        let value = TrackMetadata.resolve(path, tags: .init(title: "Wrong Title", artist: " Jay ",
                                                           albumArtist: "合辑", album: "Greatest Hits", track: 9, disc: 1))
        XCTAssertEqual(value.title, "晴天 (Live)")
        XCTAssertEqual(value.artist, "周杰伦") // The artist folder takes precedence over embedded credits.
        XCTAssertEqual(value.albumArtist, "合辑")
        XCTAssertEqual(value.album, "叶惠美")
        XCTAssertEqual(value.track, 2)
        XCTAssertEqual(value.disc, 2)
    }

    func testRecognizesSongArtistFileNamesWithoutTrustingCorruptTitleTags() throws {
        let examples = [("灰色轨迹-Beyond", "灰色轨迹"), ("光辉岁月 - Beyond", "光辉岁月"),
                        ("喜欢你-Beyond-Hi-Res", "喜欢你"), ("海阔天空 - Live", "海阔天空 - Live")]
        for (file, expected) in examples {
            let path = try XCTUnwrap(RelativeAudioPath("Beyond/\(file).mp3"))
            let value = TrackMetadata.resolve(path, tags: .init(title: "»ÒÉ«¹ì¼£", album: "Unrelated"))
            XCTAssertEqual(value.title, expected)
            XCTAssertEqual(value.artist, file.hasSuffix("Live") ? nil : "Beyond")
            XCTAssertEqual(value.album, "Beyond")
        }
    }

    func testFlatFileFallbackAndSafeRelativePath() throws {
        let path = try XCTUnwrap(RelativeAudioPath("陈奕迅 - 浮夸.m4a"))
        let value = TrackMetadata.resolve(path, tags: .init(), sourceName: "Audio")
        XCTAssertEqual(value.title, "浮夸")
        XCTAssertEqual(value.artist, "陈奕迅")
        XCTAssertEqual(value.album, "Audio")
        for path in ["../a.mp3", "/a.mp3", "a//b.mp3", "a/./b.mp3", "a\0.mp3", ""] {
            XCTAssertNil(RelativeAudioPath(path), path)
        }
        XCTAssertEqual(RelativeAudioPath("A/Ｔone.MP3")?.rawValue, "A/Ｔone.MP3")
    }

    func testSearchMatchesTitleAndAlbumArtistAndRespectsFullWidth() throws {
        let track = Track(rootID: UUID(), path: try XCTUnwrap(.init("test.mp3")),
                          metadata: .init(title: "Ｌｉｖｅ", artist: "歌手", albumArtist: "合辑", album: "专辑"), duration: 20)
        XCTAssertTrue(track.matches("live"))
        XCTAssertTrue(track.matches("合辑"))
        XCTAssertFalse(track.matches("无匹配"))
    }

    func testQueueSupportsRepeatAndKeepsRemovedEntriesOutOfLoop() {
        let a = UUID(), b = UUID(), c = UUID()
        var queue = PlaybackQueue(ids: [a, b, c], start: a)
        queue.removeUpcoming(b)
        XCTAssertEqual(queue.upcoming, [c])
        XCTAssertEqual(queue.advance(mode: .one, automatic: true), a)
        XCTAssertEqual(queue.advance(mode: .one, automatic: false), c)
        XCTAssertNil(queue.advance(mode: .off, automatic: true))
        XCTAssertEqual(queue.current, c)
        XCTAssertEqual(queue.advance(mode: .all, automatic: true), a)
        XCTAssertEqual(queue.upcoming, [c])
    }
}

extension DomainTests {
    func testDirectoryTitleDoesNotTakePrecedenceOverTaggedArtist() throws {
        let path = try XCTUnwrap(RelativeAudioPath("光辉岁月/不再犹豫.wav"))
        let value = TrackMetadata.resolve(path, tags: .init(artist: "Beyond"))
        XCTAssertEqual(value.album, "光辉岁月")
        XCTAssertEqual(value.artist, "Beyond")
        XCTAssertEqual(value.albumArtist, "Beyond")
        XCTAssertNil(TrackMetadata.resolve(path, tags: .init()).artist)
    }

    func testNumberAndGarbledTagFallbacksAreConservative() throws {
        let age = try XCTUnwrap(RelativeAudioPath("刘德华/17 岁.wav"))
        for tags in [MusicTags(title: "17 岁"), MusicTags(), MusicTags(title: "岁", track: 17)] {
            let result = TrackMetadata.resolve(age, tags: tags)
            XCTAssertEqual(result.title, "17 岁")
        }
        XCTAssertNil(TrackMetadata.resolve(age, tags: .init(title: "17 岁")).track)
        let numeric = try XCTUnwrap(RelativeAudioPath("Beyond/01.wav"))
        XCTAssertEqual(TrackMetadata.resolve(numeric, tags: .init(title: "Beyond(»Æ¼Ò¾Ô) - »ÒÉ«¹ì¼£")).title, "01")
        XCTAssertEqual(TrackMetadata.resolve(numeric, tags: .init(title: "François et Beyoncé")).title, "François et Beyoncé")
        let ordered = try XCTUnwrap(RelativeAudioPath("Beyond/03 17 岁 (Live).wav"))
        let result = TrackMetadata.resolve(ordered, tags: .init(track: 13))
        XCTAssertEqual(result.title, "17 岁 (Live)")
        XCTAssertEqual(result.track, 3)
    }
}

extension DomainTests {
    func testZeroPaddedFileNumbersSupplyMissingSongOrder() throws {
        let first = try XCTUnwrap(RelativeAudioPath("精选/01.wav"))
        let second = try XCTUnwrap(RelativeAudioPath("精选/02.wav"))
        let a = TrackMetadata.resolve(first, tags: .init(title: "Zebra"))
        let b = TrackMetadata.resolve(second, tags: .init(title: "Apple"))
        XCTAssertEqual(a.title, "Zebra")
        XCTAssertEqual(b.title, "Apple")
        XCTAssertEqual(a.track, 1)
        XCTAssertEqual(b.track, 2)
        XCTAssertEqual(TrackMetadata.resolve(first, tags: .init(title: "Zebra", track: 9)).track, 9)
        XCTAssertNil(TrackMetadata.resolve(try XCTUnwrap(.init("精选/1989.wav")), tags: .init(title: "1989")).track)
    }
}
