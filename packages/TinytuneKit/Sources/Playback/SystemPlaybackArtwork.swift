import CoreGraphics
import Foundation
import ImageIO
import MediaPlayer
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Keeps only the active cover and the bundled fallback; library thumbnails are content-addressed.
@MainActor
final class SystemPlaybackArtwork {
    private let fallback: @MainActor () -> CGImage?
    private lazy var placeholder = fallback().map(Self.mediaArtwork)
    private var url: URL?
    private var artwork: MPMediaItemArtwork?
    private var loading: Task<Void, Never>?

    init(fallback: @escaping @MainActor () -> CGImage?) { self.fallback = fallback }

    var value: MPMediaItemArtwork? { artwork ?? placeholder }

    func update(url: URL?, onChange: @escaping @MainActor () -> Void) {
        guard self.url != url else { return }
        loading?.cancel()
        loading = nil
        self.url = url
        artwork = nil
        guard let url, url.isFileURL else { return }
        loading = Task { [weak self] in
            guard !Task.isCancelled else { return }
            let image = await Task.detached(priority: .utility) { Self.readThumbnail(url) }.value
            guard let self, !Task.isCancelled else { return }
            loading = nil
            guard let image else { return }
            artwork = Self.mediaArtwork(image)
            onChange()
        }
    }

    func retryIfMissing() -> Bool {
        guard url != nil, artwork == nil, loading == nil else { return false }
        url = nil
        return true
    }

    private nonisolated static func readThumbnail(_ url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }

    private nonisolated static func mediaArtwork(_ image: CGImage) -> MPMediaItemArtwork {
        let bounds = CGSize(width: image.width, height: image.height)
        // MediaPlayer can call this handler on a background queue. Capture only an immutable bitmap.
        return MPMediaItemArtwork(boundsSize: bounds) { @Sendable size in
            let resized = resizedImage(image, to: size)
            #if os(macOS)
            return NSImage(cgImage: resized, size: NSSize(width: resized.width, height: resized.height))
            #else
            return UIImage(cgImage: resized)
            #endif
        }
    }

    private nonisolated static func resizedImage(_ image: CGImage, to size: CGSize) -> CGImage {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return image }
        let width = max(1, Int(min(size.width, CGFloat(image.width)).rounded()))
        let height = max(1, Int(min(size.height, CGFloat(image.height)).rounded()))
        if width == image.width, height == image.height { return image }
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
        let scale = min(CGFloat(width) / CGFloat(image.width), CGFloat(height) / CGFloat(image.height))
        let w = CGFloat(image.width) * scale, h = CGFloat(image.height) * scale
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: (CGFloat(width) - w) / 2, y: (CGFloat(height) - h) / 2, width: w, height: h))
        return context.makeImage() ?? image
    }
}
