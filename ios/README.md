# ServiceFlow for iOS (native)

The SwiftUI crew app. It replaces the React Native build on the App Store under
the same listing (bundle id `com.ottawapainters.app`, App Store Connect app
`6787451069`). Its Android counterpart is `android/` (see `android/README.md`).

## Layout

```
ios/
  project.yml            XcodeGen spec (the .xcodeproj is generated, not committed)
  Config/App.xcconfig    Supabase URL, publishable key, media Worker URL
  ServiceFlow/           the app: SwiftUI views, Supabase, CoreLocation, camera
  ServiceFlowKit/        Foundation-only core: models, time tracker, offline queues
  spec/                  behaviour spec of the RN app this replaces
```

`ServiceFlowKit` holds everything that can be reasoned about without a device.
It builds and runs its checks on macOS:

```
cd ios/ServiceFlowKit
swift run ServiceFlowCoreChecks
```

## Building

1. Install Xcode and `brew install xcodegen`.
2. Put your team in `ios/Config/Signing.xcconfig` (git-ignored):
   `DEVELOPMENT_TEAM = XXXXXXXXXX`
3. `cd ios && xcodegen` and open `ServiceFlow.xcodeproj`.
4. Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `project.yml` above
   what App Store Connect has before archiving.

## How it works

- **One owner of shift state.** `TimeTracker` (core) applies every clock-in,
  clock-out, switch, edit and delete locally, saves it, then sends it through
  the durable `CommandQueue`. Commands for the same entry are sent strictly in
  order; permanent refusals are dropped and shown instead of retried forever.
- **The server is the source of truth.** Each refresh loads the person's own
  `time_entries` (by `employee_id`) and reconciles: shifts ended by a manager
  close on the device, a shift started elsewhere is adopted, and locally
  closed shifts can't be revived by a stale read.
- **Entry ids are known up front.** New entries use a UUID client id that the
  server also uses as the row id, so location points always carry their
  `time_entry_id`.
- **Per-person storage.** Everything is stored under
  `Application Support/ServiceFlow/users/<user id>/`, so another account on the
  same phone never sees or inherits a shift.
- **Media uploads survive restarts.** Captures are moved into the user's media
  folder and uploaded one at a time with an `x-upload-id` idempotency key;
  video posters are uploaded too.

## App Store review (July 2026 rejection)

- **2.5.4:** no `UIBackgroundModes`. Location is recorded at clock-in, at
  clock-out and while the app is open during a shift; it stops when the app
  goes to the background.
- **5.1.1(iv):** location permission is requested only from a Clock In tap,
  with no pre-prompt. Clocking in works without location, so a declined
  prompt is never followed by a nag or a Settings redirect. Notification
  permission is asked once, after the first clock-in.
- **5.1.1(v):** More → Delete account (also on the onboarding screen).
- **3.2:** anyone can create a company (any trade) or join one with an invite
  code; no single-business branding or copy.
- **2.3.10:** take screenshots from this build on an iPhone 6.9" and iPad 13"
  simulator.

## Deliberate differences from the RN app

The RN behaviour is described in `spec/`; these were bugs or App Store problems:

| RN | Native |
|---|---|
| Own history filtered on a `user_id` column that doesn't exist, so the timesheet only showed this device's entries | Filters on `employee_id`; full history from the server |
| Offline clock-in + clock-out overwrote each other in the queue; the shift never reached the server | Separate, ordered commands |
| Reconciled on `status == "complete"` (server writes `completed`) | Checks `completed` |
| Shift and queue not tied to the user | Per-user storage; sign-out asks what to do with a running shift |
| Upload queue in memory, no idempotency key, posters never sent | Persisted queue, `x-upload-id`, posters uploaded |
| Team Map showed crew locations | Team Map removed |
| "Change Project" on a time edit never saved on the server | Removed |
| 8 h / 10 h reminder re-fired on every cold launch | Only future reminders are scheduled |
| Delete photo said "permanently" (it goes to a recoverable trash) | Copy fixed |
