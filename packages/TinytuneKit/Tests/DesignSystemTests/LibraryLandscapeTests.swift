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
}
