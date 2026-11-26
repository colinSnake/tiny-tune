import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class CatalogAlbumCardTests(unittest.TestCase):
    def test_album_cards_hide_paths_and_conditionally_show_artist(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        cards = source.split('struct AlbumGrid:', 1)[1].split('struct SongRows:', 1)[0]
        self.assertNotIn('album.location', cards)
        self.assertIn('if album.showsArtistSubtitle', cards)

    def test_album_detail_hides_source_below_artist(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        detail = source.split('struct AlbumDetail:', 1)[1].split('private struct GroupHeader:', 1)[0]
        self.assertNotIn('album.location', detail)
        self.assertIn('album.showsArtistSubtitle', detail)
        header = source.split('private struct GroupHeader:', 1)[1].split('\n}', 1)[0]
        self.assertNotIn('location', header)
        self.assertIn('Text(detail)', header)

    def test_artist_detail_keeps_album_groups_without_title_links(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        detail = source.split('struct ArtistDetail:', 1)[1].split('struct AlbumDetail:', 1)[0]
        self.assertIn('ForEach(artist.albums)', detail)
        self.assertNotIn('NavigationLink', detail)
        self.assertNotIn('square.stack', detail)
        self.assertNotIn('album.location', detail)

    def test_catalog_song_tab_keeps_row_playback_without_play_all(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        catalog = source.split('struct Catalog: View', 1)[1].split('struct EmptyLibrary:', 1)[0]
        self.assertNotIn('PlayCollectionButton(', catalog)
        self.assertIn('SongRows(app: app, tracks: list, playCollection: list, showSources: showSources)', catalog)

    def test_album_detail_shows_actual_song_count_above_play_all_on_both_platforms(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        album, header = source.split('struct AlbumDetail:', 1)[1].split('private struct GroupHeader:', 1)
        summary_and_header = album.split('        CatalogScroll {', 1)[0]
        self.assertNotIn('#if os(iOS)', summary_and_header)
        self.assertIn('countSummary: groupCount(1, album.tracks.count)', album)
        self.assertIn('detail: album.showsArtistSubtitle ? artist : nil', album)
        self.assertLess(header.index('Text(countSummary)'), header.index('PlayCollectionButton('))

    def test_macos_album_play_button_uses_compact_native_control_size(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        artist, album = source.split('struct ArtistDetail:', 1)[1].split('struct AlbumDetail:', 1)
        album = album.split('private struct GroupHeader:', 1)[0]
        header = source.split('private struct GroupHeader:', 1)[1].split('private struct PlayCollectionButton:', 1)[0]
        button = source.split('private struct PlayCollectionButton:', 1)[1].split('#if os(iOS)', 1)[1].split('#endif', 1)[0]
        self.assertNotIn('usesCompactPlayButton', artist)
        self.assertIn('usesCompactPlayButton: true', album)
        self.assertIn('usesCompactSize: usesCompactPlayButton', header)
        self.assertIn('.controlSize(usesCompactSize ? .regular : .large)', button)

    def test_detail_header_keeps_play_all_without_group_removal(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        header = source.split('private struct GroupHeader:', 1)[1].split('private struct PlayCollectionButton:', 1)[0]
        self.assertIn('PlayCollectionButton', header)
        self.assertNotIn('Menu {', header)
        self.assertNotIn('RemovalConfirmation', header)
        rows = source.split('struct SongRows:', 1)[1].split('struct ArtistDetail:', 1)[0]
        self.assertIn('app.remove(track)', rows)

    def test_album_detail_lists_supply_their_own_cover_without_number_tiles(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        artist, album = source.split('struct ArtistDetail:', 1)[1].split('struct AlbumDetail:', 1)
        album = album.split('private struct GroupHeader:', 1)[0]
        for detail in [artist, album]:
            self.assertIn('SongRows(', detail)
            self.assertIn('albumArtwork: ', detail)
        rows = source.split('struct SongRows:', 1)[1].split('struct ArtistDetail:', 1)[0]
        self.assertIn('artwork: track.artwork ?? albumArtwork', rows)
        self.assertNotIn('trackNumber:', rows)
        self.assertNotIn('numberTracks', source)

    def test_mac_artist_and_album_destinations_leave_shared_background_visible(self):
        source = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        mac_shell, destination = source.split('private struct DestinationContent:', 1)
        self.assertIn('macChrome(nowPlaying: page == .player)', mac_shell)
        self.assertIn('MacLibraryBackground(hasTracks:', mac_shell)
        self.assertNotIn('MacLibraryBackground(', destination)
        self.assertIn('''#if os(iOS)
        content().phoneLibraryBackground(.browsing)
        #else
        content()
        #endif''', destination)

    def test_folder_grouping_is_enabled_for_both_native_platforms(self):
        source = (ROOT / 'apps/Shared/AppState.swift').read_text()
        defaults = source.split('private(set) var snapshot', 1)[1].split('private(set) var starting', 1)[0]
        self.assertIn('LibraryIndex(snapshot: .init(), foldsQualityVariants: true, artistGrouping: .folder)', defaults)
        self.assertIn('LibraryIndex(snapshot: .init(), artistGrouping: .folder)', defaults)
