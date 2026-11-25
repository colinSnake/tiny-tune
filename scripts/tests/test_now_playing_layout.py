import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class NowPlayingLayoutTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / 'apps/Shared/PlayerViews.swift').read_text()
        self.player = self.source.split('struct NowPlayingView:', 1)[1].split('struct QueueView:', 1)[0]
        self.panel = self.source.split('private struct TrackLyricsPanel:', 1)[1].split('private struct LyricImportPreview:', 1)[0]

    def test_mac_sequential_playback_uses_a_bulleted_list_without_changing_ios(self):
        mode = self.source.split('private struct PlaybackModeButton: View', 1)[1].split('private var title:', 1)[0]
        self.assertRegex(mode, r'#if os\(macOS\)\s+case \.sequential: "list\.bullet"\s+#else\s+case \.sequential: "list\.number"')
        self.assertIn('case .repeatOne: "repeat.1"', mode)
        self.assertIn('case .shuffle: "shuffle"', mode)

    def test_mac_queue_uses_the_same_music_note_list_as_iphone(self):
        queue = self.source.split('private struct MacQueueButton: View', 1)[1].split('private struct MacQueuePopover:', 1)[0]
        self.assertIn('PlayerIcon("Queue", symbol: "music.note.list")', queue)
        self.assertIn('PlayerIcon("Queue", symbol: "music.note.list", size: phoneTransportIconSize)', self.player)
        self.assertIn('.popover(isPresented: $isPresented', queue)
        self.assertEqual(self.source.count('MacQueueButton(player: player)'), 2)

    def test_controls_are_pinned_outside_scrolling_content_even_without_lyrics(self):
        body = self.player.split('private var recordMaxWidth:', 1)[0]
        inset = body.split('.safeAreaInset(edge: .bottom, spacing: 0)', 1)
        self.assertEqual(len(inset), 2, 'Controls must be in a persistent bottom safe-area inset')
        self.assertIn('playbackControls', inset[1].split('.background {', 1)[0])
        controls = self.player.split('private var playbackControls:', 1)[1].split('private var songHeading:', 1)[0]
        self.assertIn('Scrubber(player: player', controls)
        self.assertIn('phoneTransport', controls)
        self.assertIn('transport', controls)
        self.assertNotIn('if player.current', controls)
        self.assertNotIn('LyricsPanel', controls)

    def test_song_information_uses_remaining_height_on_both_platforms(self):
        body = self.player.split('private var recordMaxWidth:', 1)[0]
        self.assertIn('alignment: horizontal ? .center : .top', body)
        self.assertIn('minHeight: max(0, viewport.size.height - 32)', body)
        self.assertIn('HStack(alignment: .center', body)
        self.assertIn('ScrollView {', body)
        self.assertNotIn('minHeight: horizontal ? viewport.size.height : nil', body)

    def test_phone_metadata_stays_next_to_record_with_flexible_space_below_lyrics(self):
        self.assertIn('private var stackedContent: some View', self.player)
        content = self.player.split('private var stackedContent: some View', 1)[1].split('private var phoneTransportIconSize:', 1)[0]
        self.assertIn('VStack(spacing: 12)', content)
        self.assertLess(content.index('record'), content.index('detail.frame('))
        self.assertLess(content.index('detail.frame('), content.index('Spacer(minLength: 24)'))
        detail = self.player.split('private var detail: some View', 1)[1].split('private var playbackControls:', 1)[0]
        self.assertIn('.padding(.top, 6)', detail)

    def test_mac_now_playing_keeps_metadata_and_lyrics_on_one_center_axis(self):
        detail = self.player.split('private var detail:', 1)[1].split('private var playbackControls:', 1)[0]
        self.assertNotIn('MacVolumeButton', detail)
        self.assertNotIn('#if os(iOS)', detail)
        self.assertIn('.multilineTextAlignment(.center)', detail)
        self.assertLess(detail.index('songHeading'), detail.index('LyricsPanel'))
        song_heading = self.player.split('private var songHeading:', 1)[1].split('private var feedback:', 1)[0]
        self.assertIn('VStack(alignment: .center', song_heading)
        self.assertIn('stackedContent', self.player.split('private var recordMaxWidth:', 1)[0])

    def test_mac_volume_sits_after_queue_without_shifting_the_center_play_button(self):
        transport = self.player.split('private var transport: some View', 1)[1]
        self.assertIn('MacVolumeButton', transport)
        self.assertLess(transport.index('MacQueueButton'), transport.index('MacVolumeButton'))
        self.assertIn('Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)', transport)
        self.assertIn('.frame(maxWidth: .infinity, alignment: .trailing)', transport)
        self.assertIn('.frame(maxWidth: .infinity, alignment: .leading)', transport)

    def test_mac_miniplayer_and_details_share_the_round_seek_control(self):
        mini = self.source.split('struct MiniPlayer: View', 1)[1].split('private struct PlaybackFeedback', 1)[0]
        scrubber = self.source.split('private struct Scrubber: View', 1)[1].split('/// Keep UIKit', 1)[0]
        self.assertEqual(mini.count('Scrubber(player: player)'), 2)
        self.assertIn('Scrubber(player: player, onPreview:', self.player)
        self.assertIn('PlaybackDotSlider(position:', scrubber)
        self.assertNotIn('Slider(value:', scrubber)
        self.assertIn('timeLabel(position)', scrubber)
        self.assertRegex(scrubber, r'#else\s+\.frame\(height: 28\)')
        mac = self.source.split('private struct PlaybackDotSlider: NSViewRepresentable', 1)[1].split('#endif', 1)[0]
        self.assertIn('override func drawKnob', mac)
        self.assertIn('NSBezierPath(ovalIn:', mac)
        self.assertIn('if changed { seek?(doubleValue) }', mac)

    def test_ios_progress_track_taps_commit_through_the_guarded_seek_path(self):
        slider = self.source.split('private struct PlaybackDotSlider: UIViewRepresentable', 1)[1].split('#elseif os(macOS)', 1)[0]
        self.assertIn('UITapGestureRecognizer(target: slider, action: #selector(DotSlider.tapTrack(_:)))', slider)
        self.assertIn('tap.cancelsTouchesInView = true', slider)
        self.assertIn('slider.addGestureRecognizer(tap)', slider)
        self.assertIn('guard isEnabled, recognizer.state == .ended', slider)
        self.assertIn('PlaybackSliderPosition.value(', slider)
        self.assertIn('value: minimumValue', slider)
        self.assertIn('value: maximumValue', slider)
        self.assertIn('sendActions(for: .valueChanged)', slider)
        self.assertIn('override func continueTracking', slider)
        self.assertIn('override func cancelTracking', slider)
        self.assertIn('slider.isContinuous = false', slider)
        self.assertNotIn('player.pause()', slider)
        self.assertNotIn('player.toggle()', slider)
        scrubber = self.source.split('private struct Scrubber: View', 1)[1].split('/// Keep UIKit', 1)[0]
        self.assertIn('if player.current?.id == trackID { player.seek(seconds) }', scrubber)
        self.assertIn('seekable: player.seekingAvailable', scrubber)

    def test_inline_lyrics_have_no_expansion_or_import_controls(self):
        summary = self.panel.split('private var summary:', 1)[1].split('private var fullPanel:', 1)[0]
        self.assertNotIn('PlayerIcon(', summary)
        self.assertNotIn('lyricsMenu', summary)
        self.assertNotIn('showsFullLyrics', self.panel)
        self.assertIn('.lineLimit(5)', summary)
        self.assertIn('.multilineTextAlignment(.center)', summary)
        retry = self.panel.split('private func retryStatus(', 1)[1].split('private var retryButton:', 1)[0]
        self.assertIn('if !inline { importButton }', retry)

    def test_missing_lyrics_are_status_only_on_ios_and_macos(self):
        missing = self.panel.split('private func missingStatus(', 1)[1].split('private func retryStatus(', 1)[0]
        self.assertIn('Text("No lyrics for this song")', missing)
        self.assertNotIn('retryStatus(', missing)
        self.assertNotIn('#if os(iOS)', missing)

    def test_lyric_strip_renders_five_centered_context_lines(self):
        source = (ROOT / 'packages/TinytuneKit/Sources/DesignSystem/NowPlayingLyrics.swift').read_text()
        self.assertIn('let visible: [Int]', source)
        self.assertIn('static let visibleLineCount = 5', source)
        self.assertIn('ForEach(window.visible', source)
        self.assertIn('.multilineTextAlignment(.center)', source)
        self.assertNotIn('line(window.current, emphasized: true)', source)


if __name__ == '__main__':
    unittest.main()
