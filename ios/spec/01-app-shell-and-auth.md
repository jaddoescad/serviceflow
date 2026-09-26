# 01 — App shell, navigation, auth and small screens

Source of truth: React Native app in `~/Desktop/serviceflow/mobile` (Expo SDK 54, RN 0.81.5, React Navigation 7, supabase-js 2.107). Files read in full:
`App.js`, `app.config.js`, `eas.json`, `src/theme.js`, `src/lib/supabase.js`, `src/lib/employeeRepository.js`, `src/lib/pushTokenRegistration.js`, `src/lib/useEmployeeProjectContext.js`, `src/components/UpdateReadyPrompt.js`, `src/screens/LoginScreen.js`, `HomeScreen.js`, `ContactScreen.js`, `QuoteScreen.js`, `ServicesScreen.js`, plus the checked-in native project `mobile/ios/ServiceFlow/*` (Info.plist, entitlements, Expo.plist, AppDelegate.swift, PrivacyInfo.xcprivacy, project.pbxproj). Skimmed for context: `src/lib/timeTrackingNotifications.js`, `timeTrackingRuntime.js`, `timeTracking.js`, `projectRepository.js`, `locationTrackingFeature.js`, Supabase migrations, `docs/multi-company-plan.md`.

Other specs own: Clock In, Jobs (Projects), Project Detail, Timesheet, Team Map, camera/media, time tracking and location. This spec defines the container they live in and the props/state they get from it.

---

## 0. Global conventions

### 0.1 Colour tokens (`src/theme.js`)

Two palettes exist. The shell, tab bar, More screen, maintenance screen and update prompt use `palette`. The login screen and the four unused marketing screens use `colors`.

`palette` (imported in App.js as `COLORS`):

| Token | Hex | Used for (in this area) |
|---|---|---|
| `green` | `#173f37` | Active tab icon and label, Sign out button background |
| `teal` | `#2f8d7f` | Boot spinner, "ServiceFlow" kicker on More, active-shift dot, update prompt Restart button |
| `brown` | `#7c5127` | (not used in this area) |
| `white` | `#ffffff` | Shell/tab bar/screen backgrounds, status bar background (Android only), button text |
| `surface` | `#f7f8f7` | More-screen cards |
| `border` | `#e0e3e1` | Tab bar top border, card borders |
| `muted` | `#8b9692` | Inactive tab icon and label, card labels, diagnostic text, idle dot, maintenance body |
| `ink` | `#11201d` | Titles, email text, maintenance title, update-prompt background |

`colors`:

| Token | Hex | Token | Hex |
|---|---|---|---|
| `brand` | `#258585` | `danger` | `#B91C1C` |
| `brandDeep` | `#235c50` | `background` | `#f8fafc` |
| `brandInk` | `#1a2d29` | `card` | `#ffffff` |
| `accent` | `#6B4A2B` | `primary` | `#1e3a8a` |
| `surface` | `#FFFFFF` | `primarySoft` | `#dbeafe` |
| `field` | `#F0F8F6` | `accentBlue` | `#0ea5e9` |
| `fieldBorder` | `#DDE9E6` | `text` | `#0f172a` |
| `ink` | `#1a2d29` | `muted` | `#64748b` |
| `inkMuted` | `#4f625c` | `border` | `#e2e8f0` |

`radius`: `card` 14, `button` 12. `spacing`: `xs` 6, `sm` 10, `md` 16, `lg` 22, `xl` 28.

Inline hex values outside theme.js (this area): `#9AA7A3` (login placeholder), `#A8C9C3` (login button disabled), `#FFFFFF` (login button text), `#a45623` (More "Issue:" text), `#DDE6E3` (update prompt subtitle), `#000000` (update prompt shadow).

### 0.2 Typography

- No custom fonts are loaded. Everything is the iOS system font (SF Pro). Use `Font.system(size:weight:)`.
- RN `fontWeight` to SwiftUI: `"500"` → `.medium`, `"600"` → `.semibold`, `"700"` → `.bold`, `"800"` → `.heavy`, `"900"` → `.black`. No weight given → `.regular`.
- A `Text` with no `fontSize` is RN's default of **14pt**.
- `letterSpacing` is in points → SwiftUI `.tracking(x)`. `textTransform: "uppercase"` → `.textCase(.uppercase)` (or uppercase the string).
- Dynamic Type: RN scales `fontSize` with the system text size by default (`allowFontScaling` is never disabled in this area). To match, use `Font.system(size:)` scaled with `@ScaledMetric` or `UIFontMetrics`. If you use fixed sizes, larger text settings will look different from the RN app.

### 0.3 Appearance

- Light mode only: `userInterfaceStyle: "light"` → Info.plist `UIUserInterfaceStyle = Light`. Set `.preferredColorScheme(.light)` as well.
- Status bar: `expo-status-bar` `style="dark"`, so dark content on a light background, on every screen. Info.plist has `UIViewControllerBasedStatusBarAppearance = false` and `UIStatusBarStyle = UIStatusBarStyleDefault`.
- All screens are drawn edge to edge. Safe-area insets are applied by hand (see §1.4).

---

## 1. Navigation

### 1.1 Root state machine (`AppRoot` in App.js)

Checked top to bottom on every render:

| # | Condition | Shows |
|---|---|---|
| 1 | `loading === true` (until `supabase.auth.getSession()` resolves the first time) | **Boot screen** (§2.1) |
| 2 | `session == null` | **LoginScreen** (§2.2). No navigation container or tab bar. |
| 3 | `maintenanceMode === true` | **Maintenance screen** (§2.3). Takes over the whole app with no way out (no sign-out button). |
| 4 | otherwise | `NavigationContainer` → native stack with `Main` (tab shell) and `ProjectDetail` |

Over all of these, `UpdateReadyPrompt` (§5) is a floating banner rendered as a sibling of `AppRoot`, so it can appear on the boot, login and maintenance screens too.

States that have **no** dedicated UI in the RN app (the native app should keep this behaviour unless an App Store change says otherwise, see §8):

- **Profile missing** (no `employees` row for `auth.uid()`): `upsertEmployeeProfileForUser` returns `error = "Your employee profile has not been activated. Ask an administrator for access."`, but `useEmployeeProjectContext` **ignores the error**. The message is never shown. `employeeProfile` stays `null`, so the user gets the crew tab set and `painterName` falls back (§3.5). All data lists come back empty because of RLS.
- **Inactive profile** (`is_active = false`, or inactive membership): `is_active` is selected but **never checked on the client**. The user reaches the main shell. RLS (`private.my_org_ids()` requires an active `org_members` row in an active organization) returns no rows, and `register_push_token` fails silently. In practice the user sees empty screens.
- **Offline**: no global offline banner or check. The boot screen waits for `getSession()`, which reads the stored session from AsyncStorage and does not need the network, so the app opens offline with the last session. Each screen handles its own fetch errors (other specs).

### 1.2 Screen graph

```
App
├─ UpdateReadyPrompt (overlay, always mounted)
└─ AppRoot
   ├─ Boot (spinner)
   ├─ LoginScreen                      [signed out]
   ├─ Maintenance                      [signed in, app_config.maintenance_mode = true]
   └─ NavigationContainer / NativeStack (headerShown: false, gestureEnabled: true, contentStyle bg #ffffff)
      ├─ "Main"  → custom tab shell
      │    ├─ tab "clock"     Clock In   → ClockInScreen
      │    ├─ tab "projects"  Jobs       → ProjectsScreen
      │    ├─ tab "timesheet" Timesheet  → TimesheetScreen
      │    ├─ tab "teamMap"   Team Map   → TeamMapScreen     [managers only, see 1.5]
      │    └─ tab "more"      More       → MoreScreen (defined inline in App.js)
      └─ "ProjectDetail" → ProjectDetailScreen (pushed over the whole shell, tab bar hidden)
```

`HomeScreen`, `ContactScreen`, `QuoteScreen` and `ServicesScreen` are **not imported anywhere**. They cannot be reached (§2.5).

There are no modals, sheets or other stack routes at the shell level. Sheets and modals inside tabs belong to those screens' specs.

### 1.3 Tabs

The tab bar is **custom-drawn** (a row of `Pressable`s), not `UITabBar` and not a React Navigation tab navigator.

Order and content:

| key | Label (verbatim) | Ionicons name | Suggested SF Symbol |
|---|---|---|---|
| `clock` | `Clock In` | `time-outline` | `clock` |
| `projects` | `Jobs` | `folder` (filled) | `folder.fill` |
| `timesheet` | `Timesheet` | `reader-outline` | `doc.text` (a document with lines; closest match) |
| `teamMap` | `Team Map` | `map-outline` | `map` |
| `more` | `More` | `ellipsis-horizontal` | `ellipsis` |

Fallback icon for an unknown key: `ellipse-outline`, which never happens in practice. For a pixel-exact match, bundle the Ionicons glyphs as SVG/PDF template images instead of SF Symbols.

Tab bar layout:

- Full-width row. `paddingHorizontal` 6, `paddingTop` 8, `paddingBottom` = **bottom safe-area inset + 10**. Background `#ffffff`. Top border 1pt `#e0e3e1`. No shadow.
- Each button: `flex: 1` (equal widths), content centred vertically and horizontally, `paddingVertical` 4, 4pt gap between icon and label.
- Icon 27pt. Label 11pt `.bold`, tracking 0.1.
- Colour: active `#173f37`, inactive `#8b9692`. There is no pill, underline or background change on the active tab. There is no pressed state (a plain `Pressable` with no style change).
- Accessibility: role `tab`, label = tab label, `selected` state = active.
- Tapping a tab sets `activeTab`. Tapping the tab that is already active does nothing: no scroll-to-top and no pop.

Tab scene behaviour (must be kept, other screens depend on it):

- **All tab screens stay mounted.** Inactive ones are hidden with `display: "none"`, so scroll position and local state survive tab switches. In SwiftUI, use a `ZStack` of all tab views with `.opacity(0)` and `.allowsHitTesting(false)`, or a `TabView` with a hidden system bar. Do not rebuild the views on each switch.
- Each screen gets an `enabled` flag that is true only while it is visible and nothing is pushed over it:
  - ClockInScreen: `enabled = activeTab == "clock" && selectedProject == nil`
  - ProjectsScreen: `enabled = activeTab == "projects" && selectedProject == nil`
  - TeamMapScreen: `enabled = activeTab == "teamMap"`, and it is only created when `canViewTeamMap`
  - TimesheetScreen and MoreScreen get no `enabled` flag.
- Default tab on launch: `clock`.
- **Tab reset:** in `onAuthStateChange`, whenever the callback receives a non-null session, the app sets `activeTab = "clock"` and `selectedProject = null`. supabase-js fires this for `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED` and `USER_UPDATED`. **Side effect:** a background token refresh (about hourly, and often right after returning to the foreground) sends the user back to Clock In, and if ProjectDetail is open it blanks it (the detail host renders nothing while the route stays pushed). This looks unintended. **Recommendation:** reset only on `SIGNED_IN` (a real account change). Flag this to the product owner if an exact replica is required.

### 1.4 Safe areas and layout of the Main shell

- Shell background `#ffffff`.
- The content area gets `paddingTop` = top safe-area inset (tab screens start below the status bar or Dynamic Island). The screens themselves do not add top insets.
- The tab bar handles the bottom inset (see above). The content area fills the space between the top inset and the tab bar.
- LoginScreen uses `SafeAreaView` with edges top and bottom.
- Maintenance and Boot screens ignore safe areas (their content is centred).

### 1.5 Push to Project Detail and back

- `openProject(project, action = nil)`: ignored if `project` is nil. Otherwise it sets `selectedProject`, sets `detailAction` (`nil`, `"photos"` or `"camera"`), and pushes route `ProjectDetail`.
  - Callers: ProjectsScreen `onSelectProject(project)`. ClockInScreen `onViewProject(project)` and `onViewProject(project, "photos")` ("open photos"). ProjectDetailScreen maps `initialAction`: anything non-nil opens its `photos` tab, and `"camera"` also opens the camera.
- It is a standard iOS push (UIKit `UINavigationController` animation). `headerShown: false`: there is **no navigation bar**, and ProjectDetail draws its own back button (`onBack` → pop).
- Interactive edge-swipe back is **enabled** (`gestureEnabled: true`).
- The pushed screen covers the tab bar.
- When the detail screen is fully popped (unmounted), `selectedProject` is cleared (`DetailHost` cleanup). This re-enables the Clock In and Jobs tab screens.
- `onOpenActiveClock` (from ProjectDetail): set `activeTab = "clock"`, then pop.
- Props App.js passes to ProjectDetailScreen: `project`, `initialAction`, `onBack`, `entries = tracking.teamEntries`, `activeShift`, `activeElapsedMs`, `clockOutPending`, `trackingNotice`, `projects = trackingProjects`, `user = session.user`, `painterName`, `canViewTeamTime = canManageProjects`, `onClockIn`, `onClockOut` (wrapped, see below), `onSwitchProject`, `onOpenActiveClock`, `onDeleteTimeEntry`, `onUpdateTimeEntry`.
- `clockOutPending`: a shared flag set to true while `tracking.clockOut(reason)` is running (the `clockOutWithPending` wrapper), so screens can hide live-shift UI during clock-out. It is passed to ProjectDetail only. ClockIn also gets the wrapped `onClockOut`.

Props passed to the tab screens (so the native view models expose the same data):

| Screen | Props |
|---|---|
| ClockInScreen | `enabled`, `user = session.user`, `painterName`, `onViewProject = openProject`, `activeShift`, `activeElapsedMs`, `todayWorkedMs`, `locationStatus`, `trackingNotice`, `trackingPermissions`, `suggestedProject`, `projects = tracking.resolvedProjects`, `onClockIn`, `onClockOut = clockOutWithPending`, `onSwitchProject`, `onUpdateTimeEntry` |
| ProjectsScreen | `enabled`, `onSelectProject = openProject`, `activeShift`, `projectTimeTotals`, `myProjectTimeTotals`, `projectLatestActivity`, `assignedProjectIds`, `canManageProjects`, `canViewTeamTime = canManageProjects`, `onProjectsChanged = refreshProjectData` |
| TimesheetScreen | `entries = tracking.entries`, `activeShift`, `projects = trackingProjects`, `painterName`, `onDeleteTimeEntry`, `onUpdateTimeEntry` |
| TeamMapScreen | `projects = tracking.resolvedProjects`, `enabled` |
| MoreScreen | `userEmail = session.user.email`, `profile = employeeProfile` (unused inside), `activeShift`, `trackingPermissions`, `trackingDiagnostic` |

`tracking` is `useTimeTracking(trackingProjects, sessionUser)`, owned by the time-tracking spec. It runs as soon as a session exists, **including while the maintenance screen is showing**, because React hooks run before the early returns.

### 1.6 Manager-only UI: exact rule

```js
const canManageProjects = ["admin", "manager"].includes(employeeProfile?.role);
const canViewTeamMap   = canManageProjects && isLocationTrackingFeatureEnabled();
```

- `employeeProfile.role` is **`employees.role`** (the legacy per-person column). It is **not** `org_members.role`.
- Roles that count: `admin`, `manager`. Any other value, or a null or missing profile, means crew.
- `isLocationTrackingFeatureEnabled()` = `Constants.expoConfig.extra.locationTrackingEnabled !== false`, which comes from build-time env `EXPO_PUBLIC_LOCATION_TRACKING_ENABLED !== "0"` (default on).
- Effects:
  - `canViewTeamMap` → the "Team Map" tab is inserted between Timesheet and More. Tab count is 5 for managers and 4 for crew.
  - `canManageProjects` → passed to ProjectsScreen as `canManageProjects` and `canViewTeamTime`, and to ProjectDetail as `canViewTeamTime`.
- The profile loads asynchronously after sign-in, so for a moment a manager sees the crew tab set, and then the Team Map tab appears. The profile is fetched once per session user plus on `refreshProjectData`. It is **not** refetched on foreground or on a timer, so a role change needs an app restart, a re-login or a project change that calls `onProjectsChanged`.
- Backend note (from `docs/multi-company-plan.md`, migration `20260925210514_membership_based_permissions`): roles now live in `org_members.role` (`owner|admin|manager|crew`). `employees.role`/`is_active` are kept only as Ottawa Painters legacy fields, and the plan says `canManageProjects` should move to the membership role. **The native app should use `org_members.role in ('owner','admin','manager')` for the active company**, and fall back to `employees.role` only if the multi-company work is not live. Confirm with the backend owner which one the native launch uses.

### 1.7 Deep links

- **None handled.** `NavigationContainer` has no `linking` config, and no code calls `Linking.getInitialURL`/`addEventListener`.
- The native project registers URL scheme `com.ottawapainters.app` (`CFBundleURLTypes`, added by Expo prebuild) and forwards to `RCTLinkingManager`. Nothing in JS listens, so opening that URL just opens the app.
- No universal links: the entitlements have only `aps-environment` and no Associated Domains.
- Supabase `detectSessionInUrl: false`, so there are no magic-link or OAuth redirects.
- **Notification taps** are the only "deep" entry points. They are handled by time tracking (`subscribeToTrackingNotificationResponses`, `consumeInitialNotificationResponse`) and **do not navigate**: they call `clockIn`/`clockOut`/`switchProject` or set a `trackingNotice` shown on Clock In. See §4.3.
- Native equivalent: register the same scheme only if needed for invites (§8). Otherwise it can be dropped.

---

## 2. Screens

### 2.1 Boot screen

- Full screen `#ffffff`, a small (default size) `ActivityIndicator` centred, colour `#2f8d7f`. No text.
- Shown only until the first `getSession()` resolves, which is local and near-instant.
- Before that, the native launch screen is shown: `SplashScreen.storyboard` with image `SplashScreenLegacy` (= `assets/serviceflow-splash.png`, 2048×2048, logo mark plus "ServiceFlow" wordmark centred on white), `scaleAspectFit`, background colour asset `SplashScreenBackground` = sRGB white. Config: `splash.resizeMode: "contain"`, `backgroundColor: "#FFFFFF"`.
- Native: use a launch screen with the same image on white. The boot spinner can be a SwiftUI `ProgressView().tint(Color(hex: 0x2f8d7f))` shown while the Keychain session is restored.

### 2.2 LoginScreen

Container: `SafeAreaView` (edges top and bottom), background `#FFFFFF`. Inside it is a vertical `ScrollView`:
- `automaticallyAdjustKeyboardInsets` (iOS moves content above the keyboard and scrolls the focused field into view)
- `keyboardShouldPersistTaps="handled"` (tapping a button while the keyboard is up works on the first tap)
- `keyboardDismissMode="on-drag"`
- no scroll indicator, `bounces = false`
- content: `flexGrow: 1`, `paddingHorizontal` 28, `paddingTop` 32, `paddingBottom` 32. Content is **top-aligned**, not vertically centred.

Top to bottom:

1. **Logo**: image `assets/serviceflow-logo-trimmed.png` (1098×702: the network mark plus the "Service" wordmark in dark ink and "Flow" in teal). Centred, `width: 100%` capped at `maxWidth 230`, `height 147`, `contentMode .fit`, `marginBottom 28`.
2. **Form** block: `width 100%`, `maxWidth 420`, centred horizontally (matters on iPad).
   1. Label `Email Address`: `#235c50`, 15pt `.bold`, `marginBottom 8`.
   2. Email field: height 52, bg `#FFFFFF`, border 1pt `#DDE9E6`, corner radius 10, `paddingHorizontal 16`, text `#1a2d29` 16pt `.medium`, `marginBottom 18`.
      - Placeholder `name@company.com`, colour `#9AA7A3`.
      - `autocapitalization none`, `autocorrect off`, keyboard `.emailAddress`, `textContentType .emailAddress` (`autoComplete="email"`), return key **Next** → focuses the password field (`blurOnSubmit={false}`: keyboard stays up).
   3. Label `Password`: same style as above.
   4. Password row: an HStack container with height 52, bg `#FFFFFF`, border 1pt `#DDE9E6`, radius 10, `paddingLeft 16`, no right padding.
      - Secure text field, `flex 1`, full height, text `#1a2d29` 16pt `.medium`. Placeholder `Password`, colour `#9AA7A3`. `autocapitalization none`, `autocorrect off`, `textContentType .password`. Return key **Done** → calls `submit`.
      - Show/Hide toggle at the trailing edge: full row height, `paddingHorizontal 16`, text `Show` when hidden and `Hide` when visible, colour `#258585`, 15pt `.heavy`. Accessibility role button. Tapping flips `secureTextEntry`.
   5. **Error slot**: a fixed **30pt-high** box, content vertically centred (it reserves space, so the layout does not jump). When `error` is set: text in `#B91C1C`, 14pt `.bold`, leading-aligned.
   6. **Log In button**: height 52, radius 10, full width, bg `#258585`, label centred, white `#FFFFFF` 17pt `.heavy`.
      - Label: `Log In`. While a request is in flight: `Signing In...` (three ASCII periods, not an ellipsis character).
      - Disabled (bg `#A8C9C3`, no press effect) when `!canSubmit`.
      - Pressed (only when enabled): bg `#235c50` and the button moves down by 1pt (`translateY: 1`).
   7. Helper text `Employee accounts are created by the office.`: `#4f625c`, 14pt `.semibold`, centred, `marginTop 18`.

Logic:

- `canSubmit = email.trim().length > 0 && password.trim().length > 0 && !loading`.
- `submit()`:
  - If `!canSubmit`: set error `Enter your email and password.` and return. This can only happen from the keyboard **Done** key, because the button is disabled. Pressing Done *while a request is already in flight* also shows this message (a quirk).
  - Otherwise clear the error, set `loading = true`, call `supabase.auth.signInWithPassword({ email: email.trim(), password })`. The password is sent **untrimmed**, and whitespace-only passwords are rejected by the check above.
  - `loading = false` afterwards.
  - On error: show `signInError.message` **verbatim** from Supabase GoTrue, for example `Invalid login credentials` or `Email not confirmed`. Network failure gives whatever the fetch error message is (supabase-js usually reports `Failed to fetch`/`Network request failed`, which is ambiguous, so show the error's `localizedDescription`).
  - On success the screen does nothing. The root listens to the auth state and swaps to the main shell. The fields do not clear.
- Typing in either field clears any visible error.
- There is **no** "Forgot password", no sign-up, no SSO, no Sign in with Apple, and no remember-me toggle (the session is always persisted).
- Android-only keyboard padding code exists. Ignore it on iOS.

### 2.3 Maintenance screen

- Full screen `#ffffff`, content centred vertically and horizontally, `paddingHorizontal 32`.
- Title: `Database upgrade in progress`. `#11201d`, 22pt `.black`, centred.
- Body (`marginTop 12`): `ServiceFlow is temporarily paused while your jobs and time records are verified. Please try again shortly.` `#8b9692`, 15pt regular, line height 22 (line spacing ≈ 22 − 15pt font line height), centred.
- No buttons, no retry, no sign-out. The only way out is to restart the app after the flag is cleared (or a token refresh or auth event that changes `session.user.id`, which it will not).
- See §3.6 for when the flag is fetched.

### 2.4 More screen (inline `MoreScreen` in App.js)

Container: plain `View`, **not scrollable**, background `#ffffff`, padding 24 on all sides with `paddingTop 36` (below the shell's top safe-area inset). On small phones with an active shift the content can clip at the bottom. In native it is acceptable to wrap it in a `ScrollView` with the same padding (no visual difference when it fits).

Top to bottom:

1. Kicker `ServiceFlow` (rendered uppercase: "SERVICEFLOW"): `#2f8d7f`, 11.5pt `.heavy`, tracking 1.4, `marginBottom 3`.
2. Title `More`: `#11201d`, 28pt `.black`, tracking −0.6, `marginBottom 16`.
3. **Card 1: account**. Card style: bg `#f7f8f7`, radius 18, border 1pt `#e0e3e1`, padding 18, `marginTop 12`, `marginBottom 18`. RN does not collapse margins, so the gap between two cards is 18 + 12 = 30pt.
   - Label `Signed in as` (uppercase): `#8b9692`, 11.5pt `.heavy`, tracking 1.2, `marginBottom 6`.
   - Value: `session.user.email`, `#11201d`, 16pt `.bold`.
4. **Card 2: location tracking** (same card style).
   - Label `Location tracking` (uppercase, same label style).
   - Status row (HStack, 9pt spacing, `marginBottom 8`, vertically centred):
     - Dot: 10×10 circle, `#2f8d7f` if `activeShift` else `#8b9692`.
     - Value text `#11201d` 15pt `.black`:
       - no active shift: `Off while clocked out`
       - active shift: `trackingModeLabel(trackingDiagnostic.mode)`:

         | `mode` | Text |
         |---|---|
         | `painting` | `On-site tracking active` |
         | `stationary` | `Stationary tracking active` |
         | `travel` | `Travel tracking active` |
         | `unavailable` | `Tracking unavailable` |
         | anything else / nil | `Preparing location tracking` |
   - If `activeShift` (each line: `#8b9692`, 12.5pt `.semibold`, `marginTop 4`):
     - `Last location: {t}` where `t = formatDiagnosticTime(trackingDiagnostic.lastLocationAt ?? activeShift.lastLocation.capturedAt)`
     - `Last upload: {formatDiagnosticTime(trackingDiagnostic.lastSyncAt)}`
     - `Location access: Active shifts only` if `trackingPermissions.foreground` is true, else `Location access: Not enabled`
     - `Tracking may pause if ServiceFlow is force-closed.`
     - If `trackingDiagnostic.lastErrorCode`: `Issue: {lastErrorCode}` in `#a45623`, 12pt `.heavy`, `marginTop 7` (the raw code string, not localised).
   - Else one line (same diagnostic style): `ServiceFlow requests location when you clock in and stops tracking when you clock out.`
   - `formatDiagnosticTime(value)`: if the value is missing, unparseable, or ≤ epoch 0 → `Not received yet`. Otherwise `toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })`. In en-US this renders as e.g. `Sep 26, 3:04 PM`. Native: `date.formatted(.dateTime.month(.abbreviated).day().hour().minute())` with the device locale.
5. **Sign out button**: height 54, radius 18, full width (inside the 24pt padding), bg `#173f37`, label `Sign out` in white 16pt `.black`, centred. No pressed style (plain `Pressable`). Action: `supabase.auth.signOut()` right away, with **no confirmation dialog**, even during an active shift. The root's auth listener then shows LoginScreen.
   - Ambiguity: sign-out does not explicitly stop an active shift, background location, or scheduled shift reminders in App.js. What `useTimeTracking` does when `user` becomes null is covered by the time-tracking spec. Local shift state in AsyncStorage may survive. Decide explicitly in native (recommended: confirm first if a shift is active; see §8).

The `profile` prop is passed but not used. The screen does not show a name, role, company, app version or support link.

### 2.5 Unused marketing screens (HomeScreen, ContactScreen, QuoteScreen, ServicesScreen)

**These are dead code.** Nothing imports them (`grep` over `App.js`/`src` finds only their own definitions). A user can never see them in the current app. They are Ottawa Painters-style marketing placeholders with fake contact data (`serviceflow.example.com`, `+1 (613) 555-0183`, `TODO: replace with real URL`). The multi-company plan (Phase 5) says to delete them.

**Recommendation: do not build them in the native app.** They are not part of the "exact replica" because they are unreachable, and shipping placeholder painting-company content would work against guideline 3.2 (see §8). They are documented below only for completeness.

Shared style for all four: `ScrollView` bg `#f8fafc`, content padding 16, `paddingBottom` 36 (Services: 32). Page title 28pt `.heavy` `#1e3a8a`, `marginBottom 10`. Subtext `#64748b` 14pt (Services: 15pt), `marginBottom 16`. Cards: bg `#ffffff`, border 1 `#e2e8f0`, radius 14, padding 16.

**HomeScreen**
- Hero card (`marginBottom 16`): title `ServiceFlow` (28/800 `#1e3a8a`). Subtitle (mt 10, 16pt `#0f172a`, lh 22): `Field-service assignments, clock-ins, and job-site updates for mobile teams.` CTA button (mt 16, leading-aligned, bg `#1e3a8a`, radius 12, padding 10×16, opacity 0.8 when pressed): `Get a free quote` (white, 14/700). It opens `https://serviceflow.example.com` and ignores errors.
- Card `Why choose us` (section title 20/700 `#0f172a`, mb 16). Bullets (15pt `#64748b`, mb 8), each prefixed `• `: `Interior painting and color matching`, `Exterior painting and power washing`, `Cabinet refinishing and trim detail work`, `Free estimates and same-week appointments`.
- Card `Core services`: rows with bottom border 1 `#e2e8f0`, mb 10, pb 10. Name 16/700 `#0f172a`, detail mt 3 `#64748b`:
  - `Residential` / `Home interiors, exteriors, and deck prep/painting.`
  - `Commercial` / `Offices, condos, and property maintenance crews.`
  - `Renovation` / `Surface prep, texture, caulking, and finishing touch-ups.`
- Badge card (bg `#dbeafe`, radius 14, padding 16, mb 16): `Service area` (16/700 `#1e3a8a`), then (mt 6, `#0f172a`) `Built for field crews, dispatchers, and operations teams.`
- Remote image, height 190, radius 14, placeholder bg `#e2e8f0`: `https://images.unsplash.com/photo-1600566753370-84e7f1a53f26?auto=format&fit=crop&w=1000&q=80`.

**ContactScreen**
- Title `Contact`. Subtext `Reach us directly for scheduling and estimates.`
- Card (overflow hidden) with rows (padding 16, bottom border, HStack space-between). Left: label 14/700 `#0f172a` mb 2, value `#64748b`. Right: `↗` in `#1e3a8a` bold. Row taps:
  - `Phone` / `+1 (613) 555-0183` → `tel:+16135550183`
  - `Email` / `support@serviceflow.example` → `mailto:support@serviceflow.example`
  - `Instagram` / `@serviceflow` → `https://www.instagram.com`
  - `Facebook` / `ServiceFlow` → `https://www.facebook.com`
  - `Address` / `Operations office` → `https://maps.google.com`
- Hours card (mt 16): `Hours` (700, mb 10), then lines (`#64748b`, mb 4): `Mon - Fri: 8:00 AM – 6:00 PM`, `Saturday: 9:00 AM – 3:00 PM`, `Sunday: Closed` (hyphen in "Mon - Fri", en dashes in the time ranges, verbatim).

**QuoteScreen**
- Title `Request a quote`. Subtext `Share your project details and we'll get back to you within 24 hours.`
- Fields (border 1 `#e2e8f0`, red `#B91C1C` border on error, radius 12, bg white, padding 16, mb 16). Placeholders: `Your name`, `Phone number` (phone pad), `Email (optional)` (email keyboard, no caps, no autocorrect), `Service (Interior, Exterior, Cabinet...)`, `Tell us about your space, timelines, and special instructions` (multiline, min height 110, top-aligned).
- Field errors below each field (13/600 `#B91C1C`, mt −8, mb 16): name empty `Please enter your name.`, phone empty `Please enter your phone number.`, phone < 10 digits `Enter a valid phone number.`, email present and not matching `^[^\s@]+@[^\s@]+\.[^\s@]+$` → `Enter a valid email address.`, service empty `Please enter a service type.` Editing a field clears its error.
- Button `Submit request` (bg `#1e3a8a`, radius 12, padding 16, white 700, opacity 0.85 when pressed). On invalid input: alert `Missing details` / `Please check the highlighted fields and try again.` On valid input: alert `Request received` / `Thanks, {name}! We'll contact you at {phone} shortly for your {service} quote.`, then the form resets. **Nothing is sent to a backend** (TODO in code).

**ServicesScreen**
- Title `Services`. Subtext `Select a service category below and request a quote for tailored pricing.`
- Vertical stack (gap 16) of cards: title 18/700 `#0f172a` mb 6, text `#64748b` lh 20:
  - `Interior Painting` / `Wallpaper prep, base coat, premium low-VOC paints, and cleanup included.`
  - `Exterior Painting` / `Pressure wash, scraping, caulking, primer, and seasonal weather-ready finishing.`
  - `Color Consultation` / `Free in-home or remote color planning with brand-matched recommendations.`
  - `Cabinet Refinishing` / `Sanding, patching, staining, and modern finishes for a clean update.`
  - `Commercial Jobs` / `Tenant-ready schedules, minimal disruption windows, and contractor coordination.`
- No interactive elements.

### 2.6 Assets (`mobile/assets/`)

| File | Size | Used where |
|---|---|---|
| `serviceflow-icon.png` | 1024×1024 | App icon (`expo.icon`). The checked-in `ios/.../AppIcon.appiconset/App-Icon-1024x1024@1x.png` looks the same (different bytes, same artwork: teal "network path" mark on white, no wordmark). Use the appiconset file. |
| `serviceflow-splash.png` | 2048×2048 | Launch screen (`splash.image`). Copied into `SplashScreenLegacy.imageset` (@1x/@2x/@3x are all 2048×2048). |
| `serviceflow-logo-trimmed.png` | 1098×702 | LoginScreen logo (the only image `require`d in JS). |
| `serviceflow-adaptive-icon.png` | 1024×1024 | Android adaptive icon only. Not needed on iOS. |
| `serviceflow-logo.png` | 1600×900 | Unused (the untrimmed logo). |
| `serviceflow-generated-logo.png`, `serviceflow-model-lockup-lines.png`, `serviceflow-model-lockup-v2.png` | 1254×1254 | Unused. |
| `ottawa-painters-logo.png` (628×249), `ottawa-painters-icon.png` (520×249), `ottawa-painters-bg.jpg` (960×720) | | Unused. **Do not ship** (3.2, single-business branding). |

Other visuals in this area are vector icons (Ionicons, §1.3) and one remote image in the unused HomeScreen.

---

## 3. Auth and session

### 3.1 Supabase client (`src/lib/supabase.js`)

- `createClient(supabaseUrl, supabaseKey, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })`.
- URL: `EXPO_PUBLIC_SUPABASE_URL` or `Constants.expoConfig.extra.supabaseUrl`. Key: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, else `EXPO_PUBLIC_SUPABASE_ANON_KEY`, else `extra.supabasePublishableKey`.
- If either is missing, the module **throws `"Missing Supabase environment variables."` at import**, which crashes the app on launch (this is what `AGENTS.md` Release Verification checks for). Native: fail fast in debug. In release, show a fatal config screen rather than crashing (and it should never ship like this).
- Auto-refresh is tied to app state: `startAutoRefresh()` on `active`, `stopAutoRefresh()` otherwise. supabase-swift refreshes automatically, so pause/resume on `scenePhase` changes to match.
- Supabase project (from docs): `bwbckdkouqghdadpkjvn`. The real URL and key come from EAS environment `production` (§6).

### 3.2 Session lifecycle

| Event | Behaviour |
|---|---|
| First launch (no stored session) | Boot spinner → `getSession()` returns null → LoginScreen. There is no onboarding, no permission priming and no intro. |
| Launch with stored session | Boot → main shell right away (works offline). The token is refreshed in the background when it has expired. |
| Sign-in | `signInWithPassword` only (§2.2). |
| Auth state change | `onAuthStateChange((event, session) => setSession(session); if (session) { activeTab = "clock"; selectedProject = nil })` (see the §1.3 caveat). |
| Refresh failure / revoked refresh token | supabase-js emits `SIGNED_OUT` → session null → LoginScreen. There is no message. |
| Sign-out | More → `Sign out` → `supabase.auth.signOut()` (default scope, which revokes the refresh token server-side and clears storage). There is no confirmation. |
| Session storage | AsyncStorage (unencrypted). Native: store in the **Keychain** (supabase-swift default). This is a security improvement with no visible difference. Existing RN sessions will **not** carry over when a user upgrades to the native build, so users must sign in once. Tell users or testers. |

### 3.3 After sign-in: data loaded by the shell (`useEmployeeProjectContext(session)`)

Runs whenever `session.user` exists:

1. **Tracking projects**: `listMappedProjects()` → `job_feed` `select *` where `is_feed_visible = true` and `status in ('scheduled','active')`, ordered by `updated_at desc`, paged by 1000. Client-side it drops archived/cancelled and QA projects (name matches `/qa web smoke|do not use/i`), then keeps only rows where `latitude` and `longitude` are both non-null. The result is `trackingProjects`, used by time tracking, Timesheet and ProjectDetail. Loaded once per user id, and again on `refreshProjectData`.
2. **Employee profile**: `upsertEmployeeProfileForUser(user)`:
   ```
   from("employees").select("id,email,full_name,role,is_active").eq("id", user.id).maybeSingle()
   ```
   - fetch error → `{ profile: nil, error }`
   - row → `profile = row + { user_id: row.id }`
   - no row → `{ profile: nil, error: Error("Your employee profile has not been activated. Ask an administrator for access.") }`
   - Despite its name, it **never inserts or upserts**. The caller sets `employeeProfile` only if a profile came back, and ignores the error (a stale profile stays if a later fetch fails).
3. **Assignments**: `listActiveProjectAssignmentIds(user.id)` → `job_assignments` `select job_id` where `employee_id = user.id` and `status = 'active'` → `assignedProjectIds: [String]`. It refreshes after the profile loads, **every 60 s** while signed in, and each time the app becomes `active`.
4. `refreshProjectData()` = (1) and (2)+(3) in parallel. It is passed to ProjectsScreen as `onProjectsChanged`.

### 3.4 Push-token registration (see §4)

Runs when `sessionUser.id` becomes available (so right after sign-in, and on every cold launch with a session). Errors are swallowed.

### 3.5 Display name (`getEmployeeDisplayName`)

First non-empty value of: `employees.full_name` → `user.user_metadata.full_name` → `user.user_metadata.name` → the part of `user.email` before `@` → `"Painter"`. The result is `painterName`, passed to ClockIn, Timesheet and ProjectDetail. (`"Painter"` is trade-specific wording; see §8.)

### 3.6 `app_config` / maintenance / minimum version

- Query (once per `session.user.id` change, i.e. at sign-in or launch; never polled; not re-checked on foreground):
  ```
  from("app_config").select("maintenance_mode").eq("id", "default").maybeSingle()
  ```
- `maintenanceMode = (data?.maintenance_mode === true)`. On any error or missing row it **fails open** (false). The flag starts false, so the main shell renders first and switches to the maintenance screen when the query returns (a brief flash).
- Signed out → `maintenanceMode = false`, and it is never checked before login.
- Table `public.app_config` (from `v2.app_config`): `id text pk default 'default'`, `schema_version int`, `maintenance_mode bool`, **`minimum_mobile_version text not null`** (seeded `'1.1.0'`), `settings jsonb`, `updated_at`. RLS policy `app_config_read`: select for `anon, authenticated` using true.
- **`minimum_mobile_version` is not read by the RN app.** There is no forced-update check. Native: optional. If you add one, compare against `CFBundleShortVersionString` and show a blocking "update from the App Store" screen. This is a new behaviour, not a replica.

---

## 4. Notifications

### 4.1 Permission request timing

There are two call sites. Both use the plain iOS alert/sound/badge authorization (`requestPermissionsAsync()` with no options: expo defaults to `allowAlert`, `allowBadge`, `allowSound`).

1. **Right after sign-in / on every launch with a session**: `registerPushToken(sessionUser)` calls `getPermissionsAsync()`. If not granted, it calls `requestPermissionsAsync()` immediately. **So the system notification prompt appears on the first main-shell render after login, with no pre-prompt.** On later launches iOS does not show it again (already decided).
2. **At clock-in and whenever an active shift is restored** (`requestTrackingPermissions()` in `timeTrackingRuntime.js`): it requests notifications first, then While-In-Use location. If granted, it registers the notification categories (§4.3). Owned by the time-tracking spec. Mentioned here because of 5.1.1(iv) (§8).

### 4.2 Token registration (`registerPushToken`)

Steps (iOS):
1. If permission is not granted after asking → return without doing anything.
2. `getExpoPushTokenAsync({ projectId })` with `projectId` = `Constants.easConfig.projectId` → `extra.eas.projectId` → `extra.expoProjectId` → env `EXPO_PUBLIC_EAS_PROJECT_ID` → default `"93638a9a-d605-4fee-800e-6449ca444429"`. Result: `ExponentPushToken[...]`. If there is no token, stop.
3. `getDevicePushTokenAsync().data`: on iOS this is the raw APNs device token as a hex string. It becomes nil on failure.
4. RPC:
   ```
   supabase.rpc("register_push_token", {
     payload: {
       expo_push_token:   "<ExponentPushToken[...]>",
       platform:          "ios",
       device_push_token: "<apns hex>" | null,
       app_version:       "1.5.0"   // Constants.expoConfig.version
     }
   })
   ```
5. All errors are swallowed (`.catch(() => {})`). Nothing is shown to the user.

Server: `public.register_push_token(payload jsonb) returns uuid`, SECURITY DEFINER. It requires `auth.uid()` and (after `20260925210514`) at least one active membership (`private.my_org_ids()`), otherwise it raises `Active employee profile required`. It upserts `public.push_tokens` on conflict **`(expo_push_token)`**: sets `employee_id = auth.uid()`, `platform`, `device_push_token`, `app_version`, `is_active = true`, `last_registered_at = now()`. Optional `payload.id`.

**Native implication (important):** a native app has no Expo push token. The server's delivery (edge functions that send through the Expo Push API using `expo_push_token`) will not reach native installs unless:
- (a) the backend adds APNs sending using `device_push_token` (recommended), and the RPC accepts a row without `expo_push_token`. **Today the conflict key is `expo_push_token`, and a null value would insert a new row every launch** (nulls are never equal in a unique index). This needs a backend change, e.g. a unique key on `device_push_token`, or the native client sends a stable synthetic id. Or
- (b) the native app keeps using Expo's push service by calling Expo's `getExpoPushToken` HTTP endpoint with the APNs token (`https://exp.host/--/api/v2/push/getExpoPushToken`, needs the EAS project id and the app's APNs credentials uploaded to Expo). **Ambiguous / needs a backend decision. Flag this to the owner before building.**
- Send `platform: "ios"` and `app_version` = `CFBundleShortVersionString`.
- The RN app never deactivates the token on sign-out. Consider marking it inactive on sign-out in native (a small improvement; needs an RPC).

### 4.3 Foreground presentation, categories and actions

Foreground handler (set at module load): show banner and list, play sound, do not set badge. Native: in `userNotificationCenter(_:willPresent:)`, return `[.banner, .list, .sound]`.

Categories (registered only after `requestNotificationPermissions()` succeeds at clock-in). All actions use `opensAppToForeground: true` → `UNNotificationActionOptions.foreground`:

| Category identifier | Actions (identifier → title) |
|---|---|
| `ottawa-painters-arrival-prompt` | `clock_in` → `Clock In` |
| `ottawa-painters-clock-out-prompt` | `clock_out` → `Clock Out` |
| `ottawa-painters-switch-project-prompt` | `switch_project` → `Switch Job`, `clock_out` → `Clock Out` |

Keep the identifiers exactly as they are (server-sent pushes may reference them), even though they carry the old business name. The user never sees them.

Local notifications and tap handling are covered in the time-tracking spec. Summary: titles `Are you at another job?` / `Still on this job?` / `You're at a job site` / `Still clocked in?` (8 h and 10 h reminders `serviceflow-active-shift-8h`/`-10h`). Taps call `clockOut("notification")`, `switchProject`, `clockIn`, or set a `trackingNotice`. Responses are de-duplicated by request identifier (in memory plus persisted `lastHandledNotificationId`). The cold-launch response is read with `getLastNotificationResponseAsync`. Notification taps **do not change the tab or navigate**. (A tap brings the app to the foreground on whatever tab was last open, or `clock` on a cold start.)

Remote pushes: this area has no handler for remote-push payloads. Whatever the server sends is shown by the system. Tapping one goes through the same response handler, which only acts on `data.type` values `arrival`, `switch_project`, `clock_out`, `active_shift_reminder`.

Entitlement: `aps-environment` = `development` in the checked-in file. Release signing needs `production` (EAS normally fixes this at signing). Set it correctly in the native project.

---

## 5. OTA updates (`UpdateReadyPrompt`)

RN behaviour (expo-updates):
- Config: `updates.url = https://u.expo.dev/93638a9a-d605-4fee-800e-6449ca444429`, `fallbackToCacheTimeout 0`, `EXUpdatesCheckOnLaunch ALWAYS`, `EXUpdatesLaunchWaitMs 0` (launch never waits, and a download applies on the next launch). `runtimeVersion "1.5.0"` in app.config.js, while the checked-in `Expo.plist` says `EXUpdatesRuntimeVersion 1.4.0` (stale, or overwritten at build time; ambiguous).
- Channels (eas.json): `preview`, `pilot` (iOS TestFlight), `production` (Play).
- In-app check: skipped in dev and when updates are disabled. It checks on mount, on every background→active transition, and every 15 min while active, with a 60 s cooldown between checks and one check in flight at a time. If `checkForUpdateAsync().isAvailable`, it calls `fetchUpdateAsync()`. Errors are ignored.
- When `isUpdatePending`: a floating banner, absolutely positioned at `top = safeArea.top + 10`, centred, zIndex above everything, touches pass through outside the banner.
  - Banner: width 94% (max 560), minHeight 72, HStack spacing 12, padding 16 horizontal / 12 vertical, radius 18, bg `#11201d`, shadow black 20% opacity radius 12 offset (0,6). Accessibility live region polite.
  - Left (flex 1): title `Update ready` white 15pt `.black`. Subtitle `Restart ServiceFlow to use the latest version.` `#DDE6E3` 12pt `.semibold`, mt 2.
  - Right button: minHeight 42, paddingHorizontal 14, radius 12, bg `#2f8d7f`. Label `Restart now` (while restarting: `Restarting…` with a real ellipsis character U+2026), white 13pt `.black`. Pressed opacity 0.8, disabled opacity 0.6. Accessibility label `Restart now to install the update`.
  - Tap → `Updates.reloadAsync()`. On failure: alert title `Unable to restart`, message `Close and reopen ServiceFlow to finish installing the update.` (single default OK button).
  - The banner cannot be dismissed.

**Native: drop this.** App Store apps cannot download executable code (guideline 2.5.2), and updates come through the App Store. Optional replacement: the `app_config.minimum_mobile_version` gate (§3.6), and/or a non-blocking "A new version is available" banner in the same visual style that opens the App Store page (`itms-apps://apps.apple.com/app/id6787451069`). If you build that banner, reuse the styling above.

---

## 6. Environment and config

| Value | Source (RN) | Used for | Native |
|---|---|---|---|
| Supabase URL | `EXPO_PUBLIC_SUPABASE_URL` (→ `extra.supabaseUrl`) | all API | Build setting / xcconfig → Info.plist key, e.g. `SUPABASE_URL` |
| Supabase publishable key | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, fallback `EXPO_PUBLIC_SUPABASE_ANON_KEY` | all API | xcconfig → Info.plist `SUPABASE_PUBLISHABLE_KEY` |
| Project media API URL | `EXPO_PUBLIC_PROJECT_MEDIA_API_URL`, trailing `/` stripped (→ `extra.projectMediaApiUrl`) | Cloudflare R2 media worker (`mobile/cloudflare/project-media-worker`). If missing, media shows `Project media is not configured. Set EXPO_PUBLIC_PROJECT_MEDIA_API_URL to the media Worker URL.` | xcconfig |
| Location tracking enabled | `EXPO_PUBLIC_LOCATION_TRACKING_ENABLED` (`"0"` = off, anything else/unset = on) → `extra.locationTrackingEnabled` | gates the Team Map tab (`isLocationTrackingFeatureEnabled`) and location uploads | compile-time flag |
| Location pilot emails | `EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS`, comma-separated, trimmed and lowercased → `extra.locationTrackingPilotEmails` | `isLocationTrackingEnabledForUser`: empty list = everyone; otherwise only listed emails upload location (`locationTrackingRepository`). Does **not** affect the Team Map tab. | compile-time list |
| EAS project id | `EXPO_PUBLIC_EAS_PROJECT_ID`, default `93638a9a-d605-4fee-800e-6449ca444429` | Expo push token, OTA URL | only if keeping Expo push (§4.2) |
| Google Maps key | `GOOGLE_MAPS_API_KEY_IOS` or `GOOGLE_MAPS_API_KEY` (native build time only) | Team Map / clock-in map (other spec) | Team-map spec decides MapKit vs Google |
| App title | `extra.appTitle = "ServiceFlow"` | not read anywhere in the files covered here | — |

- Real values live in **EAS environment `production`** (every build profile uses `environment: "production"`). Pull them with `eas env:pull --environment production` (see `AGENTS.md`). `.env.example` lists the names. Never commit real keys. The publishable key is designed to be public, but keep it in an xcconfig that is not in git.
- `APP_VARIANT=production` is set for `simcheck` and `pilot` profiles. It is not read by any file in this area.
- App Store Connect app id (`ascAppId`): `6787451069` (eas.json submit `production` and `pilot`).

---

## 7. Info.plist / project-level facts

Sources: `app.config.js` and the checked-in `mobile/ios/ServiceFlow/Info.plist` and `project.pbxproj`. Where they disagree, both are listed.

| Item | Value |
|---|---|
| Display name (`CFBundleDisplayName`) | `ServiceFlow` |
| Bundle id | `com.ottawapainters.app` (it cannot change without a new App Store record. Keep it so installs upgrade.) |
| Version | app.config `1.5.0`. pbxproj `MARKETING_VERSION = 1.5.0`. **Info.plist hardcodes `CFBundleShortVersionString 1.4.0`** (not `$(MARKETING_VERSION)`), so it is ambiguous which one ended up in the uploaded binary. Check App Store Connect and use a higher version for the native build. |
| Build number | `CFBundleVersion 1` / `CURRENT_PROJECT_VERSION 1` locally. EAS `appVersionSource: "remote"` + `autoIncrement` controls the real number. The native build number must be higher than the last one in App Store Connect. |
| Min iOS | `IPHONEOS_DEPLOYMENT_TARGET = 15.1` (Expo SDK 54). Native may raise this (e.g. iOS 17 for modern SwiftUI) at the cost of older devices. Product decision. |
| Device family | `TARGETED_DEVICE_FAMILY = "1,2"` (iPhone + iPad), `supportsTablet: true`. `UIRequiresFullScreen = false` (iPad multitasking allowed). `UIRequiredDeviceCapabilities = [arm64]`. `LSRequiresIPhoneOS = true`. |
| Orientation | app.config `orientation: "portrait"`. Info.plist iPhone: `Portrait`, `PortraitUpsideDown`. iPad (`~ipad`): Portrait, PortraitUpsideDown, LandscapeLeft, LandscapeRight. Portrait lock is **not enforced on iPad**, so layouts must work in iPad landscape (the login form's `maxWidth 420` exists for this). |
| Appearance | `UIUserInterfaceStyle = Light`, `UIStatusBarStyle = UIStatusBarStyleDefault`, `UIViewControllerBasedStatusBarAppearance = false`, `CADisableMinimumFrameDurationOnPhone = true` (ProMotion 120 Hz) |
| Launch screen | `UILaunchStoryboardName = SplashScreen` (§2.1) |
| Encryption | `ITSAppUsesNonExemptEncryption = false` |
| ATS | `NSAllowsArbitraryLoads = false`, `NSAllowsLocalNetworking = true` (for the Metro dev server. Native can drop it.) |
| URL scheme | `com.ottawapainters.app` (unused, §1.7) |
| Background modes | `UIBackgroundModes = [location, fetch]`. `expo-location` `isIosBackgroundLocationEnabled: true`. **Must change** (§8). |
| Entitlements | `aps-environment = development` (use `production` for release). No Associated Domains, no App Groups. |

Permission usage strings (verbatim):

| Key | String |
|---|---|
| `NSLocationWhenInUseUsageDescription` | `ServiceFlow uses your location during an active shift to confirm job-site and travel time.` |
| `NSCameraUsageDescription` | `ServiceFlow uses the camera to take job-site photos and videos for project records.` |
| `NSMicrophoneUsageDescription` | `ServiceFlow uses the microphone to record audio when you capture job-site videos.` |
| `NSPhotoLibraryUsageDescription` | `ServiceFlow accesses your photo library so you can attach existing photos and videos to a project.` |

Not declared: `NSLocationAlwaysAndWhenInUseUsageDescription` and `NSLocationAlwaysUsageDescription` (`locationAlwaysAndWhenInUsePermission: false`, `locationAlwaysPermission: false`). The app only ever requests **While In Use**. `NSPhotoLibraryAddUsageDescription` is not declared. If the native app saves media to Photos, it needs one (camera/media spec).

Privacy manifest (`PrivacyInfo.xcprivacy`): required-reason APIs FileTimestamp (`C617.1`, `0A2A.1`, `3B52.1`), UserDefaults (`CA92.1`), DiskSpace (`E174.1`, `85F4.1`), SystemBootTime (`35F9.1`). `NSPrivacyCollectedDataTypes` is empty, `NSPrivacyTracking = false`. These reasons come mostly from RN/Expo libraries. The native app should declare **only the APIs its own code and SDKs use** (likely UserDefaults `CA92.1`, maybe FileTimestamp). It should also fill in `NSPrivacyCollectedDataTypes` (precise location, email, name, photos/videos, user ID; linked to identity; app functionality; no tracking) to match the App Privacy labels.

---

## 8. Native iOS changes required by App Store review

Rejections to address: 2.3.10 (non-iOS screenshots), 5.1.1(iv) (location permission nagging / Settings redirect before the prompt), 2.5.4 (background location used only for employee tracking), 3.2 (looks like a single-business app). The following items in this area must differ from the RN app.

### 8.1 Guideline 2.5.4: background location

- Remove `location` from `UIBackgroundModes`, and remove `fetch` unless a native feature really needs Background App Refresh (nothing in this area does). Do not set `allowsBackgroundLocationUpdates` or `showsBackgroundLocationIndicator`.
- More-screen copy that depends on this (keep it truthful):
  - `Location access: Active shifts only` stays accurate.
  - `Tracking may pause if ServiceFlow is force-closed.` becomes inaccurate, because tracking will pause whenever the app is in the background. Suggested replacement: `Location updates while ServiceFlow is open.` Confirm the wording with the product owner and the time-tracking spec.
  - `ServiceFlow requests location when you clock in and stops tracking when you clock out.` can stay.
  - Mode labels `Travel tracking active` etc. depend on what the time-tracking spec keeps.
- Team Map (manager tab) should present data as "last seen" (team-map spec).

### 8.2 Guideline 5.1.1(iv): permission timing

- **Notifications:** the RN app asks for notification permission the moment the main shell appears after login (`registerPushToken`), and again at every clock-in or restored shift. For native:
  - Do not request on launch or at login. Request at a moment where the user sees why, e.g. the first Clock In (after the location prompt), or from a clear "Enable shift reminders" control on More. Only call `getNotificationSettings` at launch. If already authorized, register for remote notifications and call `register_push_token`.
  - Never show a custom pre-prompt that pushes the user to allow, and never show an "are you sure" screen after they deny.
- **Location:** request While-In-Use only when the user taps Clock In (or the clock-in map's "use my location"). No screen before the system prompt. After a denial, show a Settings link **only** as a result of the user tapping Clock In again, not on launch and not as a banner that repeats. (The RN camera screen links to Settings when camera access is blocked. That is fine because it only appears when the user opens the camera, but make sure the system prompt comes first.)
- Do not call `requestTrackingPermissions()`-style re-prompts every time an active shift is restored on launch. Check the status instead (the time-tracking spec owns this).

### 8.3 Guideline 3.2: not a single-business app

- Do not ship the Ottawa Painters assets (`ottawa-painters-*`) or `HomeScreen`/`ContactScreen`/`QuoteScreen`/`ServicesScreen` (painting-company marketing with placeholder contact details).
- Login helper text `Employee accounts are created by the office.` implies one company with no self-serve path. Replace it with sign-up and join entry points (8.5).
- The `"Painter"` display-name fallback (§3.5) → use a generic `"Crew member"` or the email prefix.
- The maintenance copy `…while your jobs and time records are verified` is fine and generic.
- The role gate should use per-company `org_members.role` (§1.6), so any company's owner, admin or manager gets manager UI.
- Show the active company name (e.g. on More, and in a company switcher if the user belongs to more than one company).

### 8.4 Guideline 2.3.10: screenshots

Not a code change. Take screenshots from the native build on iOS simulators or devices: 6.9" iPhone, and 13" iPad because `TARGETED_DEVICE_FAMILY` includes iPad (or drop iPad support by setting device family to `1`, which also removes the iPad landscape requirement). Screenshots must show iOS UI with no Android status or navigation bars and no device frames from another platform. Show clock-in, jobs, photos and timesheet.

### 8.5 New flows: where they fit in navigation

The backend work is in `docs/multi-company-plan.md` (Phases 2, 3 and 5). RPC names there are planned, not all built yet: `create_organization`, `accept_invitation(code)`, edge function `send-invitation`, table `org_invitations`, 8-character codes shown as `K7Q2-MX9P`, 7-day expiry. **Confirm what exists before building.**

Revised root state machine:

```
Boot
├─ no session ──────────► Auth stack
│                          ├─ Welcome / Sign in (email + password; plan also allows email OTP)
│                          ├─ Create account (email sign-up)  ── "Create an account" link on Sign in
│                          ├─ Verify email (if confirmation or OTP is on)
│                          └─ Forgot password (recommended; not in RN)
├─ session, maintenance ─► Maintenance (add a "Sign out" button: otherwise stuck users cannot switch accounts)
├─ session, 0 active memberships ─► Onboarding (no tab bar)
│                          ├─ "Create a company"  → name, trade, city/timezone, phone → create_organization → owner → Main
│                          ├─ "Join with an invite code" → code entry → accept_invitation(code) → Main
│                          ├─ Pending invites matching the verified email (one-tap join)
│                          └─ Sign out / Delete account (still reachable here)
└─ session, ≥1 membership ─► Main (tabs, as §1)
                             └─ More
                                ├─ Signed in as / Company (+ switcher if >1 company)
                                ├─ Join another company (invite code)
                                ├─ Invite crew (managers; optional, may stay web-only)
                                ├─ Location tracking card (as §2.4, copy per 8.1)
                                ├─ Sign out
                                └─ Delete account  → confirmation screen → server deletion → back to Auth stack
```

This replaces the RN behaviour where "profile missing" or "inactive" leads to an empty main shell (§1.1). The "0 active memberships" check should use `org_members` (or `private.my_org_ids()` through an RPC), not `employees`.

**In-app account deletion (5.1.1(v))**
- It must be possible to start deletion from inside the app, without emailing anyone. Put it at More → `Delete account` (destructive style, below Sign out), and also on the Onboarding screen.
- The flow needs a confirmation screen that explains what is deleted. Per the plan: the login and memberships are removed, and time entries a company needs for payroll are kept, marked as a deleted user. It may require re-authentication (password or OTP). Then call a server-side deletion endpoint (edge function with service role; the RPC or edge function name is **not yet defined**). Then sign out locally and return to the Auth stack.
- Company owners: define what happens to a company whose only owner deletes their account (block with a message, or require transferring ownership). **This is a product decision and has not been made.**

**Sign-up**
- Supabase email sign-up (`signUp(email, password)`), or email OTP (`signInWithOtp` + `verifyOtp`) as the plan proposes. The plan keeps password login for the App Review demo account. There is no third-party login, so Sign in with Apple is not required.
- If email confirmation stays on and uses links, the native app needs a URL scheme or universal link. Using OTP codes avoids that.

**App Review access (2.1)**: a demo company plus an owner login and a crew login with passwords, and review notes that explain create-company and invite-code. This needs the password sign-in path kept.

### 8.6 Other changes that follow from going native

- The OTA update prompt is removed (§5). Optionally add an App Store update banner or minimum-version gate.
- Push notifications: Expo push tokens do not exist natively. The backend must support APNs tokens (§4.2). **Blocking decision.**
- Session storage moves from AsyncStorage to Keychain. Users sign in again once after upgrading.
- Fix, or explicitly decide to keep, the RN quirks: the tab resets to Clock In on every token refresh (§1.3); the maintenance screen has no sign-out; sign-out has no confirmation during an active shift and does no explicit shift or reminder cleanup (§2.4); the maintenance flag is checked only at login or launch.
- `aps-environment` must be `production` for release builds.
