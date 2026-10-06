# Native iOS server notifications

The native iOS app registers an `apns:<device token>` through the existing
`register_push_token` RPC. The server routes these tokens directly to Apple.
Expo tokens continue to use Expo for older installs and the React Native Android
app. FCM delivery is not part of this iOS change.

## Server configuration

Set these Edge Function secrets on ServiceFlow's Supabase project
`bwbckdkouqghdadpkjvn`:

- `APNS_PRIVATE_KEY`: the entire Apple `.p8` PEM, including header and footer.
- `APNS_KEY_ID`: the Apple key identifier.
- `APNS_TEAM_ID`: the Apple Developer team identifier.
- `APNS_TOPIC`: `com.ottawapainters.app`.

Never commit the private key or put it in app configuration. The production key
is restricted to this app. It supports App Store and TestFlight installs;
development/simulator tokens require a separate sandbox key and sender.

Deploy both `daily-clock-in-reminders` and `stale-location-alerts`, including
their `../_shared/push.ts` dependency. Keep their existing cron-secret
authentication. No database migration or iOS source change is required for
basic delivery to existing native builds.

## Verification

Run from the repository root:

```sh
deno test --allow-env supabase/functions/_shared/push_test.ts
deno check supabase/functions/daily-clock-in-reminders/index.ts supabase/functions/stale-location-alerts/index.ts
```

These tests use generated keys and mocked provider responses. They do not prove
delivery to a real phone. For that, reopen the native App Store/TestFlight build
with notifications enabled, verify its APNs token is active, and send a targeted
test to an authorized test device. Do not invoke the all-employee daily reminder
just to test delivery.

Apple's explicit unregister response disables a token. Authentication failures,
network failures, rate limits, and `BadDeviceToken` keep it active; the last case
can indicate a development token sent to production. Tokens registered again
during a send are also protected from deactivation. A successful provider ticket
means the provider accepted the notification; verify the banner on the phone.
