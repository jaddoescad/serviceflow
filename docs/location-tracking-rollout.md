# Active-shift location tracking rollout

## What ships

- One user-started native location service that runs only during an active shift,
  plus a four-minute foreground heartbeat while the app is open.
- Balanced-accuracy updates with 50 m filtering and deferred 2-minute/100 m batches.
- Offline location queue with idempotent Supabase synchronization.
- Append-only daily route history and current tracking diagnostics.
- Manager Team Map on iOS, Android, and web.
- Eight-hour and ten-hour "Still clocked in?" reminders with a Clock Out action.
- Stale-travel alerts and 60-day route retention.

The app requests only foreground/When In Use authorization. Android keeps the
active shift alive with a visible foreground-service notification. iOS may
continue the user-started session in the background with its location indicator,
but a force-quit prevents delivery until the employee reopens the app. The app
does not register job-site geofences or monitor employees while clocked out.

## Controlled rollout

Set these build variables before creating the release:

```text
EXPO_PUBLIC_LOCATION_TRACKING_ENABLED=1
EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS=michael@example.com,bilal@example.com
```

Leave `EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS` empty after the pilot to enable location history for all employees. The pilot flag controls new route/status uploads.

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
- With the app open and stationary, confirm the manager status advances at least once within five minutes.
- Confirm the app reports painting mode and does not create repetitive route points while stationary.
- Leave the job and drive at least 2 km with the screen locked.
- Confirm travel points appear on the manager map within five minutes and route gaps are labeled.
- Stop for more than three minutes, then drive again and confirm the same active-shift service continues tracking.
- Repeat while offline, then reconnect and confirm queued points upload once without duplicates.
- Deny foreground location and confirm the rest of the app stays accessible while clock-in explains that location is required.
- Confirm no platform prompt offers or requests Always/Allow all the time access.
- Confirm the long-shift reminders are scheduled while clocked in and removed
  after clock-out or deletion of the active entry.
- Force-quit on iOS and confirm the map presents the location as old and the interruption alert asks the employee to reopen ServiceFlow.
- Force-stop on Android and confirm the same interruption behavior.
- Record Settings > Battery results for an eight-hour mostly-stationary shift and compare against the previous release.

Before any Google Play submission, install and launch the exact release artifact as required by `AGENTS.md`; a successful build alone is not a launch test.
