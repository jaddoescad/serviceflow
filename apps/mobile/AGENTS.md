# Agent Instructions

## Branch Policy

- Work on the current branch by default.
- Do not create a Git branch unless the user explicitly asks for one.

## Release Verification

Before submitting any Android build to Google Play, verify the release artifact can launch.

- Prefer installing the exact release build on a connected Android device or emulator and opening the app.
- If testing an AAB, generate/install APKs from that AAB or use another equivalent path that exercises the same signed release artifact.
- Confirm the app reaches the initial screen without crashing and that required production configuration is present, especially Supabase and Google Maps environment values.
- If no Android device/emulator is available, state that clearly before submitting, document the checks that were completed instead, and avoid claiming the app was runtime-tested.
- Do not treat a successful EAS build, `expo-doctor`, or Google Play submission as a launch test.

## Deploying

Three delivery paths. Pick by what changed.

### JavaScript-only changes — ship over the air

Anything under `src/` or `App.js` with no new native dependency:

```
eas update --branch <preview|pilot|production> --message "what changed"
```

Publish to **every** branch whose users should get it, and do **not** pass
`--platform` unless the change really is one-platform: an iOS-only publish
silently leaves Android on older code.

Channel map: `preview` is Jad's own build, `pilot` is the iOS TestFlight
build, `production` is the Google Play build. A device applies an update on
its *second* launch — the first downloads it in the background.

### Native changes — build, then bump the runtime

Adding or upgrading a native package, or changing anything under `ios/` or
`android/`, needs a new binary. **Bump `runtimeVersion` in `app.config.js`**
in the same commit. Updates only reach binaries with a matching
`runtimeVersion`, so skipping the bump lets an update land on a build whose
native code cannot run it — which crashes the app on launch.

iOS (EAS cloud iOS quota is limited; local builds avoid it):

```
eas build --platform ios --profile pilot --local
eas submit --platform ios --profile pilot --path <path-to-ipa>
```

Android, straight to the Play alpha track:

```
eas build --platform android --profile production
eas submit --platform android --profile production --path <path-to-aab>
```

Android submission is fully automated through a Google Play service account
(`eas-play-publisher@serviceflow-478921.iam.gserviceaccount.com`) whose key
lives at `./play-service-account.json`. That file is git-ignored and must
never be committed. It has "Release apps to testing tracks" and "Manage
testing tracks" for ServiceFlow only — deliberately not production release,
and no access to the other app on the account.

Do not use the Play Console web UI to upload builds: the browser file-upload
bridge caps at 10 MB and an app bundle is far larger.

### Local iOS builds

Never build iOS from this directory — the space in "Ottawa Painters App"
breaks Expo's build scripts. Clone to a path without spaces
(`~/.serviceflow-build` is the working copy), run `npm install` and
`eas env:pull --environment production` there, and build from that clone.

## Testers

Google Play closed testing (Alpha track) goes to the **ServiceFlow painters**
email list. Testers must use the Google account their phone's Play Store is
signed into, which is not necessarily the address they email from.
