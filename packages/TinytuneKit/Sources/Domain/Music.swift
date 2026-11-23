import Foundation

/// A file-system path relative to an authorized root. Never normalize case or width.
public struct RelativeAudioPath: Hashable, Sendable, Codable {
    public let rawValue: String
    public var components: [String] { rawValue.components(separatedBy: "/") }

    public init?(_ rawValue: String) {
        guard !rawValue.contains("\0"), rawValue.components(separatedBy: "/").allSatisfy({
            !$0.isEmpty && $0 != "." && $0 != ".."
        }) else { return nil }
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        guard let path = Self(string) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid relative audio path")
        }
        self = path
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct MusicTags: Sendable {
    public var title: String?
    public var artist: String?
    public var albumArtist: String?
    public var album: String?
    public var track: Int?
    public var disc: Int?

    public init(title: String? = nil, artist: String? = nil, albumArtist: String? = nil,
                album: String? = nil, track: Int? = nil, disc: Int? = nil) {
        self.title = title
        self.artist = artist
        self.albumArtist = albumArtist
        self.album = album
        self.track = track
        self.disc = disc
    }
}

public struct TrackMetadata: Codable, Hashable, Sendable {
    public let title: String
    public let artist: String?
    public let albumArtist: String?
    public let album: String?
    public let track: Int?
    public let disc: Int?

    public init(title: String, artist: String?, albumArtist: String?, album: String?, track: Int? = nil, disc: Int? = nil) {
        self.title = title
        self.artist = artist
        self.albumArtist = albumArtist
        self.album = album
        self.track = track
        self.disc = disc
    }

    public static func resolve(_ path: RelativeAudioPath, tags: MusicTags) -> Self {
        let parts = path.components
        let directories = parts.dropLast()
        let stem = (parts.last! as NSString).deletingPathExtension
        let prefix = stem.range(of: #"^\d{1,3}(?:[.\-]\s*|\s+)"#, options: .regularExpression)
        let prefixNumber = prefix.flatMap { Int(stem[$0].prefix(while: \Character.isNumber)) }
        let stripped = prefix.map { String(stem[$0.upperBound...]) } ?? stem
        let clean = stripped.replacingOccurrences(of: #"\s*\[\d{2,4}\s*k(?:bps)?\]\s*$"#, with: "", options: [.regularExpression, .caseInsensitive])
        let split = clean.range(of: " - ")
        let nameArtist = split.flatMap { nonblank(String(clean[..<$0.lowerBound])) }
        let nameTitle = split.flatMap { nonblank(String(clean[$0.upperBound...])) }
        let artist = nonblank(tags.artist) ?? nonblank(directories.first) ?? nameArtist
        let disc = directories.dropFirst(2).first.flatMap { part -> Int? in
            guard part.range(of: #"^(?:cd|disc)\s*\d{1,3}$"#, options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
            return Int(String(part.reversed().prefix(while: \Character.isNumber).reversed()))
        }
        return .init(title: nonblank(tags.title) ?? nameTitle ?? nonblank(clean) ?? nonblank(stem) ?? parts.last!,
                     artist: artist, albumArtist: nonblank(tags.albumArtist) ?? artist,
                     album: nonblank(tags.album) ?? nonblank(directories.dropFirst().first),
                     track: positive(tags.track) ?? positive(prefixNumber), disc: positive(tags.disc) ?? positive(disc))
    }

    private static func nonblank(_ string: String?) -> String? {
        guard let value = string?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    private static func positive(_ number: Int?) -> Int? { number.flatMap { $0 > 0 ? $0 : nil } }
}

public struct Track: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let rootID: UUID
    public let path: RelativeAudioPath
    public let metadata: TrackMetadata
    public let duration: Double
    public let dateAdded: Date
    public let artworkKey: String?

    public init(id: UUID = UUID(), rootID: UUID, path: RelativeAudioPath, metadata: TrackMetadata,
                duration: Double, dateAdded: Date = Date(), artworkKey: String? = nil) {
        self.id = id
        self.rootID = rootID
        self.path = path
        self.metadata = metadata
        self.duration = duration
        self.dateAdded = dateAdded
        self.artworkKey = artworkKey
    }

    public func matches(_ query: String) -> Bool {
        let needle = MusicOrdering.key(query)
        return needle.isEmpty || [metadata.title, metadata.artist, metadata.albumArtist, metadata.album]
            .compactMap { $0 }.contains { MusicOrdering.key($0).contains(needle) }
    }
}

public enum MusicOrdering {
    public static func key(_ title: String) -> String {
        title.folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .split(whereSeparator: \Character.isWhitespace).joined(separator: " ")
    }

    public static func byTitle(_ a: Track, _ b: Track) -> Bool {
        let comparison = a.metadata.title.localizedStandardCompare(b.metadata.title)
        return comparison == .orderedSame ? a.id.uuidString < b.id.uuidString : comparison == .orderedAscending
    }

    public static func byAlbumOrder(_ a: Track, _ b: Track) -> Bool {
        let x = (a.metadata.disc ?? 1, a.metadata.track ?? Int.max)
        let y = (b.metadata.disc ?? 1, b.metadata.track ?? Int.max)
        return x == y ? byTitle(a, b) : x < y
    }
}
