const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const sourcePath = path.join(__dirname, "../src/lib/locationTrackingPolicy.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const policy = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const stateSource = fs.readFileSync(
    path.join(__dirname, "../src/lib/timeTrackingState.js"),
    "utf8",
  );
  const state = await import(
    `data:text/javascript;base64,${Buffer.from(stateSource).toString("base64")}`
  );
  const {
    TRACKING_MODE,
    freshnessForTimestamp,
    freshnessForTrackingStatus,
    shouldRecordLocation,
    splitRouteSegments,
    trackingEventId,
    updateStationaryState,
  } = policy;

  const baseTime = Date.parse("2026-07-13T12:00:00.000Z");
  const point = (latitude, longitude, elapsedMs = 0, accuracy = 20) => ({
    latitude,
    longitude,
    accuracy,
    capturedAt: new Date(baseTime + elapsedMs).toISOString(),
  });

  assert.equal(
    shouldRecordLocation(point(45.42, -75.69), point(45.42005, -75.69, 30_000), TRACKING_MODE.TRAVEL),
    false,
    "travel jitter should not create a route point",
  );
  assert.equal(
    shouldRecordLocation(point(45.42, -75.69), point(45.4212, -75.69, 60_000), TRACKING_MODE.TRAVEL),
    true,
    "meaningful travel distance should create a route point",
  );
  assert.equal(
    shouldRecordLocation(point(45.42, -75.69), point(45.42001, -75.69, 4 * 60_000), TRACKING_MODE.TRAVEL),
    true,
    "travel heartbeat should be recorded after the maximum gap",
  );
  assert.equal(
    shouldRecordLocation(null, point(45.42, -75.69, 0, 400), TRACKING_MODE.TRAVEL),
    false,
    "very inaccurate automatic points should be rejected",
  );
  assert.equal(
    shouldRecordLocation(point(45.42, -75.69), point(45.42, -75.69, 1_000, 400), TRACKING_MODE.TRAVEL, "clock_out"),
    true,
    "explicit lifecycle events should be retained",
  );

  let stationary = updateStationaryState(null, point(45.42, -75.69), TRACKING_MODE.TRAVEL);
  stationary = updateStationaryState(stationary, point(45.4201, -75.69, 2 * 60_000), TRACKING_MODE.TRAVEL);
  assert.equal(stationary.stationary, false, "a short traffic stop must not switch modes");
  stationary = updateStationaryState(stationary, point(45.4201, -75.69, 3 * 60_000), TRACKING_MODE.TRAVEL);
  assert.equal(stationary.stationary, true, "three stationary minutes should enter low-power mode");

  const routeSegments = splitRouteSegments([
    point(45.42, -75.69, 0),
    point(45.421, -75.69, 2 * 60_000),
    point(45.43, -75.70, 20 * 60_000),
  ]);
  assert.equal(routeSegments.length, 2, "a 15+ minute tracking gap should split the route");

  assert.equal(freshnessForTimestamp(new Date(baseTime - 4 * 60_000).toISOString(), baseTime).level, "fresh");
  assert.equal(freshnessForTimestamp(new Date(baseTime - 10 * 60_000).toISOString(), baseTime).level, "aging");
  assert.equal(freshnessForTimestamp(new Date(baseTime - 16 * 60_000).toISOString(), baseTime).level, "stale");
  assert.equal(
    freshnessForTrackingStatus({
      last_location_at: new Date(baseTime - 2 * 60 * 60_000).toISOString(),
      tracking_mode: TRACKING_MODE.PAINTING,
      task_status: "geofence",
    }, baseTime).level,
    "stationary",
    "low-power painting mode should not be presented as a failed live tracker",
  );

  assert.match(
    trackingEventId({ localId: "shift-1" }, point(45.42, -75.69), "clock_in"),
    /^shift-1:.*:clock_in$/,
  );

  const shift = { localId: "shift-1", startedAt: "2026-07-14T13:00:00.000Z" };
  const started = state.startShiftInStore(null, shift);
  assert.equal(started.applied, true, "a new shift should claim the active slot");

  const completedEntry = {
    ...shift,
    endedAt: "2026-07-14T22:00:00.000Z",
    clockOutReason: "manual",
  };
  const closed = state.closeShiftInStore(started.store, shift, completedEntry);
  assert.equal(closed.store.activeShift, null, "clock-out should clear the active slot atomically");
  assert.deepEqual(closed.store.closedShiftIds, ["shift-1"]);

  const staleBackgroundWrite = state.updateActiveShiftInStore(
    closed.store,
    shift,
    { ...shift, lastLocation: point(45.42, -75.69, 60_000) },
  );
  assert.equal(
    staleBackgroundWrite.applied,
    false,
    "a background snapshot must not resurrect a closed shift",
  );
  assert.equal(staleBackgroundWrite.store.activeShift, null);
  assert.equal(
    state.startShiftInStore(closed.store, shift).applied,
    false,
    "a closed session id must never be reused",
  );

  const nextShift = { localId: "shift-2", startedAt: "2026-07-15T13:00:00.000Z" };
  const switched = state.switchShiftInStore(started.store, shift, nextShift, completedEntry);
  assert.equal(switched.applied, true);
  assert.equal(switched.store.activeShift.localId, "shift-2");
  assert.equal(
    state.updateActiveShiftInStore(switched.store, shift, shift).applied,
    false,
    "an old project session must not overwrite the new active session",
  );

  const queuedComplete = { action: "complete", payload: { status: "complete" } };
  const queuedActive = { action: "patch_active", payload: { status: "active" } };
  assert.equal(
    state.chooseQueuedWrite(queuedComplete, queuedActive),
    queuedComplete,
    "a delayed active write must not replace a queued completion",
  );
  assert.equal(
    state.chooseQueuedWrite(
      { action: "clock_out", payload: { client_entry_id: "shift-1" } },
      { action: "clock_in", payload: { client_entry_id: "shift-1" } },
    ).action,
    "clock_out",
    "the backend clock-out command must outrank a delayed clock-in command",
  );
  assert.equal(
    state.queuedWriteIntent({ action: "switch" }),
    "complete",
    "a project switch is terminal for the previous session",
  );
  assert.notEqual(
    state.queuedWriteGroup({ action: "adjust" }),
    state.queuedWriteGroup({ action: "clock_out" }),
    "an offline edit and clock-out must remain separate queued commands",
  );
  assert.notEqual(
    state.queuedWriteGroup({ action: "delete" }),
    state.queuedWriteGroup({ action: "switch" }),
    "deleting the old entry must not discard a queued project switch",
  );

  const regions = [{
    identifier: "active:job-1",
    latitude: 45.42,
    longitude: -75.69,
    radius: 160,
    notifyOnEnter: true,
    notifyOnExit: true,
  }];
  assert.equal(
    state.trackingRegionsSignature(regions),
    state.trackingRegionsSignature(regions.map((region) => ({ ...region }))),
  );
  assert.notEqual(
    state.trackingRegionsSignature(regions),
    state.trackingRegionsSignature([{ ...regions[0], radius: 200 }]),
  );

  const repositorySource = fs.readFileSync(
    path.join(__dirname, "../src/lib/timeEntryRepository.js"),
    "utf8",
  );
  assert.doesNotMatch(
    repositorySource,
    /from\(["']time_entries["']\)\.(?:insert|update|upsert|delete)\(/,
    "the mobile repository must not mutate time_entries directly",
  );
  for (const rpcName of [
    "clock_in_time_entry",
    "clock_out_time_entry",
    "switch_time_entry",
    "record_time_entry_observation",
    "adjust_time_entry",
    "delete_time_entry",
  ]) {
    assert.match(repositorySource, new RegExp(`rpc\\(["']${rpcName}["']`));
  }

  const migrationSource = fs.readFileSync(
    path.join(
      __dirname,
      "../supabase/migrations/20260715150000_authoritative_time_entry_commands.sql",
    ),
    "utf8",
  );
  assert.match(migrationSource, /time_entries_one_active_per_user_idx/);
  assert.match(migrationSource, /Compatibility window:/);
  assert.match(migrationSource, /time_entry_lifecycle_events/);
  const observationFunction = migrationSource.slice(
    migrationSource.indexOf("create or replace function public.record_time_entry_observation"),
    migrationSource.indexOf("create or replace function public.adjust_time_entry"),
  );
  assert.doesNotMatch(
    observationFunction,
    /set\s+(?:started_at|ended_at|status)\s*=/i,
    "the GPS observation RPC must not update lifecycle columns",
  );

  console.log("Location tracking and shift lifecycle checks passed.");
}
