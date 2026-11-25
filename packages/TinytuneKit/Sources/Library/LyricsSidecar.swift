import Domain
import Foundation

public enum LyricsSidecar {
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
        let document = try LyricsFile.parse(LyricsFile.read(url))
        return document.isEmpty ? nil : document
    }
}
