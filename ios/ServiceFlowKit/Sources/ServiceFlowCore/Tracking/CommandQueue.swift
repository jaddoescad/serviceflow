import Foundation

/// A time-entry command waiting to reach the server.
public struct QueuedCommand: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var action: TimeEntryAction
    /// Entries this command touches (a switch touches the old and the new one).
    public var entryIds: [String]
    public var command: JSONValue
    public var nextCommand: JSONValue?
    public var createdAt: Date
    public var attempts: Int
    public var lastError: String?

    public init(id: UUID = UUID(), action: TimeEntryAction, entryIds: [String], command: JSONValue,
                nextCommand: JSONValue? = nil, createdAt: Date) {
        self.id = id
        self.action = action
        self.entryIds = entryIds
        self.command = command
        self.nextCommand = nextCommand
        self.createdAt = createdAt
        attempts = 0
        lastError = nil
    }

    func touches(_ entryId: String) -> Bool { entryIds.contains(entryId) }
}

/// Result of sending one queued command.
public struct CommandOutcome: Sendable {
    public var command: QueuedCommand
    public var response: JSONValue?
    /// Set when the server refused the command for good; it has been dropped.
    public var permanentError: BackendError?
}

/// The durable, ordered queue of time-entry commands.
///
/// Every lifecycle step is its own command and commands for the same entry
/// are sent strictly in order: a clock-out never goes before its clock-in.
/// A command that fails for a transient reason stays queued and holds back
/// the later commands for its entries; one the server refuses for good is
/// dropped and reported, so it can't block the queue forever.
public actor CommandQueue {
    private let store: JSONFileStore<[QueuedCommand]>
    private var commands: [QueuedCommand]
    private var flushing = false

    public init(store: JSONFileStore<[QueuedCommand]>) {
        self.store = store
        commands = store.load() ?? []
    }

    public var pending: [QueuedCommand] { commands }
    public var isEmpty: Bool { commands.isEmpty }

    /// Entry ids with a queued delete; fetched rows for them are hidden.
    public var pendingDeletionIds: Set<String> {
        Set(commands.filter { $0.action == .delete }.flatMap(\.entryIds))
    }

    /// Entry ids whose clock-in has not reached the server yet.
    public var unacknowledgedEntryIds: Set<String> {
        Set(commands.filter { $0.action == .clockIn }.flatMap(\.entryIds)
            + commands.filter { $0.action == .switchProject }.compactMap { $0.entryIds.last })
    }

    public func enqueue(_ command: QueuedCommand) {
        switch command.action {
        case .adjust:
            // The latest edit carries the full values; an older unsent edit
            // for the same entry is superseded.
            commands.removeAll { $0.action == .adjust && $0.entryIds == command.entryIds }
            commands.append(command)
        case .delete:
            let entryId = command.entryIds.first ?? ""
            let related = commands.filter { $0.touches(entryId) }
            let neverSent = related.contains { $0.action == .clockIn } && related.allSatisfy { $0.entryIds == [entryId] }
            commands.removeAll { $0.touches(entryId) && $0.entryIds == [entryId] && ($0.action == .adjust || neverSent) }
            // An entry that never reached the server needs no delete.
            if !neverSent { commands.append(command) }
        default:
            commands.append(command)
        }
        persist()
    }

    /// Sends queued commands in order. Returns what happened to each one sent.
    public func flush(using send: @Sendable (QueuedCommand) async throws -> JSONValue) async -> [CommandOutcome] {
        guard !flushing else { return [] }
        flushing = true
        defer { flushing = false }

        var outcomes: [CommandOutcome] = []
        var blockedEntries = Set<String>()
        for queued in commands {
            if !blockedEntries.isDisjoint(with: queued.entryIds) { continue }
            do {
                let response = try await send(queued)
                remove(queued.id)
                outcomes.append(CommandOutcome(command: queued, response: response))
            } catch {
                let failure = BackendError.from(error)
                if failure.isRetryable {
                    markFailed(queued.id, message: failure.message)
                    blockedEntries.formUnion(queued.entryIds)
                    if case .offline = failure { break }
                } else {
                    remove(queued.id)
                    outcomes.append(CommandOutcome(command: queued, response: nil, permanentError: failure))
                }
            }
        }
        return outcomes
    }

    public func removeAll() {
        commands.removeAll()
        persist()
    }

    private func remove(_ id: UUID) {
        commands.removeAll { $0.id == id }
        persist()
    }

    private func markFailed(_ id: UUID, message: String) {
        guard let index = commands.firstIndex(where: { $0.id == id }) else { return }
        commands[index].attempts += 1
        commands[index].lastError = message
        persist()
    }

    private func persist() { store.save(commands) }
}
