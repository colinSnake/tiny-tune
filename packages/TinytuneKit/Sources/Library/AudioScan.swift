import AudioToolbox
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
    let embeddedTags: MusicTags?

    public init(path: RelativeAudioPath, metadata: TrackMetadata, duration: Double, artworkKey: String? = nil) {
        self.init(path: path, metadata: metadata, duration: duration, artworkKey: artworkKey, embeddedTags: nil)
    }

    fileprivate init(path: RelativeAudioPath, metadata: TrackMetadata, duration: Double, artworkKey: String?, embeddedTags: MusicTags?) {
        self.path = path
        self.metadata = metadata
        self.duration = duration
        self.artworkKey = artworkKey
        self.embeddedTags = embeddedTags
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
    fileprivate let coverage: ScanCoverage
    public var totalSkipped: Int { skipped.values.reduce(0) { $0 + $1.count } }

    public init(source: SourceDraft, audio: [ScannedAudio], replaces: UUID? = nil, skipped: [SkipReason: SkipInfo] = [:]) {
        self.init(source: source, audio: audio, replaces: replaces, skipped: skipped, coverage: .init())
    }

    fileprivate init(source: SourceDraft, audio: [ScannedAudio], replaces: UUID?, skipped: [SkipReason: SkipInfo], coverage: ScanCoverage) {
        self.source = source
        self.audio = audio
        self.replaces = replaces
        self.skipped = skipped
        self.coverage = coverage
    }

    /// Absence must be proven by enumeration, never inferred from failed audio reads.
    public func provesMissing(_ path: RelativeAudioPath) -> Bool { coverage.provesMissing(path) }

    /// Only true for paths this scan could read but the audio decoder rejected.
    public func provesUnplayable(_ path: RelativeAudioPath) -> Bool {
        coverage.unplayable.contains(Data(path.rawValue.utf8))
    }
}

private struct ScanCoverage: Sendable {
    enum Kind: Sendable { case unknown, directory, file }
    enum Presence { case missing, file, unknown }
    typealias Entries = [Data: Kind]
    // Only successfully enumerated directories have entries. Retain exact UTF-8 spelling.
    var children: [Data: Entries] = [:]
    var unplayable = Set<Data>()
    var accepted: [Data: FileStamp] = [:]

    func provesMissing(_ path: RelativeAudioPath) -> Bool {
        Self.presence(of: path) { children[$0] } == .missing
    }

    static func presence(of path: RelativeAudioPath, entriesAt: (Data) -> Entries?) -> Presence {
        var directory = Data()
        let components = path.components
        for (index, component) in components.enumerated() {
            guard let entries = entriesAt(directory) else { return .unknown }
            let name = Data(component.utf8)
            guard let kind = entries[name] else {
                // Some iCloud providers expose a hidden placeholder instead of the final name.
                return entries[Data(".\(component).icloud".utf8)] == nil ? .missing : .unknown
            }
            let last = index == components.count - 1
            if last {
                switch kind {
                case .directory: return .missing
                case .file: return .file
                case .unknown: return .unknown
                }
            }
            if kind == .file { return .missing }
            guard kind == .directory else { return .unknown }
            if !directory.isEmpty { directory.append(0x2f) }
            directory.append(name)
        }
        return .unknown
    }
}

// A cheap change detector, not a content identity or a deduplication key.
private struct FileStamp: Equatable, Sendable {
    let size: UInt64
    let modification: Date
    let creation: Date?
    let device: UInt64?
    let inode: UInt64?

    init(_ file: URL) throws {
        let path = file.path(percentEncoded: false)
        let manager = FileManager.default
        let attributes = try manager.attributesOfItem(atPath: path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber,
              let modification = attributes[.modificationDate] as? Date,
              manager.isReadableFile(atPath: path) else { throw FolderError.unavailable }
        self.size = size.uint64Value
        self.modification = modification
        creation = attributes[.creationDate] as? Date
        device = (attributes[.systemNumber] as? NSNumber)?.uint64Value
        inode = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value
    }
}

public enum AudioScanner {
    private enum InspectionError: Error { case unplayable }

    private static let extensions: Set<String> = ["mp3", "m4a", "aac", "wav", "flac"]
    private static let keys: Set<URLResourceKey> = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .isAliasFileKey, .isPackageKey, .isHiddenKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]

    public static func scan(_ source: SourceDraft, replaces: UUID? = nil, existing: [MusicSource] = [],
                            progress: @Sendable (ScanProgress) -> Void) async throws -> ImportDraft {
        let lease = try FolderAccess.open(source.bookmark)
        try FolderAccess.checkOverlap(with: lease, sources: existing, identity: source.identity)
        let result = try await scanDirectory(lease.directory, source: source, replaces: replaces, progress: progress)
        withExtendedLifetime(lease) {}
        return result
    }

    static func scanDirectory(_ directory: URL, source: SourceDraft, replaces: UUID? = nil,
                              progress: @Sendable (ScanProgress) -> Void) async throws -> ImportDraft {
        var pending: [(URL, [String])] = [(directory, [])]
        var coverage = ScanCoverage()
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
            var observed: ScanCoverage.Entries = [:]
            for entry in entries {
                try Task.checkCancellation()
                let name = entry.lastPathComponent
                let nameKey = Data(name.utf8)
                observed[nameKey] = .unknown
                do {
                    let properties = try entry.resourceValues(forKeys: keys)
                    observed[nameKey] = ordinaryKind(entry, values: properties)
                    if name.hasPrefix(".") || properties.isHidden == true { continue }
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
                                let url = try FolderAccess.readableFile(in: directory, at: path)
                                let before = try localStamp(url)
                                let entry = try await inspect(url, path: path, sourceName: source.name)
                                guard (try? localStamp(url)) == before else { throw FolderError.scanChanged }
                                coverage.accepted[Data(path.rawValue.utf8)] = before
                                audio.append(entry)
                                status.accepted += 1
                            } catch is CancellationError { throw CancellationError() }
                            catch FolderError.scanChanged { throw FolderError.scanChanged }
                            catch InspectionError.unplayable {
                                coverage.unplayable.insert(Data(path.rawValue.utf8))
                                skipped[.invalidAudio, default: .init()].add(name)
                            } catch { skipped[.unreadable, default: .init()].add(name) }
                        } else {
                            skipped[.unsupported, default: .init()].add(name)
                        }
                    }
                } catch is CancellationError { throw CancellationError() }
                catch FolderError.scanChanged { throw FolderError.scanChanged }
                catch {
                    status.checked += 1
                    skipped[.unreadable, default: .init()].add(name)
                }
                if lastUpdate.duration(to: clock.now) >= .milliseconds(125) {
                    lastUpdate = clock.now
                    progress(status)
                }
            }
            coverage.children[Data(parts.joined(separator: "/").utf8)] = observed
        }
        try Task.checkCancellation()
        progress(status)
        return .init(source: source, audio: audio, replaces: replaces, skipped: skipped, coverage: coverage)
    }

    private static func ordinaryKind(_ entry: URL, values: URLResourceValues) -> ScanCoverage.Kind {
        guard !entry.lastPathComponent.hasPrefix("."), values.isHidden != true, values.isSymbolicLink != true,
              values.isAliasFile != true, values.isPackage != true, isDownloaded(values) else { return .unknown }
        if values.isDirectory == true { return .directory }
        return values.isRegularFile == true ? .file : .unknown
    }

    private static func isDownloaded(_ values: URLResourceValues) -> Bool {
        values.isUbiquitousItem != true || values.ubiquitousItemDownloadingStatus == .current || values.ubiquitousItemDownloadingStatus == .downloaded
    }

    private static func localStamp(_ url: URL) throws -> FileStamp {
        // Take fresh metadata after decoding and at confirmation, not enumeration's cached values.
        let file = URL(fileURLWithPath: url.path(percentEncoded: false))
        let values = try file.resourceValues(forKeys: keys)
        guard ordinaryKind(file, values: values) == .file else { throw FolderError.unavailable }
        return try FileStamp(file)
    }

    private struct DirectoryReader {
        let root: URL
        private var cached: [Data: ScanCoverage.Entries] = [:]

        init(root: URL) { self.root = root }

        mutating func presence(of path: RelativeAudioPath) -> ScanCoverage.Presence {
            ScanCoverage.presence(of: path) { directory in
                if let entries = cached[directory] { return entries }
                let url = directory.isEmpty ? root : root.appending(path: String(decoding: directory, as: UTF8.self), directoryHint: .isDirectory)
                guard let entries = try? AudioScanner.children(url) else { return nil }
                let current = entries.reduce(into: ScanCoverage.Entries()) { result, entry in
                    let values = try? entry.resourceValues(forKeys: AudioScanner.keys)
                    result[Data(entry.lastPathComponent.utf8)] = values.map { AudioScanner.ordinaryKind(entry, values: $0) } ?? .unknown
                }
                cached[directory] = current
                return current
            }
        }
    }

    /// Reject stale accepted rows before indexing or restoring them. This reads metadata, not audio.
    public static func verifyAccepted(_ draft: ImportDraft, paths: [RelativeAudioPath]? = nil, in lease: FolderLease) throws {
        defer { withExtendedLifetime(lease) {} }
        try verifyAccepted(draft, paths: paths, in: lease.directory)
    }

    static func verifyAccepted(_ draft: ImportDraft, paths: [RelativeAudioPath]? = nil, in root: URL) throws {
        var directory = DirectoryReader(root: root)
        for path in paths ?? draft.audio.map(\.path) {
            try Task.checkCancellation()
            // Resolved paths alone cannot detect case-only renames on a case-insensitive volume.
            guard directory.presence(of: path) == .file,
                  let before = draft.coverage.accepted[Data(path.rawValue.utf8)],
                  let url = try? FolderAccess.readableFile(in: root, at: path),
                  (try? localStamp(url)) == before else { throw FolderError.scanChanged }
        }
    }

    /// Recheck only paths being marked missing before applying the scan preview.
    public static func verifyMissing(_ paths: [RelativeAudioPath], in lease: FolderLease) throws {
        defer { withExtendedLifetime(lease) {} }
        try verifyMissing(paths, in: lease.directory)
    }

    static func verifyMissing(_ paths: [RelativeAudioPath], in root: URL) throws {
        var directory = DirectoryReader(root: root)
        for path in paths {
            try Task.checkCancellation()
            guard directory.presence(of: path) == .missing else { throw FolderError.scanChanged }
        }
    }

    public static func verifyUnplayable(_ paths: [RelativeAudioPath], in lease: FolderLease) async throws {
        defer { withExtendedLifetime(lease) {} }
        try await verifyUnplayable(paths, in: lease.directory)
    }

    static func verifyUnplayable(_ paths: [RelativeAudioPath], in root: URL) async throws {
        var directory = DirectoryReader(root: root)
        for path in paths {
            try Task.checkCancellation()
            guard directory.presence(of: path) == .file else { throw FolderError.scanChanged }
            do {
                let url = try FolderAccess.readableFile(in: root, at: path)
                _ = try await playableDuration(of: AVURLAsset(url: url))
            } catch InspectionError.unplayable { continue }
            catch is CancellationError { throw CancellationError() }
            catch { throw FolderError.scanChanged }
            throw FolderError.scanChanged
        }
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
        let properties = try dir.resourceValues(forKeys: keys)
        guard properties.isSymbolicLink != true, properties.isAliasFile != true, properties.isPackage != true else {
            throw FolderError.unsafePath
        }
        if properties.isUbiquitousItem == true && properties.ubiquitousItemDownloadingStatus == .notDownloaded {
            throw FolderError.unavailable
        }
        return try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: Array(keys))
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    public static func inspect(_ url: URL, path: RelativeAudioPath, sourceName: String? = nil) async throws -> ScannedAudio {
        let asset = AVURLAsset(url: url)
        let duration = try await playableDuration(of: asset)
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
                                   albumArtist: text(extra, [.iTunesMetadataAlbumArtist, .id3MetadataBand,
                                                             .init(rawValue: "vorb/ALBUMARTIST")]),
                                   album: text(common, [.commonIdentifierAlbumName]),
                                   track: ordinal(extra, iTunes: .iTunesMetadataTrackNumber, id3: .id3MetadataTrackNumber, vorbis: "TRACKNUMBER"),
                                   disc: ordinal(extra, iTunes: .iTunesMetadataDiscNumber, id3: .id3MetadataPartOfASet, vorbis: "DISCNUMBER"))
        let art = AVMetadataItem.metadataItems(from: common, filteredByIdentifier: .commonIdentifierArtwork).first
        let artworkKey: String?
        if let art, let data = try? await art.load(.dataValue) { artworkKey = ArtworkCache.writeThumbnail(data) }
        else { artworkKey = nil }
        try Task.checkCancellation()
        return .init(path: path, metadata: .resolve(path, tags: tags, sourceName: sourceName), duration: duration, artworkKey: artworkKey, embeddedTags: tags)
    }

    private static func playableDuration(of asset: AVURLAsset) async throws -> Double {
        do {
            let (time, playable, protected) = try await asset.load(.duration, .isPlayable, .hasProtectedContent)
            try Task.checkCancellation()
            let duration = time.seconds
            guard playable, !protected, duration.isFinite, duration > 0,
                  !(try await asset.loadTracks(withMediaType: .audio)).isEmpty else { throw InspectionError.unplayable }
            return duration
        } catch {
            try Task.checkCancellation()
            if isFormatRejection(error, file: asset.url) { throw InspectionError.unplayable }
            // Asset loading also fails for offline files, scope failures and I/O errors.
            throw FolderError.unavailable
        }
    }

    private static func isFormatRejection(_ error: any Error, file: URL) -> Bool {
        if error is InspectionError { return isReadableLocalFile(file) }
        let failure = error as NSError
        if failure.domain == AVFoundationErrorDomain {
            switch AVError.Code(rawValue: failure.code) {
            case .fileFormatNotRecognized, .fileFailedToParse, .decoderNotFound:
                return isReadableLocalFile(file)
            case .unknown:
                guard let underlying = failure.userInfo[NSUnderlyingErrorKey] as? NSError else { return false }
                return isAudioFileFormatError(underlying) && isReadableLocalFile(file)
            case .failedToLoadMediaData:
                // AVFoundation also reports this generic error for malformed MP3s. Require an
                // explicit invalid-file result from the local audio file parser before recording it.
                guard isReadableLocalFile(file) else { return false }
                var input: AudioFileID?
                let status = AudioFileOpenURL(file as CFURL, .readPermission, 0, &input)
                if let input { AudioFileClose(input) }
                return status == kAudioFileInvalidFileError
            default: return false
            }
        }
        return isAudioFileFormatError(failure) && isReadableLocalFile(file)
    }

    private static func isAudioFileFormatError(_ error: NSError) -> Bool {
        guard error.domain == NSOSStatusErrorDomain else { return false }
        return [kAudioFileUnsupportedFileTypeError, kAudioFileUnsupportedDataFormatError, kAudioFileInvalidFileError]
            .contains { Int($0) == error.code }
    }

    private static func isReadableLocalFile(_ url: URL) -> Bool {
        let file = URL(fileURLWithPath: url.path(percentEncoded: false))
        guard url.isFileURL,
              let values = try? file.resourceValues(forKeys: keys),
              values.isRegularFile == true, values.isSymbolicLink != true, values.isAliasFile != true else { return false }
        guard isDownloaded(values) else { return false }
        do {
            let handle = try FileHandle(forReadingFrom: file)
            defer { try? handle.close() }
            _ = try handle.read(upToCount: 1)
            return true
        } catch { return false }
    }

    private static func ordinal(_ items: [AVMetadataItem], iTunes: AVMetadataIdentifier,
                                id3: AVMetadataIdentifier, vorbis: String) async -> Int? {
        for id in [iTunes, id3, AVMetadataIdentifier(rawValue: "vorb/\(vorbis)")] {
            for item in AVMetadataItem.metadataItems(from: items, filteredByIdentifier: id) {
                if let string = try? await item.load(.stringValue),
                   let first = string.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first,
                   let value = Int(first.trimmingCharacters(in: .whitespaces)), value > 0 { return value }
                if let number = try? await item.load(.numberValue), number.intValue > 0 { return number.intValue }
                if id == iTunes, let data = try? await item.load(.dataValue), data.count >= 6 {
                    // iTunes track/disc atoms: reserved word, number, total (big endian).
                    let bytes = data.dropFirst(2).prefix(2)
                    let value = bytes.reduce(0) { ($0 << 8) | Int($1) }
                    if value > 0 { return value }
                }
            }
        }
        return nil
    }
}

public enum ArtworkCache {
    /// Shared thumbnails survive until no indexed track (including inactive tracks) uses them.
    public static func removeUnreferenced(keeping keys: Set<String>) {
        removeUnreferenced(keeping: keys, in: directory)
    }

    static func removeUnreferenced(keeping keys: Set<String>, in directory: URL) {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]) else { return }
        for file in files where file.pathExtension == "jpg" {
            let key = file.deletingPathExtension().lastPathComponent
            guard url(for: key) != nil, !keys.contains(key),
                  let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                  values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            try? FileManager.default.removeItem(at: file)
        }
    }

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
