/// Maps a track tap to a value using native thumb centers, including right-to-left tracks.
public enum PlaybackSliderPosition {
    public static func value(at x: Double, minimumX: Double, maximumX: Double,
                             minimumValue: Double = 0, maximumValue: Double) -> Double? {
        guard x.isFinite, minimumX.isFinite, maximumX.isFinite,
              minimumValue.isFinite, maximumValue.isFinite else { return nil }
        let trackSpan = maximumX - minimumX
        let valueSpan = maximumValue - minimumValue
        guard trackSpan.isFinite, trackSpan != 0, valueSpan.isFinite, valueSpan > 0 else { return nil }
        let fraction = min(1, max(0, (x - minimumX) / trackSpan))
        return minimumValue + fraction * valueSpan
    }
}
