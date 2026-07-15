# Adaptive location tracking rollout

## What ships

- Low-power painting/stationary mode backed by geofences.
- Balanced-accuracy travel mode with 100 m filtering and deferred 2-minute/250 m batches.
- Offline location queue with idempotent Supabase synchronization.
- Append-only daily route history and current tracking diagnostics.
- Manager Team Map on iOS, Android, and web.
- Stale-travel alerts and 60-day route retention.

Tracking is active only while an employee is clocked in. An explicit iOS force-quit still prevents background delivery until the employee reopens the app.

## Controlled rollout

Set these build variables before creating the release:

```text
EXPO_PUBLIC_LOCATION_TRACKING_ENABLED=1
EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS=michael@example.com,bilal@example.com
```

Leave `EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS` empty after the pilot to enable location history for all employees. The adaptive battery-saving state machine remains the same; the pilot flag controls new route/status uploads.

## Supabase deployment

1. Reconcile local and remote migration history before pushing. Never repair migration history without confirming the missing migrations.
2. Apply migrations in order:
   - `20260713120000_create_employee_location_tracking.sql`
   - `20260713121000_create_stale_location_alerts.sql`
3. Set the Edge Function secret:

   ```sh
   supabase secrets set LOCATION_TRACKING_ALERT_CRON_SECRET=<long-random-secret>
   ```

4. Store the same value in Supabase Vault as `location_tracking_alert_cron_secret`. The existing `project_url` Vault secret is also required by the cron migration.
5. Deploy `stale-location-alerts`.
6. Run `npm run qa:rls` after the schema is live to verify painters cannot see or spoof another employee's locations.

## Physical-device pilot

Use signed builds on at least two iPhones and one Android device. For each device, verify:

- Clock in at a mapped job, lock the screen, and leave the phone stationary for at least one hour.
- Confirm the app reports painting mode and does not create repetitive route points.
- Leave the 160 m job geofence and drive at least 2 km with the screen locked.
- Confirm travel points appear on the manager map within five minutes and route gaps are labeled.
- Stop for more than three minutes, then drive again and confirm tracking resumes after leaving the stop geofence.
- Repeat while offline, then reconnect and confirm queued points upload once without duplicates.
- Change background permission and confirm diagnostics show the problem.
- Force-quit on iOS and confirm the map eventually presents the location as old rather than claiming it is live.
- Record Settings > Battery results for an eight-hour mostly-stationary shift and compare against the previous release.

Before any Google Play submission, install and launch the exact release artifact as required by `AGENTS.md`; a successful build alone is not a launch test.
