"""Structural regressions for the approved native iOS design (not a UI test)."""
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


class IOSLandscapeDesignTests(unittest.TestCase):
    def test_root_toolbar_preserves_plain_accessible_actions(self):
        source = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        self.assertIn('private struct PhoneRootToolbar: ToolbarContent', source)
        toolbar = source.split('private struct PhoneRootToolbar: ToolbarContent', 1)[1].split('private extension View', 1)[0]
        for contract in ['plus', 'minWidth: 44, minHeight: 44', '.accessibilityLabel', '.buttonStyle(.plain)', '.topBarTrailing']:
            self.assertIn(contract, toolbar)
        self.assertNotIn('Text(title)', toolbar)
        self.assertGreaterEqual(source.count('PhoneRootToolbar('), 2)

    def test_root_add_icon_is_20pt_and_adapts_to_system_appearance(self):
        source = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        toolbar = source.split('private struct PhoneRootToolbar: ToolbarContent', 1)[1].split('private extension ToolbarContent', 1)[0]
        self.assertIn('.font(.system(size: 20, weight: .regular))', toolbar)
        self.assertIn('.foregroundStyle(Color(uiColor: .label))', toolbar)
        self.assertNotIn('TuneTheme.accent', toolbar)
        self.assertIn('.disabled(!canImport)', toolbar)

    def test_sources_about_entry_and_sheet_are_removed(self):
        app = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        for removed in ['showsAbout', 'AboutTinytuneView', 'info.circle', '.height(366)']:
            self.assertNotIn(removed, app)
        toolbar = app.split('private struct PhoneRootToolbar: ToolbarContent', 1)[1].split('private extension View', 1)[0]
        self.assertNotIn('.topBarLeading', toolbar)
        self.assertNotIn('var about:', toolbar)
        self.assertNotIn('struct AboutTinytuneView', source)
        self.assertIn('struct TuneSettings: View', source)
        preview = (ROOT / 'docs/design/2026-11-24-ios-landscape-sources/index.html').read_text()
        cards = preview.split('function sources(){', 1)[1].split('function ', 1)[0]
        self.assertNotIn("iconButton('info'", cards)
        self.assertNotIn("action==='about'||", preview)
        self.assertNotIn("liveModal=['about','import']", preview)
        self.assertIn('.fullScreenCover(isPresented: $showsPlayer)', app)
        self.assertIn('.sheet(isPresented: $showsQueue)', app)

    def test_new_header_art_is_decorative_and_accessibility_aware(self):
        source = (ROOT / 'packages/TinytuneKit/Sources/DesignSystem/LibraryLandscape.swift').read_text()
        self.assertIn('public struct LibraryHeaderLandscape: View', source)
        header = source.split('public struct LibraryHeaderLandscape: View', 1)[1]
        for contract in ['.increased', '.isAccessibilitySize', '.allowsHitTesting(false)',
                         '.accessibilityHidden(true)', 'LibraryLandscape-Header']:
            self.assertIn(contract, header)

    def test_header_resources_have_both_appearances_and_retina_geometry(self):
        directory = ROOT / 'packages/TinytuneKit/Sources/DesignSystem/Resources/Artwork.xcassets/LibraryLandscape-Header.imageset'
        self.assertTrue((directory / 'Contents.json').is_file(), 'Header imageset has not been generated')
        images = json.loads((directory / 'Contents.json').read_text())['images']
        self.assertEqual(len(images), 2)
        self.assertTrue(any(i.get('appearances') == [{'appearance': 'luminosity', 'value': 'dark'}] for i in images))
        for image in images:
            self.assertEqual(image['scale'], '3x')
            data = (directory / image['filename']).read_bytes()
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual((int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')), (1170, 900))

    def test_editable_artwork_does_not_bake_a_paper_rectangle(self):
        ns = {'s': 'http://www.w3.org/2000/svg'}
        for appearance in ['Light', 'Dark']:
            path = ROOT / f'docs/brand/landscape/Header-{appearance}.svg'
            self.assertTrue(path.exists(), 'Editable header artwork has not been installed')
            svg = ET.parse(path).getroot()
            self.assertEqual(svg.attrib['viewBox'], '0 0 390 300')
            self.assertIn('headerFade', {n.attrib.get('id') for n in svg.findall('.//s:linearGradient', ns)})
            self.assertFalse(any(r.attrib.get('fill') in ['#f4f2eb', '#17251f'] for r in svg))

    def test_now_playing_keeps_its_full_height_transparent_composition(self):
        directory = ROOT / 'packages/TinytuneKit/Sources/DesignSystem/Resources/Artwork.xcassets/LibraryLandscape-Page.imageset'
        images = json.loads((directory / 'Contents.json').read_text())['images']
        self.assertEqual(len(images), 2)
        for image in images:
            data = (directory / image['filename']).read_bytes()
            self.assertEqual(data[:8], bytes([137, 80, 78, 71, 13, 10, 26, 10]))
            self.assertEqual((int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')), (1170, 2532))
            self.assertEqual(data[25], 6, 'Artwork must retain an alpha channel')
        for appearance in ['Light', 'Dark']:
            svg = ET.parse(ROOT / f'docs/brand/landscape/Page-{appearance}.svg').getroot()
            self.assertEqual(svg.attrib['viewBox'], '0 0 390 844')
        source = (ROOT / 'packages/TinytuneKit/Sources/DesignSystem/LibraryLandscape.swift').read_text()
        page = source.split('public struct LibraryPageLandscape:', 1)[1]
        self.assertIn('.scaledToFill()', page)
        self.assertIn('.clipped()', page)
        player = (ROOT / 'apps/Shared/PlayerViews.swift').read_text()
        self.assertIn('LibraryPageLandscape().opacity(0.68).ignoresSafeArea()', player)
        self.assertNotIn('PhoneLibraryBackground', player)

    def test_sheets_can_expand_and_keep_commit_safeguards(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        app = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        self.assertIn('private func phoneBody(_ flow: ImportFlow)', source)
        self.assertIn('.safeAreaInset(edge: .bottom', source)
        self.assertIn('textSize.isAccessibilitySize', source)
        phone = source.split('private func phoneBody(_ flow: ImportFlow)', 1)[1].split('private func macBody', 1)[0]
        self.assertNotIn('.height(546)', phone)
        self.assertIn('let compactDetent = phoneImportDetent(flow)', phone)
        self.assertIn('[compactDetent, .large]', phone)
        self.assertIn('selection: Binding(', phone)
        self.assertIn('.fraction(0.42)', phone)
        self.assertIn('.fraction(0.58)', phone)
        self.assertIn('phoneTitleSize', phone)
        self.assertIn('phoneBodySize', phone)
        self.assertIn('.interactiveDismissDisabled(flow.committing)', source)
        self.assertIn('.disabled(flow.committing || !flow.canCommit)', source)
        self.assertNotIn('.height(240)', app)

    def test_source_cards_preserve_actions_without_redundant_summary(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        self.assertNotIn('private var phoneSummary:', source)
        for contract in ['app.rescan(source)', 'app.choose(source)', 'app.remove(source)',
                         'app.restoreRemoved(in: source)', 'RemovalConfirmation(title: "Remove Source?"',
                         'private func sourceMenu']:
            self.assertIn(contract, source)

    def test_roots_share_ear_fold_and_keep_native_titles(self):
        source = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        roots = source.split('private struct PhoneShell: View', 1)[1].split('.tint(TuneTheme.phoneTabSelection)', 1)[0]
        self.assertEqual(roots.count('.phoneLibraryBackground(.browsing)'), 2)
        self.assertEqual(roots.count('.phoneLibraryBackground(libraryBackgroundStyle)'), 1)
        self.assertNotIn('LibraryPageLandscape()', source)
        helper = source.split('private extension View {', 1)[1].split('#else', 1)[0]
        self.assertIn('PhoneLibraryBackground(style: style)', helper)
        self.assertIn('TuneTheme.canvas.ignoresSafeArea(.container)', helper)
        self.assertEqual(roots.count('.navigationBarTitleDisplayMode(.inline)'), 3)
        self.assertEqual(roots.count('.toolbarBackground(.hidden, for: .navigationBar)'), 3)
        for title in ['Music Library', 'Search', 'Music Sources']:
            self.assertIn('.navigationTitle(String(localized: "'+title+'"', roots)
        self.assertNotIn('.toolbar(.hidden, for: .navigationBar)', roots)
        self.assertNotIn('PhoneRootHeader', source)
        self.assertEqual(roots.count('PhoneRootSummary('), 2)

    def test_phone_empty_library_does_not_stack_the_old_artwork(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        empty = source.split('struct EmptyLibrary:', 1)[1].split('struct CatalogScroll', 1)[0]
        self.assertNotIn('LibraryLandscape()', empty)
        self.assertIn('LibraryIllustration()', empty)

    def test_phone_ear_fold_uses_transparent_matching_appearances(self):
        directory = ROOT / 'packages/TinytuneKit/Sources/DesignSystem/Resources/Artwork.xcassets/TingyePhoneLibraryBackground.imageset'
        self.assertTrue((directory / 'Contents.json').exists(), 'Approved phone artwork has not been integrated')
        images = json.loads((directory / 'Contents.json').read_text())['images']
        self.assertEqual(len(images), 2)
        self.assertEqual({i['filename']: i.get('appearances', []) for i in images}, {
            'Light.png': [], 'Dark.png': [{'appearance': 'luminosity', 'value': 'dark'}],
        })
        for image in images:
            data = (directory / image['filename']).read_bytes()
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual((int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')), (1170, 672))
            self.assertEqual(data[25], 6, 'Artwork must retain an alpha channel')
        for appearance in ('light', 'dark'):
            svg = ET.parse(ROOT / f'docs/brand/illustrations/iphone-earfold-{appearance}.svg').getroot()
            self.assertEqual(svg.attrib['viewBox'], '0 0 390 224')

    def test_phone_ear_fold_is_decorative_and_accessibility_aware(self):
        source = (ROOT / 'packages/TinytuneKit/Sources/DesignSystem/LibraryLandscape.swift').read_text()
        self.assertIn('public struct PhoneLibraryBackground: View', source)
        phone = source.split('public struct PhoneLibraryBackground: View', 1)[1].split('#if os(iOS)', 1)[0]
        for contract in ['contrast != .increased', '!textSize.isAccessibilitySize', '.bottomTrailing',
                         '.offset(y: style.bottomBleed(forArtworkWidth: size.width))', '.clipped()',
                         '.allowsHitTesting(false)', '.accessibilityHidden(true)']:
            self.assertIn(contract, phone)

    def test_song_facet_changes_only_reset_catalog_scroll(self):
        catalog = (ROOT / 'apps/Shared/CatalogViews.swift').read_text().split('struct EmptyLibrary:', 1)[0]
        self.assertIn('.id(facet)', catalog)
        self.assertIn('app.index.catalogTracks', catalog)

    def test_browsing_cards_let_artwork_through_without_fading_content(self):
        source = (ROOT / 'packages/TinytuneKit/Sources/DesignSystem/Components.swift').read_text()
        card = source.split('func tuneCard(', 1)[1].split('public struct ArtworkTile', 1)[0]
        self.assertIn('modifier(BrowsingCardBackground(', card)
        self.assertIn('TuneTheme.raised.opacity(', card)
        self.assertNotIn('content.opacity(', card)

    def test_phone_source_surfaces_use_browsing_card_fill(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        surfaces = source.split('private var phoneBody:', 1)[1].split('private var desktopBody:', 1)[0]
        self.assertEqual(surfaces.count('.tuneCard(cornerRadius: 22)'), 2)
        self.assertNotIn('.background(TuneTheme.raised', surfaces)

    def test_phone_details_share_browsing_artwork_but_player_does_not(self):
        source = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        destination = source.split('private struct DestinationContent:', 1)[1]
        self.assertIn('private func browsingDetail', destination)
        player, helper = destination.split('case .player:', 1)[1].split('private func browsingDetail', 1)
        for case in ['.artist', '.album']:
            self.assertIn(f'case {case}(let id):\n            browsingDetail {{', destination)
        self.assertIn('content().phoneLibraryBackground(.browsing)', helper)
        self.assertNotIn('phoneLibraryBackground', player)
        self.assertIn('.background(TuneTheme.canvas)', player)

    def test_phone_sources_keep_maintenance_in_menu(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        phone = source.split('private func phoneSourceCard', 1)[1].split('private func desktopSourceCard', 1)[0]
        self.assertIn('sourceMenu(source, unavailable: unavailable)', phone)
        self.assertNotIn('phoneSourceAction', phone)
        self.assertNotIn('"Connected"', phone)
        self.assertNotIn('Image(systemName: "folder")', phone)
        self.assertNotIn('.padding(.leading, 32)', phone)
        self.assertNotIn('Your files stay where they are and are never uploaded.', source)

    def test_phone_source_ellipsis_anchors_a_compact_popover_without_replacing_long_press(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        card = source.split('private func phoneSourceCard', 1)[1].split('private func desktopSourceCard', 1)[0]
        self.assertNotIn('Menu {', card.replace('.contextMenu {', ''))
        self.assertIn('Image(systemName: "ellipsis")', card)
        self.assertIn('attachmentAnchor: .rect(.bounds)', card)
        self.assertIn('PhoneSourceActionsPopover(', card)
        self.assertIn('.contextMenu { sourceMenu(source, unavailable: unavailable) }', card)

    def test_phone_action_popovers_share_readable_rows_and_size_to_content(self):
        component = ROOT / 'apps/Shared/PhoneActionPopover.swift'
        self.assertTrue(component.is_file(), 'iOS action popovers need a shared component')
        surface = component.read_text()
        for contract in ['.presentationCompactAdaptation(.popover)', '.presentationBackground(TuneTheme.raised)',
                         'labelSize: CGFloat = 14', 'iconSize: CGFloat = 13', '@ScaledMetric',
                         '.frame(minHeight: 44)', 'TuneTheme.problem',
                         '.fixedSize(horizontal: false, vertical: true)', '.gridCellUnsizedAxes(.horizontal)']:
            self.assertIn(contract, surface)
        self.assertIn('minWidth: 130, maxWidth: 172', surface)
        self.assertIn('let idealWidth = rows.sizeThatFits(.unspecified).width', surface)
        self.assertIn('min(max(idealWidth, minWidth), maxWidth)', surface)
        self.assertIn('if textSize.isAccessibilitySize', surface)
        self.assertIn('menu.frame(width: 288)', surface)
        self.assertIn('.padding(.horizontal, 15)', surface)

    def test_empty_sources_centers_one_scrollable_card_and_omits_zero_count(self):
        app = (ROOT / 'apps/Shared/TinytuneApp.swift').read_text()
        self.assertRegex(app, r'if !app\.snapshot\.sources\.isEmpty \{\s+PhoneRootSummary\(subtitle: Text\(".*music folders"\)\)')
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        page = source.split('struct SourcesView: View', 1)[1].split('private var desktopBody:', 1)[0]
        self.assertIn('GeometryReader { viewport in', page)
        self.assertIn('phoneEmptyState', page)
        self.assertIn('.frame(minHeight: viewport.size.height)', page)
        card = page.split('private var phoneEmptyState', 1)[1]
        self.assertIn('.multilineTextAlignment(.center)', card)
        self.assertIn('.tuneCard(cornerRadius: 22)', card)
        self.assertIn('app.choose()', card)
        self.assertIn('.disabled(!app.canImport)', card)

    def test_phone_source_and_removal_confirmation_use_shared_surface(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        popup = source.split('private struct PhoneSourceActionsPopover', 1)[1].split('private struct SourceCardAction', 1)[0]
        self.assertIn('PhoneActionPopover {', popup)
        self.assertLess(popup.index('PhonePopoverDivider()'), popup.index('row(.remove)'))
        confirmation = source.split('struct RemovalConfirmation', 1)[1].split('struct SourcesView', 1)[0]
        self.assertIn('PhonePopoverSurface { content.frame(width: textSize.isAccessibilitySize ? 288 : 240) }', confirmation)
        self.assertIn('phoneTitleSize: CGFloat = 16', confirmation)
        self.assertIn('phoneBodySize: CGFloat = 14', confirmation)
        self.assertIn('.frame(minWidth: 44, minHeight: 44)', confirmation)
        self.assertIn('.keyboardShortcut(.cancelAction)', confirmation)
        self.assertIn('.frame(width: 280)', confirmation)

    def test_phone_song_sort_has_compact_label_and_keeps_the_selected_option(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        menu = source.split('private var sortMenu:', 1)[1].split('struct EmptyLibrary:', 1)[0]
        self.assertIn('#if os(iOS)', menu)
        phone, mac = menu.split('#else', 1)
        for contract in ['.font(.caption.weight(.medium))', 'size: sortIconSize', 'minWidth: 44, minHeight: 44',
                         '.popover(isPresented: $showsSortOptions', 'PhoneActionPopover {',
                         'isSelected: order == option', 'order = option', 'showsSortOptions = false']:
            self.assertIn(contract, phone)
        self.assertIn('sortIconSize: CGFloat = 11', source)
        self.assertIn('Picker("Sort By", selection: $order)', mac)

    def test_phone_lyrics_options_use_shared_popover_before_presenting_next_action(self):
        source = (ROOT / 'apps/Shared/PlayerViews.swift').read_text()
        menu = source.split('private var lyricsMenu:', 1)[1].split('private func actionLabel', 1)[0]
        for contract in ['.popover(isPresented: $showsLyricsOptions', 'PhoneActionPopover {', 'if isImported',
                         '.onDisappear(perform: finishLyricsAction)', 'selectLyricsAction(.importFile)',
                         'selectLyricsAction(.remove)', 'showsLyricsOptions = false',
                         'case .importFile: isPicking = true', 'case .remove: confirmsRemoval = true']:
            self.assertIn(contract, menu)

    def test_phone_source_actions_close_before_handoff_and_keep_remove_confirmation(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        popup = source.split('private struct PhoneSourceActionsPopover', 1)[-1].split('private struct SourceCardAction', 1)[0]
        self.assertIn('selectedAction = action', popup)
        self.assertIn('dismiss()', popup)
        self.assertIn('.onDisappear {', popup)
        self.assertIn('guard let selectedAction else { return }', popup)
        self.assertIn('onSelect(selectedAction)', popup)
        routing = source.split('private func performPhoneSourceAction', 1)[-1].split('#endif', 1)[0]
        for contract in ['app.rescan(source)', 'app.choose(source)', 'app.restoreRemoved(in: source)',
                         'case .remove: pendingRemoval = source.id']:
            self.assertIn(contract, routing)
        self.assertNotIn('app.remove(source)', routing)

    def test_phone_source_authorization_only_appears_in_more_menu(self):
        source = (ROOT / 'apps/Shared/SourceViews.swift').read_text()
        phone = source.split('private func phoneSourceCard', 1)[1].split('private func desktopSourceCard', 1)[0]
        self.assertNotIn('Authorization needed', phone)
        self.assertNotIn('sourceWarning', phone)
        self.assertNotIn('app.choose(source)', phone)
        menu = source.split('private func sourceMenu', 1)[1].split('private func sourceMetadata', 1)[0]
        self.assertIn('Button("Choose Folder Again"', menu)
        self.assertIn('app.choose(source)', menu)
        preview = (ROOT / 'docs/design/2026-11-24-ios-landscape-sources/index.html').read_text()
        cards = preview.split('function sources(){', 1)[1].split('function ', 1)[0]
        self.assertNotIn('需要重新授权', cards)
        self.assertNotIn('data-action="reconnect"', cards)
        preview_menu = preview.split('function menu(){', 1)[1].split('function ', 1)[0]
        self.assertIn('data-action="reconnect"', preview_menu)

    def test_phone_play_all_uses_compact_visuals_with_accessible_hit_target(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        button = source.split('private struct PlayCollectionButton: View', 1)[1].split('struct SearchCatalog:', 1)[0]
        self.assertIn('CompactPlayCollectionButtonStyle()', button)
        self.assertIn('.buttonStyle(.borderedProminent)', button)
        self.assertIn('app.playAll(tracks, allowsSongsHandoff: allowsSongsHandoff)', button)
        self.assertIn('.disabled(!tracks.contains', button)
        compact = button.split('private struct CompactPlayCollectionButtonStyle: ButtonStyle', 1)[1]
        for contract in ['.font(.footnote.weight(.semibold))', '.imageScale(.small)',
                         '.padding(.horizontal, 12)', '.padding(.vertical, 6)',
                         '.frame(minWidth: 44, minHeight: 44)', '.contentShape(Rectangle())',
                         'TuneTheme.accent', 'TuneTheme.onAccent', 'isEnabled']:
            self.assertIn(contract, compact)
        self.assertLess(compact.index('.background('), compact.index('.frame(minWidth: 44, minHeight: 44)'))

    def test_artist_and_album_play_actions_enable_songs_handoff(self):
        source = (ROOT / 'apps/Shared/CatalogViews.swift').read_text()
        artist = source.split('struct ArtistDetail: View', 1)[1].split('struct AlbumDetail:', 1)[0]
        album = source.split('struct AlbumDetail: View', 1)[1].split('private struct GroupHeader:', 1)[0]
        header = source.split('private struct GroupHeader: View', 1)[1].split('private struct PlayCollectionButton:', 1)[0]
        rows = source.split('struct SongRows: View', 1)[1].split('struct ArtistDetail:', 1)[0]
        self.assertEqual(artist.count('allowsSongsHandoff: true'), 2)
        self.assertEqual(album.count('allowsSongsHandoff: true'), 2)
        self.assertIn('allowsSongsHandoff: allowsSongsHandoff', header)
        self.assertIn('app.play(track, in: playCollection, allowsSongsHandoff: allowsSongsHandoff)', rows)

    def test_phone_transport_groups_five_icon_controls_with_shared_size(self):
        source = (ROOT / 'apps/Shared/PlayerViews.swift').read_text()
        player = source.split('struct NowPlayingView:', 1)[1].split('struct QueueView:', 1)[0]
        transport = player.split('private var phoneTransport: some View', 1)[1].split('private var phonePlaybackMode:', 1)[0]
        self.assertIn('HStack(spacing: 0)', transport)
        self.assertNotIn('ViewThatFits', transport)
        self.assertNotIn('VStack(', transport)
        controls = ['phonePlaybackMode', 'PlayerIcon("Previous Track"', 'PlayButton(', 'PlayerIcon("Next Track"', 'phoneQueue']
        offsets = [transport.index(control) for control in controls]
        self.assertEqual(offsets, sorted(offsets))
        self.assertEqual(transport.count('size: phoneTransportIconSize'), 2)
        self.assertIn('private var phoneTransportIconSize: CGFloat { 22 }', player)
        self.assertIn('PlaybackModeButton(player: player, transportIconSize: phoneTransportIconSize)', player)
        self.assertIn('PlayerIcon("Queue", symbol: "music.note.list", size: phoneTransportIconSize)', player)
        mode = source.split('private struct PlaybackModeButton: View', 1)[1].split('private struct PlayButton:', 1)[0]
        self.assertIn('case .sequential: "list.number"', mode)
        self.assertNotIn('showsTitle', mode)
        self.assertNotIn('Label(title', mode)
        self.assertIn('.accessibilityValue(Text(title))', mode)
        self.assertIn('player.cyclePlaybackMode()', mode)

    def test_missing_lyrics_do_not_offer_phone_recovery_actions(self):
        source = (ROOT / 'apps/Shared/PlayerViews.swift').read_text()
        panel = source.split('private struct TrackLyricsPanel:', 1)[1]
        for context in ('private var summary', 'private var fullPanel'):
            view = panel.split(context, 1)[1].split('case .failed:', 1)[0]
            self.assertIn('missingStatus(', view.split('case .missing:', 1)[1])
        player = source.split('struct NowPlayingView:', 1)[1].split('struct QueueView:', 1)[0]
        self.assertIn('phoneTransport', player)
        self.assertIn('PlayerIcon("Queue", symbol: "music.note.list", size: phoneTransportIconSize)', player)


if __name__ == '__main__':
    unittest.main()
