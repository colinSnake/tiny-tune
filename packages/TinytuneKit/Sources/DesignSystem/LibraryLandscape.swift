import SwiftUI

/// The approved horizontal scroll and re-composed mobile leaf use distinct artwork.
enum LibraryLandscapeComposition {
    case horizontal, portrait

    var assetName: String {
        switch self {
        case .horizontal: "TingyeLibraryLandscape-Horizontal"
        case .portrait: "TingyeLibraryLandscape-Portrait"
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

/// Top-aligned, transparent artwork shared by the phone library, sources and About sheet.
/// The SVG owns its fade; sizing preserves the composition instead of stretching the scene.
public struct LibraryHeaderLandscape: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var textSize

    public init() {}

    public var body: some View {
        GeometryReader { viewport in
            if contrast != .increased, !textSize.isAccessibilitySize {
                Image(decorative: "TingyeLibraryLandscape-Header", bundle: .module)
                    .renderingMode(.original)
                    .resizable()
                    .aspectRatio(390.0 / 300.0, contentMode: .fit)
                    .frame(maxWidth: 600)
                    .frame(width: viewport.size.width, height: viewport.size.height, alignment: .topTrailing)
                    .clipped()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

#if os(macOS)
/// The agreed desktop composition is shared by library, search and source destinations.
public struct MacLibraryBackground: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var textSize
    private let hasTracks: Bool

    public init(hasTracks: Bool) {
        self.hasTracks = hasTracks
    }

    private var showsArtwork: Bool { contrast != .increased && !textSize.isAccessibilitySize }

    public var body: some View {
        GeometryReader { viewport in
            if showsArtwork {
                let size = Self.artworkSize(in: viewport.size, hasTracks: hasTracks)
                Image(decorative: "TingyeMacLibraryBackground", bundle: .module)
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size.width, height: size.height)
                    .opacity(min(1, max(0.45, (viewport.size.width - 420) / 340)))
                    .frame(width: viewport.size.width, height: viewport.size.height, alignment: .bottomTrailing)
                    .clipped()
            }
        }
        .background(showsArtwork ? TuneTheme.macLibraryCanvas : TuneTheme.canvas)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func artworkSize(in viewport: CGSize, hasTracks: Bool) -> CGSize {
        // Match the design at its reference size and keep the artwork low in a wide, short window.
        let width = max(0, min(viewport.width * (hasTracks ? 0.82 : 0.88), 1080, viewport.height * 1.55))
        return CGSize(width: width, height: width * 680 / 1080)
    }
}
#endif

/// A fixed, quiet edge illustration behind the phone library, search and sources.
public struct PhoneLibraryBackground: View {
    public enum Style {
        case emptyLibrary, browsing

        var artworkOpacity: Double { self == .emptyLibrary ? 0.87 : 0.59 }
        private var referenceWidth: CGFloat { self == .emptyLibrary ? 345 : 342 }

        func bottomBleed(forArtworkWidth width: CGFloat) -> CGFloat {
            // Recreate the approved crop at the content edge, not under the mini-player or tab bar.
            let referenceBleed: CGFloat = self == .emptyLibrary ? 31 : 18
            return referenceBleed * width / referenceWidth
        }

        func artworkSize(in viewport: CGSize) -> CGSize {
            let aspect = CGFloat(390) / 224
            // Use the handset composition without enlarging it on iPad; short viewports
            // (landscape or keyboard) keep the artwork low and away from the controls.
            let width = max(0, min(referenceWidth, viewport.width * referenceWidth / 390,
                                   viewport.height * 0.36 * aspect))
            return CGSize(width: width, height: width / aspect)
        }
    }

    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var textSize
    private let style: Style

    public init(style: Style) {
        self.style = style
    }

    public var body: some View {
        GeometryReader { viewport in
            if contrast != .increased, !textSize.isAccessibilitySize {
                let size = style.artworkSize(in: viewport.size)
                Image(decorative: "TingyePhoneLibraryBackground", bundle: .module)
                    .renderingMode(.original)
                    .resizable()
                    .frame(width: size.width, height: size.height)
                    .opacity(style.artworkOpacity)
                    .offset(y: style.bottomBleed(forArtworkWidth: size.width))
                    .frame(width: viewport.size.width, height: viewport.size.height, alignment: .bottomTrailing)
                    .clipped()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

#if os(iOS)
/// The existing full-height artwork on the Now Playing backdrop.
public struct LibraryPageLandscape: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var textSize

    public init() {}

    public var body: some View {
        GeometryReader { viewport in
            if contrast != .increased, !textSize.isAccessibilitySize {
                Image(decorative: "TingyeLibraryLandscape-Page", bundle: .module)
                    .renderingMode(.original)
                    .resizable()
                    .scaledToFill()
                    .frame(width: viewport.size.width, height: viewport.size.height)
                    .clipped()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
#endif
