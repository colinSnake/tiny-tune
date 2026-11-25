import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class MacOSLyricsTypographyTests(unittest.TestCase):
    def test_following_lyrics_larger_on_macos_without_changing_iphone(self):
        source = (ROOT / 'packages/TinytuneKit/Sources/DesignSystem/NowPlayingLyrics.swift').read_text()
        metrics = source.split('public struct NowPlayingLyricStrip: View', 1)[1].split('@Environment', 1)[0]
        self.assertIn('#if os(macOS)', metrics)
        mac, iphone = metrics.split('#else', 1)
        for fragment in ('private var inactiveSize = 15.0', 'private var currentSize = 18.0',
                         'private var rowHeight = 32.0'):
            self.assertIn(fragment, mac)
        self.assertIn('private var rowHeight = 28.0', iphone)
        line = source.split('private func line(', 1)[1]
        mac, iphone = line.split('#else', 1)
        self.assertIn('.font(.system(size: emphasized ? currentSize : inactiveSize,', mac)
        self.assertIn('weight: emphasized ? .semibold : .regular)', mac)
        self.assertIn('.minimumScaleFactor(0.86)', mac)
        self.assertIn('.font(emphasized ? .body.weight(.semibold) : .subheadline)', iphone)
        self.assertIn('.lineLimit(1)', line)
        self.assertIn('static let visibleLineCount = 5', source)
