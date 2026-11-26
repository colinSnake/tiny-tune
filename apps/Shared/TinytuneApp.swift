import DesignSystem
import Foundation
import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#endif

private enum AppBrand {
    static let displayName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "听页"
}

/// Tinytune's own interface is Simplified Chinese, independent of the system picker language.
enum AppLanguage {
    static let locale = Locale(identifier: "zh-Hans")
    static let bundle = Bundle.main.url(forResource: "zh-Hans", withExtension: "lproj")
        .flatMap(Bundle.init(url:)) ?? .main
}

@main
struct TinytuneApp: App {
    @State private var app = AppState()

    var body: some Scene {
        #if os(macOS)
        Window(AppBrand.displayName, id: "library") {
            Root(app: app)
                .frame(minWidth: 760, minHeight: 500)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                    app.player.checkpoint()
                }
        }
        .defaultSize(width: 1120, height: 720)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button(String(localized: "Add Folder…", bundle: AppLanguage.bundle, locale: AppLanguage.locale)) { app.choose() }
                    .keyboardShortcut("o", modifiers: .command)
                    .disabled(!app.canImport)
            }
        }
        Settings {
            TuneSettings().tint(TuneTheme.accent).environment(\.locale, AppLanguage.locale)
        }
        #else
        WindowGroup { Root(app: app) }
        #endif
    }
}

private struct Root: View {
    @Bindable var app: AppState
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        #if os(macOS)
        integration(MacShell(app: app))
        #else
        integration(PhoneShell(app: app))
            .fileImporter(isPresented: $app.choosingFolder, allowedContentTypes: [.folder], onCompletion: app.receiveSelection)
        #endif
    }

    private func integration<V: View>(_ view: V) -> some View {
        view
            .tint(TuneTheme.accent)
            .task { app.start() }
            .onChange(of: scenePhase) {
                if scenePhase == .active { app.verifySources() }
                else if scenePhase == .background { app.player.checkpoint() }
            }
            .sheet(isPresented: Binding(get: { app.flow != nil }, set: { if !$0 { app.cancelFlow() } }), onDismiss: app.cancelFlow) {
                ImportSheet(app: app)
                    .environment(\.locale, AppLanguage.locale)
                    .tint(TuneTheme.accent)
            }
            .alert(AppBrand.displayName, isPresented: Binding(get: { app.notice != nil }, set: { if !$0 { app.notice = nil } })) {
                Button(String(localized: "OK", bundle: AppLanguage.bundle, locale: AppLanguage.locale), role: .cancel) { app.notice = nil }
            } message: {
                if let notice = app.notice { Text(notice) }
            }
            .environment(\.locale, AppLanguage.locale)
    }
}

#if os(iOS)
private struct PhoneShell: View {
    let app: AppState
    @State private var facet: Facet = .artists
    @State private var selectedTab: Tab = .library
    @State private var libraryPath: [Page] = []
    @State private var searchPath: [Page] = []
    @State private var query = ""
    @State private var showsPlayer = false
    @State private var showsQueue = false
    @Environment(\.dynamicTypeSize) private var textSize

    private enum Tab { case library, search, sources }

    private var libraryBackgroundStyle: PhoneLibraryBackground.Style {
        !app.starting && !app.storeFailure && app.snapshot.tracks.isEmpty ? .emptyLibrary : .browsing
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack(path: $libraryPath) {
                VStack(spacing: 0) {
                    PhoneRootSummary(subtitle: Text("\(Text("\(app.index.catalogTracks.count) songs")) · \(Text("\(app.index.albums.count) albums"))"))
                    if !app.snapshot.tracks.isEmpty { facetSelector.padding(.top, textSize.isAccessibilitySize ? 0 : 24) }
                    Catalog(app: app, facet: facet, isVisibleRoot: selectedTab == .library && libraryPath.isEmpty,
                            showSources: showSources)
                }
                .phoneLibraryBackground(libraryBackgroundStyle)
                .navigationTitle(String(localized: "Music Library", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(.hidden, for: .navigationBar)
                .toolbar {
                    PhoneRootToolbar(canImport: app.canImport, add: { app.choose() })
                }
                .navigationDestination(for: Page.self, destination: destination)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { mini }
            .tint(TuneTheme.accent)
            .tabItem { Label("Music Library", systemImage: "music.note.list") }.tag(Tab.library)

            NavigationStack(path: $searchPath) {
                SearchCatalog(app: app, query: query, showSources: showSources)
                    .navigationTitle(String(localized: "Search", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                    .navigationBarTitleDisplayMode(.inline)
                    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Title, artist or album")
                    .phoneLibraryBackground(.browsing)
                    .toolbarBackground(.hidden, for: .navigationBar)
                    .navigationDestination(for: Page.self, destination: destination)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { mini }
            .tint(TuneTheme.accent)
            .tabItem { Label("Search", systemImage: "magnifyingglass") }.tag(Tab.search)

            NavigationStack {
                VStack(spacing: 0) {
                    if !app.snapshot.sources.isEmpty {
                        PhoneRootSummary(subtitle: Text("\(app.snapshot.sources.count) music folders"))
                    }
                    SourcesView(app: app)
                }
                .phoneLibraryBackground(.browsing)
                .navigationTitle(String(localized: "Music Sources", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(.hidden, for: .navigationBar)
                .toolbar {
                    PhoneRootToolbar(canImport: app.canImport, add: { app.choose() })
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { mini }
            .tint(TuneTheme.accent)
            .tabItem { Label("Music Sources", systemImage: "folder") }.tag(Tab.sources)
        }
        .tint(TuneTheme.phoneTabSelection)
        .fullScreenCover(isPresented: $showsPlayer) {
            NavigationStack {
                NowPlayingView(app: app, showQueue: { showsQueue = true }, showSources: {
                    showsPlayer = false
                    showSources()
                })
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Close", systemImage: "chevron.down") { showsPlayer = false }.labelStyle(.iconOnly)
                    }
                }
                .sheet(isPresented: $showsQueue) {
                    NavigationStack {
                        QueueView(player: app.player)
                            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { showsQueue = false } } }
                    }
                    .tint(TuneTheme.accent)
                    .environment(\.locale, AppLanguage.locale)
                }
            }
            .tint(TuneTheme.accent)
            .environment(\.locale, AppLanguage.locale)
        }
    }

    private var facetSelector: some View {
        Group {
            if textSize.isAccessibilitySize {
                facetMenu
            } else {
                ViewThatFits(in: .horizontal) {
                    facetTabs.fixedSize(horizontal: true, vertical: false)
                    facetMenu
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
    }

    private var facetTabs: some View {
        HStack(spacing: 18) {
            ForEach(Facet.allCases) { item in
                let isSelected = item == facet
                Button {
                    facet = item
                } label: {
                    VStack(spacing: 5) {
                        Text(item.label)
                            .font(.body.weight(isSelected ? .semibold : .medium))
                            .foregroundStyle(isSelected ? TuneTheme.accent : TuneTheme.secondary)
                            .lineLimit(1)
                        Capsule()
                            .fill(isSelected ? TuneTheme.accent : .clear)
                            .frame(width: 18, height: 2.5)
                            .accessibilityHidden(true)
                    }
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Browse by")
    }

    private var facetMenu: some View {
        Picker("Browse by", selection: $facet) {
            ForEach(Facet.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.menu)
        .frame(minHeight: 44)
    }

    private var mini: some View {
        MiniPlayer(app: app, open: { showsPlayer = true }, showQueue: { showsPlayer = true; showsQueue = true })
    }

    private func destination(_ page: Page) -> some View {
        DestinationContent(app: app, page: page, queue: { showsQueue = true }, sources: showSources)
            .toolbar(.visible, for: .navigationBar)
    }

    private func showSources() { selectedTab = .sources }
}

/// Counts stay in the content area; all three tab titles use the native inline bar.
private struct PhoneRootSummary: View {
    let subtitle: Text

    var body: some View {
        subtitle
            .font(.subheadline)
            .foregroundStyle(TuneTheme.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 24)
            .padding(.top, 6)
            .padding(.bottom, 12)
    }
}

private struct PhoneRootToolbar: ToolbarContent {
    let canImport: Bool
    let add: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            action("plus", label: "Add Folder", perform: add)
                .disabled(!canImport)
        }
        .phonePlainToolbarBackground()
    }

    private func action(_ symbol: String, label: LocalizedStringKey, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .regular))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color(uiColor: .label))
        .accessibilityLabel(label)
    }
}

private extension ToolbarContent {
    @ToolbarContentBuilder
    func phonePlainToolbarBackground() -> some ToolbarContent {
        if #available(iOS 26.0, *) {
            sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
    }
}

private extension View {
    func phoneLibraryBackground(_ style: PhoneLibraryBackground.Style) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { PhoneLibraryBackground(style: style) }
            // The canvas extends under native bars; the fold stops at the content edge.
            .background { TuneTheme.canvas.ignoresSafeArea(.container) }
            .toolbarBackground(.hidden, for: .tabBar)
    }
}

#else
private struct MacShell: View {
    let app: AppState
    @State private var selection: MacLibrarySidebar.Item = .artists
    @State private var path: [Page] = []
    @State private var query = ""
    @State private var showsLyrics = false

    private var activeQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isSearching: Bool { !activeQuery.isEmpty }

    var body: some View {
        let title = rootTitle
        NavigationSplitView {
            MacLibrarySidebar(app: app, selection: $selection)
        } detail: {
            NavigationStack(path: $path) {
                macChrome {
                    ZStack {
                        // Keep the browser mounted so clearing search preserves its scroll and sort state.
                        browser
                            .opacity(isSearching ? 0 : 1)
                            .disabled(isSearching)
                            .allowsHitTesting(!isSearching)
                            .accessibilityHidden(isSearching)
                        if isSearching {
                            SearchCatalog(app: app, query: activeQuery, showSources: showSources)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .navigationTitle(title)
                }
                .navigationDestination(for: Page.self) { page in
                    macChrome(nowPlaying: page == .player) {
                        DestinationContent(app: app, page: page, sources: showSources)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(TuneTheme.canvas)
        }
        .onChange(of: selection) { path = []; query = "" }
        .onChange(of: activeQuery) { if !path.isEmpty { path = [] } }
    }

    @ViewBuilder private var browser: some View {
        if selection == .sources {
            SourcesView(app: app)
        } else {
            Catalog(app: app, facet: facet, isVisibleRoot: !isSearching && path.isEmpty, showSources: showSources)
        }
    }

    private var rootTitle: String {
        if isSearching {
            return String(localized: "Search Results", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        }
        if selection == .sources {
            return String(localized: "Music Sources", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
        }
        return String(localized: "Music Library", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
    }

    private func macChrome<V: View>(nowPlaying: Bool = false, @ViewBuilder content: () -> V) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                content().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background {
                        if !nowPlaying {
                            MacLibraryBackground(hasTracks: !app.snapshot.tracks.isEmpty)
                        }
                    }
                if showsLyrics && !nowPlaying {
                    Divider()
                    LyricsPanel(app: app).frame(minWidth: 220, idealWidth: 280, maxWidth: 300)
                }
            }
            if !nowPlaying {
                MiniPlayer(app: app, open: { path.append(.player) },
                           showsLyrics: showsLyrics, toggleLyrics: { showsLyrics.toggle() })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TuneTheme.canvas)
        .searchable(text: $query, placement: .toolbar, prompt: "Title, artist or album")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button(action: showSources) {
                    Label {
                        Text("Music Sources")
                    } icon: {
                        Image("MacSources")
                            .foregroundStyle(app.storeFailure || !app.unavailable.isEmpty ? TuneTheme.problem : TuneTheme.accent)
                            .background {
                                if isShowingSources {
                                    RoundedRectangle(cornerRadius: 5).fill(TuneTheme.subtle)
                                }
                            }
                    }
                    .labelStyle(.iconOnly)
                }
                .help(Text("\(Text("Music Sources")) · \(sourceStatus)"))
                .accessibilityAddTraits(isShowingSources ? .isSelected : [])

                Button {
                    app.choose()
                } label: {
                    Label {
                        Text("Add Folder")
                    } icon: {
                        Image("MacAddFolder").foregroundStyle(TuneTheme.accent)
                    }
                    .labelStyle(.iconOnly)
                }
                .disabled(!app.canImport)
                .help("Add Folder")
            }
        }
    }

    private var isShowingSources: Bool { selection == .sources && !isSearching && path.isEmpty }

    private var sourceStatus: Text {
        if app.starting { return Text("Loading…") }
        if app.storeFailure { return Text("Library unavailable") }
        if !app.unavailable.isEmpty { return Text("\(app.unavailable.count) unavailable folders") }
        let count = app.snapshot.sources.count
        return count == 0 ? Text("No folders added") : Text("\(count) music folders")
    }

    private var facet: Facet {
        switch selection { case .albums: .albums; case .songs: .songs; default: .artists }
    }

    private func showSources() {
        query = ""
        path = []
        selection = .sources
    }
}

private struct MacLibrarySidebar: View {
    enum Item { case artists, albums, songs, sources }

    let app: AppState
    @Binding var selection: Item
    @FocusState private var focusedItem: Item?
    @State private var hoveredItem: Item?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                libraryHeader
                    .padding(.horizontal, 6)
                    .padding(.bottom, 13)
                row(.artists, title: "Artists", symbol: "person.2")
                row(.albums, title: "Albums", symbol: "square.stack")
                row(.songs, title: "Songs", symbol: "music.note.list")
            }
            .padding(.horizontal, 12)
            .padding(.top, 16)
            .padding(.bottom, 8)
        }
        .background(.regularMaterial)
        .navigationSplitViewColumnWidth(min: 178, ideal: 218, max: 270)
        .navigationTitle(AppBrand.displayName)
    }

    private var libraryHeader: some View {
        HStack(spacing: 10) {
            Image(decorative: "BrandMark")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: 36, height: 36)
                .background(TuneTheme.subtle, in: .rect(cornerRadius: 9))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("Local Library").font(.callout.weight(.semibold))
                libraryStatus.font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var libraryStatus: Text {
        if app.starting { return Text("Loading…") }
        if app.storeFailure { return Text("Library unavailable") }
        let count = app.snapshot.tracks.count
        return count == 0 ? Text("No songs imported") : Text("\(count) tracks in library")
    }

    private func row(_ item: Item, title: LocalizedStringKey, symbol: String) -> some View {
        let selected = selection == item
        let focusedOnly = focusedItem == item && !selected
        return Button {
            selection = item
            focusedItem = item
        } label: {
            HStack(spacing: 9) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 18)
                    .foregroundStyle(selected ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
                    .accessibilityHidden(true)
                Text(title)
                    .font(.callout.weight(selected ? .semibold : .regular))
                    .underline(focusedOnly)
            }
            .foregroundStyle(selected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .frame(minHeight: 34)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                let shape = RoundedRectangle(cornerRadius: 8)
                if selected { shape.fill(TuneTheme.sidebarSelection) }
                else if hoveredItem == item || focusedOnly { shape.fill(.primary.opacity(0.065)) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if hovering { hoveredItem = item }
            else if hoveredItem == item { hoveredItem = nil }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focusedItem, equals: item)
        .onMoveCommand { direction in moveSelection(from: item, direction: direction) }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func moveSelection(from item: Item, direction: MoveCommandDirection) {
        guard direction == .up || direction == .down else { return }
        let items: [Item] = [.artists, .albums, .songs]
        guard let index = items.firstIndex(of: item) else { return }
        let destination = index + (direction == .up ? -1 : 1)
        guard items.indices.contains(destination) else { return }
        selection = items[destination]
        focusedItem = items[destination]
    }
}
#endif

private struct DestinationContent: View {
    let app: AppState
    let page: Page
    #if os(iOS)
    let queue: () -> Void
    #endif
    let sources: () -> Void

    var body: some View {
        switch page {
        case .artist(let id):
            browsingDetail {
                if let artist = app.index.artists.first(where: { $0.id == id }) { ArtistDetail(app: app, artist: artist, showSources: sources) }
                else { itemUnavailable }
            }
        case .album(let id):
            browsingDetail {
                if let album = app.index.albums.first(where: { $0.id == id }) { AlbumDetail(app: app, album: album, showSources: sources) }
                else { itemUnavailable }
            }
        case .player:
            #if os(iOS)
            NowPlayingView(app: app, showQueue: queue, showSources: sources)
                .background(TuneTheme.canvas)
            #else
            NowPlayingView(app: app, showSources: sources)
            #endif
        }
    }

    private func browsingDetail<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        #if os(iOS)
        content().phoneLibraryBackground(.browsing)
        #else
        content()
        #endif
    }

    private var itemUnavailable: some View { ContentUnavailableView("Not in the library", systemImage: "music.note") }
}
