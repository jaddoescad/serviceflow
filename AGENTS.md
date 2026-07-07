# Agent Instructions

## Release Verification

Before submitting any Android build to Google Play, verify the release artifact can launch.

- Prefer installing the exact release build on a connected Android device or emulator and opening the app.
- If testing an AAB, generate/install APKs from that AAB or use another equivalent path that exercises the same signed release artifact.
- Confirm the app reaches the initial screen without crashing and that required production configuration is present, especially Supabase and Google Maps environment values.
- If no Android device/emulator is available, state that clearly before submitting, document the checks that were completed instead, and avoid claiming the app was runtime-tested.
- Do not treat a successful EAS build, `expo-doctor`, or Google Play submission as a launch test.
