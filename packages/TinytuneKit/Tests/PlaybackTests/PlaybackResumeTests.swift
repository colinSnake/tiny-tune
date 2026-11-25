import CoreGraphics
import Domain
import Foundation
import ImageIO
import MediaPlayer
@testable import Playback
import XCTest

final class PlaybackResumeTests: XCTestCase {
    @MainActor
    func testPlayingPausedRowResumesWithoutReplacingQueue() async throws {
        let store = try tempStore()
        let current = try track("Current", album: "First album")
        let next = try track("Next", album: "Second album")
        let alternate = try track("Alternate", album: "Third album")
        let audio = try fixture(store, "row-resume")
        let player = Player(snapshotStore: store)
        player.volume = 0
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        defer { player.pause() }

        player.play(current, in: [current, next])
        try await wait { player.phase == .playing && player.seekingAvailable }
        player.pause()
        player.seek(6)
        try await wait { player.position >= 5.9 }
        player.play(current, in: [current, alternate])
        try await wait { player.phase == .playing }
        XCTAssertGreaterThanOrEqual(player.position, 5.9)
        XCTAssertEqual(player.upcoming.map(\.id), [next.id])
        try await wait {
            player.checkpoint()
            return player.position > 6.1
        }
        player.next()
        try await wait { player.current?.id == next.id && player.phase == .playing }

        player.pause()
        player.play(alternate, in: [alternate, current])
        try await wait { player.current?.id == alternate.id && player.phase == .playing }
        XCTAssertEqual(player.upcoming.map(\.id), [current.id], "A different row uses its own collection")
    }

    @MainActor
    func testPlayingRestoredPausedRowResumesButPlayAllStartsFresh() async throws {
        let store = try tempStore()
        let tracks = try [track("Previous"), track("Current"), track("Next"), track("Alternate")]
        let originalQueue = Array(tracks.prefix(3))
        let current = tracks[1]
        let otherCollection = [current, tracks[3]]
        try seed(store, ids: originalQueue.map(\.id), currentID: current.id, position: 7, repeatMode: .off)
        let audio = try fixture(store, "row-checkpoint")
        let player = Player(snapshotStore: store)
        player.volume = 0
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        defer { player.pause() }
        player.restoreCheckpoint(tracks: tracks)
        XCTAssertEqual(player.phase, .paused)

        player.play(current, in: otherCollection)
        try await wait { player.phase == .playing }
        XCTAssertGreaterThanOrEqual(player.position, 6.9)
        XCTAssertEqual(player.upcoming.map(\.id), [tracks[2].id])

        player.pause()
        player.playAll(otherCollection)
        XCTAssertEqual(player.current?.id, current.id)
        XCTAssertEqual(player.upcoming.map(\.id), [tracks[3].id])
        XCTAssertEqual(player.position, 0)
        try await wait { player.phase == .playing }
    }

    @MainActor
    func testSystemArtworkFollowsRestoredTrackAndRefreshedMetadata() async throws {
        let store = try tempStore()
        let initial = try track("Artwork", album: "Local album")
        func withArtwork(_ key: String?) -> Track {
            .init(id: initial.id, rootID: initial.rootID, path: initial.path, metadata: initial.metadata,
                  duration: initial.duration, dateAdded: initial.dateAdded, artworkKey: key)
        }
        func image(side: Int) throws -> CGImage {
            let context = try XCTUnwrap(CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                                                bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.setFillColor(red: 0.2, green: 0.6, blue: 0.4, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
            return try XCTUnwrap(context.makeImage())
        }
        let folder = store.url.deletingLastPathComponent()
        func writeImage(_ name: String, side: Int) throws {
            let cover = folder.appendingPathComponent(name + ".png")
            let png = try XCTUnwrap(CGImageDestinationCreateWithURL(cover as CFURL, "public.png" as CFString, 1, nil))
            CGImageDestinationAddImage(png, try image(side: side), nil)
            XCTAssertTrue(CGImageDestinationFinalize(png))
        }
        try writeImage("original", side: 64)

        try seed(store, ids: [initial.id], currentID: initial.id, position: 6, repeatMode: .off)
        let center = MPNowPlayingInfoCenter.default()
        let fallback = try image(side: 32)
        let player = Player(snapshotStore: store, artworkURL: { track in
            track.artworkKey.map { folder.appendingPathComponent($0 + ".png") }
        }, fallbackArtwork: { fallback })
        player.connectSystemControls()
        defer { player.removeTracks([initial.id]) }
        func artwork() -> MPMediaItemArtwork? { center.nowPlayingInfo?[MPMediaItemPropertyArtwork] as? MPMediaItemArtwork }

        player.restoreCheckpoint(tracks: [withArtwork("original")])
        try await wait { artwork()?.bounds.width == 64 }
        let published = try XCTUnwrap(artwork())
        XCTAssertEqual(published.image(at: CGSize(width: 16, height: 16))?.size.width, 16)
        XCTAssertEqual(center.nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "Artwork")
        XCTAssertEqual(center.nowPlayingInfo?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 6)
        player.pause()
        XCTAssertTrue(artwork() === published, "Pausing reuses the loaded cover")

        player.refreshCatalogMetadata([withArtwork("missing")])
        XCTAssertEqual(artwork()?.bounds.width, 32, "A previous cover must not remain while the new cover loads")
        try writeImage("missing", side: 48)
        // A rescan can repair an evicted thumbnail without changing its metadata.
        try await wait {
            player.refreshCatalogMetadata([withArtwork("missing")])
            return artwork()?.bounds.width == 48
        }

        player.refreshCatalogMetadata([withArtwork("original")])
        player.refreshCatalogMetadata([withArtwork(nil)])
        XCTAssertEqual(artwork()?.bounds.width, 32)
        player.resume()
        XCTAssertEqual(player.phase, .failed)
        XCTAssertNil(center.nowPlayingInfo)
    }

    @MainActor
    func testRestoreUsesSavedOrderAndDoesNotOpenAudio() async throws {
        let store = try tempStore()
        let tracks = try [track("Previous"), track("Current"), track("Removed"), track("Next")]
        try seed(store, ids: tracks.map(\.id), currentID: tracks[1].id, position: 7, repeatMode: .all)
        let probe = ResolverProbe()
        let player = Player(snapshotStore: store)
        player.configure { _ in try await probe.open() }
        player.restoreCheckpoint(tracks: [tracks[3], tracks[1], tracks[0]])
        XCTAssertEqual(try store.load()?.queue.ids, [tracks[0].id, tracks[1].id, tracks[3].id],
                       "Persist pruning immediately so deleted songs cannot return on the next launch")

        XCTAssertEqual(player.current?.id, tracks[1].id)
        XCTAssertEqual(player.upcoming.map(\.id), [tracks[3].id])
        XCTAssertEqual(player.position, 7)
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.mode, .sequential)
        let untouched = await probe.calls
        XCTAssertEqual(untouched, 0)

        player.resume()
        try await wait { player.phase == .failed }
        let attempted = await probe.calls
        XCTAssertEqual(attempted, 1)
        XCTAssertEqual(player.current?.id, tracks[1].id)
        XCTAssertEqual(player.position, 7)
        XCTAssertEqual(try store.load()?.position, 7)
        XCTAssertEqual(player.upcoming.map(\.id), [tracks[3].id])
    }

    @MainActor
    func testMissingCurrentRetainsOnlyTheUnplayedTail() async throws {
        let store = try tempStore()
        let tracks = try [track("History"), track("Deleted current"), track("Upcoming")]
        try seed(store, ids: tracks.map(\.id), currentID: tracks[1].id, position: 4, repeatMode: .off)
        let player = Player(snapshotStore: store)
        player.restoreCheckpoint(tracks: [tracks[0], tracks[2]])
        let persisted = try XCTUnwrap(store.load())
        XCTAssertFalse(persisted.queue.ids.contains(tracks[1].id))
        XCTAssertEqual(persisted.position, 0)
        XCTAssertNil(player.current)
        XCTAssertEqual(player.upcoming.map(\.id), [tracks[2].id])
        XCTAssertEqual(player.position, 0)
        XCTAssertTrue(player.canGoNext)
        player.removeUpcoming(tracks[2].id)
        let reopened = Player(snapshotStore: store)
        reopened.restoreCheckpoint(tracks: tracks)
        XCTAssertFalse(reopened.hasContext)
    }

    @MainActor
    func testBadAndNewerSnapshotsDoNotBlockStartupOrGetOverwrittenOnExit() async throws {
        let store = try tempStore()
        let song = try track("Available")
        try seed(store, ids: [song.id], currentID: song.id, position: 6, repeatMode: .one)
        let encoded = try Data(contentsOf: store.url)
        var newer = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        newer["version"] = 99
        for data in [Data("{truncated".utf8), try JSONSerialization.data(withJSONObject: newer)] {
            try data.write(to: store.url, options: .atomic)
            let player = Player(snapshotStore: store)
            player.restoreCheckpoint(tracks: [song])
            XCTAssertEqual(player.phase, .idle)
            XCTAssertFalse(player.hasContext)
            player.checkpoint()
            XCTAssertEqual(try Data(contentsOf: store.url), data)
        }
    }

    @MainActor
    func testEndedSnapshotKeepsEndedState() async throws {
        let store = try tempStore()
        let song = try track("Ended")
        try seed(store, ids: [song.id], currentID: song.id, position: song.duration, repeatMode: .off, ended: true)
        let player = Player(snapshotStore: store)
        player.restoreCheckpoint(tracks: [song])
        XCTAssertEqual(player.phase, .ended)
        XCTAssertEqual(player.position, song.duration)
    }

    @MainActor
    func testResumeSeeksBeforePlaybackAndQueueEditsSurviveRelaunch() async throws {
        let store = try tempStore()
        let audio = store.url.deletingLastPathComponent().appendingPathComponent("fixture.wav")
        try writeSilentWAV(to: audio, seconds: 12)
        let songs = try [track("Start", duration: 12), track("Remove"), track("Keep")]
        try seed(store, ids: songs.map(\.id), currentID: songs[0].id, position: 6, repeatMode: .off)
        let player = Player(snapshotStore: store)
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        player.restoreCheckpoint(tracks: songs)
        player.removeUpcoming(songs[1].id)
        player.resume()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.phase, .playing)
        player.pause()
        XCTAssertEqual(player.position, 6, accuracy: 0.4)
        let reopened = Player(snapshotStore: store)
        reopened.restoreCheckpoint(tracks: songs)
        XCTAssertEqual(reopened.phase, .paused)
        XCTAssertEqual(reopened.position, 6, accuracy: 0.4)
        XCTAssertEqual(reopened.upcoming.map(\.id), [songs[2].id])
    }

    @MainActor
    func testSeekingKeepsPlaybackIntentForPlayingAndPausedAudio() async throws {
        let store = try tempStore()
        let audio = store.url.deletingLastPathComponent().appendingPathComponent("seek-fixture.wav")
        try writeSilentWAV(to: audio, seconds: 12)
        let song = try track("Seek", duration: 12)
        try seed(store, ids: [song.id], currentID: song.id, position: 1, repeatMode: .off)
        let player = Player(snapshotStore: store)
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        player.restoreCheckpoint(tracks: [song])
        player.resume()
        defer { player.pause() }
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.phase, .playing)
        XCTAssertTrue(player.seekingAvailable)

        player.seek(7)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(player.phase, .playing)
        player.pause()
        XCTAssertEqual(player.position, 7, accuracy: 0.5)

        player.seek(3)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(player.phase, .paused)
        player.pause()
        XCTAssertEqual(player.position, 3, accuracy: 0.1)
    }

    @MainActor
    func testReplacedFileWithShorterDurationRestartsAtZero() async throws {
        let store = try tempStore()
        let audio = store.url.deletingLastPathComponent().appendingPathComponent("short.wav")
        try writeSilentWAV(to: audio, seconds: 2)
        let song = try track("Replaced", duration: 12)
        try seed(store, ids: [song.id], currentID: song.id, position: 6, repeatMode: .off)
        let player = Player(snapshotStore: store)
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        player.restoreCheckpoint(tracks: [song])
        player.resume()
        player.pause()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.duration, 2, accuracy: 0.01)
        XCTAssertEqual(player.position, 0, accuracy: 0.01)
        XCTAssertEqual(try store.load()?.position, 0)
    }

    @MainActor
    func testPlayAllReplacesAlbumQueueAndAdvancesInListOrderAcrossAlbums() async throws {
        let store = try tempStore()
        let first = try track("Zebra", duration: 1, album: "Live")
        let next = try track("Apple", album: "Studio")
        let last = try track("Middle", album: "Live")
        let short = try fixture(store, "library-start", seconds: 1)
        let audio = try fixture(store, "library-queue")
        let player = Player(snapshotStore: store)
        player.configure { track in
            let file = track.id == first.id ? short : audio
            return PlayableResource(url: file, retaining: file)
        }
        player.play(first, in: [first, last])
        XCTAssertEqual(player.upcoming.map(\.id), [last.id])

        player.playAll([first, next, last])
        XCTAssertEqual(player.current?.id, first.id)
        XCTAssertEqual(player.upcoming.map(\.id), [next.id, last.id])
        try await wait { player.current?.id == next.id && player.phase == .playing }
        XCTAssertEqual(player.upcoming.map(\.id), [last.id])
        player.next()
        try await wait { player.current?.id == last.id && player.phase == .playing }
        XCTAssertTrue(player.upcoming.isEmpty)
        player.pause()
    }

    @MainActor
    func testNextSelectsTheFirstRemainingTrackWithoutSkipping() async throws {
        let store = try tempStore()
        let songs = try [track("Deleted"), track("First remaining"), track("Second remaining")]
        try seed(store, ids: songs.map(\.id), currentID: songs[0].id, position: 2, repeatMode: .off)
        let player = Player(snapshotStore: store)
        let audio = try fixture(store, "remain")
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        player.restoreCheckpoint(tracks: Array(songs.dropFirst()))
        player.next()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.upcoming.map(\.id), [songs[2].id])
        player.removeTracks(Set(songs.map(\.id)))
        let reopened = Player(snapshotStore: store)
        reopened.restoreCheckpoint(tracks: songs)
        XCTAssertFalse(reopened.hasContext)
    }

    @MainActor
    func testPreviousResetsRestoredPositionWithoutOpeningAudio() async throws {
        let store = try tempStore()
        let songs = try [track("History"), track("Current")]
        try seed(store, ids: songs.map(\.id), currentID: songs[1].id, position: 6, repeatMode: .off)
        let player = Player(snapshotStore: store)
        let probe = ResolverProbe()
        player.configure { _ in try await probe.open() }
        player.restoreCheckpoint(tracks: songs)
        player.previous()
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.position, 0)
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(try store.load()?.position, 0)
        let calls = await probe.calls
        XCTAssertEqual(calls, 0)
    }

    @MainActor
    func testExplicitRestartRecoversTheSameTrackFromZeroAfterFailedResume() async throws {
        let store = try tempStore()
        let audio = store.url.deletingLastPathComponent().appendingPathComponent("fixture.wav")
        try writeSilentWAV(to: audio, seconds: 12)
        let song = try track("Retry", duration: 12)
        try seed(store, ids: [song.id], currentID: song.id, position: 6, repeatMode: .off)
        let player = Player(snapshotStore: store)
        player.configure { _ in throw CocoaError(.fileReadNoSuchFile) }
        player.restoreCheckpoint(tracks: [song])
        player.resume()
        try await wait { player.phase == .failed }
        XCTAssertEqual(try store.load()?.position, 6)
        XCTAssertTrue(player.canRestartFromBeginning)

        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        player.restartFromBeginning()
        player.pause()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.current?.id, song.id)
        XCTAssertEqual(player.position, 0, accuracy: 0.01)
        XCTAssertEqual(try store.load()?.position, 0)
    }

    @MainActor
    func testV1CheckpointPreservesPositionButDoesNotInventPlayedHistory() throws {
        let store = try tempStore()
        let songs = try [track("Never played"), track("Current"), track("Next")]
        let data = try JSONSerialization.data(withJSONObject: [
            "version": 1, "ids": songs.map { $0.id.uuidString }, "currentID": songs[1].id.uuidString,
            "position": 2.5, "repeatMode": "all", "ended": false,
        ])
        try data.write(to: store.url)
        let player = Player(snapshotStore: store)
        player.restoreCheckpoint(tracks: songs)
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.position, 2.5)
        XCTAssertEqual(player.mode, .sequential)
        XCTAssertEqual(player.upcoming.map(\.id), [songs[2].id])
        player.previous()
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.position, 0)
    }

    @MainActor
    func testJumpHistorySurvivesRelaunchAndNextFollowsReplayPath() async throws {
        let store = try tempStore()
        let songs = try [track("A"), track("B"), track("C"), track("D")]
        let player = Player(snapshotStore: store)
        player.play(songs[0], in: songs)
        player.jump(to: songs[2].id)

        let reopened = Player(snapshotStore: store)
        let audio = try fixture(store, "history")
        reopened.configure { _ in PlayableResource(url: audio, retaining: audio) }
        reopened.restoreCheckpoint(tracks: songs)
        XCTAssertEqual(reopened.current?.id, songs[2].id)
        XCTAssertEqual(reopened.phase, .paused)
        reopened.previous()
        try await wait { reopened.phase != .loading }
        XCTAssertEqual(reopened.current?.id, songs[0].id)
        XCTAssertEqual(reopened.upcoming.map(\.id), [songs[2].id, songs[3].id])
        reopened.next()
        try await wait { reopened.phase != .loading }
        XCTAssertEqual(reopened.current?.id, songs[2].id)
        XCTAssertEqual(reopened.phase, .paused)
    }

    @MainActor
    func testModeCyclePreservesPausedTrackAndPersistsExactlyOneMode() throws {
        let store = try tempStore()
        let songs = try [track("Previous"), track("Current"), track("Next"), track("Last")]
        let expectedTail = songs.suffix(2).map(\.id)
        try seed(store, ids: songs.map(\.id), currentID: songs[1].id, position: 5, repeatMode: .off)
        let player = Player(snapshotStore: store)
        player.restoreCheckpoint(tracks: songs)
        XCTAssertEqual(player.mode, .sequential)

        let modes: [PlaybackMode] = [.repeatOne, .shuffle, .sequential]
        for mode in modes {
            player.cyclePlaybackMode()
            XCTAssertEqual(player.mode, mode)
            XCTAssertEqual(player.current?.id, songs[1].id)
            XCTAssertEqual(player.position, 5)
            XCTAssertEqual(player.phase, .paused)
            if mode == .shuffle {
                XCTAssertEqual(Set(player.upcoming.map(\.id)), Set(songs.map(\.id)).subtracting([songs[1].id]))
                XCTAssertEqual(player.upcoming.count, 3)
            } else {
                XCTAssertEqual(player.upcoming.map(\.id), expectedTail)
            }

            let saved = try XCTUnwrap(store.load())
            XCTAssertEqual(saved.queue.isShuffled, mode == .shuffle)
            XCTAssertEqual(saved.repeatMode, mode == .repeatOne ? .one : .off)
            let reopened = Player(snapshotStore: store)
            reopened.restoreCheckpoint(tracks: songs)
            XCTAssertEqual(reopened.mode, mode)
            XCTAssertEqual(reopened.upcoming, player.upcoming)
        }
    }

    @MainActor
    func testLegacyCombinedModeRestoresShuffleWithoutRepeatingTheCurrentTrack() throws {
        let store = try tempStore()
        let songs = try [track("Current"), track("Second"), track("Third")]
        var queue = PlaybackQueue(ids: songs.map(\.id), start: songs[0].id)
        queue.setShuffle(true)
        try store.save(.init(queue: queue, position: 4, repeatMode: .one))

        let player = Player(snapshotStore: store)
        player.restoreCheckpoint(tracks: songs)
        XCTAssertEqual(player.mode, .shuffle)
        XCTAssertEqual(player.position, 4)
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.upcoming.map(\.id), queue.upcoming)
        player.checkpoint()
        XCTAssertEqual(try store.load()?.repeatMode, .off)
        XCTAssertEqual(try store.load()?.queue, queue)
    }

    @MainActor
    func testShuffledTailAndModeAreRestoredExactlyWithoutOpeningAudio() async throws {
        let store = try tempStore()
        let songs = try (0..<7).map { try track("Track \($0)") }
        try seed(store, ids: songs.map(\.id), currentID: songs[0].id, position: 0, repeatMode: .one)
        let player = Player(snapshotStore: store)
        let audio = try fixture(store, "shuffle")
        player.configure { _ in PlayableResource(url: audio, retaining: audio) }
        player.restoreCheckpoint(tracks: songs)
        player.cyclePlaybackMode()
        let first = try XCTUnwrap(player.upcoming.first)
        player.next()
        try await wait { player.phase != .loading }
        player.removeUpcoming(try XCTUnwrap(player.upcoming.last).id)
        let order = player.upcoming.map(\.id)
        let missing = try XCTUnwrap(order.first)
        let probe = CandidateProbe(resources: [songs[0].id: audio])
        let reopened = Player(snapshotStore: store)
        reopened.configure { try await probe.open($0.id) }
        reopened.restoreCheckpoint(tracks: songs.reversed().filter { $0.id != missing })
        XCTAssertEqual(reopened.mode, .shuffle)
        XCTAssertEqual(try store.load()?.repeatMode, .off)
        XCTAssertEqual(reopened.current?.id, first.id)
        XCTAssertEqual(reopened.upcoming.map(\.id), Array(order.dropFirst()))
        let untouched = await probe.attempts
        XCTAssertTrue(untouched.isEmpty)
        reopened.previous()
        try await wait { reopened.phase != .loading }
        XCTAssertEqual(reopened.current?.id, songs[0].id)
        XCTAssertEqual(reopened.upcoming.first?.id, first.id)
        XCTAssertEqual(reopened.phase, .paused)
        let calls = await probe.attempts
        XCTAssertEqual(calls, [songs[0].id])
    }

    func testV2RejectsQueueWithInvalidFutureOrHistory() throws {
        let store = try tempStore()
        let a = UUID(), b = UUID(), outside = UUID()
        try seed(store, ids: [a, b], currentID: a, position: 2, repeatMode: .all)
        let encoded = try Data(contentsOf: store.url)
        let source = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(source["version"] as? Int, 2)
        let dictionary = try XCTUnwrap(source["queue"] as? [String: Any])
        for (key, invalid) in [("pending", [b.uuidString, b.uuidString]), ("pending", [a.uuidString]),
                               ("replay", [a.uuidString]),
                               ("history", [outside.uuidString]), ("history", [a.uuidString])] {
            var snapshot = source
            var queue = dictionary
            queue[key] = invalid
            snapshot["queue"] = queue
            try JSONSerialization.data(withJSONObject: snapshot).write(to: store.url)
            XCTAssertThrowsError(try store.load())
        }
    }

    func testSnapshotRejectsInvalidPositionOrInconsistentLegacyIDs() throws {
        let store = try tempStore()
        let id = UUID()
        let queue = PlaybackQueue(ids: [id], start: id)
        let good = PlaybackSnapshot(queue: queue, position: 6, repeatMode: .off)
        try store.save(good)
        for invalid in [
            PlaybackSnapshot(queue: queue, position: -.infinity, repeatMode: .off),
            .init(queue: queue, position: -1, repeatMode: .off),
            .init(queue: .init(), position: 6, repeatMode: .off),
            .init(queue: .init(), position: 0, repeatMode: .off, ended: true),
        ] {
            XCTAssertThrowsError(try store.save(invalid))
            XCTAssertEqual(try store.load(), good)
        }
        for (ids, current) in [([id, id], id), ([id], UUID())] {
            let data = try JSONSerialization.data(withJSONObject: [
                "version": 1, "ids": ids.map(\.uuidString), "currentID": current.uuidString,
                "position": 0, "repeatMode": "off", "ended": false,
            ])
            try data.write(to: store.url)
            XCTAssertThrowsError(try store.load())
        }
    }

    @MainActor
    func testNaturalAdvanceSkipsCorruptAudioWithoutRecordingItAsHistory() async throws {
        let store = try tempStore()
        let songs = try [track("Short", duration: 1), track("Corrupt"), track("Good")]
        let short = try fixture(store, "short", seconds: 1)
        let good = try fixture(store, "good")
        let corrupt = short.deletingLastPathComponent().appendingPathComponent("corrupt.wav")
        try Data("not audio".utf8).write(to: corrupt)
        let probe = CandidateProbe(resources: [songs[0].id: short, songs[1].id: corrupt, songs[2].id: good])
        let player = Player(snapshotStore: store)
        player.configure { try await probe.open($0.id) }
        player.play(songs[0], in: songs)
        try await wait { player.phase == .failed || (player.current?.id == songs[2].id && player.phase == .playing) }

        XCTAssertEqual(player.current?.id, songs[2].id)
        XCTAssertEqual(player.phase, .playing)
        XCTAssertEqual(player.skippedTrackCount, 1)
        XCTAssertFalse(player.exhaustedCandidates)
        XCTAssertEqual(try store.load()?.queue.history, [songs[0].id])
        XCTAssertEqual(try store.load()?.queue.ids, songs.map(\.id))
        let attempts = await probe.attempts
        XCTAssertEqual(attempts, songs.map(\.id))
        player.pause()
    }

    @MainActor
    func testSequentialExhaustionDoesNotWrapAndRetryCanRecover() async throws {
        let store = try tempStore()
        let songs = try [track("First"), track("Current"), track("Missing"), track("Last")]
        let good = try fixture(store, "restored")
        try seed(store, ids: songs.map(\.id), currentID: songs[1].id, position: 2, repeatMode: .all)
        let probe = CandidateProbe()
        let player = Player(snapshotStore: store)
        player.configure { try await probe.open($0.id) }
        player.restoreCheckpoint(tracks: songs)
        player.next()
        try await wait { player.phase == .failed }
        XCTAssertTrue(player.exhaustedCandidates)
        XCTAssertFalse(player.canRestartFromBeginning)
        let attempts = await probe.attempts
        XCTAssertEqual(attempts, [songs[2].id, songs[3].id])
        XCTAssertEqual(try store.load()?.queue.ids, songs.map(\.id))
        XCTAssertTrue(try XCTUnwrap(store.load()).queue.history.isEmpty)
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.position, 2)

        await probe.restore(songs[3].id, with: good)
        player.resume()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.current?.id, songs[3].id)
        XCTAssertEqual(player.phase, .playing)
        XCTAssertEqual(player.skippedTrackCount, 1)
        XCTAssertFalse(player.exhaustedCandidates)
        player.pause()
    }

    @MainActor
    func testPreviousSkipsUnavailableHistoryAndRemainsPaused() async throws {
        let store = try tempStore()
        let songs = try [track("Playable prior"), track("Missing prior"), track("Current"), track("Pending")]
        var queue = PlaybackQueue(ids: songs.map(\.id))
        XCTAssertTrue(queue.jump(to: songs[1].id))
        XCTAssertTrue(queue.jump(to: songs[2].id))
        try store.save(.init(queue: queue, position: 0, repeatMode: .off))
        let good = try fixture(store, "prior")
        let probe = CandidateProbe(resources: [songs[0].id: good])
        let player = Player(snapshotStore: store)
        player.configure { try await probe.open($0.id) }
        player.restoreCheckpoint(tracks: songs)
        player.previous()
        try await wait { player.phase != .loading }
        let attempts = await probe.attempts
        XCTAssertEqual(attempts, [songs[1].id, songs[0].id])
        XCTAssertEqual(player.current?.id, songs[0].id)
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.position, 0)
        XCTAssertEqual(player.upcoming.map(\.id), [songs[2].id, songs[3].id])
        XCTAssertEqual(try store.load()?.queue.ids, songs.map(\.id))
    }

    @MainActor
    func testResumeAfterRemovingCurrentSelectsFirstPlayableRemainingTrack() async throws {
        let store = try tempStore()
        let songs = try [track("Removed current"), track("Missing next"), track("Playable next")]
        try seed(store, ids: songs.map(\.id), currentID: songs[0].id, position: 1, repeatMode: .one)
        let audio = try fixture(store, "leftover")
        let probe = CandidateProbe(resources: [songs[2].id: audio])
        let player = Player(snapshotStore: store)
        player.configure { try await probe.open($0.id) }
        player.restoreCheckpoint(tracks: songs)
        player.removeTracks([songs[0].id])
        player.resume()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.current?.id, songs[2].id)
        XCTAssertEqual(player.phase, .playing)
        XCTAssertEqual(try store.load()?.queue.history, [])
        player.pause()
    }

    @MainActor
    func testPausedNavigationInvalidatesSuspendedCandidateOnPauseRemovalOrNewTrack() async throws {
        let store = try tempStore()
        let songs = try [track("Anchor"), track("Slow candidate"), track("New track")]
        let audio = try fixture(store, "good")
        for action in ["pause", "remove", "select"] {
            try seed(store, ids: songs.map(\.id), currentID: songs[0].id, position: 2, repeatMode: .off)
            var resources = [songs[2].id: audio]
            if action != "select" { resources[songs[1].id] = audio }
            let probe = CandidateProbe(resources: resources, suspended: songs[1].id)
            let player = Player(snapshotStore: store)
            player.configure { try await probe.open($0.id) }
            player.restoreCheckpoint(tracks: songs)
            player.next()
            // A paused navigation must still resolve the media without playing it.
            let deadline = ContinuousClock.now + .seconds(2)
            while await !probe.isWaiting, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(10)) }
            let isWaiting = await probe.isWaiting
            guard isWaiting else { return XCTFail("Did not start resolving the paused candidate") }
            XCTAssertEqual(player.current?.id, songs[0].id)
            XCTAssertEqual(try store.load()?.queue.current, songs[0].id)
            switch action {
            case "pause": player.pause()
            case "remove": player.removeUpcoming(songs[1].id)
            default: player.play(songs[2], in: songs)
            }
            await probe.releaseSuspended()
            try await wait { player.phase != .loading }
            try await Task.sleep(for: .milliseconds(80))
            XCTAssertEqual(player.current?.id, action == "select" ? songs[2].id : songs[0].id)
            XCTAssertEqual(player.phase, action == "select" ? .playing : .paused)
            XCTAssertEqual(try store.load()?.queue.current, player.current?.id)
            if action == "remove" { XCTAssertEqual(player.upcoming.map(\.id), [songs[2].id]) }
            if action != "select" { XCTAssertEqual(player.position, 2) }
            let attempts = await probe.attempts
            XCTAssertEqual(attempts, action == "select" ? [songs[1].id, songs[2].id] : [songs[1].id])
            player.pause()
        }
    }

    @MainActor
    func testNaturalRepeatOneStopsWhenReopenFailsButManualNextStillWorks() async throws {
        let store = try tempStore()
        let songs = try [track("Repeat", duration: 1), track("Next")]
        let short = try fixture(store, "one", seconds: 1)
        let next = try fixture(store, "next")
        let probe = CandidateProbe(resources: [songs[0].id: short, songs[1].id: next])
        let player = Player(snapshotStore: store)
        player.configure { try await probe.open($0.id) }
        player.cyclePlaybackMode()
        player.play(songs[0], in: songs)
        try await wait { player.phase == .playing }
        await probe.makeUnavailable(songs[0].id)
        try await wait { player.phase == .failed }
        let attempts = await probe.attempts
        XCTAssertEqual(attempts, [songs[0].id, songs[0].id])
        XCTAssertTrue(player.exhaustedCandidates)
        XCTAssertEqual(player.current?.id, songs[0].id)
        XCTAssertEqual(player.upcoming.map(\.id), [songs[1].id])
        player.next()
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.phase, .playing)
        XCTAssertFalse(player.exhaustedCandidates)
        player.pause()
    }

    private func fixture(_ store: PlaybackSnapshotStore, _ name: String, seconds: UInt32 = 12) throws -> URL {
        let audio = store.url.deletingLastPathComponent().appendingPathComponent(name + ".wav")
        try writeSilentWAV(to: audio, seconds: seconds)
        return audio
    }

    private func seed(_ store: PlaybackSnapshotStore, ids: [UUID], currentID: UUID?, position: Double,
                      repeatMode: RepeatMode, ended: Bool = false) throws {
        let queue = try XCTUnwrap(PlaybackQueue(legacyIDs: ids, current: currentID))
        try store.save(.init(queue: queue, position: position, repeatMode: repeatMode, ended: ended))
    }

    @MainActor
    private func wait(_ finished: @MainActor () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while !finished(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(finished(), "Playback did not settle before the deadline")
    }

    private func track(_ title: String, duration: Double = 20, album: String? = nil) throws -> Track {
        .init(rootID: UUID(), path: try XCTUnwrap(RelativeAudioPath("\(title).wav")),
              metadata: .init(title: title, artist: nil, albumArtist: nil, album: album), duration: duration)
    }

    private func tempStore() throws -> PlaybackSnapshotStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: directory) }
        return PlaybackSnapshotStore(url: directory.appendingPathComponent("PlaybackSnapshot.json"))
    }

    private func writeSilentWAV(to url: URL, seconds: UInt32) throws {
        let rate: UInt32 = 8_000
        let byteCount = rate * 2 * seconds
        var data = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
        }
        append(byteCount + 36)
        data.append(Data("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(rate); append(rate * 2); append(UInt16(2)); append(UInt16(16))
        data.append(Data("data".utf8))
        append(byteCount)
        data.append(Data(count: Int(byteCount)))
        try data.write(to: url)
    }
}

private actor ResolverProbe {
    private(set) var calls = 0
    func open() throws -> PlayableResource {
        calls += 1
        throw CocoaError(.fileReadNoSuchFile)
    }
}

private actor CandidateProbe {
    private var resources: [UUID: URL]
    private let suspended: UUID?
    private var gate: CheckedContinuation<Void, Never>?
    private(set) var attempts: [UUID] = []
    var isWaiting: Bool { gate != nil }

    init(resources: [UUID: URL] = [:], suspended: UUID? = nil) {
        self.resources = resources
        self.suspended = suspended
    }

    func open(_ id: UUID) async throws -> PlayableResource {
        attempts.append(id)
        if id == suspended { await withCheckedContinuation { gate = $0 } }
        guard let url = resources[id] else { throw CocoaError(.fileReadNoSuchFile) }
        return PlayableResource(url: url, retaining: url)
    }

    func restore(_ id: UUID, with url: URL) { resources[id] = url }
    func makeUnavailable(_ id: UUID) { resources[id] = nil }
    func releaseSuspended() { gate?.resume(); gate = nil }
}

extension PlaybackResumeTests {
    @MainActor
    func testRefreshTrackDisplayNamesWithoutReorderingOrOpeningPlayback() async throws {
        let store = try tempStore()
        let songs = try [track("Start"), track("Upcoming"), track("Last")]
        try seed(store, ids: songs.map(\.id), currentID: songs[0].id, position: 4, repeatMode: .one)
        let probe = ResolverProbe()
        let player = Player(snapshotStore: store)
        player.configure { _ in try await probe.open() }
        player.restoreCheckpoint(tracks: songs)
        let edits = songs.map { song in
            Track(id: song.id, rootID: song.rootID, path: song.path,
                  metadata: .init(title: "Edited \(song.metadata.title)", artist: "Artist", albumArtist: nil, album: nil),
                  duration: song.duration)
        }
        player.refreshCatalogMetadata(edits.reversed())
        XCTAssertEqual(player.current?.metadata.title, "Edited Start")
        XCTAssertEqual(player.upcoming.map(\.id), Array(songs.dropFirst().map(\.id)))
        XCTAssertEqual(player.upcoming.first?.metadata.title, "Edited Upcoming")
        XCTAssertEqual(player.position, 4)
        XCTAssertEqual(player.phase, .paused)
        XCTAssertEqual(player.mode, .repeatOne)
        let calls = await probe.calls
        XCTAssertEqual(calls, 0)
    }
}

extension PlaybackResumeTests {
    @MainActor
    func testRemovingLaterTrackDoesNotCancelPendingSwitchOrRestoreRemovedItems() async throws {
        let store = try tempStore()
        let audio = store.url.deletingLastPathComponent().appending(component: "audio.wav")
        try writeSilentWAV(to: audio, seconds: 12)
        let songs = try [track("A"), track("B"), track("C"), track("D")]
        let player = Player(snapshotStore: store)
        player.configure { song in
            if song.id == songs[1].id { try await Task.sleep(for: .milliseconds(180)) }
            return PlayableResource(url: audio, retaining: audio)
        }
        player.playAll(songs)
        try await wait { player.phase == .playing }
        player.next()
        XCTAssertEqual(player.phase, .loading)
        player.removeTracks([songs[2].id])
        XCTAssertEqual(player.phase, .loading)
        try await wait { player.phase != .loading }
        XCTAssertEqual(player.phase, .playing)
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertEqual(player.upcoming.map(\.id), [songs[3].id])
        XCTAssertFalse(try XCTUnwrap(store.load()).queue.ids.contains(songs[2].id))
    }

}
