import CoreGraphics
import Domain
import ImageIO
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

public enum TuneTheme {
    /// Core brand endpoints: iris violet to soft rose.
    public static let brandViolet = Color(red: 131.0 / 255, green: 103.0 / 255, blue: 244.0 / 255)
    public static let brandRose = Color(red: 237.0 / 255, green: 131.0 / 255, blue: 181.0 / 255)
    public static var brandGradient: LinearGradient {
        LinearGradient(colors: [brandViolet, brandRose], startPoint: .leading, endPoint: .trailing)
    }

    public static var canvas: Color { adaptive(0xFAF8FC, 0x19151F) }
    public static var raised: Color { adaptive(0xFFFFFF, 0x27212D) }
    public static var primary: Color { adaptive(0x2A2331, 0xF7F1FA) }
    public static var secondary: Color { adaptive(0x756B7E, 0xBDB3C7) }
    /// Solid, contrast-safe accent for text, focus rings, and native controls.
    public static var accent: Color { adaptive(0x6D4AC4, 0xC1A9FF) }
    public static var onAccent: Color { adaptive(0xFFFFFF, 0x241A31) }
    public static var subtle: Color { adaptive(0xF0EAF8, 0x3B3245) }
    public static var problem: Color { adaptive(0xA8334B, 0xFF9CAB) }

    fileprivate static var trackArtworkPlaceholder: Color { adaptive(0xEDE7F8, 0x3B3245) }
    fileprivate static var onTrackArtworkPlaceholder: Color { adaptive(0x7651C8, 0xD2C0FF) }

    #if os(macOS)
    static var macLibraryCanvas: Color { adaptive(0xFBF9FC, 0x1D1924) }

    /// The desktop pink-violet treatment keeps white sidebar and action text legible.
    public static var sidebarSelection: LinearGradient {
        LinearGradient(colors: [adaptive(0x7658CA, 0x7658CA), adaptive(0xA257A6, 0xA257A6)],
                       startPoint: .leading, endPoint: .trailing)
    }
    #else
    /// Native tab controls use the solid accent, not the low-contrast gradient.
    public static var phoneTabSelection: Color { accent }
    #endif

    private static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        func components(_ color: UInt32) -> (CGFloat, CGFloat, CGFloat) {
            (CGFloat((color >> 16) & 255) / 255, CGFloat((color >> 8) & 255) / 255, CGFloat(color & 255) / 255)
        }
        #if os(macOS)
        return Color(nsColor: NSColor(name: nil) { appearance in
            let (r, g, b) = components(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light)
            return NSColor(srgbRed: r, green: g, blue: b, alpha: 1)
        })
        #else
        return Color(uiColor: UIColor { traits in
            let (r, g, b) = components(traits.userInterfaceStyle == .dark ? dark : light)
            return UIColor(red: r, green: g, blue: b, alpha: 1)
        })
        #endif
    }
}

public extension View {
    /// Inset browsing surface. Only the fill is translucent; the surface doesn't clip focus or menus.
    func tuneCard(cornerRadius: CGFloat = 16) -> some View {
        modifier(BrowsingCardBackground(cornerRadius: cornerRadius))
    }
}

struct BrowsingCardBackground: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content.background(
            TuneTheme.raised.opacity(Self.fillOpacity(for: colorScheme, contrast: contrast, reduceTransparency: reduceTransparency)),
            in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        )
    }

    nonisolated static func fillOpacity(for scheme: ColorScheme, contrast: ColorSchemeContrast, reduceTransparency: Bool) -> Double {
        if reduceTransparency || contrast == .increased { return 1 }
        return scheme == .dark ? 0.78 : 0.68
    }
}

public struct ArtworkTile: View {
    fileprivate enum Placeholder { case foldedRecord, photo }

    private let artwork: URL?
    private let size: CGFloat?
    private let placeholder: Placeholder
    @State private var localArtwork: CGImage?

    public init(artwork: URL? = nil, size: CGFloat? = nil) {
        self.init(artwork: artwork, size: size, placeholder: .foldedRecord)
    }

    fileprivate init(artwork: URL?, size: CGFloat?, placeholder: Placeholder) {
        self.artwork = artwork
        self.size = size
        self.placeholder = placeholder
    }

    public var body: some View {
        ZStack {
            if let localArtwork {
                TuneTheme.subtle
                Image(decorative: localArtwork, scale: 1)
                    .resizable()
                    .scaledToFit()
            } else if placeholder == .photo {
                TuneTheme.trackArtworkPlaceholder
                    .overlay {
                        Image(systemName: "photo")
                            .font(.system(size: 17, weight: .medium))
                            .foregroundStyle(TuneTheme.onTrackArtworkPlaceholder)
                    }
            } else {
                Image(decorative: "TingyeFoldedRecord", bundle: .module)
                    .renderingMode(.original)
                    .resizable()
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: (size ?? 160) >= 100 ? 12 : 6))
        .accessibilityHidden(true)
        .task(id: artwork) {
            localArtwork = nil
            guard let artwork else { return }
            let image = await Task.detached(priority: .utility) {
                CGImageSourceCreateWithURL(artwork as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
            }.value
            if !Task.isCancelled { localArtwork = image }
        }
    }
}

public struct TunePrimaryButton: ButtonStyle {
    public init() { }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .foregroundStyle(TuneTheme.onAccent)
            .background(TuneTheme.accent.opacity(configuration.isPressed ? 0.8 : 1), in: .rect(cornerRadius: 12))
    }
}

public struct TrackRowContent: View {
    let title: String
    let artist: String
    let duration: String
    let state: String?
    let stateIcon: TrackRowStatusIcon?
    let artwork: URL?
    @Environment(\.dynamicTypeSize) private var textSize

    public init(title: String, artist: String, duration: String, state: String?, artwork: URL?,
                stateIcon: TrackRowStatusIcon? = nil) {
        self.title = title
        self.artist = artist
        self.duration = duration
        self.state = state
        self.stateIcon = stateIcon
        self.artwork = artwork
    }

    public var body: some View {
        HStack(spacing: 12) {
            ArtworkTile(artwork: artwork, size: 40, placeholder: .photo)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(TuneTheme.primary)
                Text(artist).foregroundStyle(TuneTheme.secondary).font(.subheadline)
                if textSize.isAccessibilitySize { trailingMetadata }
            }
            .layoutPriority(1)
            Spacer(minLength: 4)
            if !textSize.isAccessibilitySize { trailingMetadata }
        }
        .padding(.vertical, 7)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var trailingMetadata: some View {
        HStack(spacing: 8) {
            if let state { stateLabel(state) }
            Text(duration).font(.caption.monospacedDigit()).foregroundStyle(TuneTheme.secondary)
                .fixedSize(horizontal: true, vertical: false)
        }
    }

    private func stateLabel(_ state: String) -> some View {
        Group {
            if let stateIcon {
                let label = Label { Text(state) } icon: { TrackRowStatusGlyph(icon: stateIcon) }
                ViewThatFits(in: .horizontal) {
                    label.labelStyle(.titleAndIcon)
                    label.labelStyle(.iconOnly)
                }
                .accessibilityLabel(Text(state))
            } else {
                Text(state).lineLimit(1)
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(TuneTheme.accent)
    }
}
