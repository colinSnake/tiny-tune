import DesignSystem
import SwiftUI
import XCTest

final class TuneThemeTests: XCTestCase {
    func testAccentResolvesToTheIrisPaletteInBothAppearances() {
        XCTAssertEqual(hex(TuneTheme.accent, .light), 0x6D4AC4)
        XCTAssertEqual(hex(TuneTheme.accent, .dark), 0xC1A9FF)
    }

    func testBrandGradientUsesTheApprovedVioletAndRoseEndpoints() {
        XCTAssertEqual(hex(TuneTheme.brandViolet, .light), 0x8367F4)
        XCTAssertEqual(hex(TuneTheme.brandRose, .light), 0xED83B5)
    }

    func testThemeTextRetainsContrastInBothAppearances() {
        for appearance in [ColorScheme.light, .dark] {
            for (foreground, background) in [
                (TuneTheme.primary, TuneTheme.canvas), (TuneTheme.secondary, TuneTheme.canvas),
                (TuneTheme.primary, TuneTheme.raised), (TuneTheme.secondary, TuneTheme.raised),
                (TuneTheme.onAccent, TuneTheme.accent), (TuneTheme.accent, TuneTheme.subtle),
                (TuneTheme.problem, TuneTheme.canvas),
            ] {
                let a = luminance(resolved(foreground, appearance))
                let b = luminance(resolved(background, appearance))
                let ratio = (max(a, b) + 0.05) / (min(a, b) + 0.05)
                XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(appearance): \(foreground) on \(background)")
            }
        }
    }

    private func resolved(_ color: Color, _ appearance: ColorScheme) -> Color.Resolved {
        var environment = EnvironmentValues()
        environment.colorScheme = appearance
        return color.resolve(in: environment)
    }

    private func luminance(_ color: Color.Resolved) -> Float {
        0.2126 * color.linearRed + 0.7152 * color.linearGreen + 0.0722 * color.linearBlue
    }

    private func hex(_ color: Color, _ appearance: ColorScheme) -> Int {
        let rgb = resolved(color, appearance)
        return [rgb.red, rgb.green, rgb.blue].reduce(0) { ($0 << 8) | Int(($1 * 255).rounded()) }
    }
}
