import SwiftUI

struct RecordLabelRotation {
    private static let degreesPerSecond = 22.5
    private var parked: Double = 0
    private var start: ContinuousClock.Instant?

    func degrees(at now: ContinuousClock.Instant) -> Double {
        guard let start else { return parked }
        let elapsed = start.duration(to: now).components
        let seconds = Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18
        return (parked + max(0, seconds) * Self.degreesPerSecond).truncatingRemainder(dividingBy: 360)
    }

    mutating func setRunning(_ running: Bool, at now: ContinuousClock.Instant) {
        if running, start == nil {
            start = now
        } else if !running, start != nil {
            parked = degrees(at: now)
            start = nil
        }
    }
}

struct NowPlayingRecordGeometry {
    let size: CGSize
    let center: CGPoint
    let radius: CGFloat
    let labelRadius: CGFloat
    init(size: CGSize = CGSize(width: 360, height: 324), center: CGPoint = CGPoint(x: 151, y: 164),
         radius: CGFloat = 145, labelRadius: CGFloat = 99) {
        self.size = size; self.center = center; self.radius = radius; self.labelRadius = labelRadius
    }

    static let phone = Self(size: CGSize(width: 360, height: 310), center: CGPoint(x: 180, y: 155),
                           radius: 135, labelRadius: 92)

    fileprivate var tonearmScale: CGFloat { radius / TonearmProfile.discRadius }

    private func fitted(_ point: CGPoint) -> CGPoint {
        .init(x: center.x + (point.x - TonearmProfile.discCenter.x) * tonearmScale,
              y: center.y + (point.y - TonearmProfile.discCenter.y) * tonearmScale)
    }

    var pivot: CGPoint { fitted(TonearmProfile.pivot) }
    var cartridge: CGPoint { fitted(TonearmProfile.cartridge) }
    var tube: [TonearmProfile.Bend] {
        TonearmProfile.tube.map { .init(end: fitted($0.end), control1: fitted($0.control1), control2: fitted($0.control2)) }
    }
    var needleTip: CGPoint {
        let angle = TonearmProfile.needleAngle * .pi / 180
        let tip = TonearmProfile.needleEnd
        let shell = TonearmProfile.cartridge
        return fitted(CGPoint(x: shell.x + cos(angle) * tip.x - sin(angle) * tip.y,
                              y: shell.y + sin(angle) * tip.x + cos(angle) * tip.y))
    }
}

/// Coordinates in the approved drawing, fitted to either platform's vinyl radius.
enum TonearmProfile {
    static let discCenter = CGPoint(x: 161, y: 146)
    static let discRadius: CGFloat = 134
    static let pivot = CGPoint(x: 294, y: 24)
    static let tubeStart = CGPoint(x: 294, y: 28)
    static let cartridge = CGPoint(x: 256, y: 80)
    static let needleAngle = 49.0
    static let needleEnd = CGPoint(x: 0.1, y: 12.2)
    static let tube: [Bend] = [
        .init(end: CGPoint(x: 276, y: 62), control1: CGPoint(x: 294, y: 43), control2: CGPoint(x: 286, y: 55)),
        .init(end: cartridge, control1: CGPoint(x: 269, y: 67), control2: CGPoint(x: 261, y: 73)),
    ]

    struct Bend: Sendable {
        let end: CGPoint
        let control1: CGPoint
        let control2: CGPoint
    }
}

public struct NowPlayingRecord: View {
    private let artwork: URL?
    private let playing: Bool
    #if os(iOS)
    private let geometry = NowPlayingRecordGeometry.phone
    #else
    private let geometry = NowPlayingRecordGeometry()
    #endif

    public init(artwork: URL?, playing: Bool) {
        self.artwork = artwork
        self.playing = playing
    }

    public var body: some View {
        GeometryReader { proxy in
            let scale = proxy.size.width / geometry.size.width
            let labelSize = 2 * geometry.labelRadius * scale
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    var drawing = context
                    drawing.scaleBy(x: scale, y: scale)
                    drawVinyl(in: drawing)
                }
                RecordLabel(artwork: artwork, size: labelSize, playing: playing)
                    .position(x: geometry.center.x * scale, y: geometry.center.y * scale)
                Canvas { context, _ in
                    var drawing = context
                    drawing.scaleBy(x: scale, y: scale)
                    drawTonearm(in: drawing)
                }
            }
        }
        .aspectRatio(geometry.size.width / geometry.size.height, contentMode: .fit)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }

    private func drawVinyl(in drawing: GraphicsContext) {
        let center = geometry.center, radius = geometry.radius
        let disc = circle(at: center, radius: radius)
        var shadow = drawing
        shadow.addFilter(.shadow(color: .black.opacity(0.56), radius: 13, x: 0, y: 9))
        shadow.fill(disc, with: .color(Color(red: 0.075, green: 0.062, blue: 0.092)))
        drawing.fill(disc, with: .conicGradient(
            Gradient(colors: [Color(red: 0.14, green: 0.115, blue: 0.17),
                              Color(red: 0.245, green: 0.205, blue: 0.29),
                              Color(red: 0.075, green: 0.062, blue: 0.092),
                              Color(red: 0.19, green: 0.15, blue: 0.23),
                              Color(red: 0.14, green: 0.115, blue: 0.17)]),
            center: center, angle: .degrees(27)))
        for groove in stride(from: Int(geometry.labelRadius + 6), to: Int(radius - 5), by: 3) {
            drawing.stroke(circle(at: center, radius: CGFloat(groove)), with: .color(armMetal.opacity(0.19)), lineWidth: 0.65)
        }
        drawing.stroke(disc, with: .color(armMetal.opacity(0.55)), lineWidth: 1)
        drawing.stroke(circle(at: center, radius: radius - 5), with: .color(armMetal.opacity(0.27)), lineWidth: 1)
        drawing.stroke(circle(at: center, radius: geometry.labelRadius + 2.5), with: .color(armMetal.opacity(0.57)), lineWidth: 1.2)
    }

    private func drawTonearm(in drawing: GraphicsContext) {
        var context = drawing
        context.translateBy(x: geometry.center.x, y: geometry.center.y)
        context.scaleBy(x: geometry.tonearmScale, y: geometry.tonearmScale)
        context.translateBy(x: -TonearmProfile.discCenter.x, y: -TonearmProfile.discCenter.y)

        let pivot = TonearmProfile.pivot
        let shell = TonearmProfile.cartridge
        let metal = Gradient(stops: [
            .init(color: metalColor(0xEDEAF2), location: 0),
            .init(color: metalColor(0xACABB9), location: 0.43),
            .init(color: metalColor(0xCECBD8), location: 0.70),
            .init(color: metalColor(0xAAA6B6), location: 1)
        ])
        var arm = Path()
        arm.move(to: TonearmProfile.tubeStart)
        for bend in TonearmProfile.tube {
            arm.addCurve(to: bend.end, control1: bend.control1, control2: bend.control2)
        }
        var shade = context
        shade.addFilter(.shadow(color: .black.opacity(0.52), radius: 2.2, x: 1, y: 2.4))
        shade.stroke(arm, with: .color(metalColor(0x5A5366)), style: StrokeStyle(lineWidth: 4.3, lineCap: .round))
        context.stroke(arm, with: .linearGradient(metal, startPoint: pivot, endPoint: shell), style: StrokeStyle(lineWidth: 3.4, lineCap: .round))
        context.stroke(arm.offsetBy(dx: -0.58, dy: -0.20), with: .color(.white.opacity(0.36)), style: StrokeStyle(lineWidth: 0.64, lineCap: .round))

        func hub(_ radius: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: pivot.x - radius, y: pivot.y - radius, width: 2 * radius, height: 2 * radius))
        }
        shade.fill(hub(7.6), with: .color(metalColor(0x15131B)))
        context.fill(hub(6.7), with: .linearGradient(metal, startPoint: CGPoint(x: 290, y: 17), endPoint: CGPoint(x: 298, y: 31)))
        context.fill(hub(4.75), with: .linearGradient(Gradient(colors: [metalColor(0x776E84), metalColor(0x3D3549)]), startPoint: CGPoint(x: 291, y: 20), endPoint: CGPoint(x: 296, y: 29)))
        context.stroke(hub(4.75), with: .color(.white.opacity(0.20)), lineWidth: 0.50)
        context.fill(Path(roundedRect: CGRect(x: 292.8, y: 23.65, width: 2.4, height: 0.7), cornerRadius: 0.33), with: .color(metalColor(0xB4ACBE)))

        var head = context
        head.translateBy(x: shell.x, y: shell.y)
        head.rotate(by: .degrees(TonearmProfile.needleAngle))
        head.fill(Path(ellipseIn: CGRect(x: -4.5, y: 11, width: 9, height: 4)), with: .color(.black.opacity(0.48)))
        var cantilever = Path()
        cantilever.move(to: CGPoint(x: -0.25, y: 6.8))
        cantilever.addLine(to: TonearmProfile.needleEnd)
        head.stroke(cantilever, with: .color(metalColor(0xC3B7CC)), style: StrokeStyle(lineWidth: 1.12, lineCap: .round))
        head.fill(circle(at: TonearmProfile.needleEnd, radius: 0.61), with: .color(metalColor(0xFFF1FC)))
        var body = Path()
        body.move(to: CGPoint(x: -2.55, y: -4.9))
        body.addQuadCurve(to: CGPoint(x: -3.65, y: -3.8), control: CGPoint(x: -3.55, y: -5))
        body.addLine(to: CGPoint(x: -3.35, y: 4.4))
        body.addQuadCurve(to: CGPoint(x: -2.55, y: 5.8), control: CGPoint(x: -3.25, y: 5.2))
        body.addLine(to: CGPoint(x: 1.95, y: 8.15))
        body.addQuadCurve(to: CGPoint(x: 3.15, y: 7.4), control: CGPoint(x: 3.12, y: 8.6))
        body.addLine(to: CGPoint(x: 3.75, y: -3.55))
        body.addQuadCurve(to: CGPoint(x: 2.85, y: -4.9), control: CGPoint(x: 3.8, y: -4.82))
        body.closeSubpath()
        head.fill(body.offsetBy(dx: 0.65, dy: 1.35), with: .color(.black.opacity(0.63)))
        head.fill(body, with: .linearGradient(metal, startPoint: CGPoint(x: -4, y: -4), endPoint: CGPoint(x: 4, y: 7)))
        head.stroke(body, with: .color(metalColor(0xF4EBFA).opacity(0.70)), lineWidth: 0.42)
        var seam = Path()
        seam.move(to: CGPoint(x: -3.2, y: 4.2))
        seam.addLine(to: CGPoint(x: 3.25, y: 6.95))
        head.stroke(seam, with: .color(metalColor(0x7D526D).opacity(0.92)), lineWidth: 0.86)
        head.fill(Path(ellipseIn: CGRect(x: -0.68, y: -1.4, width: 1.36, height: 1.36)), with: .color(metalColor(0x60576A)))
    }

    private var armMetal: Color { Color(red: 0.83, green: 0.77, blue: 0.92) }

    private func metalColor(_ hex: UInt32) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255, opacity: 1)
    }

    private func circle(at point: CGPoint, radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: 2 * radius, height: 2 * radius))
    }
}

private struct RecordLabel: View {
    let artwork: URL?
    let size: CGFloat
    let playing: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var rotation = RecordLabelRotation()

    private var spinning: Bool { playing && !reduceMotion && scenePhase == .active }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !spinning)) { _ in
            ArtworkTile(artwork: artwork, size: size)
                .clipShape(Circle())
                .rotationEffect(.degrees(rotation.degrees(at: .now)))
        }
        .onChange(of: spinning, initial: true) { _, running in
            rotation.setRunning(running, at: .now)
        }
    }
}
