# Sentry

Organization: [ServiceFlow](https://serviceflowapp.sentry.io/). Team: `serviceflow`.

| App | Sentry project | Integration |
| --- | --- | --- |
| Admin website | `serviceflow-web` | Next.js browser, Node server, Edge, React error boundary |
| Native Android | `serviceflow-android` | Android crashes, unhandled exceptions, ANRs |
| Native iOS | `serviceflow-ios` | Apple crashes and unhandled exceptions |
| React Native crew app | Android / iOS project by platform | JS errors, React boundary, native crashes |

DSNs in source are public ingestion addresses. API tokens must never be committed
or included in client configuration. Development builds disable reporting.
Session replay and tracing are off; default personal-information collection is off.

## Build uploads

Set `SENTRY_AUTH_TOKEN` to a Sentry organization token with the `org:ci` scope in
the build environment. The web build uploads source maps to `serviceflow-web`;
the native Android release build uploads R8 mappings to `serviceflow-android`.
Native iOS Release builds upload dSYMs to `serviceflow-ios` using `sentry-cli`
(install it on the build machine). Without the token, error reporting still
works, but minified/obfuscated stack traces may be less readable.

For the React Native Android build, store `SENTRY_AUTH_TOKEN` as an EAS secret
or inject it into the local Gradle build environment. Project settings are in
`mobile/android/sentry.properties`; the Metro config adds source-map debug IDs.
For OTA updates to a Sentry-enabled binary, export with source maps and upload
the matching maps using `sentry-cli` to the platform's Sentry project.

## Delivery

Push the intended changes to `main`; the existing GitHub integration deploys
the website to https://serviceflow-admin.vercel.app. Native iOS and Android need
new binaries through their existing release paths. Adding the React Native SDK
also requires a new binary: its OTA runtime is now `1.5.1`, including the checked-in
native runtime values. Do not publish this JS update to older binaries.

## Verification

Use a synthetic handled exception with no business data and confirm it in the
correct Sentry project. Use `setup-verification` as the environment for setup
checks. Build success alone does not confirm event delivery. Never trigger a
crash or change a real employee's records to test monitoring.
