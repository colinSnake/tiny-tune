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
    public static var canvas: Color { adaptive(0xFAF8EF, 0x20261F) }
    public static var raised: Color { adaptive(0xFFFEF8, 0x293228) }
    public static var primary: Color { adaptive(0x242B23, 0xEEF1E6) }
    public static var secondary: Color { adaptive(0x586154, 0xB8C2B1) }
    public static var accent: Color { adaptive(0x355541, 0xC4D5A7) }
    public static var onAccent: Color { adaptive(0xFAF7EA, 0x263529) }
    public static var subtle: Color { adaptive(0xE6EADA, 0x354332) }
    public static var problem: Color { adaptive(0x9B3C49, 0xFFB3BC) }

    #if os(macOS)
    /// Pine greens dark enough to retain contrast with white sidebar labels.
    public static var sidebarSelection: LinearGradient {
        LinearGradient(colors: [adaptive(0x47604C, 0x4B6249), adaptive(0x355541, 0x354B39)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    #else
    /// Use the shared brand accent on the native tab bar material.
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
    /// Inset content surface. The caller owns padding; the surface doesn't clip focus or menus.
    func tuneCard() -> some View {
        background(TuneTheme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

public struct ArtworkTile: View {
    private let artwork: URL?
    private let size: CGFloat?
    @State private var localArtwork: CGImage?

    public init(artwork: URL? = nil, size: CGFloat? = nil) {
        self.artwork = artwork
        self.size = size
    }

    public var body: some View {
        ZStack {
            if let localArtwork {
                TuneTheme.subtle
                Image(decorative: localArtwork, scale: 1)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(decorative: "FoldedRecord", bundle: .module)
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
    let detail: String
    let duration: String
    let state: String?
    let stateSymbol: String?
    let artwork: URL?
    let trackNumber: Int?
    @Environment(\.dynamicTypeSize) private var textSize

    public init(title: String, detail: String, duration: String, state: String?, artwork: URL?,
                trackNumber: Int? = nil, stateSymbol: String? = nil) {
        self.title = title
        self.detail = detail
        self.duration = duration
        self.state = state
        self.stateSymbol = stateSymbol
        self.artwork = artwork
        self.trackNumber = trackNumber
    }

    public var body: some View {
        HStack(spacing: 12) {
            if let trackNumber {
                Text(trackNumber, format: .number)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(TuneTheme.secondary)
                    .frame(width: 40)
                    .accessibilityHidden(true)
            } else { ArtworkTile(artwork: artwork, size: 40) }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(TuneTheme.primary)
                Text(detail).foregroundStyle(TuneTheme.secondary).font(.subheadline)
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
            if let stateSymbol {
                let label = Label(state, systemImage: stateSymbol)
                ViewThatFits(in: .horizontal) {
                    label.labelStyle(.titleAndIcon)
                    label.labelStyle(.iconOnly)
                }
            } else {
                Text(state).lineLimit(1)
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(TuneTheme.accent)
    }
}
