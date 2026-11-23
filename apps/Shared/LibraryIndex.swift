import Domain
import Foundation
import Library

extension Track {
    var subtitle: String {
        [metadata.artist ?? String(localized: "Unknown artist", bundle: AppLanguage.bundle, locale: AppLanguage.locale), metadata.album].compactMap { $0 }.joined(separator: " · ")
    }
    var artwork: URL? { artworkKey.flatMap(ArtworkCache.url(for:)) }
}

func timeLabel(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0, seconds < Double(Int.max) else { return "—:—" }
    let total = Int(seconds)
    if total >= 3600 { return "\(total / 3600):\(String(format: "%02d:%02d", total / 60 % 60, total % 60))" }
    return "\(total / 60):\(String(format: "%02d", total % 60))"
}

func groupCount(_ albums: Int, _ songs: Int) -> String {
    let albumCount = String(localized: "\(albums) albums", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
    let songCount = String(localized: "\(songs) songs", bundle: AppLanguage.bundle, locale: AppLanguage.locale)
    return "\(albumCount) · \(songCount)"
}
