import SwiftUI

/// A quiet folded page with a small sound wave, used only for an empty library.
public struct LibraryIllustration: View {
    public init() { }

    public var body: some View {
        Canvas { context, size in
            let scale = size.width / 224
            var drawing = context
            drawing.scaleBy(x: scale, y: scale)

            let sheet = Path { path in
                path.move(to: CGPoint(x: 49, y: 17))
                path.addQuadCurve(to: CGPoint(x: 129, y: 13), control: CGPoint(x: 83, y: 13))
                path.addLine(to: CGPoint(x: 166, y: 48))
                path.addLine(to: CGPoint(x: 166, y: 105))
                path.addQuadCurve(to: CGPoint(x: 157, y: 114), control: CGPoint(x: 166, y: 114))
                path.addLine(to: CGPoint(x: 48, y: 114))
                path.addQuadCurve(to: CGPoint(x: 39, y: 105), control: CGPoint(x: 39, y: 114))
                path.addLine(to: CGPoint(x: 39, y: 27))
                path.addQuadCurve(to: CGPoint(x: 49, y: 17), control: CGPoint(x: 39, y: 17))
                path.closeSubpath()
            }
            var shadow = drawing
            shadow.addFilter(.shadow(color: TuneTheme.primary.opacity(0.10), radius: 10, x: 0, y: 7))
            shadow.fill(sheet, with: .color(TuneTheme.raised))
            drawing.fill(sheet, with: .linearGradient(
                Gradient(colors: [TuneTheme.raised, TuneTheme.subtle]),
                startPoint: CGPoint(x: 43, y: 22), endPoint: CGPoint(x: 164, y: 111)))
            drawing.stroke(sheet, with: .color(TuneTheme.accent.opacity(0.12)), lineWidth: 1)

            var foldedCorner = Path()
            foldedCorner.move(to: CGPoint(x: 129, y: 14))
            foldedCorner.addLine(to: CGPoint(x: 129, y: 39))
            foldedCorner.addQuadCurve(to: CGPoint(x: 139, y: 49), control: CGPoint(x: 129, y: 49))
            foldedCorner.addLine(to: CGPoint(x: 165, y: 49))
            foldedCorner.closeSubpath()
            drawing.fill(foldedCorner, with: .linearGradient(
                Gradient(colors: [TuneTheme.brandViolet.opacity(0.88), TuneTheme.brandRose.opacity(0.82)]),
                startPoint: CGPoint(x: 129, y: 15), endPoint: CGPoint(x: 165, y: 49)))
            drawing.stroke(foldedCorner, with: .color(TuneTheme.raised.opacity(0.8)), lineWidth: 1)

            // The note sits on the page; the three flowing arcs carry the sound outward.
            drawing.fill(Path(ellipseIn: CGRect(x: 72, y: 73, width: 15, height: 11)),
                         with: .color(TuneTheme.brandViolet))
            var noteStem = Path()
            noteStem.move(to: CGPoint(x: 84, y: 76))
            noteStem.addLine(to: CGPoint(x: 91, y: 48))
            noteStem.addLine(to: CGPoint(x: 105, y: 52))
            drawing.stroke(noteStem, with: .color(TuneTheme.brandViolet),
                           style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            drawing.fill(Path(roundedRect: CGRect(x: 101, y: 47, width: 8, height: 10), cornerRadius: 2),
                         with: .color(TuneTheme.brandRose))

            for (index, height) in [12.0, 22.0, 32.0].enumerated() {
                var wave = Path()
                let x = CGFloat(179 + index * 8)
                wave.move(to: CGPoint(x: x, y: 64 - height / 2))
                wave.addQuadCurve(to: CGPoint(x: x, y: 64 + height / 2), control: CGPoint(x: x + 8, y: 64))
                drawing.stroke(wave, with: .linearGradient(
                    Gradient(colors: [TuneTheme.brandViolet.opacity(0.5), TuneTheme.brandRose.opacity(0.72)]),
                    startPoint: CGPoint(x: x, y: 64 - height / 2), endPoint: CGPoint(x: x, y: 64 + height / 2)),
                    style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }

            drawing.fill(Path(ellipseIn: CGRect(x: 29, y: 38, width: 5, height: 5)),
                         with: .color(TuneTheme.brandRose.opacity(0.8)))
            drawing.fill(Path(ellipseIn: CGRect(x: 194, y: 101, width: 4, height: 4)),
                         with: .color(TuneTheme.brandViolet.opacity(0.52)))
        }
        .aspectRatio(224 / 128.0, contentMode: .fit)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
