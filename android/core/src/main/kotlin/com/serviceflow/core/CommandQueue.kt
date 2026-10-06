package com.serviceflow.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

/** A time-entry command waiting to reach the server. */
@Serializable
data class QueuedCommand(
    @Serializable(with = UUIDSerializer::class) val id: UUID = UUID.randomUUID(),
    val action: TimeEntryAction,
    /** Entries this command touches (a switch touches the old and the new one). */
    val entryIds: List<String>,
    val command: JSONValue,
    val nextCommand: JSONValue? = null,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant,
    val attempts: Int = 0,
    val lastError: String? = null,
) {
    internal fun touches(entryId: String): Boolean = entryId in entryIds
}

/** Result of sending one queued command. */
data class CommandOutcome(
    val command: QueuedCommand,
    val response: JSONValue?,
    /** Set when the server refused the command for good; it has been dropped. */
    val permanentError: BackendError? = null,
)

/**
 * The durable, ordered queue of time-entry commands.
 *
 * Every lifecycle step is its own command and commands for the same entry
 * are sent strictly in order: a clock-out never goes before its clock-in.
 * A command that fails for a transient reason stays queued and holds back
 * the later commands for its entries; one the server refuses for good is
 * dropped and reported, so it can't block the queue forever.
 *
 * A Swift actor there; here a mutex guards each change. Like the actor, the
 * lock is not held while a command is on the network, so commands can be
 * queued during a flush. Reads return immutable snapshots.
 */
class CommandQueue(private val store: JSONFileStore<List<QueuedCommand>>) {
    private val mutex = Mutex()

    @Volatile
    private var commands: List<QueuedCommand> = store.load() ?: emptyList()

    @Volatile
    private var flushing = false

    val pending: List<QueuedCommand> get() = commands
    val isEmpty: Boolean get() = commands.isEmpty()

    /** Entry ids with a queued delete; fetched rows for them are hidden. */
    val pendingDeletionIds: Set<String>
        get() = commands.filter { it.action == TimeEntryAction.Delete }.flatMap { it.entryIds }.toSet()

    /** Entry ids whose clock-in has not reached the server yet. */
    val unacknowledgedEntryIds: Set<String>
        get() {
            val snapshot = commands
            return (snapshot.filter { it.action == TimeEntryAction.ClockIn }.flatMap { it.entryIds } +
                snapshot.filter { it.action == TimeEntryAction.SwitchProject }.mapNotNull { it.entryIds.lastOrNull() }).toSet()
        }

    suspend fun enqueue(command: QueuedCommand) = mutex.withLock {
        val list = commands.toMutableList()
        when (command.action) {
            TimeEntryAction.Adjust -> {
                // The latest edit carries the full values; an older unsent edit
                // for the same entry is superseded.
                list.removeAll { it.action == TimeEntryAction.Adjust && it.entryIds == command.entryIds }
                list.add(command)
            }
            TimeEntryAction.Delete -> {
                val entryId = command.entryIds.firstOrNull() ?: ""
                val related = list.filter { it.touches(entryId) }
                val neverSent = related.any { it.action == TimeEntryAction.ClockIn } && related.all { it.entryIds == listOf(entryId) }
                list.removeAll {
                    it.touches(entryId) && it.entryIds == listOf(entryId) && (it.action == TimeEntryAction.Adjust || neverSent)
                }
                // An entry that never reached the server needs no delete.
                if (!neverSent) list.add(command)
            }
            else -> list.add(command)
        }
        commands = list
        persist()
    }

    /** Sends queued commands in order. Returns what happened to each one sent. */
    suspend fun flush(send: suspend (QueuedCommand) -> JSONValue): List<CommandOutcome> {
        val snapshot = mutex.withLock {
            if (flushing) return emptyList()
            flushing = true
            commands
        }
        try {
            val outcomes = mutableListOf<CommandOutcome>()
            val blockedEntries = mutableSetOf<String>()
            for (queued in snapshot) {
                if (queued.entryIds.any { it in blockedEntries }) continue
                try {
                    val response = send(queued)
                    remove(queued.id)
                    outcomes.add(CommandOutcome(queued, response))
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    val failure = BackendError.from(error)
                    if (failure.isRetryable) {
                        markFailed(queued.id, failure.message)
                        blockedEntries.addAll(queued.entryIds)
                        if (failure is BackendError.Offline) break
                    } else {
                        remove(queued.id)
                        outcomes.add(CommandOutcome(queued, null, permanentError = failure))
                    }
                }
            }
            return outcomes
        } finally {
            flushing = false
        }
    }

    suspend fun removeAll() = mutex.withLock {
        commands = emptyList()
        persist()
    }

    private suspend fun remove(id: UUID) = mutex.withLock {
        commands = commands.filter { it.id != id }
        persist()
    }

    private suspend fun markFailed(id: UUID, message: String) = mutex.withLock {
        val index = commands.indexOfFirst { it.id == id }
        if (index < 0) return@withLock
        commands = commands.toMutableList().also { it[index] = it[index].copy(attempts = it[index].attempts + 1, lastError = message) }
        persist()
    }

    private fun persist() = store.save(commands)
}
