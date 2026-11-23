// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TinytuneKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: ["Domain", "Library", "Playback", "DesignSystem"].map {
        .library(name: $0, targets: [$0])
    },
    targets: [
        .target(name: "Domain"),
        .target(name: "Library", dependencies: ["Domain"]),
        .target(name: "Playback", dependencies: ["Domain"]),
        .target(name: "DesignSystem", dependencies: ["Domain"], resources: [.process("Resources")]),
        .testTarget(name: "DesignSystemTests", dependencies: ["DesignSystem"]),
        .testTarget(name: "DomainTests", dependencies: ["Domain"]),
        .testTarget(name: "LibraryTests", dependencies: ["Domain", "Library"]),
        .testTarget(name: "PlaybackTests", dependencies: ["Domain", "Playback"]),
    ]
)
