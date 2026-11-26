import DesignSystem
import Domain
import Library
import Playback
import SwiftUI

enum Facet: String, CaseIterable, Identifiable {
    case artists, albums, songs
    var id: Self { self }
    var label: LocalizedStringKey {
        switch self { case .artists: "Artists"; case .albums: "Albums"; case .songs: "Songs" }
    }
    var symbol: String {
        switch self { case .artists: "person.2"; case .albums: "square.stack"; case .songs: "music.note.list" }
    }
}

enum Page: Hashable { case artist(String), album(String), player }

struct Catalog: View {
    let app: AppState
    let facet: Facet
    let isVisibleRoot: Bool
    let showSources: () -> Void
    @State private var order: SongSort = .title
    #if os(iOS)
    @State private var showsSortOptions = false
    @ScaledMetric(relativeTo: .caption) private var sortIconSize: CGFloat = 11
    #endif

    private enum SongSort: CaseIterable {
        case title, artist, recent

        var label: LocalizedStringKey {
            switch self {
            case .title: "Song title"
            case .artist: "Artist"
            case .recent: "Recently added"
            }
        }
    }

    var body: some View {
        if app.starting {
            ProgressView("Opening music library…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if app.storeFailure {
            ContentUnavailableView {
                Label("Could not open the library", systemImage: "externaldrive.badge.exclamationmark")
            } description: {
                Text("Existing data has been preserved.")
            } actions: {
                Button("Try Again") { app.start() }
            }
        } else if app.snapshot.tracks.isEmpty {
            EmptyLibrary(app: app, showSources: showSources)
        } else {
            CatalogScroll {
                if !app.unavailable.isEmpty { SourceBanner(showSources: showSources) }
                HStack(alignment: .firstTextBaseline) {
                    #if os(iOS)
                    countLabel
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(TuneTheme.secondary)
                        .accessibilityAddTraits(.isHeader)
                    #else
                    Text(facet.label).font(.title2.weight(.semibold)).foregroundStyle(TuneTheme.primary)
                    Text(count, format: .number).font(.subheadline.monospacedDigit()).foregroundStyle(TuneTheme.secondary)
                        .accessibilityHidden(true)
                    #endif
                    Spacer()
                    if facet == .songs { sortMenu }
                }
                switch facet {
                case .artists: ArtistList(artists: app.index.artists)
                case .albums: AlbumGrid(albums: app.index.albums)
                case .songs:
                    let list = songs
                    SongRows(app: app, tracks: list, playCollection: list, showSources: showSources)
                }
            }
            .onChange(of: showsSongs, initial: true) { _, visible in
                if visible { app.continueInSongs(songs) }
            }
            #if os(iOS)
            // Facets have different row lengths and counts. A new scroll container starts
            // at the top without reusing another facet’s offset or resetting song sort.
            .id(facet)
            #endif
        }
    }

    private var showsSongs: Bool { isVisibleRoot && facet == .songs }

    private var count: Int {
        switch facet { case .artists: app.index.artists.count; case .albums: app.index.albums.count; case .songs: app.index.catalogTracks.count }
    }

    #if os(iOS)
    private var countLabel: Text {
        switch facet {
        case .artists: Text("\(count) artists")
        case .albums: Text("\(count) albums")
        case .songs: Text("\(count) songs")
        }
    }
    #endif

    private var songs: [Track] {
        switch order {
        case .title: app.index.catalogTracks
        case .recent: app.index.catalogTracks.sorted { $0.dateAdded == $1.dateAdded ? MusicOrdering.byTitle($0, $1) : $0.dateAdded > $1.dateAdded }
        case .artist: app.index.catalogTracks.sorted {
            let a = $0.metadata.artist ?? "", b = $1.metadata.artist ?? ""
            let compare = a.localizedStandardCompare(b)
            return compare == .orderedSame ? MusicOrdering.byTitle($0, $1) : compare == .orderedAscending
        }
        }
    }

    private var sortMenu: some View {
        #if os(iOS)
        Button { showsSortOptions = true } label: {
            Label {
                Text("Sort By").font(.caption.weight(.medium))
            } icon: {
                Image(systemName: "arrow.up.arrow.down").font(.system(size: sortIconSize, weight: .medium))
            }
            .foregroundStyle(TuneTheme.accent)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sort By")
        .popover(isPresented: $showsSortOptions, attachmentAnchor: .rect(.bounds)) {
            PhoneActionPopover {
                ForEach(SongSort.allCases, id: \.self) { option in
                    GridRow {
                        PhonePopoverAction(option.label, isSelected: order == option) {
                            showsSortOptions = false
                            order = option
                        }
                    }
                }
            }
        }
        #else
        Menu {
            Picker("Sort By", selection: $order) {
                ForEach(SongSort.allCases, id: \.self) { option in
                    Text(option.label).tag(option)
                }
            }
        } label: { Label("Sort By", systemImage: "arrow.up.arrow.down") }
        .accessibilityLabel("Sort By")
        #endif
    }
}

struct EmptyLibrary: View {
    let app: AppState
    let showSources: () -> Void

    private var hasSources: Bool { !app.snapshot.sources.isEmpty }
    #if os(macOS)
    @ScaledMetric(relativeTo: .title2) private var titleSize: CGFloat = 22
    #endif

    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                content.frame(minHeight: viewport.size.height)
            }
        }
    }

    private var content: some View {
        VStack(spacing: 18) {
            #if os(macOS)
            ArtworkTile(size: 146)
                .clipShape(.rect(cornerRadius: 18))
                .shadow(color: TuneTheme.primary.opacity(0.10), radius: 14, y: 7)
                .padding(.bottom, 7)
            #else
            LibraryIllustration()
                .frame(maxWidth: 208)
                .accessibilityHidden(true)
            #endif
            VStack(spacing: 8) {
                Text("Give your favorite music a page of its own")
                    #if os(macOS)
                    .font(.system(size: titleSize, weight: .semibold))
                    #else
                    .font(.title.weight(.semibold))
                    #endif
                    .foregroundStyle(TuneTheme.primary)
                    .accessibilityAddTraits(.isHeader)
            }
            .fixedSize(horizontal: false, vertical: true)
            if hasSources {
                Button(action: showSources) { Label("View Music Sources", systemImage: "folder") }
            } else {
                Button { app.choose() } label: { Label("Add Folder", systemImage: "plus") }
                    .disabled(!app.canImport)
            }
        }
        #if os(macOS)
        .buttonStyle(MacEmptyLibraryButton())
        .padding(.bottom, 54)
        #else
        .buttonStyle(TunePrimaryButton())
        #endif
        .frame(maxWidth: 400)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 24)
        .padding(.vertical, 36)
        .frame(maxWidth: .infinity)
    }
}

#if os(macOS)
private struct MacEmptyLibraryButton: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(minHeight: 34)
            .foregroundStyle(.white)
            .background {
                let shape = RoundedRectangle(cornerRadius: 8)
                if contrast == .increased || !enabled {
                    shape.fill(Color(red: 0.33, green: 0.20, blue: 0.60))
                } else {
                    shape.fill(TuneTheme.sidebarSelection)
                }
            }
            .opacity(!enabled ? 0.57 : configuration.isPressed ? 0.83 : 1)
    }
}
#endif

struct CatalogScroll<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            stack
                .frame(maxWidth: 1056)
                .padding(.horizontal, catalogMargin)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity)
        }
    }

    private var stack: some View {
        #if os(iOS)
        VStack(alignment: .leading, spacing: 16) { content }
        #else
        LazyVStack(alignment: .leading, spacing: 16) { content }
        #endif
    }
}

private var catalogMargin: CGFloat {
    #if os(macOS)
    24
    #else
    16
    #endif
}

struct SourceBanner: View {
    let showSources: () -> Void

    var body: some View {
        Button(action: showSources) {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.circle").foregroundStyle(TuneTheme.problem)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Some sources are unavailable").font(.subheadline.weight(.semibold)).foregroundStyle(TuneTheme.primary)
                    Text("View Music Sources").font(.caption).foregroundStyle(TuneTheme.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(TuneTheme.secondary)
                    .accessibilityHidden(true)
            }
            .padding(14)
            .contentShape(Rectangle())
            .tuneCard()
        }.buttonStyle(.plain)
    }
}

struct ArtistList: View {
    let artists: [ArtistGroup]

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(artists) { artist in
                NavigationLink(value: Page.artist(artist.id)) {
                    HStack(spacing: 12) {
                        ArtworkTile(artwork: artist.artwork, size: 44)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(artist.name ?? String(localized: "Unknown artist", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                                .font(.body.weight(.medium)).foregroundStyle(TuneTheme.primary)
                            Text(groupCount(artist.albums.count, artist.tracks.count))
                                .font(.subheadline).foregroundStyle(TuneTheme.secondary)
                        }
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                            .foregroundStyle(TuneTheme.secondary).accessibilityHidden(true)
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 55)
                    .contentShape(Rectangle())
                    .accessibilityElement(children: .combine)
                }.buttonStyle(.plain)
                if artist.id != artists.last?.id { Divider().padding(.leading, 70).padding(.trailing, 14) }
            }
        }
        .padding(.vertical, 4)
        .tuneCard()
    }
}

struct AlbumGrid: View {
    let albums: [AlbumGroup]
    @Environment(\.dynamicTypeSize) private var textSize

    private var columns: [GridItem] {
        if textSize.isAccessibilitySize { return [.init(.flexible())] }
        return [.init(.adaptive(minimum: 137, maximum: 225), spacing: 16, alignment: .topLeading)]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
            ForEach(albums) { album in
                NavigationLink(value: Page.album(album.id)) {
                    VStack(alignment: .leading, spacing: 6) {
                        ArtworkTile(artwork: album.artwork)
                        Text(album.title ?? String(localized: "Unknown album", bundle: AppLanguage.bundle, locale: AppLanguage.locale)).font(.body.weight(.medium)).foregroundStyle(TuneTheme.primary)
                        if album.showsArtistSubtitle {
                            Text(album.artist ?? String(localized: "Unknown artist", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                                .font(.subheadline).foregroundStyle(TuneTheme.secondary)
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .tuneCard()
                    .accessibilityElement(children: .combine)
                }.buttonStyle(.plain)
            }
        }
    }
}

struct SongRows: View {
    @State private var pendingRemoval: UUID?
    @State private var editingTrack: Track?
    let app: AppState
    let tracks: [Track]
    let playCollection: [Track]
    let showSources: () -> Void
    var albumArtwork: URL? = nil
    var allowsSongsHandoff = false
    #if os(macOS)
    @FocusState private var focused: UUID?
    @State private var selected: UUID?
    #endif

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(tracks) { track in
                row(track)
                if track.id != tracks.last?.id { Divider().padding(.leading, 64).padding(.trailing, 12) }
            }
        }
        .padding(4)
        .tuneCard()
        .sheet(item: $editingTrack) { TrackDisplayEditor(app: app, track: $0) }
    }

    private func row(_ track: Track) -> some View {
        let play = { app.play(track, in: playCollection, allowsSongsHandoff: allowsSongsHandoff) }
        let state = state(for: track)
        let content = TrackRowContent(title: track.metadata.title, artist: track.displayArtist, duration: timeLabel(track.duration),
                                      state: state?.title, artwork: track.artwork ?? albumArtwork, stateIcon: state?.icon)
        return rowInteraction(content, track: track, play: play)
            .contextMenu {
                Button("Play", systemImage: "play", action: play)
                Button("Edit Display Names", systemImage: "pencil") { editingTrack = track }
                    .disabled(!app.canImport)
                if app.unavailable.contains(track.rootID) { Button("View Music Sources", systemImage: "folder", action: showSources) }
                Divider()
                Button("Remove from Library", systemImage: "trash", role: .destructive) { pendingRemoval = track.id }
                    .disabled(!app.canImport)
            }
            .removalPopover(isPresented: Binding(get: { pendingRemoval == track.id }, set: { if !$0, pendingRemoval == track.id { pendingRemoval = nil } })) {
                RemovalConfirmation(title: "Remove Song?", name: track.metadata.title) {
                    pendingRemoval = nil
                } confirm: {
                    pendingRemoval = nil
                    app.remove(track)
                }
            }
    }

    @ViewBuilder private func rowInteraction(_ content: TrackRowContent, track: Track, play: @escaping () -> Void) -> some View {
        let insetContent = content.padding(.horizontal, 8).contentShape(Rectangle())
        #if os(macOS)
        let isSelected = selected == track.id
        let isFocused = focused == track.id
        insetContent
            .background {
                let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
                if isSelected {
                    shape.fill(isFocused ? TuneTheme.accent.opacity(0.18) : TuneTheme.subtle)
                } else if isFocused {
                    shape.fill(TuneTheme.primary.opacity(0.1))
                }
            }
            .onTapGesture(count: 2) { select(track.id); play() }
            .onTapGesture { select(track.id) }
            .focusable()
            .focusEffectDisabled()
            .focused($focused, equals: track.id)
            .onKeyPress(.return) { select(track.id); play(); return .handled }
            .onKeyPress(.space) { if app.player.hasContext { app.player.toggle(); return .handled }; return .ignored }
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { play() }
        #else
        Button(action: play) { insetContent }.buttonStyle(.plain)
        #endif
    }

    #if os(macOS)
    private func select(_ id: UUID) {
        selected = id
        focused = id
    }
    #endif

    private func state(for track: Track) -> (title: String, icon: TrackRowStatusIcon)? {
        if app.unavailable.contains(track.rootID) {
            return (String(localized: "Source unavailable", bundle: AppLanguage.bundle, locale: AppLanguage.locale), .system("exclamationmark.circle"))
        }
        guard app.player.current?.id == track.id else { return nil }
        switch app.player.phase {
        case .playing: return (String(localized: "Playing", bundle: AppLanguage.bundle, locale: AppLanguage.locale), .playing)
        case .loading: return (String(localized: "Loading…", bundle: AppLanguage.bundle, locale: AppLanguage.locale), .system("hourglass"))
        case .paused: return (String(localized: "Paused", bundle: AppLanguage.bundle, locale: AppLanguage.locale), .paused)
        case .failed: return (String(localized: "Could not play", bundle: AppLanguage.bundle, locale: AppLanguage.locale), .system("exclamationmark.circle"))
        default: return nil
        }
    }
}

private struct TrackDisplayEditor: View {
    let app: AppState
    let track: Track
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var artist: String
    @State private var saving = false
    @State private var failed = false

    init(app: AppState, track: Track) {
        self.app = app
        self.track = track
        _title = State(initialValue: track.metadata.title)
        _artist = State(initialValue: track.metadata.artist ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            #if os(iOS)
            ScrollView { fields.frame(maxWidth: .infinity, alignment: .leading) }
            #else
            fields
            #endif
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button("Save", action: save)
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || !app.canImport)
            }
        }
        .padding(20)
        .frame(maxWidth: 520)
        .foregroundStyle(TuneTheme.primary)
        .background(TuneTheme.raised)
        .tint(TuneTheme.accent)
        .interactiveDismissDisabled(saving)
        #if os(macOS)
        .frame(width: 440)
        #endif
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edit Display Names").font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Text(verbatim: track.path.rawValue).font(.caption).foregroundStyle(TuneTheme.secondary)
            VStack(alignment: .leading, spacing: 8) {
                Text("Song title").accessibilityHidden(true)
                TextField("Song title", text: $title).textFieldStyle(.roundedBorder)
                Text("Artist").accessibilityHidden(true)
                TextField("Artist", text: $artist).textFieldStyle(.roundedBorder)
                Text("Edits only affect the music library. Leave a field blank to use its automatic name.")
                    .font(.footnote).foregroundStyle(TuneTheme.secondary)
                Button("Restore Automatic Names") {
                    title = track.automaticMetadata.title
                    artist = track.automaticMetadata.artist ?? ""
                }
            }
            .disabled(saving)
            if failed {
                Label("Could not save the display names. No changes were applied.", systemImage: "exclamationmark.circle")
                    .foregroundStyle(TuneTheme.problem)
            }
        }
    }

    private func save() {
        saving = true
        failed = false
        Task {
            let saved = await app.saveDisplayNames(track, title: title, artist: artist)
            saving = false
            if saved { dismiss() } else { failed = true }
        }
    }
}

struct ArtistDetail: View {
    let app: AppState
    let artist: ArtistGroup
    let showSources: () -> Void
    var body: some View {
        let songs = artist.tracks
        CatalogScroll {
            GroupHeader(artwork: artist.artwork, title: artist.name ?? String(localized: "Unknown artist", bundle: AppLanguage.bundle, locale: AppLanguage.locale),
                        detail: groupCount(artist.albums.count, songs.count), app: app, tracks: songs, allowsSongsHandoff: true)
            ForEach(artist.albums) { album in
                SongRows(app: app, tracks: album.tracks, playCollection: songs,
                         showSources: showSources, albumArtwork: album.artwork, allowsSongsHandoff: true)
            }
        }
        .navigationTitle(artist.name ?? String(localized: "Unknown artist", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct AlbumDetail: View {
    let app: AppState
    let album: AlbumGroup
    let showSources: () -> Void
    var body: some View {
        let discs = Dictionary(grouping: album.tracks) { $0.metadata.disc ?? 1 }
        let artwork = album.artwork
        let artist = album.artist ?? String(localized: "Unknown artist", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        CatalogScroll {
            GroupHeader(artwork: artwork, title: album.title ?? String(localized: "Unknown album", bundle: AppLanguage.bundle, locale: AppLanguage.locale),
                        detail: album.showsArtistSubtitle ? artist : nil, app: app, tracks: album.tracks,
                        countSummary: groupCount(1, album.tracks.count), usesCompactPlayButton: true, allowsSongsHandoff: true)
            ForEach(discs.keys.sorted(), id: \.self) { disc in
                if discs.count > 1 { Text("Disc \(disc)").font(.headline).accessibilityAddTraits(.isHeader) }
                SongRows(app: app, tracks: discs[disc] ?? [], playCollection: album.tracks,
                         showSources: showSources, albumArtwork: artwork, allowsSongsHandoff: true)
            }
        }
        .navigationTitle(album.title ?? String(localized: "Unknown album", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct GroupHeader: View {
    let artwork: URL?
    let title: String
    let detail: String?
    let app: AppState
    let tracks: [Track]
    var countSummary: String? = nil
    var usesCompactPlayButton = false
    var allowsSongsHandoff = false
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        ViewThatFits(in: .horizontal) {
            if !textSize.isAccessibilitySize {
                HStack(alignment: .center, spacing: 20) { tile; text }
            }
            VStack(alignment: .leading, spacing: 16) { tile; text }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .tuneCard()
    }

    private var tile: some View {
        #if os(macOS)
        ArtworkTile(artwork: artwork, size: 150)
        #else
        ArtworkTile(artwork: artwork, size: 110)
        #endif
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title2.weight(.semibold)).foregroundStyle(TuneTheme.primary).accessibilityAddTraits(.isHeader)
            Group {
                if let detail { Text(detail) }
                if let countSummary { Text(countSummary) }
            }
            .font(.subheadline)
            .foregroundStyle(TuneTheme.secondary)
            PlayCollectionButton(app: app, tracks: tracks, usesCompactSize: usesCompactPlayButton, allowsSongsHandoff: allowsSongsHandoff)
        }
    }
}

private struct PlayCollectionButton: View {
    let app: AppState
    let tracks: [Track]
    var usesCompactSize = false
    var allowsSongsHandoff = false

    var body: some View {
        Button { app.playAll(tracks, allowsSongsHandoff: allowsSongsHandoff) } label: { Label("Play All", systemImage: "play.fill") }
            #if os(iOS)
            .buttonStyle(CompactPlayCollectionButtonStyle())
            #else
            .buttonStyle(.borderedProminent)
            .controlSize(usesCompactSize ? .regular : .large)
            #endif
            .disabled(!tracks.contains { !app.unavailable.contains($0.rootID) })
    }
}

#if os(iOS)
private struct CompactPlayCollectionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.semibold))
            .imageScale(.small)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(TuneTheme.onAccent)
            .background(TuneTheme.accent.opacity(configuration.isPressed ? 0.8 : 1), in: .rect(cornerRadius: 8))
            .opacity(isEnabled ? 1 : 0.45)
            // Only the visible button shrinks; its touch target remains at least 44 pt.
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }
}
#endif

struct SearchCatalog: View {
    let app: AppState
    let query: String
    let showSources: () -> Void
    @State private var resolved: ResolvedSearch?

    private struct SearchRequest: Equatable {
        let text: String
        let revision: UUID
    }

    private struct ResolvedSearch {
        let query: LibraryIndex.Query
        let revision: UUID
        let results: LibraryIndex.SearchResults
    }

    var body: some View {
        let index = app.index
        let request = SearchRequest(text: query, revision: index.revision)
        Group {
            if app.snapshot.tracks.isEmpty {
                ContentUnavailableView {
                    Label("Search your music", systemImage: "magnifyingglass")
                } description: {
                    Text(app.snapshot.sources.isEmpty ? "Add a music folder before searching." : "No songs in your library")
                } actions: {
                    if app.snapshot.sources.isEmpty { Button("Add Folder") { app.choose() }.disabled(!app.canImport) }
                    else { Button("View Music Sources", action: showSources) }
                }
            } else if let resolved, resolved.revision == request.revision {
                let songs = resolved.results.songs
                let artists = resolved.results.artists
                let albums = resolved.results.albums
                if resolved.results.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    CatalogScroll {
                        if !songs.isEmpty {
                            section("Songs", count: songs.count)
                            SongRows(app: app, tracks: songs, playCollection: songs, showSources: showSources)
                        }
                        if !artists.isEmpty {
                            section("Artists", count: artists.count)
                            ArtistList(artists: artists)
                        }
                        if !albums.isEmpty {
                            section("Albums", count: albums.count)
                            AlbumGrid(albums: albums)
                        }
                    }
                }
            } else {
                ContentUnavailableView("Search your music", systemImage: "magnifyingglass", description: Text("Search by title, artist or album."))
            }
        }
        .task(id: request) {
            guard !Task.isCancelled else { return }
            let query = LibraryIndex.Query(request.text)
            guard !query.isEmpty else { resolved = nil; return }
            if resolved?.query == query && resolved?.revision == request.revision { return }
            // Refresh an already entered query immediately when the library changes.
            if resolved?.query != query {
                do { try await Task.sleep(for: .milliseconds(150)) }
                catch { return }
            }
            guard !Task.isCancelled else { return }
            let results = await Task.detached(priority: .userInitiated) { index.search(query) }.value
            guard !Task.isCancelled, app.index.revision == request.revision else { return }
            resolved = .init(query: query, revision: request.revision, results: results)
        }
    }

    private func section(_ name: LocalizedStringKey, count: Int) -> some View {
        HStack {
            Text(name).font(.headline).foregroundStyle(TuneTheme.primary)
            Text(count, format: .number).font(.caption.monospacedDigit()).foregroundStyle(TuneTheme.secondary)
        }.accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }
}
