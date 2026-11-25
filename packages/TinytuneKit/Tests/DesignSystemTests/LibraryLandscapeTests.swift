import CoreGraphics
@testable import DesignSystem
import XCTest

final class LibraryLandscapeTests: XCTestCase {
    func testApprovedHorizontalCompositionAtDefaultWindowSize() {
        let size = LibraryLandscapeComposition.horizontal.size(in: CGSize(width: 902, height: 667))
        XCTAssertEqual(size.width, 927, accuracy: 0.01)
        XCTAssertEqual(size.height, 412, accuracy: 0.01)
    }

    func testApprovedPortraitCompositionAtReferencePhoneSize() {
        let size = LibraryLandscapeComposition.portrait.size(in: CGSize(width: 402, height: 640))
        XCTAssertEqual(size.width, 402, accuracy: 0.01)
        XCTAssertEqual(size.height, 196, accuracy: 0.01)
    }

    func testOnlyThePhoneCompositionBleedsIntoTheInsetAtTheBottom() {
        XCTAssertEqual(LibraryLandscapeComposition.portrait.bottomBleed(forArtworkHeight: 196), 9, accuracy: 0.01)
        XCTAssertEqual(LibraryLandscapeComposition.portrait.bottomBleed(forArtworkHeight: 98), 4.5, accuracy: 0.01)
        XCTAssertEqual(LibraryLandscapeComposition.horizontal.bottomBleed(forArtworkHeight: 412), 0)
    }

    func testShortViewportsKeepTheIllustrationAtTheEdgeWithoutStretchingIt() {
        for (composition, artwork) in [
            (LibraryLandscapeComposition.horizontal, CGSize(width: 927, height: 412)),
            (.portrait, CGSize(width: 402, height: 196)),
        ] {
            let size = composition.size(in: CGSize(width: 720, height: 250))
            XCTAssertGreaterThan(size.height, 0)
            XCTAssertLessThan(size.height, 170)
            XCTAssertEqual(size.width / size.height, artwork.width / artwork.height, accuracy: 0.001)
        }
    }

    func testPhoneEarFoldMatchesTheApprovedScaleAndOpacity() {
        let viewport = CGSize(width: 390, height: 700)
        let empty = PhoneLibraryBackground.Style.emptyLibrary
        let browsing = PhoneLibraryBackground.Style.browsing
        XCTAssertEqual(empty.artworkSize(in: viewport).width, 345)
        XCTAssertEqual(browsing.artworkSize(in: viewport).width, 342)
        XCTAssertEqual(empty.artworkOpacity, 0.87)
        XCTAssertEqual(browsing.artworkOpacity, 0.59)
        XCTAssertEqual(empty.bottomBleed(forArtworkWidth: 345), 31)
        XCTAssertEqual(browsing.bottomBleed(forArtworkWidth: 342), 18)
        XCTAssertEqual(empty.bottomBleed(forArtworkWidth: 172.5), 15.5)
    }

    func testPhoneEarFoldFitsCompactAndLandscapeViewportsWithoutStretching() {
        for style in [PhoneLibraryBackground.Style.emptyLibrary, .browsing] {
            let compact = style.artworkSize(in: CGSize(width: 320, height: 560))
            let keyboard = style.artworkSize(in: CGSize(width: 390, height: 230))
            let landscape = style.artworkSize(in: CGSize(width: 720, height: 240))
            let tablet = style.artworkSize(in: CGSize(width: 834, height: 1024))
            XCTAssertLessThan(compact.width, 320)
            XCTAssertLessThanOrEqual(keyboard.height, 230 * 0.36 + 0.001)
            XCTAssertLessThanOrEqual(landscape.height, 240 * 0.36 + 0.001)
            XCTAssertLessThanOrEqual(tablet.width, 345)
            for size in [compact, keyboard, landscape, tablet] {
                XCTAssertGreaterThan(size.width, 0)
                XCTAssertEqual(size.width / size.height, 390.0 / 224, accuracy: 0.001)
            }
            XCTAssertEqual(style.artworkSize(in: .zero), .zero)
        }
    }
}
