#if os(macOS)
import AppKit
import DesignSystem
import SwiftUI
import XCTest

final class TrackRowArtworkTests: XCTestCase {
    @MainActor
    func testTrackWithoutCoverShowsThemeTintedTileWithContrastingCenteredGlyph() throws {
        for (appearance, expectedBackground) in [(ColorScheme.light, 0xEDE7F8), (.dark, 0x3B3245)] {
            let row = TrackRowContent(title: "Song", artist: "Artist", duration: "4:15", state: nil, artwork: nil)
                .frame(width: 300)
                .environment(\.colorScheme, appearance)
            let renderer = ImageRenderer(content: row)
            let bitmap = NSBitmapImageRep(cgImage: try XCTUnwrap(renderer.cgImage))
            let centerY = bitmap.pixelsHigh / 2
            // ImageRenderer emits sRGB pixels. Read their components without reinterpreting
            // NSBitmapImageRep's calibrated RGB label as a different profile.
            let background = try XCTUnwrap(bitmap.colorAt(x: 6, y: centerY))
            XCTAssertEqual(hex(background), expectedBackground, "\(appearance) placeholder background")
            XCTAssertEqual(bitmap.colorAt(x: 0, y: centerY - 20)?.alphaComponent, 0, "The tile clips its corners")
            let glyphColors = (12..<28).flatMap { x in
                (centerY - 8..<centerY + 8).compactMap { y in bitmap.colorAt(x: x, y: y) }
            }
            XCTAssertTrue(glyphColors.contains { contrast(background, $0) >= 4.5 },
                          "\(appearance) placeholder should have a high-contrast centered glyph")
        }
    }

    private func hex(_ color: NSColor) -> Int {
        [color.redComponent, color.greenComponent, color.blueComponent].reduce(0) { ($0 << 8) | Int(($1 * 255).rounded()) }
    }

    private func luminance(_ color: NSColor) -> CGFloat {
        func linearize(_ value: CGFloat) -> CGFloat {
            value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linearize(color.redComponent) + 0.7152 * linearize(color.greenComponent) + 0.0722 * linearize(color.blueComponent)
    }

    private func contrast(_ first: NSColor, _ second: NSColor) -> CGFloat {
        let values = [luminance(first), luminance(second)].sorted()
        return (values[1] + 0.05) / (values[0] + 0.05)
    }
}
#endif
