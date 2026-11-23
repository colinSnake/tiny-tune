import Domain
import Foundation

struct PlaybackSnapshot: Codable, Equatable {
    private static let supportedVersion = 2

    let queue: PlaybackQueue
    let position: Double
    let repeatMode: RepeatMode
    let ended: Bool

    private enum CodingKeys: String, CodingKey {
        case version, queue, ids, currentID, position, repeatMode, ended
    }

    init(queue: PlaybackQueue, position: Double, repeatMode: RepeatMode, ended: Bool = false) {
        self.queue = queue
        self.position = position
        self.repeatMode = repeatMode
        self.ended = ended
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let version = try values.decode(Int.self, forKey: .version)
        switch version {
        case 1:
            let ids = try values.decode([UUID].self, forKey: .ids)
            let current = try values.decodeIfPresent(UUID.self, forKey: .currentID)
            guard let legacy = PlaybackQueue(legacyIDs: ids, current: current) else {
                throw DecodingError.dataCorruptedError(forKey: .ids, in: values, debugDescription: "Invalid legacy queue")
            }
            queue = legacy
        case Self.supportedVersion:
            queue = try values.decode(PlaybackQueue.self, forKey: .queue)
        default:
            throw DecodingError.dataCorruptedError(forKey: .version, in: values, debugDescription: "Unsupported checkpoint version")
        }
        position = try values.decode(Double.self, forKey: .position)
        repeatMode = try values.decode(RepeatMode.self, forKey: .repeatMode)
        ended = try values.decode(Bool.self, forKey: .ended)
    }

    func encode(to encoder: any Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(Self.supportedVersion, forKey: .version)
        try values.encode(queue, forKey: .queue)
        try values.encode(position, forKey: .position)
        try values.encode(repeatMode, forKey: .repeatMode)
        try values.encode(ended, forKey: .ended)
    }

    var isValid: Bool {
        position.isFinite && position >= 0 && (queue.current != nil || (position == 0 && !ended))
    }
}

/// A container-local checkpoint. The library remains the only source of paths and authorizations.
struct PlaybackSnapshotStore {
    private enum StoreError: Error { case invalidSnapshot }

    let url: URL

    static var local: Self {
        .init(url: URL.applicationSupportDirectory
            .appendingPathComponent("Tinytune", isDirectory: true)
            .appendingPathComponent("PlaybackSnapshot.json", isDirectory: false))
    }

    func load() throws -> PlaybackSnapshot? {
        let data: Data
        do { data = try Data(contentsOf: url) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
        let snapshot = try JSONDecoder().decode(PlaybackSnapshot.self, from: data)
        return snapshot.isValid ? snapshot : nil
    }

    func save(_ snapshot: PlaybackSnapshot) throws {
        guard snapshot.isValid else { throw StoreError.invalidSnapshot }
        let data = try JSONEncoder().encode(snapshot)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}
