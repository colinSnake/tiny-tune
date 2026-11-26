@testable import DesignSystem
import SwiftUI
import XCTest

final class BrowsingCardBackgroundTests: XCTestCase {
    func testStandardCardsShowArtworkWithMoreSeparationInDarkMode() {
        let light = BrowsingCardBackground.fillOpacity(for: .light, contrast: .standard, reduceTransparency: false)
        let dark = BrowsingCardBackground.fillOpacity(for: .dark, contrast: .standard, reduceTransparency: false)
        XCTAssertGreaterThan(light, 0)
        XCTAssertGreaterThan(dark, light)
        XCTAssertLessThan(dark, 1)
    }

    func testEitherAccessibilitySettingMakesCardsOpaqueInBothAppearances() {
        for scheme in [ColorScheme.light, .dark] {
            for (contrast, reduceTransparency) in [(ColorSchemeContrast.increased, false), (.standard, true), (.increased, true)] {
                XCTAssertEqual(BrowsingCardBackground.fillOpacity(for: scheme, contrast: contrast, reduceTransparency: reduceTransparency), 1)
            }
        }
    }
}
