import Domain
import Foundation
import XCTest
@testable import Library

final class LyricsSidecarTests: XCTestCase {
    func testMatchesExactStemAndDistinguishesMissingUnsafeAndInvalid() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let album = root.appending(path: "专辑")
        try FileManager.default.createDirectory(at: album, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let track = try XCTUnwrap(RelativeAudioPath("专辑/01 曲.现场.FLAC"))
        let sidecar = album.appending(path: "01 曲.现场.lrc")
        XCTAssertNil(try LyricsSidecar.read(in: root, audioPath: track))
        try Data([0xFF]).write(to: sidecar)
        XCTAssertThrowsError(try LyricsSidecar.read(in: root, audioPath: track))
        try Data(repeating: 0x41, count: 1_048_577).write(to: sidecar)
        XCTAssertThrowsError(try LyricsSidecar.read(in: root, audioPath: track))
        try Data("[00:01]测试".utf8).write(to: sidecar)
        XCTAssertEqual(try LyricsSidecar.read(in: root, audioPath: track)?.cues.first?.lines, ["测试"])
        try FileManager.default.removeItem(at: sidecar)
        try FileManager.default.createSymbolicLink(at: sidecar, withDestinationURL: root.appending(path: "missing.lrc"))
        XCTAssertThrowsError(try LyricsSidecar.read(in: root, audioPath: track))
    }
}
