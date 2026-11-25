@testable import DesignSystem
import XCTest

final class PlaybackSliderPositionTests: XCTestCase {
    func testTapUsesActualThumbCentersRatherThanTheWholeViewWidth() {
        XCTAssertEqual(value(24), 0)
        XCTAssertEqual(value(174), 50)
        XCTAssertEqual(value(324), 100)
    }

    func testTapsOutsideTheTrackClampToTheSongBounds() {
        XCTAssertEqual(value(-200), 0)
        XCTAssertEqual(value(600), 100)
    }

    func testRightToLeftTracksKeepTheSameTimelineDirectionAsTheNativeSlider() {
        XCTAssertEqual(value(324, minimumX: 324, maximumX: 24), 0)
        XCTAssertEqual(value(249, minimumX: 324, maximumX: 24), 25)
        XCTAssertEqual(value(174, minimumX: 324, maximumX: 24), 50)
        XCTAssertEqual(value(99, minimumX: 324, maximumX: 24), 75)
        XCTAssertEqual(value(24, minimumX: 324, maximumX: 24), 100)
    }

    func testNonzeroValueRangesAreRespected() {
        XCTAssertEqual(PlaybackSliderPosition.value(at: 174, minimumX: 24, maximumX: 324,
                                                   minimumValue: 20, maximumValue: 120), 70)
    }

    func testFractionalDurationsKeepSeekPrecision() throws {
        let target = try XCTUnwrap(value(204, duration: 277.32))
        XCTAssertEqual(target, 166.392, accuracy: 0.0001)
    }

    func testZeroWidthAndUnavailableDurationsDoNotProduceSeekTargets() {
        XCTAssertNil(value(50, minimumX: 20, maximumX: 20))
        XCTAssertNil(value(50, duration: 0))
        XCTAssertNil(value(50, duration: -1))
    }

    func testNonfiniteInputIsRejected() {
        XCTAssertNil(value(.nan))
        XCTAssertNil(value(.infinity))
        XCTAssertNil(value(50, minimumX: .nan))
        XCTAssertNil(value(50, maximumX: .infinity))
        XCTAssertNil(value(50, duration: .infinity))
        XCTAssertNil(PlaybackSliderPosition.value(at: 50, minimumX: 24, maximumX: 324,
                                                 minimumValue: .nan, maximumValue: 100))
    }

    private func value(_ x: Double, minimumX: Double = 24, maximumX: Double = 324,
                       duration: Double = 100) -> Double? {
        PlaybackSliderPosition.value(at: x, minimumX: minimumX, maximumX: maximumX, maximumValue: duration)
    }
}
