import Domain
import Foundation

public enum LyricsImportError: Error, Equatable, Sendable {
    case wrongExtension, unavailable, tooLarge, invalidEncoding, empty
}

/// Stores only confirmed, validated copies. A track ID identifies one indexed recording,
/// regardless of the filename, display metadata or location of the selected lyrics file.
public actor ImportedLyricsStore {
    public struct Candidate: Identifiable, Sendable {
        public let id = UUID()
        public let filename: String
        public let document: LyricsDocument
        fileprivate let data: Data
    }

    public struct Resolved: Sendable {
        public let document: LyricsDocument
        public let isImported: Bool
    }

    private let directory: URL

    public init(directory: URL = URL.applicationSupportDirectory
        .appending(path: "Tinytune/ImportedLyrics", directoryHint: .isDirectory)) {
        self.directory = directory
    }

    public func prepareImport(from url: URL) throws -> Candidate {
        guard url.isFileURL, url.pathExtension.lowercased() == "lrc" else { throw LyricsImportError.wrongExtension }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data = try LyricsFile.read(url)
        let document = try LyricsFile.parse(data)
        guard !document.isEmpty else { throw LyricsImportError.empty }
        return Candidate(filename: url.lastPathComponent, document: document, data: data)
    }

    public func save(_ candidate: Candidate, for trackID: UUID) throws {
        try Task.checkCancellation()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try candidate.data.write(to: file(for: trackID), options: .atomic)
    }

    public func read(for trackID: UUID) throws -> LyricsDocument? {
        do {
            let document = try LyricsFile.parse(LyricsFile.read(file(for: trackID)))
            guard !document.isEmpty else { throw LyricsImportError.empty }
            return document
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
            return nil
        }
    }

    public func resolve(for trackID: UUID, bookmark: Data?, audioPath: RelativeAudioPath) throws -> Resolved? {
        if let document = try read(for: trackID) { return .init(document: document, isImported: true) }
        guard let bookmark else { throw FolderError.unavailable }
        return try LyricsSidecar.read(bookmark: bookmark, audioPath: audioPath).map { .init(document: $0, isImported: false) }
    }

    public func remove(for trackID: UUID) throws {
        do { try FileManager.default.removeItem(at: file(for: trackID)) }
        catch let error as CocoaError where error.code == .fileNoSuchFile { return }
    }

    public func removeDeletedTracks(_ ids: Set<UUID>) {
        for id in ids { try? remove(for: id) }
    }

    /// Best-effort cleanup of our own copies, including leftovers from old catalog removals.
    public func removeUnreferenced(keeping ids: Set<UUID>) {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]) else { return }
        for file in files where file.pathExtension == "lrc" {
            guard let id = UUID(uuidString: file.deletingPathExtension().lastPathComponent), !ids.contains(id),
                  let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                  values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            try? FileManager.default.removeItem(at: file)
        }
    }

    private func file(for trackID: UUID) -> URL {
        directory.appending(path: "\(trackID.uuidString).lrc", directoryHint: .notDirectory)
    }
}

enum LyricsFile {
    private static let limit = 1_048_576

    static func read(_ url: URL) throws -> Data {
        try Task.checkCancellation()
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isAliasFileKey, .isSymbolicLinkKey,
                                                      .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
        guard values.isRegularFile == true, values.isAliasFile != true, values.isSymbolicLink != true,
              values.isUbiquitousItem != true || values.ubiquitousItemDownloadingStatus != .notDownloaded else {
            throw LyricsImportError.unavailable
        }
        if let size = values.fileSize, size > limit { throw LyricsImportError.tooLarge }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let data = try file.read(upToCount: limit + 1) ?? Data()
        guard data.count <= limit else { throw LyricsImportError.tooLarge }
        return data
    }

    static func parse(_ data: Data) throws -> LyricsDocument {
        try Task.checkCancellation()
        guard let text = String(data: data, encoding: .utf8), !data.contains(0) else {
            throw LyricsImportError.invalidEncoding
        }
        return LyricsDocument.parse(text)
    }
}
