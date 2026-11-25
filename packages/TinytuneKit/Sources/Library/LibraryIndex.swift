import Domain
import Foundation

public struct AlbumGroup: Identifiable, Sendable {
    public let id: String
    public let title: String?
    public let artist: String?
    public let location: String?
    public let tracks: [Track]
    public let artwork: URL?

    public var showsArtistSubtitle: Bool {
        guard let artist else { return true }
        let artistKey = MusicOrdering.key(artist)
        // Some imported directory trees leak the "audio" container name into album-artist tags.
        guard artistKey != "audio" else { return false }
        guard let title else { return true }
        return artistKey != MusicOrdering.key(title)
    }
}

public struct ArtistGroup: Identifiable, Sendable {
    public let id: String
    public let name: String?
    public let albums: [AlbumGroup]
    public var tracks: [Track] { albums.flatMap(\.tracks) }
    public var artwork: URL? { albums.lazy.compactMap(\.artwork).first }
}

/// Browsing and search data for a single immutable library snapshot.
public struct LibraryIndex: Sendable {
    public enum ArtistGrouping: Sendable {
        case performer
        /// The first artist directory below a music source (or its audio wrapper) names the artist.
        case folder
    }

    public struct Query: Equatable, Sendable {
        fileprivate let key: String
        public var isEmpty: Bool { key.isEmpty }

        public init(_ text: String) { key = MusicOrdering.key(text) }
    }

    public struct SearchResults: Sendable {
        public let songs: [Track]
        public let artists: [ArtistGroup]
        public let albums: [AlbumGroup]
        public var isEmpty: Bool { songs.isEmpty && artists.isEmpty && albums.isEmpty }
    }

    public let revision = UUID()
    public let artists: [ArtistGroup]
    public let albums: [AlbumGroup]
    public let catalogTracks: [Track]
    private let trackKeys: [[String]]
    private let artistKeys: [String?]
    private let albumKeys: [String?]

    public init(tracks input: [Track], sourceNames: [UUID: String] = [:], foldsQualityVariants: Bool = false,
                artistGrouping: ArtistGrouping = .performer) {
        let tracks = foldsQualityVariants ? Self.foldingQualityCopies(in: input) : input
        catalogTracks = tracks
        let grouped = Dictionary(grouping: tracks, by: Self.albumID)
        let albumLocations = Self.uniqueLabels(grouped.compactMap { id, songs -> (String, String)? in
            guard let track = songs.first else { return nil }
            let location = Self.location(sourceNames[track.rootID], path: track.path.albumDirectory)
            return location.isEmpty ? nil : (id, location)
        })
        func artistFolderName(_ track: Track) -> String? {
            guard case .folder = artistGrouping else { return nil }
            let folders = track.path.albumDirectory.split(separator: "/").map(String.init)
            let folder: String?
            // Importing Downloads keeps audio/Artist/... paths; audio is a container, not an artist.
            if folders.first?.caseInsensitiveCompare("audio") == .orderedSame {
                folder = folders.dropFirst().first
            } else {
                folder = folders.first
            }
            guard let folder else { return nil }
            let name = folder.trimmingCharacters(in: .whitespacesAndNewlines)
            // The Web exporter uses this directory for unfiled music; it is not an artist.
            return name.isEmpty || name == "未归档歌曲" ? nil : name
        }
        let folderAlbums = grouped.map { id, values in
            let ordered = values.sorted(by: MusicOrdering.byAlbumOrder)
            let folderArtist = ordered.first.flatMap(artistFolderName)
            // Without an artist folder, do not credit a compilation to a random performer.
            let names = ordered.compactMap(\.metadata.albumArtist)
            let artist = folderArtist ?? (Set(names.map(Self.key)).count == 1 ? names.first : nil)
            let artwork = ordered.lazy.compactMap { $0.artworkKey.flatMap(ArtworkCache.url(for:)) }.first
            return (album: AlbumGroup(id: id, title: ordered.first?.metadata.album, artist: artist,
                                      location: albumLocations[id], tracks: ordered, artwork: artwork), folderArtist: folderArtist)
        }
        var byArtist: [String: (name: String?, albums: [AlbumGroup])] = [:]
        for (album, folderArtist) in folderAlbums.sorted(by: { $0.album.id < $1.album.id }) {
            if let folderArtist {
                byArtist[Self.key(folderArtist), default: (folderArtist, [])].albums.append(album)
                continue
            }
            // Tracks at the source root or in a miscellaneous folder keep their performer groups.
            let performers = Dictionary(grouping: album.tracks) { Self.key($0.metadata.artist ?? $0.metadata.albumArtist) }
            for (id, songs) in performers {
                let name = songs.first.flatMap { $0.metadata.artist ?? $0.metadata.albumArtist }
                let group = AlbumGroup(id: album.id, title: album.title, artist: album.artist,
                                       location: album.location, tracks: songs, artwork: album.artwork)
                byArtist[id, default: (name, [])].albums.append(group)
            }
            // Keep explicit album credits discoverable as well as individual performers.
            if let artist = album.artist, performers[Self.key(artist)] == nil {
                byArtist[Self.key(artist), default: (artist, [])].albums.append(album)
            }
        }
        artists = byArtist.map { id, group in
            let sorted = group.albums.sorted { Self.namedBefore($0.title, $1.title, tie: $0.id < $1.id) }
            return ArtistGroup(id: id, name: group.name, albums: sorted)
        }.sorted { Self.namedBefore($0.name, $1.name, tie: $0.id < $1.id) }
        albums = folderAlbums.map(\.album).sorted {
            Self.namedBefore($0.title, $1.title, tie: Self.namedBefore($0.artist, $1.artist, tie: $0.id < $1.id))
        }
        trackKeys = tracks.map { track in
            let metadata = track.metadata
            return [metadata.title, metadata.artist, metadata.albumArtist, metadata.album]
                .compactMap { $0 }.map(MusicOrdering.key)
        }
        artistKeys = artists.map { $0.name.map(MusicOrdering.key) }
        albumKeys = albums.map { $0.title.map(MusicOrdering.key) }
    }

    public func search(_ query: Query) -> SearchResults {
        guard !query.isEmpty else { return .init(songs: [], artists: [], albums: []) }
        let needle = query.key
        // Fields are matched independently; never match across a title/artist/album boundary.
        return .init(songs: zip(catalogTracks, trackKeys).compactMap { track, keys in
            keys.contains { $0.contains(needle) } ? track : nil
        }, artists: zip(artists, artistKeys).compactMap { artist, key in
            key?.contains(needle) == true ? artist : nil
        }, albums: zip(albums, albumKeys).compactMap { album, key in
            key?.contains(needle) == true ? album : nil
        })
    }

    private static func location(_ source: String?, path: String) -> String {
        [source, path].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " / ")
    }

    private static func uniqueLabels<ID: Hashable & Comparable>(_ values: [(id: ID, label: String)]) -> [ID: String] {
        var result: [ID: String] = [:]
        for group in Dictionary(grouping: values, by: { key($0.label) }).values {
            for (offset, item) in group.sorted(by: { $0.id < $1.id }).enumerated() {
                result[item.id] = group.count == 1 ? item.label : "\(item.label) (\(offset + 1))"
            }
        }
        return result
    }

    private struct RecordingKey: Hashable {
        let source: UUID
        let folder: Data
        let stem: String
        let artist: String?
    }

    /// Only fold a labeled quality copy into a matching unmarked file. Exact paths are
    /// still stored, and file identity, recovery, imported lyrics and saved queues are untouched.
    private static func foldingQualityCopies(in tracks: [Track]) -> [Track] {
        let quality = #"(?i)(?:\s*[-_–—]\s*|\s+|\s*[\[(（【])(?:hi[ -]?res|高品(?:质)?|无损|lossless|(?:128|192|256|320)\s*k(?:bps)?)[\])）】]?$"#
        func key(_ track: Track, stem: String) -> RecordingKey {
            .init(source: track.rootID, folder: Data(track.path.components.dropLast().joined(separator: "/").utf8),
                  stem: MusicOrdering.key(stem), artist: track.automaticMetadata.artist.map(MusicOrdering.key))
        }
        var originals: [RecordingKey: [Double]] = [:]
        var copies: [UUID: RecordingKey] = [:]
        for track in tracks where track.duration.isFinite && track.duration > 0 {
            guard let file = track.path.components.last else { continue }
            let stem = (file as NSString).deletingPathExtension
            if let suffix = stem.range(of: quality, options: .regularExpression), suffix.lowerBound > stem.startIndex {
                let base = String(stem[..<suffix.lowerBound])
                copies[track.id] = key(track, stem: base)
            } else {
                originals[key(track, stem: stem), default: []].append(track.duration)
            }
        }
        return tracks.filter { track in
            guard track.metadata == track.automaticMetadata, let copy = copies[track.id] else { return true }
            return originals[copy]?.contains { abs($0 - track.duration) <= 0.2 } != true
        }
    }

    private static func albumID(_ track: Track) -> String {
        // Preserve exact source/path identity even when two directory names compare equal as Swift Strings.
        "\(track.rootID.uuidString):\(Data(track.path.albumDirectory.utf8).base64EncodedString())"
    }

    private static func key(_ value: String?) -> String { value.map { "name:\(MusicOrdering.key($0))" } ?? "unknown" }

    private static func namedBefore(_ lhs: String?, _ rhs: String?, tie: @autoclosure () -> Bool) -> Bool {
        guard let lhs, let rhs else { return lhs != nil || (rhs == nil && tie()) }
        switch lhs.localizedStandardCompare(rhs) {
        case .orderedAscending: return true
        case .orderedDescending: return false
        case .orderedSame: return tie()
        }
    }
}
