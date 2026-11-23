import Domain
import Foundation
import XCTest

final class PlaybackQueueTests: XCTestCase {
    func testJumpSkipsPendingItemsWithoutInventingHistory() {
        let songs = (0..<5).map { _ in UUID() }
        var queue = PlaybackQueue(ids: songs, start: songs[0])
        XCTAssertTrue(queue.jump(to: songs[3]))
        XCTAssertEqual(queue.history, [songs[0]])
        XCTAssertEqual(queue.upcoming, [songs[4]])
        XCTAssertEqual(queue.previous(), songs[0])
        XCTAssertEqual(queue.upcoming, [songs[3], songs[4]])
        XCTAssertEqual(queue.advance(mode: .off, automatic: false), songs[3])
        XCTAssertEqual(queue.advance(mode: .off, automatic: true), songs[4])
    }

    func testStartingInMiddleDoesNotInventPriorPlayback() {
        let songs = (0..<4).map { _ in UUID() }
        var queue = PlaybackQueue(ids: songs, start: songs[2])
        XCTAssertNil(queue.previous())
        XCTAssertEqual(queue.upcoming, [songs[3]])
    }

    func testShuffleIsSeededAndDoesNotReplaceCurrentOrConsumeRepeatOne() {
        let songs = (0..<5).map { _ in UUID() }
        var left = PlaybackQueue(ids: songs, start: songs[1])
        var right = left
        var rng = FixtureRNG(state: 73)
        var other = FixtureRNG(state: 73)
        left.setShuffle(true, using: &rng)
        right.setShuffle(true, using: &other)
        XCTAssertEqual(left.current, songs[1])
        let pending = left.upcoming
        XCTAssertEqual(pending, right.upcoming)
        XCTAssertEqual(pending.count, 4)
        XCTAssertEqual(Set(pending), Set(songs.filter { $0 != songs[1] }))
        XCTAssertEqual(left.advance(mode: .one, automatic: true, using: &rng), songs[1])
        XCTAssertEqual(left.upcoming, pending)
        XCTAssertTrue(left.history.isEmpty)
        XCTAssertEqual(left.advance(mode: .one, automatic: false, using: &rng), pending[0])
        XCTAssertEqual(left.previous(), songs[1])
        XCTAssertEqual(left.upcoming, pending)
        left.setShuffle(false, using: &rng)
        XCTAssertFalse(left.isShuffled)
        XCTAssertEqual(left.current, songs[1])
        XCTAssertEqual(left.upcoming, Array(songs.dropFirst(2)))
    }

    func testShuffleFinishesWithoutRepeatAndLoopsInASeparateRoundWithoutBoundaryRepeat() throws {
        let songs = (0..<6).map { _ in UUID() }
        var queue = PlaybackQueue(ids: songs, start: songs[0])
        var rng = FixtureRNG(state: 21)
        queue.setShuffle(true, using: &rng)
        var firstRound = [songs[0]]
        while let id = queue.advance(mode: .off, automatic: true, using: &rng) { firstRound.append(id) }
        XCTAssertEqual(Set(firstRound), Set(songs))
        XCTAssertEqual(firstRound.count, songs.count)
        let boundary = try XCTUnwrap(queue.advance(mode: .all, automatic: true, using: &rng))
        XCTAssertNotEqual(boundary, firstRound.last)
        XCTAssertEqual(Set([boundary] + queue.upcoming), Set(songs))
        XCTAssertEqual(queue.upcoming.count, songs.count - 1)
        XCTAssertEqual(queue.previous(), firstRound.last)
        XCTAssertEqual(queue.advance(mode: .all, automatic: false, using: &rng), boundary)
    }

    func testPreviousAndNextAcrossLoopBoundaryLeaveNewRoundIntact() throws {
        let a = UUID(), b = UUID()
        var queue = PlaybackQueue(ids: [a, b], start: a)
        var rng = FixtureRNG(state: 9)
        queue.setShuffle(true, using: &rng)
        XCTAssertEqual(queue.advance(mode: .all, automatic: false, using: &rng), b)
        XCTAssertEqual(queue.advance(mode: .all, automatic: false, using: &rng), a)
        XCTAssertEqual(queue.upcoming, [b])
        XCTAssertEqual(queue.previous(), b)
        XCTAssertEqual(queue.upcoming, [a])
        queue = try JSONDecoder().decode(PlaybackQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertEqual(queue.advance(mode: .off, automatic: false, using: &rng), a)
        XCTAssertEqual(queue.upcoming, [b])
        XCTAssertEqual(queue.advance(mode: .off, automatic: false, using: &rng), b)
        XCTAssertNil(queue.advance(mode: .off, automatic: false, using: &rng))
    }

    func testShuffledRemovalEliminatesAllReferencesAcrossRounds() throws {
        let songs = (0..<4).map { _ in UUID() }
        var queue = PlaybackQueue(ids: songs, start: songs[0])
        var rng = FixtureRNG(state: 49)
        queue.setShuffle(true, using: &rng)
        let remove = try XCTUnwrap(queue.advance(mode: .off, automatic: false, using: &rng))
        XCTAssertEqual(queue.previous(), songs[0])
        queue.removeUpcoming(remove)
        XCTAssertFalse(queue.upcoming.contains(remove))
        XCTAssertFalse(queue.ids.contains(remove))
        XCTAssertFalse(queue.history.contains(remove))
        for _ in 0..<12 { XCTAssertNotEqual(queue.advance(mode: .all, automatic: true, using: &rng), remove) }
    }

    func testMissingShuffledCurrentRetainsShuffledTailWithoutBringingBackHistory() throws {
        let songs = (0..<5).map { _ in UUID() }
        var queue = PlaybackQueue(ids: songs, start: songs[0])
        var rng = FixtureRNG(state: 5)
        queue.setShuffle(true, using: &rng)
        let current = try XCTUnwrap(queue.advance(mode: .off, automatic: false, using: &rng))
        let pending = queue.upcoming
        queue.removeTracks([current])
        XCTAssertNil(queue.current)
        XCTAssertEqual(queue.upcoming, pending)
        XCTAssertTrue(queue.history.isEmpty)
        XCTAssertTrue(queue.isShuffled)
        XCTAssertFalse(queue.ids.contains(songs[0]))
        XCTAssertEqual(queue.advance(mode: .off, automatic: false, using: &rng), pending[0])
    }

    func testSingleSongShuffleCanRepeatWithoutCreatingFakePrevious() {
        let song = UUID()
        var queue = PlaybackQueue(ids: [song], start: song)
        var rng = FixtureRNG(state: 7)
        queue.setShuffle(true, using: &rng)
        XCTAssertNil(queue.advance(mode: .off, automatic: true, using: &rng))
        XCTAssertEqual(queue.advance(mode: .all, automatic: true, using: &rng), song)
        XCTAssertNil(queue.previous())
    }
}

private struct FixtureRNG: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9e3779b97f4a7c15
        var value = state
        value = (value ^ (value >> 30)) &* 0xbf58476d1ce4e5b9
        value = (value ^ (value >> 27)) &* 0x94d049bb133111eb
        return value ^ (value >> 31)
    }
}
