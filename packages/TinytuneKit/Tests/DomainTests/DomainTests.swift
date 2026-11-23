import Domain
import Foundation
import XCTest

final class DomainTests: XCTestCase {
    func testTagValuesWinPerFieldAndPreserveVersions() throws {
        let path = try XCTUnwrap(RelativeAudioPath("周杰伦/叶惠美/Disc 2/02 晴天 (Live) [320k].mp3"))
        let value = TrackMetadata.resolve(path, tags: .init(artist: " Jay ", albumArtist: "合辑"))
        XCTAssertEqual(value.title, "晴天 (Live)")
        XCTAssertEqual(value.artist, "Jay")
        XCTAssertEqual(value.albumArtist, "合辑")
        XCTAssertEqual(value.album, "叶惠美")
        XCTAssertEqual(value.track, 2)
        XCTAssertEqual(value.disc, 2)
    }

    func testFlatFileFallbackAndSafeRelativePath() throws {
        let path = try XCTUnwrap(RelativeAudioPath("陈奕迅 - 浮夸.m4a"))
        let value = TrackMetadata.resolve(path, tags: .init())
        XCTAssertEqual(value.title, "浮夸")
        XCTAssertEqual(value.artist, "陈奕迅")
        XCTAssertNil(value.album)
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
