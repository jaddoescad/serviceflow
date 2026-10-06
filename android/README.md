# ServiceFlow for Android (native)

The Kotlin / Jetpack Compose crew app, a feature-for-feature port of the native
iOS app in `ios/` with Material 3 components. It will replace the React Native
build (`mobile/`) on Google Play under the same listing (application id
`com.ottawapainters.app`); until it is released, `mobile/` is still what ships.

## Layout

```
android/
  core/   plain Kotlin/JVM port of ios/ServiceFlowKit: models, time tracker,
          offline queues, media upload queue, presentation rules
  app/    the app: Compose screens, Supabase (supabase-kt), fused location,
          CameraX, local notifications
```

`core` keeps the Swift type and member names, so a change on one platform can be
mirrored on the other. Its checks are the port of `ServiceFlowCoreChecks`:

```
cd android
./gradlew :core:test
```

## Building

1. JDK 17 and the Android SDK (`local.properties`: `sdk.dir=...`).
2. Add the Maps key to `android/local.properties` (git-ignored):
   `GOOGLE_MAPS_API_KEY_ANDROID=...`. Without it the Clock In map is blank.
3. `./gradlew :app:installDebug`. Debug builds use the id
   `com.ottawapainters.app.debug`, so they install beside the Play build.
4. Release: put the upload key in `local.properties`
   (`SERVICEFLOW_UPLOAD_STORE_FILE`, `SERVICEFLOW_UPLOAD_STORE_PASSWORD`,
   `SERVICEFLOW_UPLOAD_KEY_ALIAS`, `SERVICEFLOW_UPLOAD_KEY_PASSWORD`), bump
   `versionCode`/`versionName` in `app/build.gradle.kts` above what Play has,
   then `./gradlew :app:bundleRelease`. Follow `mobile/AGENTS.md` release
   verification: launch the minified release build before submitting.

## How it works

The same rules as iOS (see `ios/README.md`):

- `TimeTracker` (core) owns shift state; every change is saved locally and sent
  through the durable, ordered `CommandQueue`. The server is the source of truth
  and each refresh reconciles with it.
- Everything is stored per person under `files/ServiceFlow/users/<user id>/`.
- Location is foreground only: at clock-in, at clock-out and while the app is
  open during a shift. No background permission, no foreground service. The
  permission is requested only from a Clock In tap; clocking in works without it.
- Notification permission (Android 13+) is asked once, after the first clock-in.
  Shift reminders are local alarms. Remote push is not registered: the server
  only delivers Expo tokens.
- Media uploads are persisted and sent one at a time with an `x-upload-id`
  idempotency key; photo notes and drawings use the same server functions and
  format as iOS and the web admin.
