import Domain
import Foundation
import XCTest

final class LyricsTests: XCTestCase {
    func testSharedFixtureSortsExpandsGroupsAndClearsTiming() throws {
        var fixtures = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { fixtures.deleteLastPathComponent() }
        let source = try String(contentsOf: fixtures.appending(path: "tests/Fixtures/Lyrics/timeline.lrc"), encoding: .utf8)
        let document = LyricsDocument.parse(source)
        XCTAssertEqual(document.cues.map(\.milliseconds), [875, 2750, 5250, 7750])
        XCTAssertEqual(document.cues.map(\.lines), [["第一句"], ["合成段落", "第二行"], [], ["合成段落"]])
        XCTAssertNil(document.index(at: 0.874))
        XCTAssertEqual(document.index(at: 0.875), 0)
        XCTAssertEqual(document.index(at: 2.75), 1)
        XCTAssertNil(document.index(at: 5.25))
        XCTAssertEqual(document.index(at: 7.75), 3)
        XCTAssertNil(document.index(at: .infinity))
    }

    func testBOMPlainMetadataAndMalformedLabels() {
        XCTAssertEqual(LyricsDocument.parse("\u{FEFF}[ti:title]\r\n正文\r\n下一行\r\n").plainText, "正文\n下一行")
        XCTAssertTrue(LyricsDocument.parse("[offset:0]\n\n").isEmpty)
        XCTAssertEqual(LyricsDocument.parse("[Verse]\n正文\n[00:62]非法").plainText, "[Verse]\n正文\n[00:62]非法")
        XCTAssertEqual(LyricsDocument.parse("[00:00]引子\n[offset:-250]").cues.first?.milliseconds, 250)
        XCTAssertEqual(LyricsDocument.parse("[00:00.1]引子\n[offset:250]").cues.first?.milliseconds, 0)
    }
}
