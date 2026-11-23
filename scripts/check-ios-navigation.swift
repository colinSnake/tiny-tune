// Run against a Chinese iPhone portrait screenshot with the keyboard dismissed:
// swift scripts/check-ios-navigation.swift <screenshot.png> <音乐库|搜索|来源>
import Foundation
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    exit(EXIT_FAILURE)
}

let tabs = ["音乐库", "搜索", "来源"]
let arguments = CommandLine.arguments
guard arguments.count == 3, tabs.contains(arguments[2]) else {
    fail("Pass a screenshot file and the expected navigation title: \(tabs.joined(separator: " / "))")
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
try VNImageRequestHandler(url: URL(fileURLWithPath: arguments[1])).perform([request])
let observations = (request.results ?? []).compactMap { observation -> (text: String, frame: CGRect)? in
    guard let text = observation.topCandidates(1).first?.string else { return nil }
    return (text.replacingOccurrences(of: " ", with: ""), observation.boundingBox)
}
let bottom = observations.filter { $0.frame.midY < 0.07 }
let actual = bottom.filter { tabs.contains($0.text) || $0.text == "设置" }.sorted { $0.frame.midX < $1.frame.midX }
guard actual.map(\.text) == tabs else { fail("Expected exactly three tabs, found \(bottom.map(\.text))") }
let gaps = zip(actual, actual.dropFirst()).map { $1.frame.midX - $0.frame.midX }
guard abs(gaps[0] - gaps[1]) < 0.04, abs(actual[1].frame.midX - 0.5) < 0.04 else {
    fail("Tab labels are not balanced across the bar")
}
guard let title = observations.first(where: { $0.text == arguments[2] && $0.frame.midY > 0.8 }) else {
    fail("Expected \(arguments[2]) in the navigation bar")
}
guard abs(title.frame.midX - 0.5) < 0.04 else {
    fail("Navigation title is not centered inline: \(title.frame)")
}
print("PASS: three balanced tabs and a centered \(arguments[2]) title")
