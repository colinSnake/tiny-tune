import SwiftUI

/// The approved horizontal scroll and re-composed mobile leaf use distinct artwork.
enum LibraryLandscapeComposition {
    case horizontal, portrait

    var assetName: String {
        switch self {
        case .horizontal: "LibraryLandscape-Horizontal"
        case .portrait: "LibraryLandscape-Portrait"
        }
    }

    func size(in viewport: CGSize) -> CGSize {
        let artwork: CGSize
        let reference: CGSize
        switch self {
        case .horizontal:
            // The transparent left edge can extend past the detail column. The right edge is fixed.
            artwork = CGSize(width: 927, height: 412)
            reference = CGSize(width: 902, height: 667)
        case .portrait:
            artwork = CGSize(width: 402, height: 196)
            reference = CGSize(width: 402, height: 550)
        }
        let scale = max(0, min(viewport.width / reference.width, viewport.height / reference.height, 1.25))
        return CGSize(width: artwork.width * scale, height: artwork.height * scale)
    }

    func bottomBleed(forArtworkHeight height: CGFloat) -> CGFloat {
        // The final translucent edge reaches slightly past the safe area on the handset.
        switch self {
        case .horizontal: 0
        case .portrait: 9 * height / 196
        }
    }
}

/// Non-interactive artwork behind the empty music library, not a scrollable content item.
public struct LibraryLandscape: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var textSize

    public init() {}

    public var body: some View {
        GeometryReader { viewport in
            if contrast != .increased, !textSize.isAccessibilitySize {
                #if os(macOS)
                let composition = LibraryLandscapeComposition.horizontal
                #else
                let composition = LibraryLandscapeComposition.portrait
                #endif
                let size = composition.size(in: viewport.size)
                Image(decorative: composition.assetName, bundle: .module)
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size.width, height: size.height)
                    .frame(width: viewport.size.width, height: viewport.size.height, alignment: .bottomTrailing)
                    .clipped()
                    .offset(y: composition.bottomBleed(forArtworkHeight: size.height))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
