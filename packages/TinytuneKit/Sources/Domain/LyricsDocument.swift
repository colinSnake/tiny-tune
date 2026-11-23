import Foundation

public struct LyricCue: Equatable, Sendable {
    public let milliseconds: Int
    public let lines: [String]
    public var seconds: Double { Double(milliseconds) / 1000 }
}

public struct LyricsDocument: Equatable, Sendable {
    public let cues: [LyricCue]
    public let plainText: String
    public var isEmpty: Bool { cues.isEmpty && plainText.isEmpty }

    public static func parse(_ source: String) -> Self {
        let text = source.first == "\u{FEFF}" ? source.dropFirst() : source[...]
        let timestamp = /^\[([0-9]{1,6}):([0-5][0-9])(?:\.([0-9]{1,3}))?\]/
        let metadata = /^\[([A-Za-z]+):([^\]]*)\]$/
        var offset = 0
        var timed: [(Int, String)] = []
        var plain: [String] = []
        for line in text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline) {
            let cleaned = line.trimmingCharacters(in: .whitespaces)
            if let tag = cleaned.wholeMatch(of: metadata) {
                if tag.1.lowercased() == "offset", let ms = Int(tag.2.trimmingCharacters(in: .whitespaces)),
                   (-1_000_000_000...1_000_000_000).contains(ms) { offset = ms }
                continue
            }
            var rest = cleaned[...]
            var times: [Int] = []
            while let match = rest.prefixMatch(of: timestamp), let min = Int(match.1), let sec = Int(match.2) {
                let fraction = match.3.map(String.init) ?? ""
                let ms = Int(fraction.padding(toLength: 3, withPad: "0", startingAt: 0)) ?? 0
                times.append((min * 60 + sec) * 1000 + ms)
                rest = rest[match.range.upperBound...]
            }
            let words = rest.trimmingCharacters(in: .whitespaces)
            if times.isEmpty { plain.append(words) }
            for time in times { timed.append((time, words)) }
        }
        guard timed.contains(where: { !$0.1.isEmpty }) else {
            return .init(cues: [], plainText: plain.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
        }
        var groups: [Int: [String]] = [:]
        for (time, words) in timed {
            let key = max(0, time - offset)
            if groups[key] == nil { groups[key] = [] }
            if !words.isEmpty, !groups[key, default: []].contains(words) { groups[key, default: []].append(words) }
        }
        return .init(cues: groups.keys.sorted().map { .init(milliseconds: $0, lines: groups[$0] ?? []) }, plainText: "")
    }

    public func index(at seconds: Double) -> Int? {
        guard seconds.isFinite, seconds >= 0 else { return nil }
        var low = 0, high = cues.count
        while low < high {
            let mid = low + (high - low) / 2
            if cues[mid].seconds <= seconds { low = mid + 1 } else { high = mid }
        }
        return low > 0 && !cues[low - 1].lines.isEmpty ? low - 1 : nil
    }
}
