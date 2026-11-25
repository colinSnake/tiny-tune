import Domain
import Foundation
import Library
import XCTest

final class ImportedLyricsStoreTests: XCTestCase {
    @MainActor
    func testPreviewDoesNotSaveAndConfirmedCopyPersistsPerTrack() async throws {
        let root = try makeDirectory()
        let location = root.appending(path: "private")
        let store = ImportedLyricsStore(directory: location)
        let first = UUID(), second = UUID()
        let original = root.appending(path: "同名歌曲.LRC")
        try "\u{FEFF}[00:02.20]第一個版本".write(to: original, atomically: true, encoding: .utf8)
        let candidate = try await store.prepareImport(from: original)
        XCTAssertEqual(candidate.filename, "同名歌曲.LRC")
        XCTAssertEqual(candidate.document.cues.first?.milliseconds, 2200)
        let unconfirmed = try await store.read(for: first)
        XCTAssertNil(unconfirmed)

        // Use the validated bytes from the preview, even if the picker URL changes before confirmation.
        try "另一個版本".write(to: original, atomically: true, encoding: .utf8)
        let secondCandidate = try await store.prepareImport(from: original)
        try await store.save(candidate, for: first)
        try await store.save(secondCandidate, for: second)
        try FileManager.default.removeItem(at: original)

        let reopened = ImportedLyricsStore(directory: location)
        let firstLyrics = try await reopened.read(for: first)
        let secondLyrics = try await reopened.read(for: second)
        XCTAssertEqual(firstLyrics, candidate.document)
        XCTAssertEqual(secondLyrics?.plainText, "另一個版本")
        try await reopened.save(secondCandidate, for: first)
        let replacement = try await reopened.read(for: first)
        XCTAssertEqual(replacement, secondCandidate.document)
        try await reopened.remove(for: first)
        try await reopened.remove(for: first) // idempotent
        let removed = try await reopened.read(for: first)
        let unrelated = try await reopened.read(for: second)
        XCTAssertNil(removed)
        XCTAssertEqual(unrelated, secondCandidate.document)
    }

    @MainActor
    func testRejectsInvalidSelectionWithoutOverwritingExistingLyrics() async throws {
        let root = try makeDirectory()
        let store = ImportedLyricsStore(directory: root.appending(path: "private"))
        let track = UUID()
        let original = root.appending(path: "song.lrc")
        try "[00:01]已存在".write(to: original, atomically: true, encoding: .utf8)
        let existing = try await store.prepareImport(from: original)
        try await store.save(existing, for: track)

        for (data, expected): (Data, LyricsImportError) in [
            (Data([0xFF]), .invalidEncoding),
            (Data("[ti:only metadata]\n[00:01]".utf8), .empty),
            (Data(repeating: 0x41, count: 1_048_577), .tooLarge),
        ] {
            try data.write(to: original, options: .atomic)
            do { _ = try await store.prepareImport(from: original); XCTFail("Unexpected valid selection") }
            catch { XCTAssertEqual(error as? LyricsImportError, expected) }
        }
        let other = root.appending(path: "wrong.txt")
        try "Valid text".write(to: other, atomically: true, encoding: .utf8)
        do { _ = try await store.prepareImport(from: other); XCTFail("Accepted a non-LRC file") }
        catch { XCTAssertEqual(error as? LyricsImportError, .wrongExtension) }
        let link = root.appending(path: "link.lrc")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: other)
        do { _ = try await store.prepareImport(from: link); XCTFail("Accepted a symbolic link") }
        catch { XCTAssertEqual(error as? LyricsImportError, .unavailable) }

        let lyrics = try await store.read(for: track)
        XCTAssertEqual(lyrics, existing.document)
    }

    @MainActor
    func testOverrideTakesPriorityEvenWithoutBookmarkAndRemovalRestoresSidecar() async throws {
        let root = try makeDirectory()
        let source = try FolderAccess.prepare(root)
        let chosen = root.appending(path: "selected.lrc")
        let sidecar = root.appending(path: "song.lrc")
        try "Imported".write(to: chosen, atomically: true, encoding: .utf8)
        try "Folder sidecar".write(to: sidecar, atomically: true, encoding: .utf8)
        let track = UUID()
        let path = try XCTUnwrap(RelativeAudioPath("song.wav"))
        let store = ImportedLyricsStore(directory: root.appending(path: "private"))
        let candidate = try await store.prepareImport(from: chosen)
        try await store.save(candidate, for: track)

        let local = try await store.resolve(for: track, bookmark: source.bookmark, audioPath: path)
        let offline = try await store.resolve(for: track, bookmark: nil, audioPath: path)
        XCTAssertEqual(local?.isImported, true)
        XCTAssertEqual(local?.document.plainText, "Imported")
        XCTAssertEqual(offline?.document, local?.document)
        try await store.remove(for: track)
        let fallback = try await store.resolve(for: track, bookmark: source.bookmark, audioPath: path)
        XCTAssertEqual(fallback?.isImported, false)
        XCTAssertEqual(fallback?.document.plainText, "Folder sidecar")
        XCTAssertEqual(try String(contentsOf: sidecar, encoding: .utf8), "Folder sidecar")
        XCTAssertEqual(try String(contentsOf: chosen, encoding: .utf8), "Imported")
    }

    private func makeDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: root) }
        return root
    }
}
