# 02 — Clock-in, time tracking, location and reminders

Source of truth (read in full): `mobile/src/screens/ClockInScreen.js`, `mobile/src/screens/clock-in/{ActiveClockInBody,ClockInMap,ClockInMap.web,JobPhotosPanel}.js`, `mobile/src/lib/{timeTracking,timeTrackingRuntime,timeTrackingStorage,timeTrackingState,timeTrackingLocation,timeTrackingNotifications(.web),timeTrackingConstants,timeTrackingGeofence(.web),timeTrackingGeofenceConfig,timeEntryRepository,timeEntryModel,trackingModel,locationTrackingRepository,locationTrackingPolicy,locationTrackingFeature,projectClockInSummary,useEmployeeProjectContext}.js`, `mobile/App.js`, `mobile/app.config.js`, `mobile/docs/time-tracking-architecture.md`, `mobile/docs/location-tracking-rollout.md`.
Server: `supabase/migrations/20260805033248_remove_job_task_time_entries.sql` (latest body of `record_time_entry_command`), `20260805025528_supabase_v2_cleanup.sql` (tables, indexes, body of `record_location_update`), `20260925205112_scope_definer_functions_to_organizations.sql` (company-scoping wrappers), `20260925210514_membership_based_permissions.sql` (membership patch), `supabase/functions/stale-location-alerts/index.ts`. Live column lists of `public.time_entries` and `public.employee_tracking_status` were confirmed read-only against project `bwbckdkouqghdadpkjvn`.

Global conventions (colour tokens, SF Pro, RN weight → SwiftUI weight mapping, `letterSpacing` → `.tracking`, Dynamic Type, light mode only) are in `01-app-shell-and-auth.md` §0 and are not repeated here. Summary: `"500"` `.medium`, `"600"` `.semibold`, `"700"` `.bold`, `"800"` `.heavy`, `"900"` `.black`. All sizes are points.

Markers used below:
- **BUG (RN)**: current behaviour that is almost certainly unintended. Each one says what the RN app does and what native should do. Every one needs an explicit keep-or-fix decision.
- **AMBIGUOUS**: the code does not settle the question.
- **APP STORE**: must change. Section 7 has the details.

---

## 0. Where this area lives

- Tab `clock` (label `Clock In`, the first tab and the default after sign-in) renders `ClockInScreen`. The screen stays mounted when other tabs are selected: it is hidden with `display: none`, not unmounted.
- `useTimeTracking(trackingProjects, sessionUser)` is created once in `AppRoot` (App.js). It is the single owner of shift state, and its outputs feed Clock In, Jobs, Project Detail, Timesheet and More.
  - `trackingProjects` comes from `useEmployeeProjectContext`, via `listMappedProjects()`.
- Props `ClockInScreen` receives from App.js:

| Prop | Value |
|---|---|
| `enabled` | `activeTab === "clock" && !selectedProject` (gates labour-task polling only) |
| `user` | `session.user` (Supabase user) |
| `painterName` | `getEmployeeDisplayName(employeeProfile, sessionUser)` (spec 01 §3.5) |
| `onViewProject(project, action?)` | pushes `ProjectDetail`. `action` is `null` or `"photos"` |
| `activeShift`, `activeElapsedMs`, `todayWorkedMs`, `locationStatus`, `trackingNotice`, `trackingPermissions`, `suggestedProject` | from `useTimeTracking` |
| `projects` | `tracking.resolvedProjects` (normalised, geocoded mapped jobs) |
| `onClockIn` | `tracking.clockIn` |
| `onClockOut` | `clockOutWithPending(reason)`: sets App-level `clockOutPending = true`, awaits `tracking.clockOut(reason)`, then sets it back to `false`. Project Detail uses `clockOutPending` to hide live-shift UI while the clock-out finishes. |
| `onSwitchProject` | `tracking.switchProject` |
| `onUpdateTimeEntry` | `tracking.updateTimeEntry` |

- Other callers of the same engine (their UI is specified elsewhere):
  - Project Detail's primary button: `Clock In` / `Switch Job` / `Clock Out`. It calls `onClockOut("project_detail")`.
  - Timesheet and Project Detail edit/delete: `updateTimeEntry` and `deleteTimeEntry`.

### 0.1 Project data feeding the screen

- `listMappedProjects()`:
  - Query: `job_feed` `select("*")`, `.eq("is_feed_visible", true)`, `.in("status", ["scheduled","active"])`, `.order("updated_at", {ascending:false})`.
  - Paged with `.range(from, from+999)` until a page returns fewer than 1000 rows.
  - Each row is passed through `normalizeJob`. Rows are dropped if `status` is `cancelled` or `archived`, if the name matches `/qa web smoke|do not use/i`, or if `latitude`/`longitude` is null.
  - `normalizeJob` sets `id = job_id = companycam_id = companycam_project_id = String(row.id)` (the `jobs.id` UUID), `formatted_address` (or `[address_line_1, city, province, postal_code].join(", ")`), `state = province`, `is_lead = false`, `is_archived = status==="archived"`, plus `budgetProgress`.
  - It is loaded once per signed-in user id. It reloads only when `refreshProjectData()` is called (Jobs screen `onProjectsChanged`). There is **no periodic refresh**.
- `useTimeTracking` runs `normalizeProject` on each project, then `geocodeProjects(projects, 80)`: the first 80 projects without coordinates go through `geocodeProject`, the rest pass through unchanged. The result is `resolvedProjects`.
  - Because the list is already filtered to mapped jobs, geocoding almost never happens here.
- `normalizeProject(project)`:
  - `id = String(companycam_id || companycam_project_id || projectId || id)`. Returns null if the id is empty.
  - `name = name || project_name || "Project"`.
  - `address = formatAddress(project)`.
  - `formatted_address = formatted_address || address`.
  - Latitude is valid only in [-90, 90] and longitude only in [-180, 180]. Blank strings become null. **Exactly (0, 0) becomes (null, null).**
- `formatAddress(project)`: `formatted_address` → `address` → `[street_address_1, street_address_2, city, state, postal_code].filter(Boolean).join(", ")`.
- The clock-in UI uses a different formatter, `ClockInMap.formatProjectAddress(project)`: `formatted_address || [city, state, postal_code].filter(Boolean).join(", ")`.
- `geocodeProject`:
  - Uses `Location.geocodeAsync(formatted_address || address)`. Native: `CLGeocoder.geocodeAddressString`.
  - Cache key `ottawaPainters.projectGeocodes.v1`. JSON map keyed by `companycam_id || address` → `{latitude, longitude, address, resolvedAt}`.
  - On failure it returns the project without coordinates.

---

## 1. Clock-in screen

The screen has two top-level states: **clocked out** (`activeShift == null`) and **clocked in** (`activeShift != null`). There is no loading gate. The clocked-out screen renders straight away, even before the persisted shift is hydrated. If hydration then finds an active shift, the screen switches to the clocked-in view. Native should hydrate synchronously from disk before the first frame, to avoid a flash.

### 1.1 Colours used in this area

| Name in code | Hex / rgba | Use |
|---|---|---|
| `green` | `#173f37` | (declared, unused on this screen) |
| `teal` | `#2f8d7f` | spinners, icons, radius circle, route line, switch chip, `±5m` text |
| `navy` | `#31495d` | Clock In pill, map pins, selected map label, View Project, camera button |
| `white` | `#ffffff` | |
| `ink` | `#11201d` | primary text |
| `muted` | `#8b9692` | secondary text, icons |
| `border` | `#e0e3e1` | card borders |
| active-view background | `#f7f7f7` (outer), `#f4f6f6` (scroll view) | |
| hairline | `#edefee` | active header bottom border, row separators |
| red | `#c0432b` | Clock Out button, error text |
| off-site icon | `#b56025` | |
| location text | `#4c5a56` | |
| Change Job border | `#b9d6cd` | |
| icon tile | `#e9f3ee` | |
| search field bg / border | `#f4f7f5` / `#e3ebe7` (main), `#dfe7e3` (switcher) | |
| LEAD pill bg / text | `#e8f1ff` / `#245c9c` | |
| result row separator | `#eef1ef` (search), `#edf0ee` (switcher) | |
| switcher backdrop | `rgba(17,32,29,0.42)` | |
| switcher handle | `#d7ddda` | |
| switcher close bg | `#edf2ef` | |
| Photos panel | muted `#6d7f7b`, hairline `#e4eae8`, thumb bg `#dfe6e4`, fallback `#c9d4d1`, more tile `#eef2f1`, error bg `#fdecea`, error text `#a5321f` | |

Icons are Ionicons (`@expo/vector-icons`). Spec 01 §1.3 covers bundling Ionicons versus using SF Symbols. Suggested SF Symbols:

| Ionicons | SF Symbol |
|---|---|
| `search` | `magnifyingglass` |
| `close-circle` | `xmark.circle.fill` |
| `close` | `xmark` |
| `location` | `mappin` (filled pin) |
| `map` | `map.fill` |
| `map-outline` | `map` |
| `chevron-forward` | `chevron.right` |
| `alert-circle` | `exclamationmark.circle.fill` |
| `alert` | `exclamationmark` |
| `play` | `play.fill` |
| `locate` | `scope` |
| `swap-horizontal` | `arrow.left.arrow.right` |
| `warning-outline` | `exclamationmark.triangle` |
| `navigate-outline` | `location` |
| `stop-circle-outline` | `stop.circle` |
| `folder-open-outline` | `folder` |
| `images-outline` | `photo.on.rectangle` |
| `camera` | `camera.fill` |
| `briefcase-outline` | `briefcase` |

### 1.2 Clocked-out layout (top to bottom)

The screen background is `#ffffff`. It fills the tab content area, below the top safe-area inset and above the tab bar.

**A. Header**: padding horizontal 22, top 14, bottom 14, bg white. It is in normal layout flow, so it pushes the map down. Z-order is above the map.
1. Painter name: `painterName`, `ink` 15 `.black`, margin-bottom 6.
2. Row (baseline-aligned, 8 spacing, wraps):
   - `"{H}H {MM}M"`, `ink` 22 `.black`, tracking −0.5. Computed from `todayWorkedMs`: `totalMinutes = floor(ms/60000)`, `H = floor(totalMinutes/60)` (no padding), `MM` = minutes padded to 2 digits. Example: `0H 00M`, `7H 05M`.
   - `Hours used today`, `muted` 12.5 `.bold`.
3. Search field: height 48, margin-top 14, corner radius 18, bg `#f4f7f5`, 1pt border `#e3ebe7`, padding horizontal 14, HStack spacing 10.
   - Leading icon: `search`, 20, `muted`.
   - TextField: placeholder `Search all projects and leads` (`muted`), text `ink` 15 `.bold`, fills the remaining width. Autocapitalisation none, autocorrect off, return key `.search`. Submit dismisses the keyboard.
   - Trailing: a small `teal` spinner while `searching`. Otherwise, if the query is non-empty, a `close-circle` 20 `muted` button with an 8pt hit slop that clears the query.
   - Typing: set `query`. If `query.trim()` is non-empty, set `searching = true` **synchronously**, so the empty state does not flash during the debounce.
   - The search runs 250 ms after the last keystroke: `searchJobsForClockIn(query)` (§3.4). The previous request is cancelled when the query changes. Success sets `results` to up to 50 matches. An error sets `results = []` and `searchError = error.message`.
   - When the trimmed query becomes empty: clear results and error, and set `searching = false`.
4. Results card (only when `query.trim()` is non-empty): margin-top 10, radius 18, white, 1pt `#e0e3e1`, clipped, shadow (black, opacity 0.08, radius 10, y 4).
   - One row per result: HStack padding h12 v10, spacing 10, bottom border 1pt `#eef1ef`.
     - Icon tile 30×30, radius 10, bg `#e9f3ee`, with `location` 15 `teal`.
     - Text column:
       - Title row (spacing 7): name, `ink` 13 `.black`, one line, can shrink. If `is_lead`, a pill follows: padding h6 v2, radius 6, bg `#e8f1ff`, text `LEAD` `#245c9c` 8.5 `.black`, tracking 0.5.
       - Address: `formatProjectAddress(result)` or `No address on file`. `muted` 11.5 `.semibold`, margin-top 1, one line.
   - Tapping a row calls `selectProject(result)`:
     1. Dismiss the keyboard.
     2. `selectedProject = result`, `loading = false`.
     3. Clear the query, results and search error.
     4. Clear `clockInError`.
   - Empty state (when not searching and there are no results): `searchError` if set, otherwise `No matching projects or leads found.`, in `muted` 13 `.bold`, padding 14.
   - The results card is **not scrollable** and grows the header. With many results the map shrinks and rows are clipped at the bottom. Native may put the list in a ScrollView capped at the available height (keep this cosmetic).

**B. Canvas**: fills the remaining space, clips its content. Z-order, bottom to top:
1. Map (§1.3), full bleed.
2. Map name labels overlay (§1.3).
3. "Map is taking too long" banner (§1.3).
4. Recenter control (§1.3).
5. Project card.
6. Clock-in cluster.

**Project card**: pinned at top 14, left 14, right 14. Touches outside the card pass through to the map.
- Card: white, radius 14, padding 12, HStack spacing 12, shadow (black 0.08, radius 10, y 4), clipped.
  - Pressed state (only when a project exists): opacity 0.85, scale 0.99.
  - Disabled when there is no `displayProject`.
  - Tap: dismiss the keyboard, then `onViewProject(displayProject)` (push Project Detail).
- Thumb: 42×42, radius 10, bg `#e9f3ee`, `map` icon 22 `teal`.
- Info column:
  - `loading` (initial `getLatestActiveProject` still pending): a `teal` spinner. This shows **even if a nearest or selected project exists**.
  - `displayProject` exists:
    - Name: `ink` 15 `.black`, tracking −0.2, one line.
    - Address: `formatProjectAddress(displayProject)` or `No address on file`, `muted` 12.5 `.semibold`, margin-top 2, one line.
  - No project:
    - Title `No active project`, same style as the name.
    - Subtitle: the `error` string from the latest-project query if set, otherwise `No active jobs are available.`
- Trailing `chevron-forward` 20 `muted`, only when a project exists.

**Clock-in cluster**: rendered only if `displayProject?.is_lead` is not true. **A lead has no Clock In button on this screen.** VStack centred horizontally, bottom = `safeAreaInsets.bottom + 22` measured from the canvas bottom. The canvas already ends at the tab bar, so this adds the inset again. Replicate as is.
- Feedback bubble (only when `trackingNotice?.message || clockInError`):
  - Max width 86% of the screen, margin-bottom 10, radius 8, white, 1pt `#e0e3e1`, padding h12 v9, HStack spacing 8, shadow (black 0.12, radius 8, y 4).
  - Icon `alert-circle` 16 `navy`.
  - Text: `ink` 12.5 `.bold`, line height 17, wraps.
  - `trackingNotice.message` takes priority over `clockInError`.
- Clock In pill: HStack, bg `navy`, padding left 6, right 26, vertical 6, radius 32, spacing 12, shadow (black 0.2, radius 12, y 6).
  - Disabled when `clockingIn || !displayProject`: opacity 0.55.
  - Pressed: opacity 0.9, scale 0.98.
  - Accessibility label `Start clock in`.
  - Contents:
    - 38×38 white circle holding `play` 16 `navy`, or a small `navy` spinner while `clockingIn`.
    - Label `Clock In`, or `Clocking In` while `clockingIn`. White 16 `.black`, tracking 0.3.
  - Tap: dismiss the keyboard, then `startClockIn()` (§1.6).

### 1.3 Map (`ClockInMap.js`, iOS)

**Provider:** `react-native-maps` 1.29.0 with **no `provider` prop**. On iOS that is **Apple MapKit**, not Google. Native: SwiftUI `Map` or `MKMapView`.

**Options:**
- `mapType` standard.
- Rotation off, pitch off.
- No compass, no scale.
- Buildings shown.
- User location shown (`showsUserLocation`).
- A pin tap does not move the camera.
- Tapping the map background dismisses the keyboard.

**Selected project for the map:**
- `project` = `displayProject`. If it has no coordinates:
  1. Look for the same id in `projects` with coordinates.
  2. Otherwise geocode `formatProjectAddress(project)` with `Location.geocodeAsync` (not cached here).
  3. Otherwise there is no coordinate: no circle or route line.
- Re-resolve when the id, `formatted_address`, `city`, `state`, `postal_code` or the project list changes.

**Markers:**
- One per project in `projects` that is not archived and has coordinates. Duplicates are removed by id (the fallback id is `lat,lng` to 6 decimals).
- If the selected project has coordinates but is not in the list, it gets a marker too.
- Every pin is a standard red-pin-style marker tinted `navy` `#31495d`, with callout title `project.name || "Project"`.
- Selection is **never** shown on the pin: no colour change, no z change.
- Tapping a pin: dismiss the keyboard, then `selectProject(project)` (same as a search result). On iOS the marker `title` also opens the native callout bubble.
- Native: use `Marker(name, coordinate:).tint(Color(hex: 0x31495d))`, or `MKMarkerAnnotationView` with `markerTintColor`. Do not rebuild annotations on every GPS tick.

**Radius circle** (selected job only): centre = job coordinate, radius **150 m** (the same value as `SITE_RADIUS_METERS`, but hard-coded separately). Stroke 2pt `rgba(47,141,127,0.55)`, fill `rgba(47,141,127,0.18)`.

**Route line** (only when both the job and user coordinates exist): a straight two-point line from user to job, drawn as three stacked polylines, bottom to top:
1. 10pt, `rgba(17,32,29,0.16)`
2. 7pt, `rgba(255,255,255,0.92)`
3. 4pt, `#2f8d7f`

All three use round caps and joins. Overlays are drawn under annotations.

**Name labels:** an overlay that ignores touches, drawn above the map (not as annotations).
- For each marker, `pointForCoordinate` gives its screen point. A pill container 168pt wide is placed with its centre at `(x, y − 66)`, so the pill floats above the pin head.
- Shown only when not mid-gesture: hidden on `onRegionChange`, shown again on `onRegionChangeComplete`.
- The selected marker's label is always shown. Other labels show only while the current `latitudeDelta ≤ 0.12`.
- Positions are recomputed when the marker set changes, after each settled region change, and once 700 ms after mount.
- Pill style: max width 168, radius 999, bg `rgba(255,255,255,0.96)`, 1pt `rgba(224,227,225,0.95)`, padding h10 v4, shadow (black 0.14, radius 8, y 3). Text `ink` 11.5 `.heavy`, one line, truncated.
- Selected pill: bg `navy`, border `rgba(255,255,255,0.92)`, text white.
- Native: in SwiftUI `Map`, use `Annotation` content with an offset label, or an `MKMapView` overlay view, hidden during camera changes to match.

**Camera:**
- Initial region `buildMapRegion(jobCoord, userCoord)`:
  - Both exist: centre on their midpoint. `latitudeDelta = max(|Δlat| × 1.35, 0.035)`, and the same for longitude.
  - One exists: that point, delta 0.012.
  - Neither: Ottawa `45.4215, −75.6972`, delta 0.035. (**APP STORE / 3.2**: an Ottawa default is company-specific. Consider the company's location or the user's region. See spec 01 §8.3.)
- The first time either coordinate becomes available: animate to `buildMapRegion` over 250 ms. This happens once per mount.
- Whenever the selected project **id** changes and it has a coordinate: animate to the job, delta 0.012, 350 ms. This happens once per id (tracked by the last-centred id).

**Recenter button:** stack at right 14, bottom = `safeAreaInsets.bottom + 110`, aligned trailing, 8 spacing.
- Error notice (only when `locationError`): max width 220, radius 10, bg `rgba(255,255,255,0.96)`, 1pt `#e0e3e1`, padding h10 v8, shadow (0.14, radius 7, y 3). Text `ink` 12 `.bold`, line height 16. Ignores touches.
- Button: 42×42 white circle, shadow (0.14, radius 7, y 3). Icon `locate` 21 `teal`, or a small `teal` spinner while locating (opacity 0.6, disabled). Hit slop 6. Accessibility label `Recenter map on your location`.
- Tap:
  1. Call `refreshForegroundLocation({request: true})`. **This currently calls `Location.requestForegroundPermissionsAsync()`, so it can show the system prompt (APP STORE, §7).**
  2. If granted, `getCurrentPositionAsync({accuracy: Balanced})` (no timeout) sets `foregroundPoint`.
  3. Target = the fresh point, or the existing user coordinate.
  4. No target: set `locationError = "Location unavailable. Enable location access and try again."` and animate to the default region.
  5. Target found: animate to it, delta 0.012, 350 ms.
  6. If anything throws: `Could not get your location. Try again.`
- `locationError` is cleared only at the start of the next recenter tap.

**"Map is taking too long" banner:** shown if the native map has not fired `onMapReady` within 4500 ms. Ignores touches. Position top 18, left 18, right 18, min height 58, radius 14, bg `rgba(255,255,255,0.96)`, 1pt `rgba(224,227,225,0.95)`, padding h14 v10, HStack spacing 10, shadow (0.14, radius 7, y 3).
- Icon `map-outline` 22 `navy`.
- Title `Map is taking too long` (`ink` 13 `.black`).
- Body `You can still choose a job and use location.` (`muted` 11.5 `.bold`, margin-top 2).
- It is drawn **under** the project card, so the card mostly covers it.
- **AMBIGUOUS:** a code comment says "iOS Apple Maps never fires onMapReady". If that is true, the RN iOS app shows this banner every time after 4.5 s, hidden behind the card. Native: show it only if MapKit has not finished loading in 4.5 s (`mapViewDidFinishLoadingMap` / `mapViewDidFailLoadingMap`).

**Web variant** (`ClockInMap.web.js`, for reference only; not needed on iOS): no map. Instead a panel titled `Web Map Preview` with coordinates or `Location not available in this browser session`, a list of nearby projects with distances, and an empty state `No mapped projects` / `Search or sync projects to choose a job.`

### 1.4 Which project is shown and targeted (clocked out)

`displayProject = activeShift?.project || selectedProject || nearestWithinRadius || defaultProject`

- `selectedProject`: the last pin or search result tapped. It sticks until the screen is remounted.
- `nearestWithinRadius`: `findNearestProject(projects, currentPoint)` returns the non-archived project with coordinates that has the smallest haversine distance. It counts only if the distance is **≤ `NEAREST_PROJECT_RADIUS_METERS` = 2000 m**. It is recomputed whenever `currentPoint` or `projects` changes, so it can change while the user watches.
- `defaultProject`: on mount, `getLatestActiveProject()` = `job_feed` `select("*")` where `is_feed_visible = true` and `status in (scheduled, active)`, ordered by `updated_at desc`, limit 1, then `normalizeJob`. It has no QA-name filter. On error, `error = error.message` (shown in the card subtitle and used as the clock-in error). `loading` is true until this resolves.
- `currentPoint = locationStatus?.point || foregroundPoint`.
  - `locationStatus` exists only during a shift.
  - `foregroundPoint`: on mount, and whenever `trackingPermissions.foreground` becomes true, the screen calls `refreshForegroundLocation({request: false})`. That is a one-shot `getCurrentPositionAsync(Balanced)` **only if already authorised**. It never prompts. It also updates on recenter.
- Distance: haversine with R = 6 371 000 m, rounded to an integer metre (`trackingModel.distanceMeters`).

### 1.5 Clocked-in (active shift) layout

The outer background is `#f7f7f7`. The content is a vertical ScrollView with bg `#f4f6f6` and bottom content padding 24.

1. **Header**: white, padding h16 top 12 bottom 13, HStack spacing 10, bottom border 1pt `#edefee`.
   - Text column:
     - Job name: `project?.name || "Selected Project"`, `ink` 18 `.black`, tracking −0.3, one line.
     - Address: `formatProjectAddress(project)` or `No address on file`, `muted` 12.5 `.medium`, margin-top 2, one line.
   - **Change Job** button: min height 34, 1pt border `#b9d6cd`, capsule, padding h10, HStack spacing 5. Icon `swap-horizontal` 15 `teal`, label `Change Job` `teal` 11.5 `.black`.
     - Disabled while `switching` (opacity 0.55). Pressed opacity 0.85.
     - Accessibility label `Choose a different job`.
     - Tap opens the Change Job sheet (§1.7).
2. **Shift card**: white, radius 12, 1pt `#e0e3e1`, horizontal margin 10, margin-top 12, padding h14 top 6 bottom 4.
   1. Location row: HStack spacing 6, margin-top 8, min height 20. It is always present, even when empty.
      - If `statusMessage`: an icon 15 (`warning-outline` `#b56025` when `locationStatus.onSite === false`, otherwise `navigate-outline` `teal`) and the text in `#4c5a56` 12.5 `.semibold`, max 2 lines.
      - `statusMessage`:
        - `base = trackingNotice?.message || locationStatus?.label || nil`.
        - `distanceText = formatDistance(locationStatus.activeDistance)`, when that distance is not null.
        - If `base` exists, `distanceText` exists and `base` does not already contain `distanceText`: `statusMessage = "\(base) (\(distanceText) from job)"`. Otherwise `statusMessage = base`.
      - `locationStatus.label` values (verbatim):
        - `Location captured. Job-site distance unavailable.` (job has no coordinates)
        - `On site, {d} from job.` (distance ≤ 150 m)
        - `Off site, {d} from job.`
        - `Location accuracy is still improving.` (fix accuracy > 250 m)
      - `formatDistance(m)`:
        - null or non-finite → `distance unknown`
        - `< 1000` → `"{round(m)} m"`, never negative
        - otherwise → `"{m/1000 to 1 decimal} km"`
   2. **Suggested-job chip** (only when `suggestedProject`): centred, bg `teal`, capsule, padding h14 v9, margin-top 10, max width 100%, HStack spacing 7.
      - Icon `swap-horizontal` 16 white, or a small white spinner while switching.
      - Text `Switch to {suggestedProject.name}`, or `Switching…` while switching. White 13 `.black`, one line.
      - Accessibility label `Switch to {name}`. Disabled while switching.
      - Tap: `switchToProject(suggestedProject)`.
   3. **Timer + Clock Out** row: HStack, space-between, spacing 12, margin-top 8, margin-bottom 12.
      - Timer: HStack aligned to the bottom edge.
        - Main text `ink` 34 `.black`, tracking −1, line height 39.
        - Seconds text `muted` 17 `.heavy`, bottom margin 3.
        - Format: `elapsed = max(0, now − startedAt)` (the edited start), ticking every 1 s.
        - `main = HH:MM` (hours padded to 2 digits, can exceed 2 digits past 99 h; minutes padded to 2), `seconds = SS`. Example: `02:07` + `45`. When hours are 0 it shows `00:MM`.
      - Clock Out button: min height 44, radius 12, bg `#c0432b`, padding h15, HStack spacing 8.
        - Icon `stop-circle-outline` 19 white, or a white spinner while clocking out.
        - Label `Clock Out`, or `Clocking Out` while clocking out. White 14 `.black`.
        - Accessibility label `Clock out current shift`.
        - Disabled while clocking out (opacity 0.55). Pressed opacity 0.85.
        - Tap: `stopClockIn()` (§1.6).
   4. Error line (only when `actionError` = `clockInError`): `#c0432b` 12.5 `.bold`, margin-bottom 10.
   5. **Start row**: top border 1pt `#edefee`, padding v10, HStack spacing 9.
      - Info (fills, baseline HStack spacing 7, wraps):
        - `STARTED`: `muted` 10.5 `.heavy`, tracking 0.5, uppercase.
        - Start time: `ink` 14.5 `.black`. Format `toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})`, e.g. `7:05 AM`. Native: `Date.FormatStyle().hour().minute()`. It shows `--` if there is no start.
        - If `summarizeAdjustments(activeShift)` is non-null: `Edited {±N}m`, `muted` 11 `.bold`, one line. N is `round((startedAt − originalStartedAt)/60000)` with sign `+`/`-`/none. The line is hidden when N = 0. Example: `Edited -10m`.
      - Two buttons `-5m` and `+5m`: min width 48, 1.5pt border `#e0e3e1`, radius 10, padding v6. Text `teal` 13 `.black`.
        - Disabled while `adjustingStart` (opacity 0.55). No pressed style.
        - Accessibility labels `Move start time 5 minutes earlier` / `Move start time 5 minutes later`.
        - Tap: `adjustActiveStart(∓5)` (§1.6).
   6. **View Project** row: top border 1pt `#edefee`, padding v12, HStack spacing 8.
      - Icon `folder-open-outline` 17 `navy`, label `View Project` `navy` 13.5 `.heavy` (fills), `chevron-forward` 16 `muted`.
      - Accessibility label `View project details`.
      - Tap: `onViewProject(project)`. Pressed opacity 0.85.
3. **Photos panel** (horizontal margin 10, margin-top 10): `JobPhotosPanel` (§1.8).
4. **Labour tasks panel** (horizontal margin 10, margin-top 10): `ProjectLabourTasksPanel` with `project`, `activeShift`, and `tracking = useProjectLabourTasks(projectId, {enabled: enabled && isClockedIn, userId})`. Its contents are specified in the labour-tasks spec.

**Order: header → shift card → Photos → Tasks.** The task list is last so it can grow without pushing the actions down.

### 1.6 Buttons and flows on the Clock-in screen

**`startClockIn()`** (Clock In pill):
1. If `clockingIn` → ignore.
2. If there is no `displayProject`: `clockInError = error || "Choose an active project before clocking in."` and stop. (Unreachable in practice, because the button is disabled.)
3. `clockingIn = true`, clear `clockInError`.
4. `shift = await onClockIn(displayProject)` (§2.4).
   - Null → `clockInError = "Clock in could not start. Check location permissions and try again."` (**APP STORE**, §7).
   - Throws → `clockInError = error.message || "Clock in could not start. Try again."`
5. Finally `clockingIn = false`.
6. On success the screen re-renders into the clocked-in view, because `activeShift` is now set.

**`stopClockIn()`** (Clock Out):
1. If `clockingOut` → ignore.
2. `project = displayProject`, `clockingOut = true`, clear the error.
3. **Push Project Detail first** (`onViewProject(project)`), so the map never flashes while the shift ends.
4. `entry = await onClockOut("manual")`.
   - Null → `clockInError = "Clock out could not complete. Try again."`
   - Throws → `error.message || "Clock out could not complete. Try again."`
   - These errors are set on the Clock-in screen, which is now under Project Detail.
5. On success, fire-and-forget `maybePromptJobOverBudget(project)`:
   - Stop if there is no project id or user id.
   - If `hasAnsweredJobOverBudgetReason(userId, projectId)` → stop. The stored key is `ottawaPainters.labourTaskOverBudgetReasonAnswered.v1:{userId}:job:{projectId}:unpublished`.
   - `evaluateJobOverBudget(projectId)` uses `listProjectBudgetProgress([id])` (budget spec). It is over only if `percentUsed > 100` and `hoursUsed > 0`. `hoursOver = hoursUsed − hoursUsed × 100/percentUsed`.
   - If over, show `OverBudgetReasonSheet` as a modal over everything. Errors are swallowed.
   - Sheet copy (verbatim):
     - Badge: `{h} over budget`, where h is `"{min}m"` if under 1 h, else `"{h.1}h"`; or `Over budget` if hoursOver is 0.
     - Title: `{project name|title|"This job"} took longer than planned`.
     - Subtitle: `What slowed it down? This helps us quote the next job better — it is not a performance review.`
     - Options: `The budget was too tight` (`budget_unrealistic`), `Extra prep or repairs` (`extra_prep`), `Moving furniture or covering` (`moving_furniture`), `Waiting on materials or client` (`waiting`), `Something else` (`other`, requires a note; placeholder `Tell us what happened…`, max 280).
     - Buttons: `Skip`, `Send`.
   - Send: `record_time_entry_command('job_issue', …)` (§3.1), then mark answered and close.
   - Skip: mark answered and close.
   - Full visual spec is in the labour-tasks spec, which owns `OverBudgetReasonSheet`.
6. Finally `clockingOut = false`.

**`adjustActiveStart(minutes)`** (`±5m`):
1. Ignore if there is no `activeShift.startedAt` or `adjustingStart` is true.
2. `next = startedAt + minutes`. If `next > now` → `clockInError = "Start time can't be later than now."` and stop. There is **no lower bound**.
3. `adjustingStart = true`, clear the error.
4. `await onUpdateTimeEntry(activeShift, { startedAt: next.ISO, adjustmentSource: "active_start_edit", skipAdjustmentHistory: true })` (§2.8).
5. Throws → `error.message || "Could not adjust start time. Try again."`
6. Finally `adjustingStart = false`.

**`switchToProject(next)`** (from the chip or the sheet):
1. Ignore if there is no project or `switching` is true.
2. If it is the same id as the active project → close the sheet.
3. `switching = true`, clear the error.
4. `shift = await onSwitchProject(next)` (§2.6).
   - Null → `clockInError = "Switch could not complete. Check location permissions and try again."` (**APP STORE**). The sheet stays open and shows the error.
   - Success → dismiss the keyboard, close the sheet, clear the search.
   - Throws → `error.message || "Switch could not complete. Try again."`
5. Finally `switching = false`.

**Photos**: the panel header and strip call `onViewProject(project, "photos")`, which opens Project Detail on its photos view.

### 1.7 Change Job sheet (`ProjectSwitcherModal`)

- Transparent modal that slides up. Android back or dismiss calls `onClose`.
- Backdrop `rgba(17,32,29,0.42)`, full screen. Tapping it closes the sheet, unless `switching`. Accessibility label `Close job selector`.
- Keyboard avoidance: `padding` on iOS.
- Sheet:
  - Full width, max height 82% of the screen, white, top corners radius 24, padding h18 top 10.
  - Bottom padding `max(18, safeAreaBottom + 10)`.
- Contents, top to bottom:
  1. Handle: 42×5 capsule `#d7ddda`, centred, margin-bottom 12.
  2. Header (HStack spacing 12):
     - Title `Change Job` (`ink` 22 `.black`, tracking −0.4).
     - Subtitle `Currently at {currentProject.name || "selected job"}` (`muted` 12.5 `.semibold`, margin-top 2, one line).
     - Close button 38×38 circle bg `#edf2ef` with `close` 22 `navy`. Accessibility label `Close job selector`. Disabled while switching.
  3. Search: height 48, margin-top 16, radius 15, 1pt `#dfe7e3`, bg `#f4f7f5`, padding h13, spacing 9.
     - Icon `search` 19 `muted`.
     - TextField: auto-focused, placeholder `Search all jobs`, `ink` 15 `.bold`, not editable while switching, autocapitalisation none, autocorrect off.
     - Trailing: spinner or clear button (same rules as §1.2).
     - The same debounced `searchJobsForClockIn` runs, sharing the screen's `searchQuery` state.
  4. Section label: `Search results` if there is a query, else `Active projects`. Uppercase, `muted` 11 `.black`, tracking 0.6, margin-top 16, bottom 7.
  5. List (ScrollView; keyboard dismisses interactively; taps are handled while the keyboard is up):
     - Source: `query ? searchResults : projects` (`resolvedProjects`).
     - Filtered: drop items with no id, the current project's id, `is_archived`, and duplicate ids.
     - Capped at **50** with a query, **40** without.
     - Row: min height 64, HStack spacing 11, bottom border 1pt `#edf0ee`, padding v9.
       - Icon tile 38×38, radius 12, bg `#e9f3ee`, with `briefcase-outline` 18 `teal` (while switching: `location` 18 `teal`).
       - Name `project.name || "Project"` (`ink` 14.5 `.black`, one line).
       - Address `formatProjectAddress` or `No address on file` (`muted` 12 `.semibold`, margin-top 2, one line).
       - `chevron-forward` 19 `muted`.
       - Accessibility label `Switch to {name || "project"}`.
       - Disabled while switching (opacity 0.6). Pressed opacity 0.85, scale 0.99.
       - Tap: `switchToProject(project)`.
     - Leads can appear in search results. This sheet shows **no** LEAD pill. Picking a lead converts it to a job (`ensureClockInProject`, §3.4).
     - Empty (not searching and nothing to show): `searchError`, or `No matching jobs found.` with a query, or `No other active projects are available.` without. `muted` 13 `.bold`, centred, padding v24.
  6. Footer:
     - While switching: HStack (spacing 8, padding-top 12, centred) with a small `teal` spinner and `Changing jobs…` (`navy` 13 `.heavy`).
     - Else, if `actionError`: `#c0432b` 12.5 `.bold`, padding-top 10.
- Close (`closeProjectSwitcher`): ignored while switching. Otherwise dismiss the keyboard, close the sheet, clear query, results and error.
- Open (`openProjectSwitcher`): ignored while switching. Otherwise clear `clockInError` and the search, then open.

### 1.8 Photos panel (`JobPhotosPanel`) in the active view

- Card: white, radius 14, 1pt `#e4eae8`, padding h14 top 12 bottom 14.
- Header row (button, accessibility label `Open job photos`, tap → `onOpenAll`): HStack spacing 8.
  - Icon `images-outline` 17 `navy`.
  - Title `Photos` (`ink` 14 `.black`, fills).
  - Count: `media.length + pending.length`, `#6d7f7b` 13 `.heavy`, tabular digits. While loading with no media yet, a small spinner replaces it.
  - `chevron-forward` 15 `#6d7f7b`.
- Strip (button, accessibility label `View all {total} photos and videos`, tap → `onOpenAll`): HStack spacing 8, margin-top 12.
  - Up to **4** square tiles (`PREVIEW_COUNT`): each flexes equally, radius 9, bg `#dfe6e4`, image aspect-fill. Pending uploads come first, then server media newest-first.
  - Video tiles: a 16pt round badge at bottom-left 4 with `play` 10 white on `rgba(8,15,18,0.7)`.
  - Pending tiles: overlay `rgba(17,32,29,0.45)` with a white spinner, or `alert` 13 white if the upload failed.
  - If more items exist: a tile with bg `#eef2f1` and text `+{remaining}` (`navy` 14 `.black`).
- No previews: `Loading photos…` while loading, else `No photos on this job yet.` (`#6d7f7b` 12.5 `.semibold`, margin-top 10).
- While uploading: HStack (spacing 8, margin-top 10) with a spinner and `Uploading {n} item` / `Uploading {n} items` + `…`.
- If any upload failed: a row (bg `#fdecea`, radius 10, padding h10 v9, margin-top 10).
  - Icon `alert-circle` 15 `#a5321f`.
  - Text `#a5321f` 12 `.bold`, 2 lines: `{n} upload` / `{n} uploads` + ` failed` + `: {first error}` (only if there is an error) + `. Tap to retry.`
  - Tap retries all failed uploads.
- Camera button: min height 46, radius 12, margin-top 12, bg `navy`. Icon `camera` 19 white and `Take Photo or Video` (white 14 `.black`, tracking 0.2). Accessibility label `Take a photo or video for this job`. Disabled with no project id. Opens `ProjectCameraScreen`.
- Media listing, upload queue and camera behaviour are specified in the media/camera spec.

### 1.9 State summary (clock-in screen)

| State | What shows |
|---|---|
| Latest-project query pending | Card spinner. Clock In may already be enabled if a nearest or selected project exists. |
| No active jobs | Card `No active project` / `No active jobs are available.`. Clock In disabled at 0.55 opacity. |
| Latest-project query error | Card `No active project` / `{error.message}` |
| Lead selected | Card shows the lead. **No Clock In button.** |
| Search pending | Spinner in the field. No empty text. |
| Search empty / error | `No matching projects or leads found.` / `{error.message}` |
| Location permission denied at Clock In | Feedback bubble `Location access is required before clocking in.` (the `trackingNotice`, **persisted across launches**, §2.2). Clock In stays available. **APP STORE §7.** |
| Clock-in RPC offline | No visible difference: the shift starts locally and the command is queued (§2.9). |
| First fix unavailable after clock-in | Active-view location row: `Your first location was not available. ServiceFlow will keep trying while you are clocked in.` |
| Foreground fix fails during shift | `Location could not be refreshed. ServiceFlow will keep trying while you are clocked in.` |
| Background service failed to start | `Active-shift tracking could not start. Keep ServiceFlow open or check location settings.` |
| Map slow | Banner `Map is taking too long` / `You can still choose a job and use location.` |
| Recenter without location | `Location unavailable. Enable location access and try again.` / `Could not get your location. Try again.` |
| Offline generally | There is no offline banner anywhere in this area. |

---

## 2. Time-entry state machine and local persistence

### 2.1 Objects

**Shift** (the active session, `activeShift`). Created by `createShift(project, user, point)`:

| Field | Value at creation |
|---|---|
| `localId` | `` `${Date.now()}-${Math.random().toString(36).slice(2, 9)}` ``, e.g. `1727370000000-k3j9x2a`. This **is** the `client_entry_id`. It is immutable. |
| `serverId` | `null`, later set to the `time_entries.id` UUID |
| `userId`, `userEmail`, `userName` | `compactUser(user)`: `name = user.name ‖ full_name ‖ user_metadata.full_name ‖ user_metadata.name ‖ emailPrefix ‖ "Painter"` |
| `project` | `normalizeProject(project)` (§0.1) |
| `originalStartedAt`, `startedAt` | now, ISO 8601 with milliseconds and `Z` |
| `startEditedAt` | `null` |
| `startedLocation`, `lastLocation` | `point` (a clock-in passes `null`; a switch passes the previous `lastLocation`) |
| `lastLocationLabel` | `null` (never updated) |
| `lastDistanceMeters`, `onSite`, `travelStartedAt` | `null` |
| `segments` | `[]` |
| `adjustmentHistory` | `[]` |

Native: an `ActiveShift: Codable` struct with these exact JSON keys.

**Point** (`toPoint(location)`):

```
{ latitude, longitude,
  accuracy: horizontalAccuracy || null,   // a value of 0 becomes null
  speed: number|null, heading: number|null,
  mocked: bool|null,                      // RN on iOS: always null (expo reports it only on Android).
                                          // Native may send CLLocation.sourceInformation?.isSimulatedBySoftware (new behaviour).
  capturedAt: ISO(location.timestamp || now) }
```

**Segment**: `{ mode: "on_site"|"off_site"|"unknown", startedAt, endedAt, distanceMeters, location: Point }`. `appendSegment(shift, status)` works like this:
- If the last segment has the same mode, only its `endedAt` (now), `distanceMeters` and `location` are updated.
- Otherwise a new segment is pushed with `startedAt = endedAt = now`.

**Entry** (`shiftToEntry(shift, endedAt, reason)`):

```
{ id: serverId || localId, localId, serverId, userId, userEmail, userName, project,
  originalStartedAt: originalStartedAt || startedAt, startedAt, startEditedAt|null,
  endedAt, durationMs: max(0, endedAt − startedAt), clockOutReason: reason,
  startedLocation, lastLocation, lastDistanceMeters, onSite,
  segments,   // when reason != "active", the last segment's endedAt = endedAt
  adjustmentHistory }
```

`activeEntry(shift) = shiftToEntry(shift, now, "active")` is used for live totals.

`clockOutReason` values:

| Value | Meaning |
|---|---|
| `active` | still running |
| `manual` | Clock-in screen |
| `project_detail` | Project Detail button |
| `notification` | notification Clock Out action |
| `switched_project` | closed by a switch |
| `server` | loaded from the server |

**Identity:** `entryIdentityKeys(e) = [serverId, id, localId]`, non-empty, as strings. Two entries are "the same" if they share any key. `shiftStorageId(s) = localId ‖ client_entry_id ‖ serverId ‖ id`.

### 2.2 Local persistence (AsyncStorage keys → native storage)

Every key is a JSON string. Native: use one file or `UserDefaults` suite per key with the same names and shapes. Do not put them in the Keychain. Writes to the main store, the runtime state and the pending tracking status are **serialised through one mutex** (`runTrackingStateMutation`). The write queue and the location queue each have their own mutex. Native: one `actor` per group.

| Key | Shape | Notes |
|---|---|---|
| `ottawaPainters.timeTracking.v1` | `{ activeShift: Shift\|null, entries: Entry[], knownProjects: Project[], lastNotice: Notice\|null, lastNotificationAt: epochMs, closedShiftIds: string[] (≤ 64, oldest dropped) }` | Main store. `knownProjects` is a copy of `resolvedProjects`, for the background task. **Not keyed by user.** |
| `ottawaPainters.timeTracking.writeQueue.v1` | `QueuedOp[]` | Offline command queue (§2.9) |
| `ottawaPainters.locationPointQueue.v1` | `LocationRow[]` (≤ 2000, oldest dropped, de-duplicated by `client_event_id`) | Offline location queue (§4.6) |
| `ottawaPainters.pendingTrackingStatus.v1` | `TrackingStatus\|null` (single latest value) | §4.6 |
| `ottawaPainters.trackingRuntime.v1` | `{ clientEntryId, mode, taskStatus, configVersion (4), trackingProfile ("active_shift"\|null), stationaryPoint, stationaryState {anchor, stationary}, permissions, lastLocationAt, lastRecordedPoint, lastSyncAt, lastErrorCode, geofenceSignature, updatedAt }` | Diagnostics, used by the More screen |
| `ottawaPainters.projectGeocodes.v1` | `{ [companycam_id‖address]: {latitude, longitude, address, resolvedAt} }` | Geocode cache |
| `ottawaPainters.lastHandledNotification.v1` | string (notification request identifier) | Notification de-duplication |
| `ottawaPainters.arrivalPrompts.v1` | object | Read/write helpers exist but **nothing calls them any more**. Do not port. |
| `ottawaPainters.labourTaskOverBudgetReasonAnswered.v1:{userId}:{taskId or "job:"+jobId}:{revision or "unpublished"}` | ISO timestamp | "Asked once" flag |

**Notice** (`trackingNotice` / `lastNotice`): `{ type, message, createdAt, suggestedProject? }`.

| `type` | Set by |
|---|---|
| `permission` | clock-in or switch denied, or unresolved project |
| `tracking_error` | location issues (see §1.9 copy) |
| `arrival` | arrival notification tap |
| `switch_project`, `clock_out` | notification taps; background handler |
| `status` | background handler |

- The notice is persisted, so **it survives relaunch** and reappears in the clock-in feedback bubble.
- It is cleared by:
  - a successful clock-in / switch / clock-out / delete (`null`);
  - `refreshTrackingPermissions` when permission is ready (clears only `type === "permission"`);
  - a successful foreground point (clears only `tracking_error`).

### 2.3 Pure lifecycle transitions (`timeTrackingState.js`)

Each takes the stored snapshot and returns `{applied, store}`. The storage layer writes only if `applied`.

| Transition | Applies when | Effect |
|---|---|---|
| `startShiftInStore(shift, fields)` | id non-empty, id not in `closedShiftIds`, and the active slot is empty or already holds the same id | `activeShift = shift`, plus fields |
| `updateActiveShiftInStore(expected, next, fields)` | `next.id == expected.id` and `expected` is the active, non-tombstoned slot | `activeShift = next`, plus fields |
| `closeShiftInStore(shift, entry?, fields)` | id non-empty (**always applies**) | clears the active slot if it is this id; merges `entry` to the front of `entries` (replacing the same `shiftStorageId`); appends id to `closedShiftIds` (the tombstone) |
| `switchShiftInStore(expected, next, entry, fields)` | ids differ, `next` not tombstoned, `expected` active | `activeShift = next`, merges `entry`, tombstones `expected` |
| `mergeCompletedEntryInStore(entry)` | always | merges `entry` |
| `isShiftActiveInStore(shift)` | | true if its id is in the active slot and not tombstoned. **Every async location or background write re-checks this before and after awaits ("stale" guard).** |

`fields` can never overwrite `activeShift` or `closedShiftIds`.

### 2.4 Clock in (`clockIn(project)`)

1. `permissions = await requestTrackingPermissions()`:
   - First `requestNotificationPermissions()`. This shows the notification prompt if undetermined, and registers categories if granted (§5.2).
   - Then `Location.requestForegroundPermissionsAsync()`: the When-In-Use prompt if undetermined.
   - Returns (§4.1) `{foreground, background:false, ready, foregroundStatus, canAskForegroundAgain, access, notifications}`.
2. If `!permissions.foreground`: set notice `{type:"permission", message:"Location access is required before clocking in."}` and return `null`. (**APP STORE**)
3. `ensureClockInProject(project)` (§3.4). A lead becomes a job through an RPC, and errors are thrown to the caller. Then `baseProject = normalizeProject(result)`. If that is null → return `null`.
4. `shift = createShift(baseProject, user, null)`. Location is **null** at this point.
5. `startStoredShift(shift, {lastNotice:null})`.
   - Not applied (another shift is active, or the id is tombstoned): adopt `store.activeShift` into state if one exists, and return `null`.
6. Set state: `activeShift = shift`, notice `null`, `suggestedProject = null`. **Return `shift` now.** The UI flips to the clocked-in view before any network call.
7. In the background (not awaited):
   - a. `insertActiveEntry(shift)`: runs `record_time_entry_command('clock_in', payload)`.
     - Success with `status==="active" && !ended_at`: if the shift is still the active one, set `serverId = row.id` (via `updateStoredActiveShift`).
     - RPC error or network error: enqueue `{action:"clock_in", payload}` and leave `serverId` as null.
   - b. In parallel: `geocodeProject(project)` and `getCurrentPoint()` (Balanced, 12 s timeout). Then:
     - With a point: `recordShiftLocation(next, projects, point, {eventType:"clock_in", permissions})` (§4.4), which also starts continuous tracking.
     - Without a point: `configureAdaptiveTracking`, `reportTrackingIssue("initial_location_unavailable")`, then notice `Your first location was not available. ServiceFlow will keep trying while you are clocked in.`
     - Then write `project` (geocoded), `startedLocation` (if still null) and `lastLocation` into the stored shift, keeping any `serverId` that has arrived meanwhile. Set `locationStatus`.
     - If there was no point, also `updateActiveLocation` (observation).
   - Any throw → `reportTrackingIssue("initial_location_capture_failed")`.
   - Every step aborts if the active `localId` has changed.

Side effects of `activeShift.localId` changing:
- The 8 h/10 h reminders are rescheduled (§5.1).
- The 1 s tick starts.
- The foreground watcher and 4-min heartbeat start (§4.3).
- `syncBackgroundTrackingState` runs (§4.5).

### 2.5 Clock out (`clockOut(reason = "manual")`)

This order is a documented invariant. Keep it.
1. `expected = activeRef`. If there is no shift, or a clock-out is already in progress → return `null`.
2. `clockOutInProgress = true`. This locks foreground point application and heartbeat capture.
3. `endedAt = now` (ISO). It is captured **before** any waiting.
4. Await any in-flight foreground location mutation, then `stopBackgroundTracking()`.
5. `point = await getCurrentPoint({timeoutMs: 8000})` (`CLOCK_OUT_LOCATION_TIMEOUT_MS`).
6. Re-read the store. If the stored active `localId` ≠ `expected.localId` → return `null`.
7. `shift = stored` with `serverId` taken from memory if the store lacks it.
   - With a point: `recordShiftLocation(shift, projects, point, {eventType:"clock_out", skipTrackingReconfigure:true})`. The new `lastLocation` becomes the clock-out coordinate.
   - Without a point: `reportTrackingIssue("clock_out_location_unavailable")`. A stale point is **never** re-timestamped as the clock-out point.
8. `entry = shiftToEntry(shift, endedAt, reason)`. `closeStoredShift(shift, entry, {lastNotice:null})` clears the slot and tombstones the id. If not applied → return `null` (it always applies).
9. State:
   - prepend `entry` to `entries` and `teamEntries`;
   - `activeShift = null`, `locationStatus = null`, notice `null`, `suggestedProject = null`;
   - reminders are cancelled by the effect.
10. `savedRow = await completeEntry(entry)`: `record_time_entry_command('clock_out', payload incl. ended_at, reason)`. On error the op is queued.
    - If `savedRow.status === "complete" && savedRow.ended_at`: replace the local entry with `entryFromSupabase(savedRow)` and persist it.
    - **BUG (RN):** the server writes `status = 'completed'`, never `'complete'`, so this reconciliation never runs. Native should check `status == "completed"`. The server is first-write-wins either way.
11. `finishTrackingSession(shift, …)` (§4.5): queue a tracking status with `mode:"clocked_out"`, `taskStatus:"stopped"`, `reason`; stop updates; reset runtime (`clientEntryId:null, mode:"clocked_out", taskStatus:"stopped"`, stationary fields and profile null); sync location data.
12. Return `entry`. Finally `clockOutInProgress = false`.

### 2.6 Switch project (`switchProject(project)`)

1. If there is no active shift → `clockIn(project)`.
2. `permissions = await getTrackingPermissions()`. This only checks and **never prompts**. If not foreground → permission notice (same copy as §2.4) and return `null`.
3. `ensureClockInProject(project)` (errors are thrown), then `geocodeProject`. If that is null → notice `{type:"permission", message:"Could not resolve the selected project."}` and return `null`.
4. `switchedAt = now`.
   - `completed = shiftToEntry(current, switchedAt, "switched_project")`.
   - `next = createShift(nextProject, user, current.lastLocation)` with `originalStartedAt = startedAt = switchedAt` and `travelStartedAt = current.travelStartedAt`.
5. `switchStoredShift(current, next, completed, {lastNotice:null})` is atomic. If not applied → return `null`.
6. State:
   - `entries` and `teamEntries` get `completed`;
   - `activeShift = next`;
   - notice `null`, suggestion `null`.
7. `switchEntry(completed, next)` runs `record_time_entry_command('switch', clockOutCommand, clockInCommand)`. On error it enqueues `{action:"switch", client_entry_id: old, next_client_entry_id: new, payload:{clock_out_command, clock_in_command}}`.
   - The response is `{completed_entry, active_entry}`.
   - If `completed_entry.status === "complete"` (**same BUG**: it is `completed`), reconcile.
   - If `active_entry` is active with `client_entry_id === next.localId` → set `next.serverId = active_entry.id`.
8. If `current.lastLocation` exists: `recordShiftLocation(next, projects, current.lastLocation, {eventType:"project_switch"})`.
   - This re-uses the **previous point with its original `capturedAt`**, so the `project_switch` point is dated before the switch.
   - Persist the result and set `locationStatus`.
   - Otherwise: `configureAdaptiveTracking(next)`.
9. Return `next`.

### 2.7 Delete (`deleteTimeEntry(entry)`)

1. The entry must have at least one identity key.
2. If it is the active shift: `closeStoredShift(entry, null)` (tombstone, no entry saved), clear state, `stopBackgroundTracking()`. **No `finishTrackingSession` runs**, so the manager's tracking status keeps its last mode (AMBIGUOUS whether that is intended).
3. Remove it from `entries` and `teamEntries`.
4. `deleteServerEntry(entry)`:
   - `server_id` = the id if it is a UUID; `client_entry_id = localId ‖ client_entry_id`.
   - Runs `record_time_entry_command('delete', {server_id, client_entry_id})`.
   - On error, enqueue `{action:"delete", payload:{server_id, client_entry_id}}`.
5. Return `true`.

### 2.8 Adjust (`updateTimeEntry(entry, updates)`)

Used by `±5m`, Timesheet edit and Project Detail edit (manager or own).

1. `updated = applyEntryTimeUpdate(entry, {...updates, adjustedBy: compactUser(user)})`:
   - `startedAt = updates.startedAt ‖ entry.startedAt`. `originalStartedAt` is kept.
   - `isActive = clockOutReason === "active" ‖ !endedAt`. An active entry keeps `endedAt = null` unless `updates.clockOut` or a non-active `updates.clockOutReason` is passed. Otherwise `endedAt = updates.endedAt ‖ entry.endedAt`.
   - `project = normalizeProject(updates.project)` if given.
   - `durationMs` is recomputed.
   - The first segment's `startedAt` becomes the new start. The last segment's `endedAt` becomes the new end.
   - If start, end or project changed and `!skipAdjustmentHistory`, append to `adjustmentHistory`: `{adjustedAt, adjustedByUserId, adjustedByEmail, adjustedByName, source: adjustmentSource‖"time_edit", previousStartedAt, nextStartedAt, previousEndedAt, nextEndedAt, previousProjectId, nextProjectId}`.
   - `startEditedAt = now` if the start changed.
2. If it is the active shift: `updateStoredActiveShift(entry, updated)`. If not applied → `null`.
3. Replace it in `entries` and `teamEntries`.
4. `savedRow = persistUpdatedEntry(updated)`:
   - Runs `record_time_entry_command('adjust', payload incl. ended_at, adjustment_source:"mobile_time_edit")`. The UI's `adjustmentSource` is **not** sent.
   - On error it enqueues `{action:"adjust", payload}` and returns `null`.
5. With `savedRow`:
   - Active row and it is the active shift: copy the server's `serverId`, `project`, `originalStartedAt`, `startedAt`, `startEditedAt`, `adjustmentHistory` into the shift. **The server's snake_case history replaces the local camelCase history** (§3.1).
   - Otherwise: replace with `entryFromSupabase(savedRow)` and persist.
6. Return `updated`.

The Timesheet edit screen sends `{startedAt}` for an active entry and `{startedAt, endedAt}` for a completed one. It never sends `endedAt` for an active shift.

### 2.9 Offline command queue (`writeQueue.v1`)

- **Operation shape:** `{ action, payload, client_entry_id?, next_client_entry_id?, id?, createdAt: ISO }`. New actions are `clock_in`, `clock_out`, `switch`, `adjust` and `delete`. There is no `observation`: location observations are **never** queued.
- **Legacy actions**, handled only when an old queue is flushed:
  - `create_active` → `clock_in`
  - `complete` → `clock_out`
  - `replace` → `adjust`
  - `patch_active` → `clock_in`, then `observation`
  - `upsert` → `clock_out` if `status==="complete"` or `ended_at`, else `clock_in`
  - `legacyCommand` fills `job_id ← payload.job_id ‖ payload.companycam_project_id` and `server_id ← payload.server_id ‖ op.id`.
  - A new native app starts with an empty queue, so it needs none of these unless it migrates RN storage (§6.10).
- **Coalescing on enqueue:**
  - `key = "{op.client_entry_id ‖ payload.client_entry_id ‖ payload.id ‖ op.id ‖ createdAt}::{group}"`.
  - Group: `deletion` for delete; `adjustment` for adjust/replace; `lifecycle` for everything else.
  - Priority: `active`(clock_in etc.) 1 < `complete`(clock_out/switch/complete, or `payload.status==="complete"`) 2 < `replace` 3 < `delete` 4.
  - If an op with the same key exists, keep the one with the higher-or-equal priority. The incoming op wins ties. The winner is removed and **re-appended at the end**, so order is insertion order with replaced items moved to the end.
  - Priorities are only compared within the same key, so the same group.
- **Flush** (`flushQueuedWrites`):
  - Single-flight. Reads the queue and runs the ops sequentially in array order.
  - Every op is attempted even when an earlier one fails.
  - Success (no `error`, or `ignored`) → removed by instance key `"{key}::{createdAt}"`. Removal is serialised with enqueue, so a newer op is never dropped.
  - Failure → the op stays.
  - There is **no backoff, no retry cap, no dead-letter queue**.
- **Triggers:**
  - At the start of every `fetchTimeEntryRows()`: on mount/user change, every **45 s**, and on app foreground.
  - A separate **60 s** interval that also flushes labour-task writes and location data.
  - Both intervals run only while there is a signed-in user.
- **Idempotency** (server-side, §3.1):
  - `clock_in` is keyed on `client_entry_id` (returns the existing row).
  - `clock_out` is first-write-wins (a completed row is returned unchanged).
  - `delete` is repeatable.
  - `adjust` is **not** idempotent: every retry appends another `adjustment_history` item.
  - `job_issue` is keyed on `client_id`.
- **BUG (RN), offline shifts can be lost:**
  - Clock in and clock out both offline → the queued `clock_in` and `clock_out` share the key `{localId}::lifecycle`. The `clock_out` replaces the `clock_in`. On flush the server raises `Time entry not found`, so the op stays queued forever and **the shift never reaches the server**.
  - A switch while offline has the same problem: the `switch` replaces the old shift's queued `clock_in`, and the switch transaction raises `Time entry not found` forever.
  - Also, a `clock_in` that fails for a non-network reason stays queued forever, e.g. `Employee already has an active time entry`, or an invalid `job_id`.
  - Recommended native behaviour: keep separate ops per lifecycle step, in order. Or, when replacing a not-yet-acknowledged `clock_in` with `clock_out`, send `clock_in` followed by `clock_out`. Treat permanent server errors (`P0001` raise messages other than network or auth) as terminal and surface them. **Needs a decision.**
- `fetchTimeEntryRows` hides server rows whose `id` or `client_entry_id` has a queued delete.

### 2.10 Server reconciliation (`refreshServerEntries`)

Runs on mount and on user change, every 45 s, and on app foreground. It needs `user.id`.

1. `rows = fetchTimeEntryRows()` (flushes the queue first, then runs the query in §3.3). If `null` (error) → stop.
2. `currentUserRows = rows.filter(row.user_id === user.id)`.
   **BUG (RN):** `public.time_entries` has **no `user_id` column** (live schema: `employee_id`). So `currentUserRows` is always empty. The effects:
   - (a) `entries` (the Timesheet, "Hours used today" and "my totals") contains **only locally recorded entries on this device**. Server rows never merge in.
   - (b) A local active shift that was already completed on the server (a manager clocked it out, or another device did) is **never** cleared.
   - (c) A server active row is **never** restored as the local active shift. After a reinstall or on a second device, the app looks clocked out while the server says active. A new clock-in then fails with `Employee already has an active time entry` and is queued forever.
   The intended logic, which native should implement using `row.employee_id == user.id` (**decision required**, strongly recommended):
   - `activeRow` = the user's row with `status==="active" && !ended_at`.
   - `completed` = the user's other rows through `entryFromSupabase`.
   - `entries = completed + local entries whose identity keys are not among the completed ones`, sorted by `startedAt` descending.
   - If the local active shift matches a completed server row: `closeStoredShift(local, serverEntry)`, clear state, stop tracking. Never send a second clock-out.
   - If `activeRow` exists, there is no local active shift, and no local entry shares its keys: `startStoredShift(shiftFromSupabase(activeRow))` and adopt it.
3. `teamEntries = rows.map(entryFromSupabase)`. This is all rows visible to the user (org-wide, §3.3) and it works today.
4. Errors are swallowed ("local clocking still works").

`entryFromSupabase(row)`:
- `id = serverId = row.id`, `localId = row.client_entry_id ‖ row.id`.
- `userId = employee_id`, `userEmail = employee_email`, `userName = employee_name ‖ "Painter"`.
- `project = {companycam_id: job_id, job_id, id: job_id, name: job_name ‖ "Job", address: job_address, formatted_address: job_address}`.
- `originalStartedAt = original_started_at ‖ started_at`, `startedAt = started_at`, `startEditedAt = start_edited_at`.
- `endedAt`: `null` if active, else `ended_at ‖ now`.
- `durationMs` is computed live for active rows.
- `clockOutReason = status==="active" ? "active" : "server"`.
- `startedLocation` / `lastLocation` from `clock_in_*` / `clock_out_*` (null if either coordinate is null).
- `lastDistanceMeters = last_distance_meters`, `onSite = is_on_site`, `segments`, `adjustmentHistory = adjustment_history`.

`shiftFromSupabase(row)` has the same fields as a Shift, with `localId = client_entry_id ‖ id` and `travelStartedAt = null`.

### 2.11 Derived values

- `activeElapsedMs = max(0, tick − startedAt)`. `tick` is set every 1 s while a shift is active.
- `liveEntries = [activeEntry(activeShift)] + entries`.
- `liveTeamEntries = [activeEntry] + teamEntries`, de-duplicated by identity keys (first wins).
- `todayWorkedMs`: the sum of `durationMs` over `liveEntries` whose `startedAt ≥ local midnight today`. An entry that crosses midnight counts in full towards the day it **started**. Yesterday's overnight shift adds nothing today.
- `projectTimeTotals` (team), `myProjectTimeTotals` (`liveEntries`) and `projectLatestActivity` come from `timeEntryPresenters` (Jobs/Timesheet specs). `projectClockInSummary.js` groups GPS segments by their parent entry for Project Detail. Segments are never counted as extra clock-ins (Project Detail spec).

### 2.12 App launch / restore sequence (native must reproduce)

1. Read the main store and runtime state. Set `activeShift`, `entries`, `trackingNotice = lastNotice`, `suggestedProject = lastNotice.suggestedProject`, `lastNotificationAt`, diagnostics. Mark hydrated. Persisting is blocked until hydration finishes, so the empty initial state can never overwrite a stored shift.
2. `refreshTrackingPermissions()` checks only. If ready → clear any `permission` notice.
3. `retireLegacyGeofences()` (§4.8).
4. Subscribe to notification responses and consume the cold-launch response (§5.3).
5. When the user id is known: `refreshServerEntries()` now and every 45 s; the 60 s flush interval.
6. Once hydrated, and whenever `entries`, `resolvedProjects` or `trackingNotice` change: persist `{entries, knownProjects, lastNotice, lastNotificationAt}`.
7. With a restored active shift:
   - reminders are reconciled (§5.1);
   - the tick starts;
   - if permission is granted: foreground watcher + heartbeat + an immediate capture (§4.3);
   - `syncBackgroundTrackingState` runs, which **calls `requestTrackingPermissions()`: it prompts for notifications and location at launch if they are undetermined** (APP STORE §7), then restarts the background service.
8. On every return to foreground (`AppState` `active`):
   - re-read the store;
   - if its active shift has the same `localId`, merge `segments` (if non-empty), `lastLocation`, `lastDistanceMeters`, `onSite`, `travelStartedAt` from disk into memory (the background task writes these);
   - `lastNotificationAt = max(disk, memory)`;
   - then `refreshServerEntries()`, `refreshTrackingPermissions()` (check only), `captureForegroundPoint()`.

---

## 3. Supabase calls

All RPCs go through the Supabase client with the user's JWT. There are **no direct INSERT, UPDATE or DELETE** statements on `time_entries`, `employee_location_points` or `employee_tracking_status`.

### 3.1 `record_time_entry_command(action text, command jsonb, next_command jsonb default null) returns jsonb`

Client call: `supabase.rpc("record_time_entry_command", { action, command, next_command })`. `next_command` is `null` except for `switch`.

**Command payload** (`commandPayload(entry, options)`), sent for `clock_in`, `clock_out`, `adjust` and `observation`, and inside `switch`:

| Key | Value | Read by server? |
|---|---|---|
| `client_entry_id` | `entry.localId ‖ entry.id ‖ entry.serverId` | yes (identity) |
| `server_id` | `serverId ‖ id` if it is a UUID (v1–5 regex), else `null` | yes (lookup; on `clock_in` it is used as the new row id if given) |
| `user_name` | `entry.userName` | no (the server uses `employees.full_name`) |
| `job_id` | `entry.project.companycam_id` (= `jobs.id` UUID) or `null` | yes (must be a valid job for `clock_in`) |
| `project_name` | `project.name ‖ "Project"` | no |
| `project_address` | `project.formatted_address ‖ project.address ‖ null` | no |
| `original_started_at` | `originalStartedAt ‖ startedAt` | `clock_in` only |
| `started_at` | `startedAt` | `clock_in`, `adjust` |
| `ended_at` | `endedAt`: **present only when `includeEndedAt`** (`clock_out`, `adjust`, the switch's clock-out). Absent otherwise. For an active entry in `adjust` it is `null`. | `clock_out`, `adjust` |
| `clock_in_latitude`, `clock_in_longitude` | `startedLocation?.lat/lng ?? null` | `clock_in` only |
| `clock_out_latitude`, `clock_out_longitude` | `lastLocation?.lat/lng ?? null` | `clock_out`, `observation` |
| `last_distance_meters` | integer or null | `clock_in`, `clock_out`, `observation` |
| `is_on_site` | bool or null | same |
| `segments` | Segment[] | same (not copied into the event metadata) |
| `reason` | `options.reason ‖ entry.clockOutReason ‖ null` | → `time_entries.notes` on `clock_in`, `clock_out`, `adjust` |
| `source` | `"mobile"` | → `time_entry_events.source` |
| `adjustment_source` | `"mobile_time_edit"` for `adjust`, else `null` | `adjust` |

Payload facts to replicate (or consciously change):
- A clock-in is built from `shiftToEntry(shift, now, "active")`, so `reason: "active"` and the server stores `notes = 'active'`.
- `startedLocation` is null at the moment of `clock_in`, so **`clock_in_latitude/longitude` are almost always null on the server**. Observations only update the `clock_out_*` columns.
- An `adjust` on a server-loaded entry sends `reason: "server"`, which overwrites `notes`.
- `captured_at` is never sent, so the server uses `now()`.

**Server behaviour** (latest body in `20260805033248…`, wrapped by `20260925205112…`):
- Wrapper `public.record_time_entry_command`:
  - Resolves the company from `command.job_id` (or `task_id → job`) and from the time entry matching `server_id`/`client_entry_id`.
  - Mismatch → `This action spans two companies.` (42501).
  - `private.set_acting_org(...)` → `You do not have access to this company.` if the caller is not a member.
  - Then calls `private.record_time_entry_command__unscoped`.
- Unscoped body:
  - Requires `auth.uid()` (`Authentication required`) and an `employees` row for the actor that is an acting member (`Active employee profile required`).
- By action:

| `action` | Behaviour | Returns |
|---|---|---|
| `task_start`/`task_stop`/`task_adjust` | raise `Task timers have been removed` | — |
| `job_issue` / `task_issue` | `command {client_id, job_id \| task_id, reason, note, minutes_over, metadata?}`. Needs a valid job (`A valid job_id is required`). Inserts `job_issues` (`issue_type` `job_over_budget` / `task_over_budget`, `reason` default `other`, `minutes_over ≥ 0`). Duplicate `client_id` is ignored. | `{ "id": uuid\|null, "duplicate": bool }` |
| `switch` | `{completed_entry: self('clock_out', command), active_entry: self('clock_in', next_command)}` in one transaction. Either failing rolls back both. | `{completed_entry: row, active_entry: row}` |
| `clock_in` | `client_entry_id` required (`client_entry_id is required`). If a row with that `client_entry_id` exists → return it (owner or manager, else `Time entry belongs to another employee`). Else if the actor already has an active row → `Employee already has an active time entry`. Needs a valid `job_id`. Inserts with id `server_id ‖ gen_random_uuid()`, `employee_email`/`employee_name` from `employees` (`coalesce(full_name, email, 'Painter')`), `job_name`/`job_address` from `jobs` (`coalesce(formatted_address, address_line_1)`), `original_started_at = coalesce(original_started_at, started_at, now())`, `started_at = coalesce(started_at, now())`, `status 'active'`, clock-in coords, distance, on-site, segments, `notes = reason`. | row |
| `clock_out` | Looks the row up by `server_id` or `client_entry_id` (newest `started_at`, `FOR UPDATE`). Not found → `Time entry not found`. Owner or manager only. **Only if `status='active'`**: sets `ended_at = coalesce(ended_at, now())`, `status='completed'`, coalesces the clock-out coords, distance, on-site, `segments` and `notes`. Otherwise the row is unchanged (first write wins). | row |
| `adjust` | Same lookup. Owner or manager (`Only a manager can adjust another employee time entry`). Sets `original_started_at = coalesce(original, started)`. If `started_at` is given, `started_at` is updated **and `start_edited_at = now()` whenever the key is present, even if unchanged**. If the key `ended_at` is present: `ended_at` = that value (null allowed) and `status='completed'` if non-null. Appends `{adjusted_at, adjusted_by, source: adjustment_source‖'app', previous_started_at, previous_ended_at}` to `adjustment_history`. `notes = coalesce(reason, notes)`. | row |
| `delete` | Same lookup. Not found → returns `false` (no error). Sets `status='deleted'`, `ended_at = coalesce(ended_at, now())`. | `true` |
| `observation` | Same lookup. Coalesces `clock_out_latitude/longitude`, `last_distance_meters`, `is_on_site`, `segments`. **It does not check `status`**, so a late observation can overwrite a completed row's clock-out coordinates and segments (the architecture doc claims "active only"; the SQL does not enforce it). Returns early and **writes no event**. | row |
| other | `Unsupported time-entry action: %` | — |

- After `clock_in`, `clock_out`, `adjust` and `delete`, the server inserts `time_entry_events` with:
  - `event_type` = the action;
  - `captured_at = command.captured_at ‖ now()`, `received_at = now()`;
  - `source = command.source ‖ 'app'`;
  - `metadata = {command: command − 'segments'}`.
- A repeated `clock_out` on a completed row still writes another event.

**Row shape** (`to_jsonb(time_entries)`): `id, client_entry_id, employee_id, job_id, employee_email, employee_name, job_name, job_address, original_started_at, started_at, start_edited_at, ended_at, status ('active'|'completed'|'deleted'), clock_in_latitude, clock_in_longitude, clock_out_latitude, clock_out_longitude, last_distance_meters, is_on_site, segments, adjustment_history, notes, approved_at, approved_by, created_at, updated_at, org_id`.
- The client also accepts an array and takes the first element.
- A check constraint requires `status='active'` ⇔ `ended_at is null` for active rows.
- The unique index `time_entries_one_active_per_employee_idx` on `(employee_id) where status='active' and ended_at is null` enforces at most one active row per employee.

Errors come back as PostgREST errors, with `message` = the raise text. Clock-in and switch errors other than network errors are **not shown to the user**: the op is simply queued (§2.9).

### 3.2 `record_location_update(point jsonb, tracking jsonb default null) returns boolean`

Client: `supabase.rpc("record_location_update", { point, tracking })`.

`point` (a `LocationRow`, built by `buildLocationRow`):

```
{ client_event_id: "{localId}:{capturedAt}:{lat.toFixed(5)}:{lng.toFixed(5)}:{eventType}",
  time_entry_id: serverId if UUID else null,
  client_entry_id: localId,
  job_id: project.id ‖ project.job_id ‖ project.companycam_id ‖ null,
  latitude, longitude,
  accuracy_meters, speed_mps, heading_degrees: number|null,
  is_mocked: bool|null,
  tracking_mode: "painting"|"stationary"|"travel"|"unknown",
  event_type: "location"|"clock_in"|"clock_out"|"project_switch"|"tracking_status",
  distance_from_job_meters: int|null, is_on_site: bool|null,
  captured_at: ISO }
```

`tracking` (a `TrackingStatus`, built by `queueTrackingStatus`). Sent only together with the **last** point of a sync batch:

```
{ time_entry_id, client_entry_id, job_id,
  latitude, longitude, accuracy_meters,        // from options.point ‖ shift.lastLocation
  last_location_at, last_sync_at: now,
  tracking_mode: "painting"|"stationary"|"travel"|"unavailable"|"clocked_out"|"unknown",
  task_status: "running"|"stopped"|"error"|"paused"(default),
  permission_foreground?: bool, permission_background?: false,   // keys only when known
  platform: "ios", app_version: "1.5.0",
  last_error_code: string|null,
  metadata: { on_site: bool|null, distance_from_project_meters: int|null, reason: string|null } }
```

Server:
- Wrapper: sets the company from the time entry (`time_entry_id` or `client_entry_id`), else from `job_id`.
- Body: requires an acting member (`Active employee profile required`). If `time_entry_id` is not the actor's → `Time entry does not belong to the current employee`.
- Inserts `employee_location_points` (`employee_id = auth.uid()`, `received_at = now()`, `tracking_mode` default `unknown`, `event_type` default `location`, `captured_at` default `now()`) **`on conflict (client_event_id) do nothing`**. This is the idempotency.
- If `tracking` is non-null, upserts `employee_tracking_status` on `employee_id`:
  - latitude, longitude, accuracy and `last_location_at` come **from `point`**, not from `tracking`;
  - `job_name`/`job_address` from `jobs`;
  - the mode, task status, permission, platform, version, error and metadata fields from `tracking`;
  - `last_sync_at = now()`.
- Returns `true`.

### 3.3 Tables read directly

| Call | Query | Used for |
|---|---|---|
| `fetchTimeEntryRows` | `time_entries` `select("*")` `.neq("status","deleted")` `.order("started_at", desc)` `.limit(500)` | §2.10. RLS `org_member_read`: every row in the user's companies, including teammates. |
| `getLatestActiveProject` | `job_feed` `*`, `is_feed_visible = true`, `status in (scheduled,active)`, `updated_at desc`, limit 1 | §1.4 |
| `listMappedProjects` | `job_feed` as above, paged by 1000 | §0.1 |
| `listActiveProjectAssignmentIds` | `job_assignments` `select("job_id")` `employee_id = uid` `status = active` (every 60 s and on foreground) | not used on this screen |
| Team Map (manager) | `employee_tracking_status` `*` `order(last_location_at desc nulls last)`; `employee_location_points` `*` `employee_id = X` `captured_at ≥ midnight` `< next midnight` `order(captured_at asc)` `limit 2000` (every 30 s) | §7.5. RLS: own rows, or all rows for company managers. |

### 3.4 Project search and lead conversion

- `searchJobsForClockIn(query, {limit: 50})` → `searchVisibleJobsAndLeads(query, {page: 0, pageSize: 50})`:
  1. `match = "%{escaped}%"`, where `,()` become spaces and `%`/`_` are backslash-escaped.
  2. `contacts` `select("id")` `.or("name.ilike.M,email.ilike.M[,phone.ilike.%digits%]")` (phone only if ≥ 3 digits), limit 1000.
  3. `leads` `select("*,contact:contacts(id,name,email,phone),jobs(id)")` `.or(address|city|province|postal_code|source|pipeline_stage_raw ilike M [, contact_id.in.(ids)])` `order(updated_at desc)` limit 1000.
  4. `job_feed` `*` `is_feed_visible = true`, `status ≠ archived`, `≠ cancelled` `.or(name|formatted_address|city|province|postal_code ilike M [, id.in.(lead job ids)])` `order(updated_at desc)` limit 1000.
  5. Result: visible jobs + leads with no linked jobs (`normalizeLead`: `is_lead: true`, `name = contact.name ‖ name ‖ "Unnamed lead"`), with QA names dropped. Sorted by `updated_at ‖ created_at` descending, first 50 kept.
  - Any error → `{projects: [], error}`.
- `ensureClockInProject(project)`:
  - Not a lead → returned unchanged.
  - A lead → `supabase.rpc("ensure_lead_clock_in_job", {requested_lead_id: leadId})`, which returns a job row (or an array) → `normalizeJob`.
  - Errors: the RPC error, `This lead is missing its project id.`, or `The lead could not be prepared for clock in.` These are thrown to the Clock-in / Project Detail error text.

---

## 4. Location

### 4.1 Permissions (current RN behaviour)

- Authorisation requested: **When In Use only** (`requestForegroundPermissionsAsync`). "Always" is never requested. Info.plist has only `NSLocationWhenInUseUsageDescription`: `ServiceFlow uses your location during an active shift to confirm job-site and travel time.` (APP STORE §7.)
- `trackingPermissions`:
  - `foreground` = granted;
  - `background: false` (constant);
  - `ready = foreground`;
  - `foregroundStatus` ("granted" / "denied" / "undetermined");
  - `canAskForegroundAgain`;
  - `access: "while_in_use" | "none"`;
  - `notifications`: bool, only on request.
- Where location authorisation is requested today:
  - (1) `clockIn`, on every tap;
  - (2) `syncBackgroundTrackingState`, whenever the active shift's `localId`, `serverId` or `onSite` changes, **including hydration at launch**;
  - (3) the map recenter button;
  - (4) probably `MapView showsUserLocation` on iOS. The `react-native-maps` `AIRMap` implementation calls `requestWhenInUseAuthorization` when `showsUserLocation` is set, which would show the prompt **the first time the Clock In tab renders, before any tap**. This could not be verified here because `node_modules` is not installed. It matches Apple's "prompt before tapping" complaint.
- Where it is only checked: mount, foreground, `switchProject`, and the clock-in screen's `refreshForegroundLocation({request:false})`.

### 4.2 Accuracy and fix acquisition

- Every fix uses `Accuracy.Balanced` → iOS `kCLLocationAccuracyHundredMeters`.
- `getCurrentPoint({timeoutMs})` = `getCurrentPositionAsync(Balanced)` raced against a timeout. The default is **12 s**; clock-out uses **8 s**; the minimum is 1 s. On timeout or error it returns `null`.
- Fixes with `accuracy > 250 m` are unreliable:
  - in `recordShiftLocation` the status becomes `{onSite: null, suggestedProject: null, label: "Location accuracy is still improving."}` and the mode is forced to `travel`;
  - `shouldRecordLocation` drops the point for `event_type "location"`;
  - the background handler skips it.

### 4.3 Foreground tracking (while a shift is active and the app is open)

Starts when `activeShift` exists and `trackingPermissions.foreground` is true. Restarts when the `localId` changes.
- Immediate `captureForegroundPoint()`: `getCurrentPoint()` (12 s).
  - `null` → `reportTrackingIssue("foreground_location_unavailable")` and notice `Location could not be refreshed. ServiceFlow will keep trying while you are clocked in.`
  - A point → `applyForegroundPoint`.
- **Heartbeat** every **4 min** (`FOREGROUND_LOCATION_HEARTBEAT_MS`): `captureForegroundPoint()`. The JS timer only runs while the app runs.
- **Watcher**: `watchPositionAsync({accuracy: Balanced, distanceInterval: 25, timeInterval: 30000})`. On iOS only `distanceFilter = 25 m` applies; `timeInterval` is Android-only. Each fix → `applyForegroundPoint`.
  - Watcher error → issue `foreground_watcher_error`.
  - Start failure → issue `foreground_watcher_start_failed`.
- `applyForegroundPoint(point)` is serialised through a promise chain and ignored during clock-out:
  1. `recordShiftLocation(shift, projects, point, {permissions})` with event `location`. Stale or no status → drop.
  2. Persist via `updateStoredActiveShift`, keeping `serverId`.
  3. Set `locationStatus` and `suggestedProject = status.suggestedProject`.
  4. Clear any `tracking_error` notice.
  5. Refresh diagnostics.
  - **No notifications are sent from the foreground path.**

### 4.4 `recordShiftLocation(shift, projects, point, {eventType, permissions, mode, skipTrackingReconfigure})`

1. Stale guard.
2. Fill the shift's project coordinates from `projects` if they are missing.
3. `status = createLocationStatus(shift, projects, point)`:
   - `activeDistance = haversine(point, job)` or null.
   - `onSite = activeDistance ≤ 150` (`SITE_RADIUS_METERS`) or null.
   - `nearestProject` / `nearestDistance` over all projects.
   - `suggestedProject` = the nearest project if its id ≠ the current job's and `nearestDistance ≤ 175` (`JOB_SUGGESTION_METERS`).
   - `shouldPromptClockOut = activeDistance ≥ 300` (`CLOCK_OUT_PROMPT_METERS`).
   - `label` (§1.5).
   - Accuracy > 250 → the override in §4.2.
4. `mode = options.mode ‖ (reliable ? modeForLocationStatus(status) : "travel")`, where `onSite === true` → `painting`, `false` → `travel`, `null` → `unknown`.
5. `nextShift` = shift plus `startedLocation` (if unset), `lastLocation = point`, `lastDistanceMeters`, `onSite`, `travelStartedAt` (set once, when the mode is travel), then `appendSegment`.
6. `queueLocationSample(nextShift, point, {mode, eventType, status, previousRecordedPoint: runtime.lastRecordedPoint})` (§4.6).
7. Stale guard again.
8. `updateActiveLocation(nextShift)` sends `record_time_entry_command('observation', …)`. Best effort, never queued.
9. Unless `skipTrackingReconfigure`: `configureAdaptiveTracking(nextShift, projects, {mode, permissions, stationaryPoint})` (§4.5). This also queues a tracking status and syncs.
10. Runtime: `lastLocationAt = point.capturedAt`, and `lastRecordedPoint = point` if a row was queued.

### 4.5 Background tracking (current RN, to be removed on iOS, §7)

- One `expo-task-manager` task, `ottawa-painters-background-location` (`BACKGROUND_LOCATION_TASK`).
- `configureAdaptiveTracking(shift)`:
  - Chooses a mode: the runtime's `stationary` if it is the same shift, else `painting` if `onSite`, else `travel`. `unknown`/`unavailable` become `travel`.
  - Calls `startContinuousTracking(mode)`: if the task is already running with `configVersion 4` and profile `active_shift`, only the metadata is updated. Otherwise it stops and restarts with:

```
accuracy Balanced, distanceInterval 50, timeInterval 120000,
deferredUpdatesDistance 100, deferredUpdatesInterval 120000, deferredUpdatesTimeout 180000,
activityType Other, showsBackgroundLocationIndicator true, pausesUpdatesAutomatically false,
foregroundService (Android) { notificationTitle "ServiceFlow clock-in active",
  notificationBody "Recording work location for your active shift.", killServiceOnDestroy false }
```

  - Then merges runtime `{clientEntryId, mode, taskStatus, stationaryPoint, permissions, lastErrorCode}`, queues a tracking status and syncs.
  - Start failure → mode `unavailable`, task status `error`, `lastErrorCode = "active_shift_tracking_start_failed"`, notice `Active-shift tracking could not start. Keep ServiceFlow open or check location settings.`
- `syncBackgroundTrackingState` (on active-shift `localId`/`serverId`/`onSite` change):
  - No shift → stop.
  - Otherwise `requestTrackingPermissions()` (prompts). Not granted → permission notice.
  - Otherwise `configureAdaptiveTracking`.
- Task handler (`handleBackgroundLocations(locations)`). It also receives fixes while the app is in the foreground. Serialised. For each fix:
  - skip if accuracy > 250;
  - build status against `store.knownProjects`;
  - `mode = modeForLocationStatus`;
  - `updateStationaryState`: in travel mode, if within 70 m of the anchor for ≥ 3 min → `stationary`;
  - append the segment, queue a sample.
  - Then:
    - `notifyIfNeeded` (§5.1). Cooldown 10 min, from `store.lastNotificationAt`.
    - Persist the shift plus `lastNotice` (`switch_project` / `clock_out` / `status` with the status label).
    - Send an observation, re-assert the service (the mode changes metadata only), queue a status, merge runtime, sync.
  - Task error → `reportTrackingIssue("background_task_error")`.
- `stopBackgroundTracking()` stops the task and sets runtime `taskStatus: "stopped"`, `trackingProfile: null`.

### 4.6 Location upload queue

- `queueLocationSample`:
  - Returns `null` if the pilot flag excludes the user (§4.9), or if `shouldRecordLocation(prev, point, mode, eventType)` says no.
  - `shouldRecordLocation`: non-`location` events are always recorded. For `location` events:
    - drop if accuracy > 250;
    - record if there is no previous point;
    - otherwise record if the distance from the previous point is ≥ 60 m (painting/stationary) or ≥ 100 m (travel/unknown), **or** the elapsed time is ≥ 15 min (painting/stationary) or ≥ 3 min (travel/unknown).
  - Otherwise `buildLocationRow` (§3.2) and append to `locationPointQueue.v1`, de-duplicated by `client_event_id`, keeping the last 2000.
- `queueTrackingStatus(shift, {mode, taskStatus, permissions, errorCode, reason, point})`:
  - Excluded by the pilot flag → none.
  - Writes the single pending status. It is guarded to the active shift unless `mode === "clocked_out"`.
- `reportTrackingIssue(shift, code)`:
  - Merges `lastErrorCode`.
  - Queues a status with the current runtime mode (or `unavailable`), the runtime task status (or `error`) and `errorCode = reason = code`.
  - Syncs.
  - Codes: `foreground_location_unavailable`, `foreground_watcher_error`, `foreground_watcher_start_failed`, `initial_location_unavailable`, `initial_location_capture_failed`, `clock_out_location_unavailable`, `active_shift_tracking_start_failed`, `background_task_error`.
- `syncPendingLocationData()`:
  - Single-flight. Reads the queue and the pending status.
  - If the queue is empty and the status has coordinates, it synthesises a point:

```
{client_event_id: "tracking-status-{client_entry_id‖'none'}-{last_location_at‖last_sync_at}",
 time_entry_id, client_entry_id: client_entry_id ‖ "tracking-status", job_id,
 latitude, longitude, accuracy_meters, tracking_mode, event_type: "tracking_status",
 captured_at: last_location_at ‖ now}
```

  - Points are sent one RPC each, in order. The status goes with the last one.
  - An error on one point → skip it (it stays queued) and continue.
  - Success → remove that point.
  - If the status was sent → clear it only if unchanged since it was read, and set runtime `lastSyncAt`, `lastErrorCode: null`.
  - **A status with no coordinates and an empty queue is never uploaded** (AMBIGUOUS/limitation).
  - A point whose `time_entry_id` belongs to someone else fails forever.
  - `time_entry_id` stays null on points captured before `serverId` is known. The server does not backfill it.
- Sync triggers:
  - after every `configureAdaptiveTracking`, `reportTrackingIssue` and `finishTrackingSession`;
  - at the end of the background handler;
  - every 60 s while signed in.
- There is no retry backoff.

### 4.7 On-site and distance constants (single table)

| Constant | Value | Where |
|---|---|---|
| `NEAREST_PROJECT_RADIUS_METERS` | 2000 | auto-target on the clocked-out screen |
| map radius circle | 150 | `ClockInMap` |
| `SITE_RADIUS_METERS` | 150 | `onSite` |
| `JOB_SUGGESTION_METERS` | 175 | "Switch to …" chip / notification |
| `CLOCK_OUT_PROMPT_METERS` | 300 | "Still on this job?" |
| `maximumAcceptedAccuracyMeters` | 250 | |
| travel distance / gap | 100 m / 3 min | |
| painting distance / gap | 60 m / 15 min | |
| stationary radius / after | 70 m / 3 min | |
| freshness fresh / stale | ≤ 5 min / > 15 min | Team Map |
| route gap | 15 min | Team Map |
| `JOB_GEOFENCE_RADIUS_METERS`, `STATIONARY_GEOFENCE_RADIUS_METERS`, `MAX_GEOFENCE_REGIONS` | 160, 100, 20 | legacy constants, unused |

### 4.8 Geofences

- No geofences are created.
- On mount, `retireLegacyGeofences()` calls `stopGeofencingAsync("ottawa-painters-geofence")` if it is running (best effort) and sets runtime `geofenceSignature: null`.
- Region identifier prefixes from older releases: `active-job:`, `job:`, `tracking-stop`.
- Native (same bundle id `com.ottawapainters.app`): on first launch, call `stopMonitoring(for:)` on every `CLLocationManager().monitoredRegions`, then never register regions.
- `notifyArrival` ("You're at a job site") is dead code. Nothing calls it.

### 4.9 Feature flags (`locationTrackingFeature.js`)

- `extra.locationTrackingEnabled` = `EXPO_PUBLIC_LOCATION_TRACKING_ENABLED !== "0"` (default on).
- `extra.locationTrackingPilotEmails` = the comma-separated `EXPO_PUBLIC_LOCATION_TRACKING_PILOT_EMAILS`, lower-cased and trimmed (empty by default).
- `isLocationTrackingEnabledForUser(shiftOrUser)`:
  - false if the feature is off;
  - true if the pilot list is empty;
  - else `email.trim().lowercased() ∈ list` (email from `.email ‖ .userEmail ‖ string`).
- **Gates only** `queueLocationSample` and `queueTrackingStatus`, i.e. uploads to `employee_location_points` and `employee_tracking_status`. Clock-in location capture, `onSite`, observations to `time_entries`, reminders and suggestions still run for everyone.
- `isLocationTrackingFeatureEnabled()` also gates the manager **Team Map** tab (`canViewTeamMap = role ∈ {admin, manager} && enabled`).
- Native: read both values from build settings / Info.plist (`LocationTrackingEnabled` bool, `LocationTrackingPilotEmails` array). Same semantics.

---

## 5. Notifications (local)

### 5.1 Scheduled and immediate local notifications

| Identifier | When | Title | Body | Category | `data` |
|---|---|---|---|---|---|
| `serviceflow-active-shift-8h` | `originalStartedAt + 8 h` | `Still clocked in?` | `Your shift at {project.name ‖ "your job"} has been running for 8 hours. Clock out if you are finished.` | `ottawa-painters-clock-out-prompt` | `{type:"active_shift_reminder", hours:8, shiftLocalId, activeProjectId}` |
| `serviceflow-active-shift-10h` | `+ 10 h` | `Still clocked in?` | `… running for 10 hours. …` (same template) | same | `hours:10` |
| random id | background fix with `suggestedProject` | `Are you at another job?` | `You look close to {suggested.name}. Switch your clock-in if this is the new job.` | `ottawa-painters-switch-project-prompt` | `{type:"switch_project", activeProjectId, suggestedProject}` |
| random id | background fix with `shouldPromptClockOut` (≥ 300 m) and no suggestion | `Still on this job?` | `You are {formatDistance(d)} from {project.name ‖ "the job"}. Clock out if you are done.` | `ottawa-painters-clock-out-prompt` | `{type:"clock_out", activeProjectId, suggestedProject:null}` |
| random id | (dead code) arrival | `You're at a job site` | `Looks like you're at {name ‖ "a job"}. Clock in to start tracking your time.` | `ottawa-painters-arrival-prompt` | `{type:"arrival", project, activeProjectId}` |

All use `sound: true`. The proximity prompts fire immediately (`trigger: null`), at most once per 10 min (`lastNotificationAt`), **only from the background task**.

Reminder reconciliation (`ensureActiveShiftReminders(shift)`). It runs after hydration and on every active `localId` change, so on **every cold launch** with a shift:
1. Cancel both identifiers.
2. `start = originalStartedAt ‖ startedAt`. The start-time edit is ignored.
3. For each reminder, `target = start + h`:
   - future → schedule a time-interval trigger of `max(60, ceil((target−now)/1000))` s, non-repeating;
   - past → schedule only the **latest** overdue one, at 60 s.
4. Consequence: every cold launch after 8 h re-fires the latest reminder 60 s later (AMBIGUOUS: probably unintended).
5. Errors are swallowed.

Cancelled (`cancelActiveShiftReminders`) whenever there is no active shift after hydration: clock-out, delete, or a switch followed by a reschedule.

Android-only channel `default` (MAX importance, vibration `[0,250,250,250]`, light `#2F8D7F`) is not applicable to iOS.

### 5.2 Permission and categories

- `requestNotificationPermissions()` = `requestPermissionsAsync()` (alert, badge, sound). It runs inside `requestTrackingPermissions` (every clock-in and every restored-shift sync) and also at login (spec 01 §4.1).
- If granted, it registers the categories. All actions use `.foreground`:
  - `ottawa-painters-arrival-prompt`: `clock_in` "Clock In"
  - `ottawa-painters-clock-out-prompt`: `clock_out` "Clock Out"
  - `ottawa-painters-switch-project-prompt`: `switch_project` "Switch Job", `clock_out` "Clock Out"
- Foreground presentation: banner, list, sound, no badge.

### 5.3 Response handling

- `dispatchNotificationResponse`:
  - Uses `id = request.identifier`. If it is in the in-memory set, or equals the persisted `lastHandledNotification.v1` → ignore. Otherwise record it in both places, then process.
  - Both the live listener and `getLastNotificationResponseAsync()` at cold launch go through it.
  - **BUG-ish (RN):** the reminder ids are fixed, so after the user taps a shift's 8 h reminder, the next shift's 8 h reminder tap is ignored if it was the last one handled.
- Processing, in order:
  1. Action `clock_out` → `clockOut("notification")`. Clocks out the **current** active shift, whatever `shiftLocalId` says.
  2. Action `switch_project` → `switchProject(normalize(data.suggestedProject))`.
  3. Action `clock_in`, or `data.type === "arrival"` → `clockIn(project)`, or a switch if another job is active, or a no-op if already on that job. Plus notice `{type:"arrival", message:"Clocking you in to {name ‖ "the job"}."}`.
  4. Body tap with `data.type`:
     - `switch_project` → `setSuggestedProject(s)` and notice `Looks like you may be at {s.name}.` (or `You may be near another job.`)
     - `clock_out` → notice `You may be away from this job. Clock out if you are done.`
     - `active_shift_reminder` → notice `You are still clocked in after {hours} hours. Clock out if you are finished.` (without ` after {hours} hours` if `hours` is missing)
     - anything else (e.g. the server's `daily_clock_in_reminder`) → nothing.
- Taps never navigate or change tab.

### 5.4 Server-sent pushes related to this area (for awareness; not local)

- `daily-clock-in-reminders` edge function:
  - `Don't forget to clock in` / `Clock in before you start work today.` (`data.type: "daily_clock_in_reminder"`)
  - `Don't forget to clock out` / `Clock out before you leave for the day.` (`daily_clock_out_reminder`)
  - Sent to every active push token, through the Expo push service.
- `stale-location-alerts` → managers: `{employee_name ‖ "Painter"} tracking was interrupted` / `No work-location update for {window} while clocked in to {job_name ‖ "a job"}. Ask them to reopen ServiceFlow.`
  - Windows by mode: travel/other 15 min (`at least 15 minutes`), stationary 2 h (`two hours in stationary mode`), painting 8 h (`eight hours in painting mode`). It repeats hourly. It runs only for employees who have a tracking-status row.
  - See §7.5: this must change.
- Native delivery of both depends on the push-token decision in spec 01 §4.2.

---

## 6. Edge cases (current behaviour)

1. **App killed mid-shift.** The shift is on disk and restored on launch (§2.12). The timer continues from `startedAt`, so no time is lost. With a background task, iOS relaunches the app for location only if it was not force-quit. A force-quit means no fixes until reopen, and the manager map ages. Queued commands and points flush on the next launch.
2. **Clocking in while another entry is active.**
   - Locally: `startShiftInStore` refuses a different id and the UI adopts the stored shift. The clock-in UI is only reachable while clocked out anyway. Project Detail offers `Switch Job` instead.
   - On the server: the one-active index plus the `clock_in` check raise `Employee already has an active time entry` (e.g. a shift still active from another device or a reinstall, see the §2.10 bug). The client queues the op and keeps retrying forever. The local shift has no `serverId`, and its observations fail with `Time entry not found`.
3. **Arrival-prompt tap for a different job while clocked in** → switch. Same job → no-op.
4. **Manager adjusts or ends a painter's active entry on the server.**
   - A new start time: the painter's device keeps its local `startedAt`. The next painter-side `adjust` overwrites the manager's start.
   - Ended by a manager: the intended reconciliation (§2.10) would clear the local shift, but today it never runs (user_id bug). The device stays "clocked in" until the painter clocks out. That `clock_out` then returns the manager's completed row unchanged, and the local entry keeps the painter's own end time.
5. **Timezone and day boundaries.**
   - All timestamps are UTC ISO strings.
   - "Hours used today" uses the device's local midnight and attributes a whole entry to its start day.
   - The reminder offsets are absolute durations.
   - A time-zone change mid-shift has no special handling.
6. **Start time edits.**
   - `+5m` cannot move the start past now: `Start time can't be later than now.`
   - `-5m` has no floor.
   - The timer and durations use the edited `startedAt`. The reminders use `originalStartedAt`.
   - `start_edited_at` is set on every `adjust` because `started_at` is always sent.
7. **Clock-out without a location fix within 8 s** → the entry completes with the previous `lastLocation` as clock-out coordinates (sent as `clock_out_latitude/longitude`), but no `clock_out` point is recorded, and the issue `clock_out_location_unavailable` is set.
8. **Double taps** are guarded by `clockingIn`, `clockingOut`, `switching` and `adjustingStart`, plus `clockOutInProgressRef` in the engine.
9. **Sign-out during a shift.** `useTimeTracking` gets `user = null`: server refresh and intervals stop, but `activeShift`, the reminders and the background task are **not stopped**. The store is not per-user, so **the next account signed in on this device inherits the previous user's active shift** (with the previous user's `userId` inside it). Native should end or confirm before sign-out and clear or segregate the store per user (decision; see spec 01 §2.4).
10. **Upgrade from RN to native.** Same bundle id. The native app cannot see AsyncStorage unless it deliberately migrates it. RN stores it under `Application Support/[bundleId]/RCTAsyncLocalStorage_V1/` (`manifest.json` plus per-key files for large values). Unsynced queued writes and points would be lost, and the active shift would be restored only from the server (once §2.10 is fixed). **Decision:** migrate `ottawaPainters.timeTracking.v1`, `…writeQueue.v1` and `…locationPointQueue.v1` once, or accept the loss.
11. **Deleted rows** are filtered out of every server read (`status != 'deleted'`) and hidden locally while a delete is queued.
12. **A project with (0, 0) coordinates** is treated as unmapped (§0.1).
13. **Leads**: no Clock In button on the clock-in screen. Switching or clocking in to a lead from elsewhere converts it to a job first. A conversion error is shown verbatim.
14. **The project list is stale** until the Jobs screen triggers `refreshProjectData`. A job created mid-day does not appear on the map until then, but it is findable through search.

---

## 7. Native iOS changes required by App Store review

Rejections: **5.1.1(iv)** (a custom "reconsider" message after the user denied location, and users sent to Settings after tapping "Don't Allow" on a pre-prompt) and **2.5.4** (`UIBackgroundModes` `location` used only for employee tracking). The native app must do the following. Where this differs from spec 01 §8.1–8.2, **this section is authoritative for location** (see the note at the end).

### 7.1 Info.plist and capabilities

| Item | Current | Native |
|---|---|---|
| `UIBackgroundModes` | `["location", "fetch"]` (from `app.config.js` and `ios/ServiceFlow/Info.plist`) | **Remove `location`.** Remove `fetch` too (nothing in this area uses it). Keep only what another spec proves it needs, e.g. `remote-notification` if silent pushes are adopted. |
| expo-location plugin `isIosBackgroundLocationEnabled: true` | adds the background mode | not applicable. Nothing may re-add it. |
| `NSLocationWhenInUseUsageDescription` | `ServiceFlow uses your location during an active shift to confirm job-site and travel time.` | Suggested: `ServiceFlow records your location when you clock in, while the app is open during a shift, and when you clock out, to confirm job-site time.` It must not imply background or travel tracking. Product owner to confirm the wording. |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | absent | keep absent. Never call `requestAlwaysAuthorization`. |
| `CLLocationManager.allowsBackgroundLocationUpdates` / `showsBackgroundLocationIndicator` / significant-change / region monitoring / visits | used indirectly by expo | **never set or used.** Setting `allowsBackgroundLocationUpdates = true` without the mode also crashes. |

### 7.2 Permission flow: what to remove and what replaces it

Remove:
1. Location authorisation requests anywhere except the Clock In action:
   - the launch/restore re-prompt in `syncBackgroundTrackingState` → replace with a status **check**;
   - the map recenter button's `requestForegroundPermissionsAsync`;
   - any prompt caused by the map showing the user's location. In SwiftUI, show `UserAnnotation()` only when authorised. MapKit's user-location display must not trigger a request.
2. The notification request bundled into `requestTrackingPermissions` ahead of the location prompt. The Clock In tap must lead straight to the location step. Notification timing follows spec 01 §8.2. Recommended: ask for notifications right **after** a successful first clock-in, for the 8 h/10 h reminders. Only when `.notDetermined`, and with no custom nag.
3. Every custom message shown as a *reaction to denial*, and every message that urges the user to change their mind:
   - `Location access is required before clocking in.` as a persisted `trackingNotice` that reappears on every launch. The `permission` notice type must **not** be persisted.
   - `Clock in could not start. Check location permissions and try again.`
   - `Switch could not complete. Check location permissions and try again.`
   - Project Detail: `Clock in could not start. Check location permissions and try again.` / `Switch job could not complete. Check location permissions and try again.` (Project Detail spec).
   - Map: `Location unavailable. Enable location access and try again.`
   - `Active-shift tracking could not start. Keep ServiceFlow open or check location settings.`
   - More: `Location access: Not enabled` is acceptable as a neutral status line, but must not link anywhere.
4. Any pre-prompt screen with a "Not now" / "Don't Allow" choice that leads away from the system prompt (the rejected pattern).

Replace with this flow (the only place location authorisation is requested):

```
User taps Clock In (clock-in screen, Project Detail, Change Job/switch, or a notification Clock In action)
│
├─ status == .authorizedWhenInUse / .authorizedAlways ──► proceed (§2.4)
│
├─ status == .notDetermined
│    ├─ (optional) explanation screen, shown BEFORE the system prompt, once per install
│    │     Title:  "Location for clock-in"
│    │     Body:   "ServiceFlow records your location when you clock in, while the app is open
│    │              during your shift, and when you clock out, so your time is matched to the
│    │              job site. Location isn't recorded while you're clocked out or while the
│    │              app is closed."
│    │     One button only: "Continue"  → always goes to the system prompt.
│    │     (No "Not now", no close button that skips the prompt. Copy to be confirmed.)
│    └─ requestWhenInUseAuthorization()
│          ├─ granted → proceed with the same clock-in
│          └─ denied  → end the attempt silently: button back to idle, NO message, NO Settings link
│
└─ status == .denied / .restricted  (user tapped Clock In again later)
     └─ show an inline, neutral notice in the clock-in feedback bubble (§1.2 style), not persisted:
          "Clock In uses your location to record where your shift starts and ends.
           You can allow location for ServiceFlow in Settings."
          + a text button "Open Settings" → UIApplication.openSettingsURLString
        (.restricted: show the first sentence only, no Settings button.)
        Clear this notice when the tab changes, the app backgrounds, or authorisation becomes granted.
```

- A notification action that needs authorisation (e.g. `Switch Job` while denied) must not show a system prompt from the background. It opens the app and shows the same neutral notice.
- `switchProject` keeps check-only semantics. If not authorised, route through the flow above: a user tap counts as the trigger.
- The recenter button, when not authorised, animates to the selected job (or the default region) and shows **no** error text. Once authorised, it recentres on the user as today. (Spec 01 §8.2 would also allow prompting from "use my location". The brief for this area limits the request to Clock In. **Reconcile.**)
- **Open decision:** clocking in stays blocked without location (current behaviour). Apple may accept this for a workforce time clock. If review pushes back, the fallback is to allow clock-in without location, send null coordinates, and report `tracking_mode: "unavailable"`.

### 7.3 Location recording after the change

- **At clock-in:** after the entry starts, one `requestLocation()` (Balanced / `kCLLocationAccuracyHundredMeters`, 12 s timeout) → `recordShiftLocation(eventType "clock_in")`. Unchanged apart from dropping the background start.
- **While the app is open (scene phase `.active`) and a shift is active:**
  - Standard updates with `distanceFilter 25`, `desiredAccuracy kCLLocationAccuracyHundredMeters`, `activityType .other`. This equals the RN foreground watcher.
  - Plus the **4-min heartbeat** `requestLocation()`.
  - Plus an immediate capture on every return to the foreground.
  - Every fix goes through `applyForegroundPoint` → `recordShiftLocation(eventType "location")` with the same filters, queue, observation and status as §4.3–4.6.
- **On `.background`:** call `stopUpdatingLocation()` and invalidate the heartbeat. Then, inside a `UIApplication.beginBackgroundTask` (≤ ~30 s, no location mode needed):
  - queue a tracking status `{mode: <current>, taskStatus: "paused", reason: "app_backgrounded"}`;
  - `syncPendingLocationData()`;
  - `flushQueuedWrites()`.
  - (New, not in RN. `task_status "paused"` already exists as the default value.)
- **On `.active` again:** status `taskStatus: "running"`, capture a point, restart updates.
- **At clock-out:** unchanged. One fresh fix with an 8 s timeout (§2.5), `eventType "clock_out"`, then `finishTrackingSession` (`clocked_out` / `stopped`).
- **Remove entirely:**
  - `expo-task-manager` / `BACKGROUND_LOCATION_TASK` and `handleBackgroundLocations`;
  - `startContinuousTracking`, the deferred-update options, the `configVersion` / `trackingProfile` bookkeeping (keep runtime `mode`, `taskStatus`, `lastLocationAt`, `lastSyncAt`, `lastErrorCode`, `lastRecordedPoint` for diagnostics);
  - the error code `background_task_error`;
  - the Android foreground-service copy.
  - `configureAdaptiveTracking` becomes "compute mode + queue status + sync". The mode is `painting` if on-site, else `travel`, else `unknown`. Stationary detection may run on foreground fixes (optional; RN only computes it in the background task).
- **Proximity notifications** (`Are you at another job?` / `Still on this job?`) fire only from the background task today, so they cannot fire without background location. **Remove them.**
  - The in-app replacements already exist and stay: the "Switch to {job}" chip (175 m) and the location row `Off site, {d} from job.` (with the `warning-outline` icon).
  - Keep the `ottawa-painters-switch-project-prompt` category registered, harmlessly, in case server pushes use it. Otherwise it can be dropped.
- **Keep** the 8 h/10 h `Still clocked in?` reminders and their `Clock Out` action. They are time-based and need no location.
- The `Tracking may pause if ServiceFlow is force-closed.` line on More becomes false. Replace it (spec 01 §8.1 suggests `Location updates while ServiceFlow is open.`). Mode labels on More:

| `mode` | Label |
|---|---|
| `painting` | `On site` |
| `travel` | `Away from job site` |
| `unknown` | `Waiting for location` |
| (app backgrounded) | n/a (More is not visible then) |

  To be confirmed with spec 01.
- `permission_background` stays `false`. `access` stays `"while_in_use"`.

### 7.4 Notification actions that start work from the background

A `Clock Out` action (`.foreground` option) opens the app and runs `clockOut("notification")`. The 8 s fresh fix works because the app is now in the foreground with When-In-Use access. Keep `.foreground` on every action. No action may run location work while the app is in the background.

### 7.5 What the manager Team Map will show

- `employee_tracking_status.last_location_at` now advances only while the painter has ServiceFlow open, and at clock-in and clock-out. Between those it freezes.
- Team Map copy (Team Map spec) should present it as **"last seen"**:
  - `Updated {m}m ago` → `Last seen {m}m ago`
  - `Updated {h}h {m}m ago` → `Last seen {h}h {m}m ago`
  - `Updated just now` → `Last seen just now`
  - `{name} · last recorded` → `{name} · last seen`
- Freshness colours keep their thresholds: fresh ≤ 5 min teal `#2f8d7f`, aging ≤ 15 min `#c47b23`, stale `#b4473d`, clocked out `#8b9692`. But "stale" becomes normal and is not an error. Recommend a neutral colour for aging and stale while `task_status == "paused"`, and a sub-label `App closed` when `task_status == "paused"`.
- Mode labels:
  - `Travelling` → `Away from job site`
  - `Painting mode` → `On site`
  - `Clocked out` stays
  - `Tracking unavailable` stays
- Routes become sparse: points only while the app is open, plus clock-in and clock-out points. `Route gaps` (> 15 min) and `Tracking resumed` markers become routine. Rename them to `Gaps` and `App opened` (suggested). The clock-in and clock-out points (`event_type` `clock_in` / `clock_out`) are the reliable anchors.
- **Backend change required (not iOS code):** `stale-location-alerts` would push `… tracking was interrupted … Ask them to reopen ServiceFlow.` to managers for every painter who backgrounds the app for 15 min in travel mode. That both spams managers and pressures employees to keep the app open, which undercuts the 2.5.4 fix. Disable the function's cron, or restrict it to "clocked in for > N h with no clock-out" and change the copy (e.g. `{name} is still clocked in` / `Clocked in to {job} for {h} hours.`). **Owner decision.**
- The rollout doc's pilot checklist items that assume background tracking (drive 2 km with the screen locked, stationary for an hour with the screen locked, force-quit interruption alert) no longer apply. Replace them with "location recorded at clock-in, clock-out and while open; nothing while backgrounded; no background-location indicator ever appears".

### 7.6 Reconciliation note with spec 01

Spec 01 §8.2 says "No screen before the system prompt" and allows prompting from the map's "use my location". This spec (per its brief) permits an **optional** explanation screen before the prompt, but only one with a single `Continue` button that always leads to the prompt, and it restricts prompting to Clock In. Pick one rule for both specs before building. The safest choice satisfies both: no explanation screen, and a prompt only on Clock In.
