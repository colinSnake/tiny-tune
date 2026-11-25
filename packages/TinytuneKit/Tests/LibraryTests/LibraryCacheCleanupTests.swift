import Domain
import Foundation
@testable import Library
import XCTest

@MainActor
final class LibraryCacheCleanupTests: XCTestCase {
    func testLyricsCleanupRemovesOnlyUnreferencedTrackCopies() async throws {
        let directory = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let kept = UUID(), removed = UUID()
        let chosen = directory.appending(path: "original.lrc")
        try "[00:01.00]Original lyrics".write(to: chosen, atomically: true, encoding: .utf8)
        let copies = directory.appending(path: "copies")
        let store = ImportedLyricsStore(directory: copies)
        let candidate = try await store.prepareImport(from: chosen)
        try await store.save(candidate, for: kept)
        try await store.save(candidate, for: removed)
        let unrelated = copies.appending(path: "notes.txt")
        try Data([1]).write(to: unrelated)
        await store.removeUnreferenced(keeping: [kept])
        let keptLyrics = try await store.read(for: kept)
        let removedLyrics = try await store.read(for: removed)
        XCTAssertEqual(keptLyrics, candidate.document)
        XCTAssertNil(removedLyrics)
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
        XCTAssertEqual(try String(contentsOf: chosen, encoding: .utf8), "[00:01.00]Original lyrics")
        await store.removeUnreferenced(keeping: [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: copies.appending(path: "\(kept.uuidString).lrc").path))
    }

    func testArtworkCleanupKeepsSharedCoversAndDoesNotTouchUnrelatedFiles() throws {
        let directory = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let kept = String(repeating: "a", count: 64), removed = String(repeating: "b", count: 64)
        let keptFile = directory.appending(path: "\(kept).jpg")
        let removedFile = directory.appending(path: "\(removed).jpg")
        let unrelated = directory.appending(path: "notes.jpg")
        let bytes = Data([12, 34, 56])
        for file in [keptFile, removedFile, unrelated] { try bytes.write(to: file) }
        let subdirectory = directory.appending(path: "\(String(repeating: "c", count: 64)).jpg")
        try FileManager.default.createDirectory(at: subdirectory, withIntermediateDirectories: false)
        ArtworkCache.removeUnreferenced(keeping: [kept], in: directory)
        XCTAssertEqual(try Data(contentsOf: keptFile), bytes, "Other sources may share this thumbnail")
        XCTAssertFalse(FileManager.default.fileExists(atPath: removedFile.path))
        XCTAssertEqual(try Data(contentsOf: unrelated), bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: subdirectory.path))
        ArtworkCache.removeUnreferenced(keeping: [], in: directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: keptFile.path))
    }

    private func temporaryFolder() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}
