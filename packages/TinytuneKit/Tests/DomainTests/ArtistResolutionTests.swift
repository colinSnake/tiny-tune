import Domain
import XCTest

final class ArtistResolutionTests: XCTestCase {
    func testArtistFolderTakesPrecedenceOverFileNameAndEmbeddedArtists() throws {
        for relative in ["华语/Beyond/Album/Guest - Song.mp3", "Beyond/Album/Guest - Song.mp3", "Beyond/Album/Disc 2/Guest - Song.mp3",
                         "audio/Beyond/Guest - Song.mp3", "audio/Beyond/Album/Guest - Song.mp3"] {
            let path = try XCTUnwrap(RelativeAudioPath(relative))
            let metadata = TrackMetadata.resolve(path, tags: .init(artist: "Guest", albumArtist: "Compilation"), sourceName: "Downloads")
            XCTAssertEqual(metadata.artist, "Beyond", relative)
            XCTAssertEqual(metadata.albumArtist, "Compilation", "Keep explicit album credits separate")
            XCTAssertEqual(metadata.title, "Song", relative)
        }
    }

    func testSelectingAudioContainerKeepsItsImmediateArtistFolders() throws {
        for relative in ["Beyond/Song.mp3", "Beyond/Disc 2/Song.mp3"] {
            let path = try XCTUnwrap(RelativeAudioPath(relative))
            XCTAssertEqual(TrackMetadata.resolve(path, tags: .init(artist: "Guest"), sourceName: "audio").artist, "Beyond")
        }
    }

    func testEmbeddedArtistIsUsedWhenNoArtistFolderIsKnown() throws {
        for relative in ["Filename Artist - Song.mp3", "Album/Song.mp3", "audio/Song.mp3",
                         "audio/未归档歌曲/Song.mp3", "未归档歌曲/Song.mp3"] {
            let path = try XCTUnwrap(RelativeAudioPath(relative))
            let metadata = TrackMetadata.resolve(path, tags: .init(artist: "Tagged Artist"), sourceName: "Downloads")
            XCTAssertEqual(metadata.artist, "Tagged Artist", relative)
        }
    }
}
