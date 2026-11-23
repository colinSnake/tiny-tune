import Domain
import Foundation

public struct AlbumGroup: Identifiable, Sendable {
    public let id: String
    public let title: String?
    public let artist: String?
    public let tracks: [Track]
    public var artwork: URL? { tracks.lazy.compactMap { $0.artworkKey.flatMap(ArtworkCache.url(for:)) }.first }
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
    private let tracks: [Track]
    private let trackKeys: [[String]]
    private let artistKeys: [String?]
    private let albumKeys: [String?]

    public init(tracks: [Track]) {
        self.tracks = tracks
        var grouped: [String: [String: [Track]]] = [:]
        for track in tracks {
            let artist = Self.key(track.metadata.albumArtist)
            let album = Self.key(track.metadata.album)
            grouped[artist, default: [:]][album, default: []].append(track)
        }
        artists = grouped.map { artistKey, albums in
            let display = albums.values.lazy.joined().min { ($0.dateAdded, $0.id.uuidString) < ($1.dateAdded, $1.id.uuidString) }?.metadata.albumArtist
            let groups = albums.map { albumKey, values in
                let name = values.min { ($0.dateAdded, $0.id.uuidString) < ($1.dateAdded, $1.id.uuidString) }?.metadata.album
                return AlbumGroup(id: "\(artistKey.utf8.count):\(artistKey)\(albumKey)", title: name,
                                  artist: display, tracks: values.sorted(by: MusicOrdering.byAlbumOrder))
            }.sorted { Self.namedBefore($0.title, $1.title, tie: $0.id < $1.id) }
            return ArtistGroup(id: artistKey, name: display, albums: groups)
        }.sorted { Self.namedBefore($0.name, $1.name, tie: $0.id < $1.id) }
        albums = artists.flatMap(\.albums).sorted {
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
        return .init(songs: zip(tracks, trackKeys).compactMap { track, keys in
            keys.contains { $0.contains(needle) } ? track : nil
        }, artists: zip(artists, artistKeys).compactMap { artist, key in
            key?.contains(needle) == true ? artist : nil
        }, albums: zip(albums, albumKeys).compactMap { album, key in
            key?.contains(needle) == true ? album : nil
        })
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
