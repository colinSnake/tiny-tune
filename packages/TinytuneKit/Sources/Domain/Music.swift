import Foundation

/// A file-system path relative to an authorized root. Never normalize case or width.
public struct RelativeAudioPath: Hashable, Sendable, Codable {
    public let rawValue: String
    public var components: [String] { rawValue.components(separatedBy: "/") }

    /// The album's relative directory, or an empty string for the source root.
    public var albumDirectory: String { catalogLocation.albumFolders.joined(separator: "/") }

    fileprivate var catalogLocation: (albumFolders: ArraySlice<String>, disc: Int?, file: String) {
        let parts = components
        let folders = parts.dropLast()
        let disc = folders.last.flatMap { part -> Int? in
            guard part.range(of: #"^(?:cd|disc)\s*\d{1,3}$"#, options: [.regularExpression, .caseInsensitive]) != nil,
                  let number = Int(String(part.reversed().prefix(while: \Character.isNumber).reversed())), number > 0 else { return nil }
            return number
        }
        return (disc == nil ? folders : folders.dropLast(), disc, parts.last!)
    }

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

public struct MusicTags: Equatable, Sendable {
    public var title: String?
    public var artist: String?
    public var albumArtist: String?
    public var album: String?
    public var track: Int?
    public var disc: Int?

    public var readableAlbumArtist: String? { TrackMetadata.readableTag(albumArtist) }

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

    public static func resolve(_ path: RelativeAudioPath, tags: MusicTags, sourceName: String? = nil) -> Self {
        let location = path.catalogLocation
        let album = nonblank(location.albumFolders.last) ?? nonblank(sourceName)
        let wrapsAudio = location.albumFolders.first?.caseInsensitiveCompare("audio") == .orderedSame
        let artistFolders = wrapsAudio ? location.albumFolders.dropFirst() : location.albumFolders
        // A lone directory can be an album. Only treat it as an artist when its container
        // establishes audio/Artist, or when an Artist/Album hierarchy is present.
        let hasArtistFolder = wrapsAudio || sourceName?.caseInsensitiveCompare("audio") == .orderedSame || artistFolders.count > 1
        let artistDirectory = wrapsAudio ? artistFolders.first : (artistFolders.count > 1 ? artistFolders.dropLast().last : artistFolders.first)
        let folderName = hasArtistFolder ? nonblank(artistDirectory) : nil
        let folderArtist = folderName == "未归档歌曲" ? nil : folderName
        let stem = (location.file as NSString).deletingPathExtension
        let tagTitle = readableTag(tags.title)
        let tagArtist = readableTag(tags.artist)
        let tagAlbumArtist = tags.readableAlbumArtist
        let trackPrefix = filenameTrack(stem, title: tagTitle, track: tags.track)
        let stripped = trackPrefix?.title ?? stem
        let clean = stripped.replacingOccurrences(of: #"\s*\[\d{2,4}\s*k(?:bps)?\]\s*$"#, with: "", options: [.regularExpression, .caseInsensitive])
        let hints = Set([folderArtist, tagArtist, tagAlbumArtist].compactMap(nonblank).map(fileArtistKey))
        let name = splitFileName(clean, artistHints: hints, albumHint: album.map(fileArtistKey),
                                 allowUnconfirmedArtist: location.albumFolders.isEmpty)
        let fileTitle = nonblank(name.title) ?? nonblank(stem)
        let title = fileTitle.flatMap { $0.allSatisfy(\.isNumber) ? nil : $0 } ?? tagTitle ?? fileTitle ?? location.file
        let artist = folderArtist ?? tagArtist ?? name.artist ?? tagAlbumArtist
        // Keep short numeric sequences intact at 09 → 10; four-digit titles like 1989 are not ordinals.
        let numberedStem = tagTitle.map { !$0.allSatisfy(\.isNumber) } == true &&
            stem.range(of: #"^[0-9]{2,3}$"#, options: .regularExpression) != nil ? positive(Int(stem)) : nil
        return .init(title: title, artist: artist, albumArtist: tagAlbumArtist ?? artist,
                     album: album ?? readableTag(tags.album), track: trackPrefix?.number ?? positive(tags.track) ?? numberedStem,
                     disc: location.disc ?? positive(tags.disc))
    }

    private static func filenameTrack(_ stem: String, title: String?, track: Int?) -> (number: Int, title: String)? {
        guard let prefix = stem.range(of: #"^[0-9]{1,3}(?:\s*[.\-]\s*|\s+)"#, options: .regularExpression),
              let number = Int(stem[prefix].prefix(while: \Character.isNumber)), number > 0,
              let rest = nonblank(String(stem[prefix.upperBound...])),
              title.map(MusicOrdering.key) != MusicOrdering.key(stem) else { return nil }
        let marker = stem[prefix]
        // A bare number followed by a space might be part of the actual title (17 岁).
        // A legacy index can contain an inferred number, so only padding, an explicit marker,
        // or a number without a pre-existing title is strong enough evidence.
        let separated = marker.last?.isWhitespace == true && (marker.contains(".") || marker.contains("-"))
        guard marker.first == "0" || separated || (track == number && title == nil) else { return nil }
        return (number, rest)
    }

    fileprivate static func readableTag(_ text: String?) -> String? {
        guard let text = nonblank(text), !text.unicodeScalars.contains(where: {
            $0.value == 0xfffd || (0x7f...0x9f).contains($0.value) || ($0.value < 0x20 && $0 != "\t")
        }) else { return nil }
        // Old GBK tags misread as Latin-1 often contain runs of accents and punctuation
        // (e.g. »ÒÉ«¹ì¼£). Avoid guessing a replacement encoding or changing normal accents.
        if text.range(of: #"(?:[\u00A1-\u00FF]{6,})"#, options: .regularExpression) != nil,
           text.range(of: #"[«»¡¿¢£¤¥¹²³¼½¾]"#, options: .regularExpression) != nil { return nil }
        if text.range(of: #"[ÃÂ][\u0080-\u00BF]"#, options: .regularExpression) != nil { return nil }
        return text
    }

    private static func splitFileName(_ file: String, artistHints: Set<String>, albumHint: String?, allowUnconfirmedArtist: Bool) -> (artist: String?, title: String) {
        func recognized(_ name: String) -> Bool {
            let key = fileArtistKey(name)
            return artistHints.contains(key) || key == albumHint
        }
        // Compact `Title-Artist` is only recognized when the suffix matches a known name.
        // Treat a quality suffix as such only when the rest matches that naming pattern.
        let withoutQuality = file.replacingOccurrences(of: #"\s*-\s*(?:hi-res|无损|高品)$"#, with: "", options: [.regularExpression, .caseInsensitive])
        if let split = withoutQuality.lastIndex(of: "-"),
           let title = nonblank(String(withoutQuality[..<split])),
           let artist = nonblank(String(withoutQuality[withoutQuality.index(after: split)...])),
           recognized(artist) {
            return (artist, title)
        }
        if let split = file.range(of: " - "),
           let artist = nonblank(String(file[..<split.lowerBound])),
           let title = nonblank(String(file[split.upperBound...])),
           (allowUnconfirmedArtist && artistHints.isEmpty) || recognized(artist) {
            return (artist, title)
        }
        return (nil, file)
    }

    private static func fileArtistKey(_ name: String) -> String {
        MusicOrdering.key(name).filter { !$0.isWhitespace }
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
    public let automaticMetadata: TrackMetadata
    public let duration: Double
    public let dateAdded: Date
    public let artworkKey: String?

    public init(id: UUID = UUID(), rootID: UUID, path: RelativeAudioPath, metadata: TrackMetadata,
                duration: Double, dateAdded: Date = Date(), artworkKey: String? = nil, automaticMetadata: TrackMetadata? = nil) {
        self.id = id
        self.rootID = rootID
        self.path = path
        self.metadata = metadata
        self.automaticMetadata = automaticMetadata ?? metadata
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
