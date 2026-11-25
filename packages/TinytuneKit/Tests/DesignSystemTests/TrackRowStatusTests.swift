import SwiftUI
@testable import DesignSystem
import XCTest

final class TrackRowStatusTests: XCTestCase {
    func testPausedRowOffersPlayInsteadOfPauseOrWaveform() {
        XCTAssertEqual(TrackRowStatusIcon.paused.symbolName, "play.fill")
        XCTAssertFalse(TrackRowStatusIcon.paused.animates(scenePhase: .active, reduceMotion: false))
        XCTAssertFalse(TrackRowStatusIcon.system("hourglass").animates(scenePhase: .active, reduceMotion: false))
    }

    func testPlayingWaveformRunsOnlyInActiveSceneWithoutReduceMotion() {
        let playing = TrackRowStatusIcon.playing
        XCTAssertTrue(playing.animates(scenePhase: .active, reduceMotion: false))
        XCTAssertFalse(playing.animates(scenePhase: .active, reduceMotion: true))
        XCTAssertFalse(playing.animates(scenePhase: .inactive, reduceMotion: false))
        XCTAssertFalse(playing.animates(scenePhase: .background, reduceMotion: false))
    }

    func testWaveformBarsChangeHeightAndFitInsideTheirFrame() {
        let start = TrackRowWaveform.heights(phase: 0)
        let next = TrackRowWaveform.heights(phase: .pi / 2)
        XCTAssertEqual(start.count, 5)
        XCTAssertNotEqual(start, next)
        for phase in stride(from: 0.0, through: 2 * .pi, by: 0.1) {
            XCTAssertTrue(TrackRowWaveform.heights(phase: phase).allSatisfy { (3...14).contains($0) })
        }
    }
}
