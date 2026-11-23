import CryptoKit
import Domain
import Foundation

public enum FolderError: Error, Equatable, Sendable {
    case chooseAgain, unavailable, unsafePath, wrongSource, overlappingSource, nothingToImport, scanChanged
}

public struct SourceDraft: Sendable {
    public let name: String
    public let identity: String
    public let bookmark: Data

    public init(name: String, identity: String, bookmark: Data) {
        self.name = name
        self.identity = identity
        self.bookmark = bookmark
    }
}

/// A read-only capability. Keeps the system grant alive while an AVPlayerItem reads it.
public final class FolderLease: Sendable {
    let directory: URL
    fileprivate init(directory: URL) { self.directory = directory }
    deinit { directory.stopAccessingSecurityScopedResource() }

    public func audioURL(for path: RelativeAudioPath) throws -> URL {
        try FolderAccess.readableFile(in: directory, at: path)
    }
}

public enum FolderAccess {
    public static func prepare(_ selection: URL) throws -> SourceDraft {
        #if os(iOS)
        guard selection.startAccessingSecurityScopedResource() else { throw FolderError.chooseAgain }
        defer { selection.stopAccessingSecurityScopedResource() }
        let options: URL.BookmarkCreationOptions = .minimalBookmark
        #else
        // NSOpenPanel provides the implicit grant for initial creation on macOS.
        let options: URL.BookmarkCreationOptions = [.withSecurityScope, .securityScopeAllowOnlyReadAccess]
        #endif
        let values = try selection.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey, .isAliasFileKey])
        guard values.isDirectory == true, values.isSymbolicLink != true, values.isAliasFile != true else { throw FolderError.unsafePath }
        let data = try selection.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil)
        let lease = try open(data)
        let location = lease.directory.standardizedFileURL.resolvingSymlinksInPath().path(percentEncoded: false)
        // Volume + file identifiers preserve identity across in-volume renames where available.
        let attrs = try? FileManager.default.attributesOfItem(atPath: location)
        let key: String
        if let file = attrs?[.systemFileNumber] as? NSNumber,
           let volume = try? lease.directory.resourceValues(forKeys: [.volumeUUIDStringKey]).volumeUUIDString {
            key = "file:\(volume):\(file)"
        } else {
            key = "path:\(location)"
        }
        return .init(name: selection.lastPathComponent, identity: digest(key), bookmark: data)
    }

    public static func open(_ bookmark: Data) throws -> FolderLease {
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = [.withSecurityScope, .withoutUI, .withoutMounting]
        #else
        let options: URL.BookmarkResolutionOptions = .withoutUI
        #endif
        var stale = false
        let root: URL
        do { root = try URL(resolvingBookmarkData: bookmark, options: options, relativeTo: nil, bookmarkDataIsStale: &stale) }
        catch { throw FolderError.chooseAgain }
        // M0: a stale macOS bookmark was observed to grant unexpected write-open access.
        // Do not start the old scope when stale, even if its target still resolves.
        guard !stale, root.isFileURL, root.startAccessingSecurityScopedResource() else { throw FolderError.chooseAgain }
        let lease = FolderLease(directory: root)
        guard let values = try? root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey, .isAliasFileKey]),
              values.isDirectory == true, values.isSymbolicLink != true, values.isAliasFile != true else {
            throw FolderError.unavailable
        }
        return lease
    }

    public static func checkOverlap(with candidate: FolderLease, sources: [MusicSource], identity: String) throws {
        let path = canonical(candidate.directory).pathComponents
        for source in sources where source.identity != identity {
            guard let existing = try? open(source.bookmark) else { continue }
            let previous = canonical(existing.directory).pathComponents
            if path.starts(with: previous) || previous.starts(with: path) { throw FolderError.overlappingSource }
            withExtendedLifetime(existing) {}
        }
    }

    public static func readableFile(in directory: URL, at path: RelativeAudioPath) throws -> URL {
        var cursor = directory
        let components = path.components
        for (index, component) in components.enumerated() {
            cursor.append(component: component, directoryHint: .inferFromPath)
            let values = try cursor.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .isAliasFileKey, .isPackageKey])
            let last = index == components.count - 1
            guard values.isSymbolicLink != true, values.isAliasFile != true, values.isPackage != true,
                  last ? values.isRegularFile == true : values.isDirectory == true else { throw FolderError.unsafePath }
        }
        guard canonical(cursor).pathComponents.starts(with: canonical(directory).pathComponents) else { throw FolderError.unsafePath }
        return cursor
    }

    private static func canonical(_ url: URL) -> URL { url.standardizedFileURL.resolvingSymlinksInPath() }
    static func digest(_ value: String) -> String { digest(Data(value.utf8)) }
    static func digest(_ value: Data) -> String { SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined() }
}
