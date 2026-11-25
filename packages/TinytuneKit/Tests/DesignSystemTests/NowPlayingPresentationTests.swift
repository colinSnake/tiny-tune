import CoreGraphics
import Domain
@testable import DesignSystem
import XCTest

final class NowPlayingPresentationTests: XCTestCase {
    func testCoverRotatesClockwiseAndKeepsItsAngleAcrossPause() {
        let start = ContinuousClock.now
        var rotation = RecordLabelRotation()
        rotation.setRunning(true, at: start)
        XCTAssertEqual(rotation.degrees(at: start + .seconds(4)), 90, accuracy: 0.001)
        rotation.setRunning(false, at: start + .seconds(5))
        XCTAssertEqual(rotation.degrees(at: start + .seconds(25)), 112.5, accuracy: 0.001)
        rotation.setRunning(true, at: start + .seconds(25))
        XCTAssertEqual(rotation.degrees(at: start + .seconds(38)), 45, accuracy: 0.001)
    }

    func testTonearmBendsFromTheOuterPivotIntoTheGrooves() {
        let record = NowPlayingRecordGeometry()
        XCTAssertGreaterThan(hypot(record.pivot.x - record.center.x, record.pivot.y - record.center.y), record.radius)
        XCTAssertLessThan(record.pivot.y, record.cartridge.y)
        XCTAssertTrue(record.tube.contains(where: { segment in
            segment.end.x < segment.control1.x && segment.control2.x < segment.control1.x
        }))
        let distance = hypot(record.cartridge.x - record.center.x, record.cartridge.y - record.center.y)
        XCTAssertLessThan(distance, record.radius)
        XCTAssertGreaterThan(distance, record.labelRadius)
    }

    func testTonearmUsesTheApprovedUpperRightProfileOnBothPlatforms() {
        for geometry in [NowPlayingRecordGeometry(), .phone] {
            let radius = geometry.radius
            let center = geometry.center
            let tip = geometry.needleTip
            XCTAssertEqual((geometry.pivot.x - center.x) / radius, 133.0 / 134, accuracy: 0.001)
            XCTAssertEqual((center.y - geometry.pivot.y) / radius, 122.0 / 134, accuracy: 0.001)
            XCTAssertEqual((geometry.cartridge.x - center.x) / radius, 95.0 / 134, accuracy: 0.001)
            XCTAssertEqual((tip.x - center.x) / radius, 85.8581 / 134, accuracy: 0.001)
            XCTAssertEqual((center.y - tip.y) / radius, 57.9206 / 134, accuracy: 0.001)
            XCTAssertEqual(geometry.tube.count, 2)
            XCTAssertEqual(geometry.tube.last?.end, geometry.cartridge)
        }
    }

    func testPhoneRecordCentersDiscAndPlacesNeedleOnPlayableGrooves() {
        let geometry = NowPlayingRecordGeometry.phone
        XCTAssertEqual(geometry.center.x, geometry.size.width / 2)
        let tip = geometry.needleTip
        let distance = hypot(tip.x - geometry.center.x, tip.y - geometry.center.y)
        XCTAssertGreaterThan(distance, geometry.labelRadius + 6)
        XCTAssertLessThan(distance, geometry.radius - 5)
        XCTAssertLessThanOrEqual(geometry.pivot.x + 20, geometry.size.width)
    }

    func testArtworkOccupiesAboutTwoThirdsOfTheDiscOnBothPlatforms() {
        for geometry in [NowPlayingRecordGeometry(), .phone] {
            XCTAssertGreaterThanOrEqual(geometry.labelRadius / geometry.radius, 0.66)
            XCTAssertLessThanOrEqual(geometry.labelRadius / geometry.radius, 0.72)
            let tip = geometry.needleTip
            let distance = hypot(tip.x - geometry.center.x, tip.y - geometry.center.y)
            XCTAssertGreaterThan(distance, geometry.labelRadius + 6)
            XCTAssertLessThan(distance, geometry.radius - 5)
        }
    }

    func testLyricWindowShowsFiveLinesAroundCurrentCueAndFillsAtSongEdges() {
        let document = LyricsDocument.parse("""
        [00:02.00]第一句
        [00:04.00]第二句
        [00:06.00]第三句
        [00:08.00]第四句
        [00:10.00]第五句
        [00:12.00]第六句
        [00:14.00]第七句
        """)
        XCTAssertEqual(NowPlayingLyricWindow.visibleLineCount, 5)
        let opening = NowPlayingLyricWindow(document: document, position: 0)
        XCTAssertNil(opening.current)
        XCTAssertEqual(opening.visible, [0, 1, 2, 3, 4])
        let first = NowPlayingLyricWindow(document: document, position: 2)
        XCTAssertEqual(first.current, 0)
        XCTAssertEqual(first.visible, [0, 1, 2, 3, 4])
        let middle = NowPlayingLyricWindow(document: document, position: 8)
        XCTAssertEqual(middle.current, 3)
        XCTAssertEqual(middle.visible, [1, 2, 3, 4, 5])
        let last = NowPlayingLyricWindow(document: document, position: 20)
        XCTAssertEqual(last.current, 6)
        XCTAssertEqual(last.visible, [2, 3, 4, 5, 6])
        XCTAssertEqual(NowPlayingLyricWindow(document: document, position: 2).visible, first.visible)
    }

    func testLyricContextSkipsEmptyCuesAndDoesNotKeepSungLinesDuringGaps() {
        let document = LyricsDocument.parse("""
        [00:02.00]已经唱过
        [00:04.00]
        [00:07.00]即将演唱
        [00:09.00]下一句
        [00:11.00]
        """)
        let gap = NowPlayingLyricWindow(document: document, position: 5)
        XCTAssertNil(gap.current)
        XCTAssertEqual(gap.visible, [2, 3])
        let ending = NowPlayingLyricWindow(document: document, position: 12)
        XCTAssertNil(ending.current)
        XCTAssertTrue(ending.visible.isEmpty)
    }

    func testLyricContextHandlesPlainTextAndShortSongsWithoutSyntheticRows() {
        let plain = NowPlayingLyricWindow(document: .parse("没有时间戳的歌词"), position: 10)
        XCTAssertTrue(plain.visible.isEmpty)
        let short = NowPlayingLyricWindow(document: .parse("[00:02.00]唯一一句"), position: 2)
        XCTAssertEqual(short.current, 0)
        XCTAssertEqual(short.visible, [0])
    }

    func testLyricWindowUsesUpcomingLineWithoutKeepingOldLyricsInAnInstrumentalGap() {
        let document = LyricsDocument.parse("""
        [00:02.00]第一句
        [00:04.00]
        [00:07.00]第二句
        [00:09.00]最后一句
        """)
        let opening = NowPlayingLyricWindow(document: document, position: 0)
        XCTAssertNil(opening.current)
        XCTAssertEqual(opening.upcoming, 0)
        let singing = NowPlayingLyricWindow(document: document, position: 2)
        XCTAssertEqual(singing.current, 0)
        XCTAssertEqual(singing.upcoming, 2)
        let instrumental = NowPlayingLyricWindow(document: document, position: 5)
        XCTAssertNil(instrumental.current)
        XCTAssertEqual(instrumental.upcoming, 2)
        let end = NowPlayingLyricWindow(document: document, position: 10)
        XCTAssertEqual(end.current, 3)
        XCTAssertNil(end.upcoming)
    }
}
