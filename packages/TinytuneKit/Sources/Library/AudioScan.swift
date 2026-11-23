import AVFoundation
import Domain
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct ScannedAudio: Sendable {
    public let path: RelativeAudioPath
    public let metadata: TrackMetadata
    public let duration: Double
    public let artworkKey: String?

    public init(path: RelativeAudioPath, metadata: TrackMetadata, duration: Double, artworkKey: String? = nil) {
        self.path = path
        self.metadata = metadata
        self.duration = duration
        self.artworkKey = artworkKey
    }
}

public enum SkipReason: String, CaseIterable, Hashable, Sendable {
    case invalidAudio, notDownloaded, unreadable, unsupported, link
}

public struct SkipInfo: Sendable {
    public private(set) var count = 0
    public private(set) var examples: [String] = []
    mutating func add(_ name: String) {
        count += 1
        if examples.count < 4 { examples.append(name) }
    }
}

public struct ScanProgress: Sendable {
    public fileprivate(set) var checked = 0
    public fileprivate(set) var accepted = 0
}

public struct ImportDraft: Sendable {
    public let source: SourceDraft
    public let audio: [ScannedAudio]
    public let replaces: UUID?
    public let skipped: [SkipReason: SkipInfo]
    public var totalSkipped: Int { skipped.values.reduce(0) { $0 + $1.count } }

    public init(source: SourceDraft, audio: [ScannedAudio], replaces: UUID? = nil, skipped: [SkipReason: SkipInfo] = [:]) {
        self.source = source
        self.audio = audio
        self.replaces = replaces
        self.skipped = skipped
    }
}

public enum AudioScanner {
    private static let extensions: Set<String> = ["mp3", "m4a", "aac", "wav", "flac"]
    private static let keys: Set<URLResourceKey> = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .isAliasFileKey, .isPackageKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]

    public static func scan(_ source: SourceDraft, replaces: UUID? = nil, existing: [MusicSource] = [],
                            progress: @Sendable (ScanProgress) -> Void) async throws -> ImportDraft {
        let lease = try FolderAccess.open(source.bookmark)
        try FolderAccess.checkOverlap(with: lease, sources: existing, identity: source.identity)
        var pending: [(URL, [String])] = [(lease.directory, [])]
        var status = ScanProgress()
        var audio: [ScannedAudio] = []
        var skipped: [SkipReason: SkipInfo] = [:]
        let clock = ContinuousClock()
        var lastUpdate = clock.now
        while let (dir, parts) = pending.popLast() {
            try Task.checkCancellation()
            let entries: [URL]
            do { entries = try children(dir) }
            catch {
                if parts.isEmpty { throw FolderError.unavailable }
                skipped[.unreadable, default: .init()].add(dir.lastPathComponent)
                continue
            }
            for entry in entries {
                try Task.checkCancellation()
                let name = entry.lastPathComponent
                do {
                    let properties = try entry.resourceValues(forKeys: keys)
                    if properties.isSymbolicLink == true || properties.isAliasFile == true {
                        status.checked += 1
                        skipped[.link, default: .init()].add(name)
                    } else if properties.isPackage == true {
                        continue
                    } else if properties.isUbiquitousItem == true && properties.ubiquitousItemDownloadingStatus == .notDownloaded {
                        status.checked += 1
                        skipped[.notDownloaded, default: .init()].add(name)
                    } else if properties.isDirectory == true {
                        pending.append((entry, parts + [name]))
                    } else if properties.isRegularFile == true {
                        status.checked += 1
                        if extensions.contains(entry.pathExtension.lowercased()), let path = RelativeAudioPath((parts + [name]).joined(separator: "/")) {
                            do {
                                let url = try lease.audioURL(for: path)
                                audio.append(try await inspect(url, path: path))
                                status.accepted += 1
                            } catch is CancellationError { throw CancellationError() }
                            catch { skipped[.invalidAudio, default: .init()].add(name) }
                        } else {
                            skipped[.unsupported, default: .init()].add(name)
                        }
                    }
                } catch is CancellationError { throw CancellationError() }
                catch {
                    status.checked += 1
                    skipped[.unreadable, default: .init()].add(name)
                }
                if lastUpdate.duration(to: clock.now) >= .milliseconds(125) {
                    lastUpdate = clock.now
                    progress(status)
                }
            }
        }
        try Task.checkCancellation()
        withExtendedLifetime(lease) {}
        progress(status)
        return .init(source: source, audio: audio, replaces: replaces, skipped: skipped)
    }

    static func children(_ dir: URL) throws -> [URL] {
        #if os(iOS)
        var coordinationError: NSError?
        var result: Result<[URL], any Error>?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: dir, options: .withoutChanges, error: &coordinationError) { url in
            result = Result { try list(url) }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw FolderError.unavailable }
        return try result.get()
        #else
        return try list(dir)
        #endif
    }

    private static func list(_ dir: URL) throws -> [URL] {
        let properties = try dir.resourceValues(forKeys: [.isSymbolicLinkKey, .isAliasFileKey, .isPackageKey])
        guard properties.isSymbolicLink != true, properties.isAliasFile != true, properties.isPackage != true else {
            throw FolderError.unsafePath
        }
        return try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    public static func inspect(_ url: URL, path: RelativeAudioPath) async throws -> ScannedAudio {
        let asset = AVURLAsset(url: url)
        let (time, playable, protected) = try await asset.load(.duration, .isPlayable, .hasProtectedContent)
        let duration = time.seconds
        guard playable, !protected, duration.isFinite, duration > 0, !(try await asset.loadTracks(withMediaType: .audio)).isEmpty else {
            throw FolderError.unavailable
        }
        let common = (try? await asset.load(.commonMetadata)) ?? []
        let extra = (try? await asset.load(.metadata)) ?? []
        func text(_ items: [AVMetadataItem], _ ids: [AVMetadataIdentifier]) async -> String? {
            for id in ids {
                for item in AVMetadataItem.metadataItems(from: items, filteredByIdentifier: id) {
                    if let value = try? await item.load(.stringValue), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return value }
                }
            }
            return nil
        }
        let tags = await MusicTags(title: text(common, [.commonIdentifierTitle]),
                                   artist: text(common, [.commonIdentifierArtist]),
                                   albumArtist: text(extra, [.iTunesMetadataAlbumArtist, .id3MetadataBand]),
                                   album: text(common, [.commonIdentifierAlbumName]))
        let art = AVMetadataItem.metadataItems(from: common, filteredByIdentifier: .commonIdentifierArtwork).first
        let artworkKey: String?
        if let art, let data = try? await art.load(.dataValue) { artworkKey = ArtworkCache.writeThumbnail(data) }
        else { artworkKey = nil }
        try Task.checkCancellation()
        return .init(path: path, metadata: .resolve(path, tags: tags), duration: duration, artworkKey: artworkKey)
    }
}

public enum ArtworkCache {
    public static func url(for key: String) -> URL? {
        guard key.count == 64, key.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return nil }
        return directory.appending(component: "\(key).jpg")
    }

    private static var directory: URL { URL.cachesDirectory.appending(component: "TinytuneArtwork", directoryHint: .isDirectory) }

    static func writeThumbnail(_ data: Data) -> String? {
        guard data.count <= 16 * 1024 * 1024 else { return nil }
        let key = FolderAccess.digest(data)
        guard let file = url(for: key) else { return nil }
        if FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) { return key }
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 512,
              ] as CFDictionary) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, thumb, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try (output as Data).write(to: file, options: .atomic)
            return key
        } catch { return nil }
    }
}
