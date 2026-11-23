import Domain
import Foundation

public enum LyricsSidecar {
    private enum ReadError: Error { case unavailable, tooLarge, invalidEncoding }
    private static let limit = 1_048_576

    public static func read(bookmark: Data, audioPath: RelativeAudioPath) throws -> LyricsDocument? {
        let lease = try FolderAccess.open(bookmark)
        return try withExtendedLifetime(lease) { try read(in: lease.directory, audioPath: audioPath) }
    }

    static func read(in root: URL, audioPath: RelativeAudioPath) throws -> LyricsDocument? {
        try Task.checkCancellation()
        let components = audioPath.components
        guard let audio = components.last,
              let relative = RelativeAudioPath((components.dropLast() + [(audio as NSString).deletingPathExtension + ".lrc"]).joined(separator: "/")) else {
            throw FolderError.unsafePath
        }
        let url: URL
        do { url = try FolderAccess.readableFile(in: root, at: relative) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile { return nil }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
        if values.isUbiquitousItem == true && values.ubiquitousItemDownloadingStatus == .notDownloaded { throw ReadError.unavailable }
        if let size = values.fileSize, size > limit { throw ReadError.tooLarge }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let data = try file.read(upToCount: limit + 1) ?? Data()
        guard data.count <= limit else { throw ReadError.tooLarge }
        guard let text = String(data: data, encoding: .utf8) else { throw ReadError.invalidEncoding }
        try Task.checkCancellation()
        let document = LyricsDocument.parse(text)
        return document.isEmpty ? nil : document
    }
}
