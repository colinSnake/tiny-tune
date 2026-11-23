import SwiftUI

/// An original vector vignette, kept apart from the playlist and reading surfaces.
public struct LibraryIllustration: View {
    public init() { }

    public var body: some View {
        Canvas { context, size in
            var drawing = context
            let scale = size.width / 224
            drawing.scaleBy(x: scale, y: scale)

            let panel = Path(roundedRect: CGRect(x: 1, y: 1, width: 222, height: 126), cornerRadius: 28)
            drawing.fill(panel, with: .linearGradient(
                Gradient(colors: [TuneTheme.raised, TuneTheme.subtle]),
                startPoint: .zero, endPoint: CGPoint(x: 207, y: 128)))
            drawing.stroke(panel, with: .color(TuneTheme.accent.opacity(0.12)), lineWidth: 1)

            RecordDrawing.disc(in: drawing, at: CGPoint(x: 101, y: 66), radius: 46, stripe: 0.32)

            var arm = Path()
            arm.move(to: CGPoint(x: 171, y: 31))
            arm.addQuadCurve(to: CGPoint(x: 164, y: 57), control: CGPoint(x: 171, y: 49))
            arm.addLine(to: CGPoint(x: 142, y: 77))
            drawing.stroke(arm, with: .color(TuneTheme.accent.opacity(0.74)),
                           style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            drawing.fill(RecordDrawing.circle(at: CGPoint(x: 171, y: 31), radius: 6), with: .color(TuneTheme.accent))
            drawing.fill(RecordDrawing.circle(at: CGPoint(x: 171, y: 31), radius: 2), with: .color(TuneTheme.onAccent))
            drawing.fill(RecordDrawing.circle(at: CGPoint(x: 142, y: 77), radius: 2.6), with: .color(TuneTheme.accent))

            var sparkle = Path()
            sparkle.move(to: CGPoint(x: 42, y: 25))
            sparkle.addQuadCurve(to: CGPoint(x: 50, y: 33), control: CGPoint(x: 43, y: 32))
            sparkle.addQuadCurve(to: CGPoint(x: 42, y: 41), control: CGPoint(x: 43, y: 34))
            sparkle.addQuadCurve(to: CGPoint(x: 34, y: 33), control: CGPoint(x: 41, y: 34))
            sparkle.addQuadCurve(to: CGPoint(x: 42, y: 25), control: CGPoint(x: 41, y: 32))
            sparkle.closeSubpath()
            drawing.fill(sparkle, with: .color(TuneTheme.accent.opacity(0.58)))
            drawing.fill(RecordDrawing.circle(at: CGPoint(x: 191, y: 87), radius: 2.5), with: .color(TuneTheme.accent.opacity(0.38)))
        }
        .aspectRatio(224 / 128.0, contentMode: .fit)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private enum RecordDrawing {
    static func circle(at point: CGPoint, radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius,
                               width: radius * 2, height: radius * 2))
    }

    static func disc(in drawing: GraphicsContext, at point: CGPoint, radius: CGFloat, stripe: CGFloat) {
        drawing.fill(circle(at: point, radius: radius), with: .linearGradient(
            Gradient(colors: [TuneTheme.accent.opacity(0.23), TuneTheme.accent.opacity(0.09)]),
            startPoint: CGPoint(x: point.x - radius, y: point.y - radius * stripe),
            endPoint: CGPoint(x: point.x + radius, y: point.y + radius)))
        drawing.stroke(circle(at: point, radius: radius), with: .color(TuneTheme.accent.opacity(0.28)), lineWidth: max(0.5, radius * 0.02))
        for ratio: CGFloat in [0.49, 0.62, 0.75, 0.88] {
            drawing.stroke(circle(at: point, radius: radius * ratio), with: .color(TuneTheme.accent.opacity(0.3)), lineWidth: max(0.45, radius * 0.015))
        }
        drawing.fill(circle(at: point, radius: radius * 0.34), with: .color(TuneTheme.accent.opacity(0.83)))
        drawing.fill(circle(at: point, radius: radius * 0.075), with: .color(TuneTheme.onAccent))
    }
}
