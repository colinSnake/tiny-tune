import Foundation

public enum RepeatMode: String, Codable, CaseIterable, Sendable { case off, all, one }

/// One playback sequence anchored to a snapshot of its source order.
public struct PlaybackQueue: Codable, Equatable, Sendable {
    private static let historyLimit = 4_096

    public private(set) var ids: [UUID]
    public private(set) var current: UUID?
    public private(set) var history: [UUID]
    public private(set) var isShuffled: Bool
    private var pending: [UUID]
    // Stack, nearest replay item last. Separate from pending so rewinding doesn't drain a new round.
    private var replay: [UUID]

    public init(ids: [UUID] = [], start: UUID? = nil) {
        var seen = Set<UUID>()
        let order = ids.filter { seen.insert($0).inserted }
        self.ids = order
        let index = start.flatMap { order.firstIndex(of: $0) } ?? order.indices.first
        current = index.map { order[$0] }
        pending = index.map { Array(order.dropFirst($0 + 1)) } ?? []
        history = []
        replay = []
        isShuffled = false
    }

    /// Version 1 knew only the source order and cursor; it cannot recover actual history.
    public init?(legacyIDs ids: [UUID], current: UUID?) {
        let members = Set(ids)
        guard members.count == ids.count else { return nil }
        if let current {
            guard members.contains(current) else { return nil }
            self.init(ids: ids, start: current)
        } else {
            self.init(ids: ids)
            self.current = nil
            pending = ids
        }
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        ids = try values.decode([UUID].self, forKey: .ids)
        current = try values.decodeIfPresent(UUID.self, forKey: .current)
        pending = try values.decode([UUID].self, forKey: .pending)
        replay = try values.decode([UUID].self, forKey: .replay)
        history = try values.decode([UUID].self, forKey: .history)
        isShuffled = try values.decode(Bool.self, forKey: .isShuffled)
        let members = Set(ids)
        let future = Set(pending)
        let roundAnchor = replay.first ?? current
        guard ids.count == members.count, pending.count == future.count, future.isSubset(of: members),
              history.count + replay.count <= Self.historyLimit,
              Self.validPath(history, within: members), Self.validPath(replay, within: members),
              current.map({ members.contains($0) && history.last != $0 && replay.last != $0 })
                ?? (history.isEmpty && replay.isEmpty && future == members),
              roundAnchor.map({ !future.contains($0) }) ?? true else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid playback queue"))
        }
    }

    public var hasPrevious: Bool { !history.isEmpty }

    public var upcoming: [UUID] {
        guard !replay.isEmpty else { return pending }
        // One actionable row per song. Next still follows every recorded replay transition.
        var seen = Set<UUID>()
        if let current { seen.insert(current) }
        return (replay.reversed() + pending).filter { seen.insert($0).inserted }
    }

    public func canAdvance(mode: RepeatMode) -> Bool {
        !replay.isEmpty || !pending.isEmpty || (mode == .all && current != nil)
    }

    public mutating func setShuffle(_ enabled: Bool) {
        var rng = SystemRandomNumberGenerator()
        setShuffle(enabled, using: &rng)
    }

    public mutating func setShuffle(_ enabled: Bool, using rng: inout some RandomNumberGenerator) {
        guard isShuffled != enabled else { return }
        isShuffled = enabled
        replay = []
        if enabled {
            pending = ids.filter { $0 != current }.shuffled(using: &rng)
        } else if let current, let index = ids.firstIndex(of: current) {
            pending = Array(ids.dropFirst(index + 1))
        } else {
            pending = ids
        }
    }

    /// Switch the pending sequence to a new collection while retaining reachable playback history.
    package func replacingSourceOrder(with ids: [UUID]) -> PlaybackQueue? {
        guard let current, ids.contains(current) else { return nil }
        var replacement = PlaybackQueue(ids: ids, start: current)
        let missing = Set(history).subtracting(replacement.ids)
        replacement.history = Self.prunedPath(history, removing: missing, adjacentTo: current)
        replacement.setShuffle(isShuffled)
        return replacement
    }

    @discardableResult
    public mutating func advance(mode: RepeatMode, automatic: Bool) -> UUID? {
        var rng = SystemRandomNumberGenerator()
        return advance(mode: mode, automatic: automatic, using: &rng)
    }

    @discardableResult
    public mutating func advance(mode: RepeatMode, automatic: Bool, using rng: inout some RandomNumberGenerator) -> UUID? {
        var navigation = Navigation(self, direction: automatic ? .automatic : .next, mode: mode)
        guard let id = navigation.next(using: &rng), let selected = navigation.selectedQueue() else { return nil }
        self = selected
        return id
    }

    public mutating func previous() -> UUID? {
        var navigation = Navigation(self, direction: .previous, mode: .off)
        guard let id = navigation.next(), let selected = navigation.selectedQueue() else { return nil }
        self = selected
        return id
    }

    package enum Direction: Sendable { case next, previous, automatic }

    /// A transient cursor. The source queue remains unchanged until a playable candidate is accepted.
    package struct Navigation {
        private let source: PlaybackQueue
        private let direction: Direction
        private let mode: RepeatMode
        private var offset = 0
        private var wrapped: [UUID]?
        private var attempted = Set<UUID>()
        private var removed = Set<UUID>()
        private var selection: (UUID, Destination)?

        private enum Destination {
            case current, history(Int), replay(Int), pending(Int), wrapped(Int)
        }

        package init(_ source: PlaybackQueue, direction: Direction, mode: RepeatMode) {
            self.source = source
            self.direction = direction
            self.mode = mode
        }

        package var selectedID: UUID? { selection?.0 }

        package mutating func removeTracks(_ ids: Set<UUID>) {
            // Keep cursor offsets anchored to the original queue until a candidate commits.
            removed.formUnion(ids)
        }

        package mutating func next() -> UUID? {
            var rng = SystemRandomNumberGenerator()
            return next(using: &rng)
        }

        mutating func next(using rng: inout some RandomNumberGenerator) -> UUID? {
            selection = nil
            while let candidate = candidate(using: &rng) {
                offset += 1
                guard !removed.contains(candidate.0), attempted.insert(candidate.0).inserted else { continue }
                if direction == .previous, candidate.0 == source.current { continue }
                selection = candidate
                return candidate.0
            }
            return nil
        }

        private mutating func candidate(using rng: inout some RandomNumberGenerator) -> (UUID, Destination)? {
            if direction == .previous {
                let index = source.history.count - 1 - offset
                return index >= 0 ? (source.history[index], .history(index)) : nil
            }
            if direction == .automatic, mode == .one, let current = source.current {
                return offset == 0 ? (current, .current) : nil
            }
            let replayIndex = source.replay.count - 1 - offset
            if replayIndex >= 0 { return (source.replay[replayIndex], .replay(replayIndex)) }
            let pendingIndex = offset - source.replay.count
            if pendingIndex < source.pending.count { return (source.pending[pendingIndex], .pending(pendingIndex)) }
            guard mode == .all, source.current != nil else { return nil }
            if wrapped == nil { wrapped = source.loopOrder(using: &rng) }
            let index = pendingIndex - source.pending.count
            guard let wrapped, index < wrapped.count else { return nil }
            return (wrapped[index], .wrapped(index))
        }

        package func selectedQueue() -> PlaybackQueue? {
            guard let (id, destination) = selection, !removed.contains(id) else { return nil }
            var result = source
            switch destination {
            case .current: break
            case .history(let index):
                result.history.removeLast(result.history.count - index)
                if let current = source.current { result.replay.append(current) }
                result.current = id
            case .replay(let index):
                result.replay.removeLast(result.replay.count - index)
                result.select(id)
            case .pending(let index):
                result.replay = []
                result.pending.removeFirst(index + 1)
                result.select(id)
            case .wrapped(let index):
                result.replay = []
                result.pending = Array((wrapped ?? []).dropFirst(index + 1))
                result.select(id)
            }
            result.removeTracks(removed)
            return result
        }
    }

    private func loopOrder(using rng: inout some RandomNumberGenerator) -> [UUID] {
        var round = ids
        if isShuffled {
            round.shuffle(using: &rng)
            if round.count > 1 && round.first == current {
                round.swapAt(0, Int.random(in: 1..<round.count, using: &rng))
            }
        }
        return round
    }

    public mutating func jump(to id: UUID) -> Bool {
        guard id != current else { return false }
        if let index = replay.lastIndex(of: id) {
            replay.removeLast(replay.count - index)
        } else if let index = pending.firstIndex(of: id) {
            replay = []
            pending.removeFirst(index + 1)
        } else { return false }
        select(id)
        return true
    }

    public mutating func removeUpcoming(_ id: UUID) {
        guard upcoming.contains(id) else { return }
        removeTracks([id])
    }

    public mutating func removeTracks(_ removed: Set<UUID>) {
        guard !removed.isEmpty else { return }
        if let current, removed.contains(current) {
            // A removed current track leaves only its effective unplayed tail.
            pending = upcoming.filter { !removed.contains($0) }
            let retained = Set(pending)
            ids.removeAll { !retained.contains($0) }
            self.current = nil
            history = []
            replay = []
        } else {
            ids.removeAll { removed.contains($0) }
            pending.removeAll { removed.contains($0) }
            history = Self.prunedPath(history, removing: removed, adjacentTo: current)
            replay = Self.prunedPath(replay, removing: removed, adjacentTo: current)
            if let anchor = replay.first ?? current { pending.removeAll { $0 == anchor } }
        }
    }

    private static func validPath(_ path: [UUID], within members: Set<UUID>) -> Bool {
        path.allSatisfy { members.contains($0) } && zip(path, path.dropFirst()).allSatisfy { $0 != $1 }
    }

    private static func prunedPath(_ path: [UUID], removing removed: Set<UUID>, adjacentTo current: UUID?) -> [UUID] {
        guard path.contains(where: { removed.contains($0) }) else { return path }
        var retained: [UUID] = []
        for id in path where !removed.contains(id) && retained.last != id { retained.append(id) }
        if let current, retained.last == current { retained.removeLast() }
        return retained
    }

    private mutating func select(_ id: UUID) {
        if let current, current != id {
            history.append(current)
            if history.count > Self.historyLimit { history.removeFirst() }
        }
        current = id
    }
}
