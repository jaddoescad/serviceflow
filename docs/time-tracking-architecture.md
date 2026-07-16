# Time-tracking architecture

## Ownership

- `timeTrackingState.js` defines the pure shift lifecycle transitions.
- `timeTrackingStorage.js` serializes local lifecycle and queue mutations.
- `timeTrackingRuntime.js` collects location data but may only update the
  currently stored session by matching its immutable `localId`.
- `timeEntryRepository.js` submits narrow commands and never mutates
  `time_entries` directly.
- Supabase/Postgres is the authoritative lifecycle owner. Authenticated RPCs
  serialize clock-in, clock-out, project switch, observation, adjustment, and
  deletion commands.
- `time_entry_lifecycle_events` retains the immutable clock-in/clock-out audit
  trail with both device-captured and server-received timestamps.

## Invariants

1. A shift session has one immutable `localId`.
2. Clock-out locks foreground location writes, serializes any in-flight write,
   stops continuous updates, and makes one bounded fresh-location attempt before
   the local terminal transition.
3. Clock-out adds the session to a bounded `closedShiftIds` tombstone list.
4. A background task may update a shift only when its `localId` still matches
   the active slot and is not tombstoned.
5. Starting a different project atomically closes the previous session and
   installs the next session.
6. A queued completion outranks queued active updates for the same session.
7. Supabase completion is first-write-wins. Repeating clock-out returns the
   existing canonical row rather than replacing `ended_at`.
8. Changing a completed row's lifecycle requires a new `adjustment_history`
   record, which distinguishes a deliberate edit from a stale retry.
9. The app clears a local active session when Supabase already has the same
   session completed.
10. An unchanged geofence region set is never re-registered.
11. An employee can have at most one active server entry.
12. GPS/geofence observations can update only location evidence; their RPC has
    no lifecycle columns in its update surface.
13. The command-based client never performs direct `INSERT`, `UPDATE`, or
    `DELETE` calls on `time_entries`; employee edits go through an ownership-
    checked, audited RPC.

## Clock-out order

1. Lock foreground location capture and capture one `endedAt` timestamp.
2. Wait for any foreground location mutation, then stop continuous background updates.
3. Attempt one fresh location capture with a bounded timeout. Record a
   `clock_out` point only when that capture succeeds; never re-timestamp a stale
   point as the clock-out location.
4. Atomically clear and tombstone the local active session.
5. Update React state and complete the Supabase row only if it is still active.
6. Use the row already in Supabase if another completion won.
7. Record terminal tracking status, remove geofences, and flush pending location data.

This order obtains the best available end-of-shift evidence without allowing a
stale point to masquerade as the clock-out location. The foreground lock,
serialized sensor shutdown, and local tombstone make late callbacks harmless:
they cannot restore the session, reopen the database row, or replace the
original clock-out time.

## Backend command boundary

- `clock_in_time_entry(command)` creates one idempotent active session using the
  authenticated user from the JWT.
- `clock_out_time_entry(command)` completes only an active session. The first
  accepted ending time is permanent unless a later audited adjustment is made.
- `switch_time_entry(clock_out_command, clock_in_command)` performs both
  transitions in one database transaction.
- `record_time_entry_observation(command)` updates only coordinates, distance,
  on-site state, and segments for a currently active session.
- `adjust_time_entry(command)` preserves employee editing while checking
  ownership/manager authority and generating adjustment history on the server.
- `delete_time_entry(command)` checks ownership; deleting another employee's
  entry requires an admin.

The phone remains responsible for sensors, UI, optimistic state, and the offline
command queue. Postgres decides whether a lifecycle transition is valid.

## Permission cutover

The owner-scoped legacy write policies remain temporarily enabled so already-
installed app versions continue working during rollout. The completed-entry
trigger prevents those clients from reopening or extending a closed shift. Once
the command-based release has been adopted, a separate migration must remove the
legacy insert/update/delete policies and table grants. Keeping that cutover out
of the initial migration avoids breaking employees on the previous build.
