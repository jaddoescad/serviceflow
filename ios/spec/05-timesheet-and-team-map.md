# 05 — Timesheet and Team Map

Source of truth (read in full): `mobile/src/screens/TimesheetScreen.js`, `mobile/src/lib/timeEntryPresenters.js`, `mobile/src/lib/timeEntryModel.js`, `mobile/src/lib/timeEntryRepository.js`, `mobile/src/screens/TeamMapScreen.js` (+ `.web.js` for differences), `mobile/src/lib/useTeamLocations.js`, `mobile/src/lib/locationTrackingRepository.js`, `mobile/src/lib/locationTrackingPolicy.js`, `mobile/src/lib/trackingModel.js` (formatters), the parts of `mobile/src/lib/timeTracking.js` that feed these screens, and `mobile/App.js`. Server: `supabase/migrations/*` (latest definitions), `supabase/functions/stale-location-alerts/index.ts`. The same files are byte-identical in `~/Desktop/ottawa-painters-app` (the repo the shipping builds come from).

Column lists in §3 were also checked against the live "Service Flow" (`bwbckdkouqghdadpkjvn`) and "Ottawa Painters" (`pyzejfhsdewpnvmtqtlw`) Supabase projects on 2026-09-26.

Notation: "RN" = the current React Native app. `ALL_CAPS` identifiers and backticked names are quoted exactly from the code. Where the RN behaviour is a bug or unclear, it is flagged **[AMBIGUOUS]** or **[RN BUG]**. The native app must make a deliberate choice on each one; do not copy a bug without deciding to.

---

## 0. Routing and access (from `App.js`)

| Item | Behaviour |
|---|---|
| Shell | A custom bottom tab bar, not a native `UITabBarController`. Tabs are `BASE_TABS` = `clock` "Clock In", `projects` "Jobs", `timesheet` "Timesheet". Then, only if `canViewTeamMap`, `teamMap` "Team Map". Then always `more` "More". |
| Tab icons (Ionicons, size 27) | `clock` → `time-outline`, `projects` → `folder`, `timesheet` → `reader-outline`, `map` → `map-outline`, `more` → `ellipsis-horizontal` |
| Tab colours | Active `#173f37` (palette `green`), inactive `#8b9692` (palette `muted`). Label 11pt, weight 700, tracking 0.1. |
| Tab bar | Background `#ffffff`, top border 1pt `#e0e3e1`, padding horizontal 6, top 8, bottom `safeAreaInsets.bottom + 10`. Each button is flex 1, vertical padding 4, gap 4 between icon and label. |
| Scene retention | Every tab scene stays mounted and is hidden with `display: none`. Timesheet internal state (selected period, open day, open edit screen) **survives tab switches**. The native app should keep each tab's view alive (e.g. a `TabView`-style container that does not rebuild), not recreate it. |
| Top inset | The content area is padded by `safeAreaInsets.top`. The status bar is dark on white. |
| Timesheet visibility | Every signed-in user sees it (all roles). |
| `canManageProjects` | `["admin", "manager"].includes(employeeProfile?.role)`. `employeeProfile` comes from `public.employees` (`id,email,full_name,role,is_active`) with `id = auth user id`. |
| `canViewTeamMap` | `canManageProjects && isLocationTrackingFeatureEnabled()`. The feature is enabled unless `expoConfig.extra.locationTrackingEnabled === false` (build env `EXPO_PUBLIC_LOCATION_TRACKING_ENABLED` = `"0"`). |
| TeamMap mount | `<TeamMapScreen projects={tracking.resolvedProjects} enabled={activeTab === "teamMap"} />`. It is only rendered when `canViewTeamMap`. It is mounted but hidden while another tab is active, and `enabled=false` stops its polling. |
| Timesheet mount | `<TimesheetScreen entries={tracking.entries} activeShift={tracking.activeShift} projects={trackingProjects} painterName={painterName} onDeleteTimeEntry={tracking.deleteTimeEntry} onUpdateTimeEntry={tracking.updateTimeEntry} />`. The `projects` prop is **unused** by the screen. |
| `painterName` | `employees.full_name` → `user_metadata.full_name` → `user_metadata.name` → email prefix → `"Painter"` |

**[AMBIGUOUS] Role source mismatch.** The client gates the Team Map on the legacy `employees.role`. The server's RLS on location tables uses `org_members.role in ('owner','admin','manager')` (`private.my_managed_org_ids()`). If the two disagree, the result is either a visible tab with no rows, or a hidden tab for someone the server would let read. For parity, keep `employees.role`. Consider moving to org membership later.

---

## 1. Timesheet

### 1.1 Data inputs

- `entries` is `tracking.entries`, the signed-in user's **completed** entries. `activeShift` is the local in-progress shift, or `null`.
- `buildTimesheetDays(entries, activeShift)` puts the active shift first. It does this through `activeEntry(activeShift)` → `shiftToEntry(shift, now, "active")`, which gives `clockOutReason: "active"` and `durationMs = now − startedAt`.
- Where `tracking.entries` comes from (`timeTracking.js`):
  - On launch it is hydrated from the device's persisted store (AsyncStorage `readStore().entries`).
  - `refreshServerEntries()` runs on mount, every **45 s** (`setInterval(refreshServerEntries, 45_000)`), and on every app foreground (`AppState` → `"active"`).
  - That refresh calls `fetchTimeEntryRows()` (§3.1). It then keeps `currentUserRows = rows.filter((row) => row.user_id === user.id)`, maps completed ones with `entryFromSupabase`, and merges them with local entries whose identity keys the server has not returned yet.
  - **[RN BUG — decide]** `public.time_entries` has **no `user_id` column**; the owner column is `employee_id`. This was verified in migrations and on both live projects. `currentUserRows` is therefore always empty, which has three effects in RN today:
    - The timesheet shows only entries that were created or edited **on this device** and persisted locally. It also shows rows returned directly by `adjust`, through `updateTimeEntry` → `entryFromSupabase(savedRow)`.
    - Entries made on another device, or changed by a manager or the web app, never appear.
    - A server-side active row is never restored into `activeShift`.
  - The clear intent is `row.employee_id === user.id`. **Recommendation:** native filters on `employee_id == auth.uid()` and treats the server as the source of truth, merged with a local pending queue. This changes what users see compared with RN (more complete history). Get product sign-off.
- `teamEntries` is **not** used by the timesheet. There is **no manager "team time" view in the Timesheet tab**. Every role sees only their own time. Team time per job lives in Project Detail (`buildProjectClockInDays`, see §1.10), which is spec 04's area.

### 1.2 Pay periods

| Rule | Value |
|---|---|
| Period length | 7 days, **Monday–Sunday**. `startOfWeek`: `diff = (getDay() + 6) % 7`, so Monday = 0. |
| Timezone | **Device local time** everywhere. The server is never asked. |
| Anchor | `startOfWeek(now)` with the time set to **12:00:00.000 local**. `end = start + 6 days` (Sunday 12:00 local). |
| Periods offered | Exactly 3: current week, previous week, the week before (`[0,1,2].map(offset => start − offset*7 days)`). Nothing older can be viewed. |
| `id` | `formatDayKey(start)` = `start.toISOString().slice(0,10)`, the **UTC** date of Monday 12:00 local. That equals the local date for any timezone between UTC−11 and UTC+11. Native: build `yyyy-MM-dd` from **local** calendar components (that is the intent). |
| `label` | `${formatPeriodPart(start)} - ${formatPeriodPart(end)}`. The separator is space, hyphen-minus, space. `formatPeriodPart` = `toLocaleDateString([], { weekday: "short", month: "short", day: "2-digit" })`, which in en-US/en-CA gives `Mon, Sep 22`. Example label: `Mon, Sep 22 - Sun, Sep 28`. Native: `DateFormatter.setLocalizedDateFormatFromTemplate("EEEMMMdd")`, device locale. |
| Default selection | `payPeriods[0]` (the current week). |
| Recompute | `useMemo(..., [todayKey])` with `todayKey = new Date().toISOString().slice(0,10)`, so recomputation is keyed on the **UTC** date. **[RN BUG]** In Ottawa the periods recompute at 20:00/19:00 local, not at local midnight. Native: recompute on local day change (`NSCalendarDayChanged`). |
| Stale selection | `periodId` state is never reset. After a week rollover, the previously selected id may still be in the list (now at index 1), so the user silently stays on last week. If it is no longer in the list, the screen falls back to `payPeriods[0]`. Parity: keep the selected id if it still exists, else fall back to the first. |
| Membership | `isDayInPeriod(day, period)`: `new Date(day.id + "T12:00:00")` (local noon) `>= period.start && <= period.end`. Inclusive. |

### 1.3 Building days (`buildTimesheetDays`)

1. `all = active ? [active, ...entries] : entries`.
2. Group by `formatDayKey(entry.startedAt)`, where the **key is built from LOCAL date parts** (`yyyy-MM-dd`). An entry belongs to the day it **started** on. Overnight shifts are not split.
3. Sort the groups by key **descending** (newest first).
4. For each day:

| Field | Computation |
|---|---|
| `id` | the key |
| `weekday` | `toLocaleDateString([], { weekday: "short" })` of `key T12:00:00` local → `Mon` |
| `date` | `toLocaleDateString([], { month: "short", day: "2-digit" })` → `Sep 02` (two-digit day) |
| `type` | `"worked"` |
| `totalMinutes` | `floor(Σ entry.durationMs / 60000)` over the day's entries |
| `total` | `formatDuration(totalMinutes*60000)` |
| `onSite` / `drive` / `locationUnavailable` | For each entry, `summarizeSegments(entry)` (§1.4). Sum `onSiteMs`, `offSiteMs` and `unknownMs` across the day. Floor each to minutes, then `formatDuration`. |
| `jobs` | Unique `entry.project?.name \|\| "Project"`, in first-seen order, **max 4** |
| `entries[]` | See the table below |

Per-entry presenter object:

| Field | Value |
|---|---|
| `id` | `entry.id \|\| entry.localId` |
| `job` | `entry.project?.name \|\| "Project"`. Server rows map `job_name \|\| "Job"`, so a server row never shows "Project". |
| `address` | `project.formatted_address \|\| project.address \|\| "No address on file"` |
| `start` | `formatClock(startedAt)` → `toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})` → `7:05 AM`. An invalid date gives `--`. |
| `startSrc` | `"GPS"` if `entry.startedLocation` else `"Manual"` |
| `end` | `"Now"` if `clockOutReason === "active"` else `formatClock(endedAt)` |
| `endSrc` | `"GPS"` if `entry.lastLocation` else `"Manual"` |
| `duration` | `formatDuration(entry.durationMs)` |
| `status` | `summarizeSegments(...).status`: one of `"On Site"`, `"Off Site"`, `"Mixed"`, `"Location unavailable"` |
| `distance` | `latestDistanceMeters == null ? "distance unknown" : formatDistance(m) + " from site"` |
| `onSiteDuration`, `offSiteDuration`, `unknownLocationDuration` | `formatDuration` of the segment sums |
| `raw` | the original entry (used for editing) |

**Live duration of the active entry.** `trackedDays` is memoised on `[entries, activeShift]`. The active entry's duration is frozen at memo time. It only moves when `activeShift` changes identity (a location update, an edit) or `entries` change. The Timesheet list therefore does **not** tick every second. **[AMBIGUOUS]** Native recommendation: recompute once a minute while an active shift exists. This is a small, harmless deviation.

### 1.4 Segments (on site / drive / no GPS)

`segments` is a JSON array on each entry, `[{ mode: "on_site"|"off_site"|"unknown", startedAt, endedAt, distanceMeters, location }]`. RN builds it on the device in `appendSegment` for every location sample:
- If the sample's mode equals the last segment's mode, that segment's `endedAt` is extended to now.
- Otherwise a new zero-length segment starts at now.

`onSite` means distance to the job ≤ `SITE_RADIUS_METERS = 150`.

`getEntrySegments(entry, nowIso)`:
- If there are no segments, use one synthetic segment `{mode: entryLocationMode(entry), startedAt, endedAt, distanceMeters: lastDistanceMeters}`. `entryLocationMode` maps `onSite === true` to `on_site`, `false` to `off_site`, anything else to `unknown`.
- A segment mode other than `on_site`/`off_site`/`unknown` falls back to the entry's mode.
- If the entry is active (`clockOutReason === "active" || !endedAt`), the **last segment's `endedAt` = now** (it is still running).
- Otherwise a missing `endedAt` falls back to `segment.endedAt || entry.endedAt || now`.
- A segment's duration is `max(0, end − start)`.

`summarizeSegments(entry)`:
- Sum the segments into `onSiteMs`, `offSiteMs` and `unknownMs`.
- `status`: both on and off > 0 → `"Mixed"`; only on → `"On Site"`; only off → `"Off Site"`; neither → `"Location unavailable"`.
- If the segment total is 0, use `entry.durationMs`. If all three buckets are 0, put the whole total in the bucket for `entry.onSite` (true → on site, false → off site, null → unknown).
- `latestDistanceMeters` = the last non-null segment `distanceMeters`, else `entry.lastDistanceMeters`.
- The on-site + drive + no-GPS sum can differ from the day total. The day total comes from `durationMs`; the buckets come from segments, and gaps between segments are counted nowhere. See §4.

### 1.5 Full day grid and merge

- `buildEmptyDaysForPeriod(period)`: walk from `period.end` **down to** `period.start` one day at a time. Skip any day `> today 23:59:59.999 local` (no future days). Each placeholder is `{id, weekday, date, type: "missing"}`.
- Merge: for every placeholder, use the tracked day with the same `id` if one exists, else the placeholder.
- "Orphan" tracked days are in the period but not in the grid (e.g. a slightly future timestamp). They are prepended, then the list is re-sorted by `id` descending, so a worked day never disappears.
- Result: every past or current day of the period is shown, **newest first**, including weekends. Every day without an entry is a red "missing" row.
- Summary values:
  - `weekTotalMin` = Σ `day.totalMinutes`.
  - `weekTotal` = `${floor(min/60)}h ${min%60}m`.
  - `daysWorked` = the count of `type === "worked"` days.

### 1.6 Formatting rules

| Formatter | Output |
|---|---|
| `formatDuration(ms)` | `minutes = max(0, floor(ms/60000))`; `"${floor(min/60)}h ${min%60}m"`. No zero-padding, no decimals: `0h 0m`, `7h 5m`, `12h 30m`. Truncates; never rounds. |
| `formatDistance(m)` | `null`/non-finite → `distance unknown`; `< 1000` → `${max(0, round(m))} m`; else `${(m/1000).toFixed(1)} km` (e.g. `1.2 km`) |
| Clock | Locale short time, `h:mm a` in en: `7:05 AM` |
| `formatDayFull(day)` | `day.date.replace(" 0", " ")` + `", "` + year → `Sep 2, 2026` (the first " 0" is stripped) |
| Currency | The "Earned" stat is the **hard-coded literal `$0.00`**. There is no pay-rate logic. |

### 1.7 Screens, copy, style

**Fonts:** system font (SF Pro) throughout. Map RN weights as follows: `"600"` → `.semibold`, `"700"` → `.bold`, `"800"` → `.heavy`, `"900"` → `.black`. `letterSpacing` maps to `.tracking(x)`. `textTransform: "uppercase"` means the displayed text is uppercased (the source copy is mixed case, as quoted). All sizes are points. Icons are **Ionicons**. For exact parity, bundle the Ionicons TTF (MIT). If SF Symbols must be used, see the mapping in §1.9.

**Timesheet palette** (local `COLORS` in `TimesheetScreen.js`; it differs from the app `theme.palette`):

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| navy | `#0f2a3d` (unused) | | inkSoft | `#3c4c54` |
| green | `#173f37` | | red | `#d24a4a` |
| teal | `#2f8d7f` | | redInk | `#a83838` |
| tealSoft | `#e6f3f0` | | redBg | `#fdecec` |
| tealInk | `#1e6b60` | | amber | `#e0a000` (unused) |
| white | `#ffffff` | | bg | `#f4f6f7` |
| surface | `#ffffff` | | border | `#e2e6e8` |
| divider | `#eef1f2` | | muted | `#6b7a7e` |
| ink | `#10222b` | | | |

Other literals used: `#a8c7c0`, `rgba(255,255,255,0.07)`, `rgba(255,255,255,0.18)`, `#f3c8c8`, `#eef1f3`, `#eef1ef`, `#d5e7e2`, `#d7dcde`, `#f8f9f9`, `#d5dadc`, `rgba(15,30,28,0.45)`.

The Timesheet has no nav bar or title. Internal navigation is **in-component state**: list → day detail → edit, each a full-screen replacement with **no push animation and no swipe-back gesture**. Back only works through the on-screen chevron. **[AMBIGUOUS]** Native may use a `NavigationStack`, which adds a push animation and edge-swipe. That is a visible deviation; decide. If the stack is used, the edit screen's "Cancel"/back must pop to the day detail (not the list), and a successful Save/Delete must pop to the **list** (both levels).

#### A. List screen (background `bg #f4f6f7`, full height)

1. **Period button (top bar)**
   - A row with gap 6 and padding h18 / t14 / b12, background `bg`.
   - Text = `period.label`, 15.5pt, 700, `ink`. Next to it an Ionicon `chevron-down` 18 in `ink`.
   - Tapping it opens the Pay Period sheet. Accessibility label: `Select pay period, currently ${period.label}`.
2. **Week summary card**
   - Layout: margin h16, top 2; radius 16; background `green #173f37`; padding 16.
   - Head row (gap 12):
     - Avatar: 44×44 circle, `teal`, showing initials (15pt, 800, white, tracking 0.4).
     - Name `painterName`: 16pt, 800, white.
     - Subtitle **`Painter · Weekly Summary`** (hard-coded; shown to managers too): 12pt, 600, `#a8c7c0`, top margin 2.
   - Initials rule: trim, split on whitespace, first letter of up to 2 parts, uppercased; fallback `"P"`.
   - Stats row: top margin 16; background `rgba(255,255,255,0.07)`; radius 12; padding v12. It holds 3 equal columns, with 1×26 dividers `rgba(255,255,255,0.18)` between them.
     - Value: 16pt, 900, white, tracking −0.3.
     - Label: 11.5pt, 700, `#a8c7c0`, tracking 0.4, UPPERCASE, top margin 3.
     - Columns: `weekTotal` / **`Logged`** · `daysWorked` / **`Days`** · **`$0.00`** / **`Earned`**.
3. **Section header** **`This Week`**
   - The text is the same for every period, including past ones.
   - Style: margin t22 / b10 / h16; 12pt, 800, `muted`, tracking 0.8, UPPERCASE.
4. **Timeline scroll view**
   - Vertical, no scroll indicator, **no bounce**. Bottom content padding 36. Horizontal padding 16.
   - Vertical line: absolute, 2pt wide, `border` colour, radius 1. It sits at x = 16+56+12 = 84 from the container edge, top 26, bottom 30.
   - **Day row**: horizontal, stretch, bottom margin 12 (0 on the last row).
     - Date column (width 56, vertically centred): weekday 13.5pt, 800, `ink`; date 12pt, 600, `muted`, top margin 2.
     - Marker column (width 24, centred, top padding 18): a 22×22 circle with a 3pt border in `bg`, above the line.
       - Worked: fill `teal`, Ionicon `checkmark` 12 white.
       - Missing: fill `red`, Ionicon `alert` 11 white.
     - Card column: flex, left margin 8.
   - **Worked card** (tappable → Day detail)
     - Radius 12, 1pt `border`, background `surface`, padding v12 / h13.
     - Top row (space-between): `day.total` 17pt, 900, `ink`, tracking −0.4, and Ionicon `chevron-forward` 18 `muted`.
     - Job pills: top margin 8, wrap, gap 6. Each pill: capsule, `tealSoft`, padding h8 / v3, gap 4. It holds Ionicon `briefcase` 11 `tealInk` and the name (11.5pt, 800, `tealInk`, 1 line, max width 100%).
     - Meta row: top margin 10, top padding 10, 1pt top border `divider`, gap 16. Items have icon gap 5 and text 12pt, 600, `muted`, with the value inline in 800 `ink`:
       - `location-sharp` 13 `teal` + **`On site `**`{onSite}`
       - `car-sport` 14 `muted` + **`Drive `**`{drive}`
       - Only if `locationUnavailable !== "0h 0m"`: `help-circle-outline` 14 `muted` + **`No GPS `**`{locationUnavailable}`
   - **Missing card** (not tappable)
     - Radius 12, 1pt `#f3c8c8`, background `redBg`, padding v12 / h13.
     - Row gap 6: Ionicon `close-circle` 16 `red` + **`No clock-in`** (14pt, 800, `redInk`).
     - Then **`No time logged`** (12.5pt, 600, `red`, top margin 4).
   - Tapping a missing day does nothing. There is no way to add a manual entry from the timesheet.
5. **Pay period sheet** (custom modal, not `.sheet`)
   - Backdrop: `rgba(15,30,28,0.45)`. Its opacity follows the animation. Tapping it closes the sheet.
   - Sheet: background `surface` (white), top corners radius 20, padding t8 / h16.
   - Animation: open is translateY 400→0 over **220 ms**, ease-out cubic. Close is 0→400 over **180 ms**, ease-in cubic, then unmount.
   - **No drag-to-dismiss.**
   - Contents:
     - Grabber: 40×4, radius 2, `#d5dadc`, centred, bottom margin 12. Decorative only.
     - Title **`Select Pay Period`**: 16pt, 900, `ink`, bottom margin 10, padding h4.
   - Rows (one per period): padding 14, radius 12, bottom margin 6, space-between. Label is the period label (14.5pt, 700, `ink`).
     - Selected: row background `tealSoft`, text 800 `tealInk`, Ionicon `checkmark-circle` 22 `teal`.
     - Not selected: an empty ring 22×22, 1.5pt `border`.
     - Accessibility: label = period label, `selected` trait.
   - Bottom spacer height `safeAreaInsets.bottom + 28`.
   - Selecting a row sets the period and closes the sheet.

#### B. Day detail screen (background `bg`)

- **Header** (row, padding h8 / t12 / b10, background `bg`):
  - Back: 38×38, hit slop 10, Ionicon `chevron-back` 28 `ink`, left-aligned in its box.
  - Title: `${day.weekday}, ${formatDayFull(day)}` → `Tue, Sep 2, 2026` (18pt, 800, `ink`, tracking −0.3).
  - Subtitle: `${day.total} logged` (13pt, 700, `muted`, top margin 2).
  - The text block has left padding 4.
- **Pinned (non-scrolling) area**, padding h16 / t6:
  - Summary card: radius 16, background `surface`, 1pt `border`, padding 16.
    - Kicker **`TOTAL TIME`**: 11pt, 900, `teal`, tracking 0.8.
    - `day.total`: 28pt, 900, `ink`, tracking −0.8, top margin 4.
    - Chip row: top margin 12, gap 8, **no wrap**. Chips are capsules, padding h10 / v6, icon gap 5, text 12.5pt, 800:
      - `location-sharp` 14 `teal` + `${onSite} on site` on `tealSoft`, text `tealInk`
      - `car-sport` 15 `inkSoft` + `${drive} drive` on `#eef1f3`, text `inkSoft`
      - Only if `locationUnavailable !== "0h 0m"`: `help-circle-outline` 15 `inkSoft` + `${locationUnavailable} no GPS`, same grey style
  - Section row (margin t22 / b10, gap 8):
    - **`Clock-ins`**: 12pt, 800, `muted`, tracking 0.8, UPPERCASE.
    - The count `day.entries.length`: 12pt, 700, `muted`.
- **Scrolling list** (padding h16 / b40, no bounce, no indicator) of **entry cards**, in the order the entries appear in `entries` (active first, then store order, which RN keeps sorted by `startedAt` desc).

Entry card (tappable → Edit): radius 14, 1pt `border`, background `surface`, padding v12 / h13, bottom margin 10.

| Status | Icon circle (32×32) bg / Ionicon (16 white) | Pill bg | Dot (6×6) | Pill text colour |
|---|---|---|---|---|
| `On Site` | `teal` / `hammer` | `tealSoft` | `teal` | `tealInk` |
| `Mixed` | `teal` / `swap-horizontal` | `tealSoft` | `teal` | `tealInk` |
| `Off Site` | `inkSoft #3c4c54` / `car-sport` | `redBg` | `red` | `redInk` |
| `Location unavailable` | `muted` / `help` | `#eef1ef` | `muted` | `inkSoft` |

- Top row (gap 10): icon circle; then `entry.job` (14.5pt, 900, `ink`, tracking −0.2, 1 line) above `entry.address` (12pt, 600, `muted`, 1 line, top margin 1); then `entry.duration` (14.5pt, 900, `ink`).
- Divider: 1pt `divider`, vertical margins 11.
- Times row:
  - IN column (flex): **`IN`** (10.5pt, 800, `muted`, tracking 0.6), `start` (14.5pt, 900, `ink`, tracking −0.2, top margin 2), `startSrc` (11pt, 700, `muted`, top margin 1).
  - Ionicon `arrow-forward` 16 `muted`, horizontal padding 8.
  - OUT column: **`OUT`** / `end` / `endSrc`, same styles.
  - `chevron-forward` 18 `muted`, left padding 8.
- Status pill: top margin 11, leading-aligned capsule, padding h9 / v5, gap 6. Text `${status} · ${distance}` (11.5pt, 800), e.g. `On Site · 42 m from site`, `Location unavailable · distance unknown`.
- `Mixed` only: a breakdown row (top margin 10, gap 6), all 11.5pt 700 `muted`: `On site {onSiteDuration}` · `Travel/off site {offSiteDuration}`. The middle "·" is 12pt, 900, colour `border`.

#### C. Edit Time screen (background `bg`)

State:
- `rawEntry = entry.raw || entry`.
- `isActiveEntry = !rawEntry.endedAt || rawEntry.clockOutReason === "active"`.
- `startAt` starts at `rawEntry.startedAt`. `endAt` starts at `rawEntry.endedAt || rawEntry.startedAt`.
- The step is `EDIT_TIME_STEP_MINUTES = 5`.

Layout:
- Header: row, padding h8 / t8 / b4, back chevron (as on Day detail) → returns to Day detail.
- Scroll area: padding h18 / t2 / b14, no bounce.
  - **`Edit Time`**: 30pt, 900, `ink`, tracking −1.
  - **`Adjust this clock-in entry`**: 13.5pt, 600, `muted`, top margin 4.
  - **Shift card**: top margin 18, radius 14, 1pt `border`, `surface`, padding 14. Row aligned to the top, gap 12:
    - Left column:
      - `painterName` (16pt, 900, `ink`). This is always the signed-in user.
      - A row (top margin 8, gap 5) of Ionicon `briefcase` 14 `teal` and `entry.job` (14pt, 800, `tealInk`, 1 line).
      - `entry.address` (12.5pt, 600, `muted`, top margin 4, 1 line).
    - Right "map tile" (**not a map**): 86×80, radius 10, `tealSoft`, 1pt `#d5e7e2`, centred, padding h6, gap 4. It holds Ionicon `location-sharp` 22 in the location colour and `entry.distance` (10pt, 800, `tealInk`, centred).
    - Status pill: top margin 12, capsule, padding h9 / v5, gap 6, text 12pt 800. The colour logic here is **binary**: only `"On Site"` counts as on. **`Mixed` renders as off site.** [RN quirk — keep for parity or fix; decide.]

| Condition | Icon (15) | Text | Colours |
|---|---|---|---|
| `status === "Location unavailable"` | `help-circle` | **`Location was not recorded for this clock-in`** | bg `#eef1ef`, text/icon `inkSoft`; tile pin `muted` |
| `status === "On Site"` | `checkmark-circle` | **`On site during clock-in`** | bg `tealSoft`, `tealInk`; tile pin `teal` |
| else (`Off Site`, `Mixed`) | `alert-circle` | **`Off site during clock-in`** | bg `redBg`, `redInk`; tile pin `red` |

  - **Form card**: top margin 14, radius 14, 1pt `border`, `surface`, padding h14.
    - Form rows have padding v14 and are space-between. The label is 13.5pt 700 `muted`. The value is 14.5pt 800 `ink`, right-aligned and shrinkable; a muted value is 700 `muted`. Rows are separated by 1pt `divider` lines.
    1. **`Date`** → `formatDayFull(day)` (e.g. `Sep 2, 2026`).
    2. **`Clock-In Time`** → `${formatTime(startAt)} · ${entry.startSrc}` (e.g. `7:05 AM · GPS`). The value updates live as the time is stepped.
       - Optional note under it (11.5pt, 700, `muted`, margin top −6 / bottom 8), from `buildOriginalTimeNote`:
         - `originalStart = rawEntry.originalStartedAt || history[0]?.previousStartedAt`.
         - `originalEnd = first history item with previousEndedAt`.
         - `lastEdit = history.last?.adjustedAt || rawEntry.startEditedAt`.
         - If the original start differs from the current `startAt` **by rounded minute**, add `Original in {h:mm a}`.
         - If the entry is not active and the original end differs from `endAt`, add `original out {h:mm a}`.
         - If any part was added and `lastEdit` is set, add `edited {h:mm a}`.
         - Join the parts with ` · `.
         - Example: `Original in 7:00 AM · original out 3:30 PM · edited 4:02 PM`.
         - The note appears **as soon as the user taps ±5m**, because it compares against the in-editor value.
       - Step buttons row (right-aligned, gap 8, padding h2 / b10). Buttons are capsules with 1pt `border`, padding h12 / v6, `surface`, text 12pt 800 `tealInk`: **`-5m`** and **`+5m`**. The text is ASCII hyphen-minus + `5m`. Accessibility labels: `Subtract 5 minutes from clock-in time` and `Add 5 minutes to clock-in time`.
    3. **`Clock-Out Time`** → active: **`In progress`**; else `${formatTime(endAt)} · ${entry.endSrc}`.
       - Step buttons as above, with labels `... clock-out time`. They are **disabled (opacity 0.4) for an active entry**.
    4. **`Duration`** (muted value) → `formatDurationLabel`: `Xh Ym`. For an active entry it is `now − startAt` and it ticks, because the App re-renders every second while a shift is active. Otherwise it is `max(0, endAt − startAt)`.
- **Footer** (fixed, padding h16 / t10 / b16, background `bg`):
  - Error text, if any: 13pt, 800, `redInk`, centred, bottom margin 8.
  - If active: **`This shift is still in progress. Only the start time can be changed.`** (12.5pt, 700, `muted`, centred, bottom margin 8).
  - **Save button**: height 50, radius 12, `teal`; disabled background `#d7dcde`. Text **`Save Changes`** (15.5pt, 900, `#f8f9f9`, tracking 0.2). While busy it shows a spinner in `#f8f9f9` instead. Accessibility label `Save changes`.
  - Row (top margin 10, gap 10) of two flex-1 buttons, each height 46, radius 12:
    - **`Cancel`**: `surface`, 1pt `border`, text 14.5pt 800 `inkSoft`. Accessibility label `Cancel editing`. Disabled while busy. Goes back to Day detail.
    - **`Delete`**: `redBg`, 1pt `#f3c8c8`, Ionicon `trash-outline` 16 `red` + text 14.5pt 800 `red`. Accessibility label `Delete time entry`. While busy its background becomes `#d7dcde`.

Rules:
- `canSave`:
  - Active entry: `startChanged && !busy`.
  - Otherwise: `(startChanged || endChanged) && endAt > startAt && !busy`.
- There are no other bounds. The start may be moved into the future, before the previous entry, onto another day, and so on. Validation is **none** client-side, and the server does not validate order either (§3.3).
- **Save**:
  - `updates = { startedAt: startAt.toISOString() }`. Add `endedAt` **only if not active**, because sending `endedAt` would close an active shift.
  - Call `onUpdateTimeEntry(entry.raw, updates)` → `tracking.updateTimeEntry` (§1.8).
  - On success: close the Edit **and** Day screens (back to the list).
  - On a thrown error: show `error.message || "Could not save changes. Try again."` and re-enable.
- **Delete**: native alert with title **`Delete time entry?`**, message **`This cannot be undone.`**, and buttons **`Cancel`** (cancel style) and **`Delete`** (destructive).
  - On confirm: `onDeleteTimeEntry(entry.raw)`, then back to the list.
  - On a thrown error: `error.message || "Could not delete entry. Try again."`.
- Any role can edit or delete **their own** entries from here. There is no request or approval flow. `approved_at`/`approved_by` exist server-side but are never read or written by the app.

### 1.8 Mutations (what Save/Delete actually do)

`tracking.updateTimeEntry(entry, updates)`:
1. `updated = applyEntryTimeUpdate(entry, {...updates, adjustedBy: {id, email, name}})`. This step:
   - Keeps `originalStartedAt = entry.originalStartedAt || entry.startedAt`.
   - For an active entry, `endedAt` stays `null` unless there is an explicit clock-out.
   - Recomputes `durationMs`.
   - Rewrites `segments[0].startedAt = startedAt` and `segments[last].endedAt = endedAt`.
   - Sets `startEditedAt = now` if the start changed.
   - If anything changed, appends a **camelCase** history item: `{adjustedAt, adjustedByUserId, adjustedByEmail, adjustedByName, source: "time_edit", previousStartedAt, nextStartedAt, previousEndedAt, nextEndedAt, previousProjectId, nextProjectId}`.
2. If it is the active shift, update the persisted active shift. If that store transition is not applied, return `null` silently; the UI still closes.
3. Optimistically replace the entry in `entries` and `teamEntries`.
4. `persistUpdatedEntry(updated)` → RPC `record_time_entry_command("adjust", commandPayload(updated, {includeEndedAt: true, adjustmentSource: "mobile_time_edit"}))`.
   - On error or exception, the command is **enqueued** in the durable write queue and `null` is returned. **No error reaches the UI.**
5. If the server returns a completed row, replace the local entry with `entryFromSupabase(row)` and persist it. If it returns an active row, merge the server's `serverId`, `project`, `originalStartedAt`, `startedAt`, `startEditedAt` and `adjustmentHistory` into the active shift.

Note: `commandPayload` with `includeEndedAt: true` sends `ended_at: entry.endedAt`, which is `null` for an active entry. The server's `adjust` treats the key `ended_at` as **present**, sets `ended_at = null`, and leaves the status unchanged (still active). This is harmless for active entries. Native: send `ended_at` only for completed entries, or send `null` exactly as RN does; either way the result is the same.

`tracking.deleteTimeEntry(entry)`:
1. If it is the active shift: close the stored shift, clear `activeShift`/notices, and stop background tracking.
2. Remove the entry from `entries` and `teamEntries` optimistically.
3. `deleteServerEntry(entry)` → RPC `record_time_entry_command("delete", {server_id: uuid|null, client_entry_id})`. On error the command is enqueued. It always returns `true` to the UI.

**Offline:**
- All edits and deletes are optimistic and queued.
- The queue is flushed at these points:
  - Every 60 s (`flushQueuedWrites`).
  - Before every `fetchTimeEntryRows`.
  - On foreground, indirectly through that fetch.
- Queued deletes are also filtered out of fetched rows (`readQueuedDeleteKeys()` matches on `id` and `client_entry_id`).
- Queue semantics (`executeQueuedOperation`) include legacy actions:
  - `clock_in`/`create_active` → `clock_in`
  - `clock_out`/`complete` → `clock_out`
  - `switch`
  - `adjust`/`replace` → `adjust`
  - `patch_active` → `clock_in` then `observation`
  - `upsert` → `clock_out` if complete, else `clock_in`
  - `delete`
  - Unknown actions stay queued.
  - Native only needs the current actions: `clock_in`, `clock_out`, `switch`, `adjust`, `delete`.

### 1.9 Loading / empty / error / offline states (Timesheet)

| State | RN behaviour |
|---|---|
| Loading | **None.** There is no spinner or skeleton. The list renders immediately from the local store. Before hydration completes, every past day shows "No clock-in". |
| Empty period | Every day shows the red **`No clock-in` / `No time logged`** card. The summary shows `0h 0m` / `0` / `$0.00`. |
| Error | Fetch errors are swallowed silently (`fetchTimeEntryRows` returns `null` → no change). The only visible errors are on the Edit screen (§1.7C). |
| Offline | Identical to online. Local data is shown, edits are queued, and nothing is shown to indicate either. |
| Pull-to-refresh | **None** (bounce disabled). |

SF Symbol fallback mapping (only if Ionicons are not bundled): `chevron-down`→`chevron.down`, `chevron-back`→`chevron.left`, `chevron-forward`→`chevron.right`, `checkmark`→`checkmark`, `alert`→`exclamationmark`, `briefcase`→`briefcase.fill`, `location-sharp`→`mappin` (closest), `car-sport`→`car.fill`, `help-circle-outline`→`questionmark.circle`, `help`→`questionmark`, `close-circle`→`xmark.circle.fill`, `hammer`→`hammer.fill`, `swap-horizontal`→`arrow.left.arrow.right`, `arrow-forward`→`arrow.right`, `checkmark-circle`→`checkmark.circle.fill`, `alert-circle`→`exclamationmark.circle.fill`, `help-circle`→`questionmark.circle.fill`, `trash-outline`→`trash`, `refresh`→`arrow.clockwise`, `warning-outline`→`exclamationmark.triangle`, `location-outline`→`mappin.and.ellipse`, `time-outline`→`clock`, `folder`→`folder.fill`, `reader-outline`→`doc.text`, `map-outline`→`map`, `ellipsis-horizontal`→`ellipsis`.

### 1.10 Other presenters in `timeEntryPresenters.js` (used outside this area; documented for completeness)

- `summarizeAdjustments(entry)` is used by ClockInScreen.
  - `netMinutes = round((startedAt − (originalStartedAt || history[0].previousStartedAt)) / 60000)`.
  - It returns `null` when 0; otherwise `{netMinutes, editedAtLabel: formatClock(startEditedAt || last.adjustedAt), editedBy: last.adjustedByName || last.adjustedByEmail || entry.userName || "Painter"}`.
- `getProjectTimeTotals(entries, active)`: Σ `durationMs` per `entryProjectId`, then `formatDuration`.
- `getProjectLatestActivity`: the maximum of `endedAt || startedAt` per project, in ms.
- `buildProjectClockInDays(entries, active, project, user, nowMs)` is the per-job **team time** used by ProjectDetail (spec 04).
  - It de-duplicates by identity keys (`serverId`, `id`, `localId`) and filters to the project's `companycam_id`.
  - It groups by local day, then by `userName || "Painter"` (`isYou` when `userId`/`userEmail` match).
  - It emits one row **per segment**: `{start, startSrc, end ("Now" if active), endSrc, duration, durationMs, status: "on"|"off"|"unknown", distanceLabel ("X m from site" or null), entryId, entryStart, entryStartSrc, entryEnd, entryEndSrc, raw, isCurrentUser}`.
  - Day `label` is `"Today"` for today, else the long weekday (`Monday`). `dateLabel` is `toLocaleDateString("en-CA", {month:"short", day:"numeric", year:"numeric"})` → `Sep 2, 2026`.

**Server `adjustment_history` shape mismatch [RN BUG — note].** The server's `adjust` appends **snake_case** items `{adjusted_at, adjusted_by, source, previous_started_at, previous_ended_at}`. The client reads only camelCase keys (`adjustedAt`, `previousStartedAt`, `previousEndedAt`, `adjustedByName`). For server-loaded history:
- "Original in" relies only on `original_started_at`.
- "original out" never shows.
- "edited" falls back to `start_edited_at`.
- `editedBy` falls back to the entry owner's name.

Native should read both key styles (and write none; the server owns history).

---

## 2. Team Map (`TeamMapScreen.js`, iOS/Android variant)

### 2.1 Access and lifecycle

- **Who can open it:** only users with `canViewTeamMap` (§0): employees.role `admin` or `manager`, with the feature enabled. It is a bottom tab labelled **`Team Map`**. Server RLS also limits rows to self plus companies the user manages.
- **Polling (from `useTeamLocations(enabled)`):**
  - While enabled: statuses load immediately, then every **30 s**, and on each app foreground.
  - While a person is selected: their route loads on selection, then every **30 s**.
  - Manual refresh (header button) reloads statuses, plus the route if someone is selected.
  - Leaving the tab (`enabled=false`) stops status polling and clears route points. The selection is kept.
- **No realtime subscriptions.** Polling only.

### 2.2 Map

- **Provider:** `react-native-maps` `MapView` with **no `provider` prop**, so iOS uses **Apple MapKit**, standard map type. Use MapKit (SwiftUI `Map` or `MKMapView`).
- Map settings:
  - Full-screen under the overlays.
  - `rotateEnabled={false}`, `pitchEnabled={false}`, `showsCompass={false}`.
  - The user-location dot is not shown. There is no custom map style.
- Initial region: `OTTAWA_REGION` = centre `45.4215, -75.6972`, span `0.18 × 0.18`.
- **Markers:**
  - **Standard system pins** tinted with `pinColor`. Tapping a pin shows the native callout (title/description).
  - There are **no always-visible name labels** and **no clustering** in the current code. Overlapping pins simply overlap.
  - If an always-visible label overlay was expected, it does not exist in RN. Do not add it for "parity". Consider it only as part of §4.
- Camera fitting runs whenever `selectedUserId` or the displayed coordinates change. The coordinate key uses 4-decimal rounding.
  - One coordinate: `animateToRegion({...c, latitudeDelta: 0.025, longitudeDelta: 0.025}, 300ms)`.
  - More than one: `fitToCoordinates(coords, {animated: true, edgePadding: {top: 100, right: 55, bottom: 300, left: 55}})`.
  - Because polling can change coordinates, **the camera re-fits every time someone moves**. This pulls the camera away from a manager who has panned. [RN behaviour; keep or soften, decide.]
  - The overview uses status coordinates. The selected view uses all route point coordinates, not the status point.

**Overview (no one selected):**
- One pin per status row with finite `latitude`/`longitude`.
- Pin colour = freshness colour (§2.3).
- Callout title: `user_name || user_email || "Painter"`. Callout description: `${modeLabel(tracking_mode)} · ${ageLabel(last_location_at)}`.
- Tapping a pin selects that person.

**Selected person:**
- Overview pins are hidden.
- Route polylines: `splitRouteSegments(routePoints)` sorts by `captured_at` and starts a new segment when the gap between consecutive points is greater than `routeGapMs` = **15 min**. Each segment with more than 1 point is drawn as a polyline in `#2f8d7f`, width 5, round cap and join.
- Accuracy circle at the status coordinate: radius `max(20, accuracy_meters || 20)` m, stroke `rgba(47,141,127,0.50)`, fill `rgba(47,141,127,0.14)`.
- Status pin at the status coordinate: freshness colour, title `${user_name || "Painter"} · last recorded`, description `ageLabel(last_location_at)`.
- Job-site pins: for each project in `projects` whose `companycam_id || id` appears in route points' `job_id` **and** which has coordinates. Pin `#7c5127` (palette brown), title `project.name || "Job site"`, description **`Job site`**.
- Gap pins: at the first point of every segment after the first. Pin `#c47b23`, title **`Tracking resumed`**, description **`The route has a gap before this point.`**

### 2.3 Status → colour / labels (`locationTrackingPolicy.js`)

`freshnessForTimestamp(last_location_at, now)`:

| Condition | `level` |
|---|---|
| Missing, invalid or ≤0 timestamp | `unavailable` |
| age ≤ 5 min (`freshAfterMs`) | `fresh` |
| age ≤ 15 min (`staleAfterMs`) | `aging` |
| older | `stale` |

`freshnessForTrackingStatus` overrides this: `tracking_mode === "clocked_out"` → level `clocked_out`.

| Level | Colour (pin, status dot) |
|---|---|
| `fresh` | `#2f8d7f` |
| `stationary` | `#3e7590`. **Dead code:** no function returns this level. |
| `clocked_out` | `#8b9692` |
| `aging` | `#c47b23` |
| `stale`, `unavailable` | `#b4473d` |

`ageLabel(ts)`:
- No timestamp: **`No location received`**.
- Under 1 min: **`Updated just now`**.
- Under 60 min: `Updated ${m}m ago`.
- Otherwise: `Updated ${h}h ${m}m ago`. Hours are unbounded, so a row from 3 days ago reads `Updated 72h 4m ago`.
- The label is evaluated at render time. It re-renders on every 30 s poll, and every second when the viewing manager has an active shift.

`modeLabel(tracking_mode)`:

| `tracking_mode` | Label |
|---|---|
| `painting` | `Painting mode` |
| `stationary` | `Stationary` |
| `travel` | `Travelling` |
| `clocked_out` | `Clocked out` |
| `unavailable` | `Tracking unavailable` |
| anything else (incl. `unknown`) | `Tracking status unknown` |

Rows are **not filtered by date or by clock-in status**. Every employee who has ever uploaded a status appears, including clocked-out people, in grey with an old "Updated …" label.

### 2.4 Overlays, copy, style

Palette for this screen is `theme.palette`: green `#173f37`, teal `#2f8d7f`, brown `#7c5127`, white `#ffffff`, surface `#f7f8f7`, border `#e0e3e1`, muted `#8b9692`, ink `#11201d`. Container background `surface`.

**Header card** (floating):
- Position: absolute, top 12 (below the safe area), left and right 12.
- Style: background `rgba(255,255,255,0.96)`, radius 18, 1pt `border`, padding 14, shadow `#000` at opacity 0.12, radius 12, offset (0,4).
- Title row (gap 10):
  - Only when someone is selected: back button, 38×38, radius 12, background `surface`, Ionicon `chevron-back` 22 `ink`. Accessibility label **`Back to team map`**. Clears the selection.
  - Text block (flex):
    - Kicker **`Team locations`**: 10.5pt, 900, `teal`, tracking 1.2, UPPERCASE.
    - Title: selected person's `user_name`, else **`Today’s field map`** (typographic apostrophe U+2019). 22pt, 900, `ink`, tracking −0.4, 1 line.
  - Refresh button: 40×40, radius 13, background `#edf6f3`, Ionicon `refresh` 20 `teal`. Accessibility label **`Refresh team locations`**. There is no spinner and no disabled state while refreshing.
- Below the title row:
  - Nobody selected: **`Tap a painter to see today’s route and tracking gaps.`** (12.5pt, 600, `muted`, top margin 5).
  - Someone selected: a row (gap 7, top margin 7) of a 10×10 status dot, `${modeLabel} · ${ageLabel}`, and `${routePoints.length} route points`. Both texts are 11.5pt 700 `muted`. The count is not singularised ("1 route points").

**Bottom panel:**
- Position: absolute, left 0, right 0, bottom 0 (sits on the app tab bar). Minimum height 218.
- Style: background `rgba(255,255,255,0.97)`, top radii 24, 1pt `border` (no bottom border), padding t14 / b18.
- Contents, in order:
  1. Error row, shown if `error` is set (above anything else):
     - Style: margin h14 / b10, background `#fff5e9`, radius 12, padding 10, gap 7.
     - Ionicon `warning-outline` 17 `#a45623` and the text (11.5pt, 700, `#87491e`, 2 lines).
     - Messages:
       - Status fetch: `error.message || "Team locations could not be loaded."`
       - Route fetch: `error.message || "This route could not be loaded."`
     - The error clears on the next successful **status** fetch. Stale data stays visible under it.
  2. Then exactly one of the following:
     - **Loading**: a centred box (min height 160, gap 10) with a spinner in `teal` and **`Loading team locations…`** (U+2026 ellipsis; 12.5pt, 700, `muted`).
       - **[RN quirk]** `loading` starts as `Boolean(enabled)` at mount. The screen mounts while another tab is active (`enabled=false`), so in practice the spinner **never shows**. The first visit shows the empty card until the first fetch returns. Native: show the loading state on the first fetch (intended behaviour); this is a cosmetic deviation.
     - **Selected → Route summary**:
       - Layout: wrapping grid, padding h16, gap 10. Cells are 47% wide, background `surface`, radius 14, 1pt `border`, padding 12. Label 10.5pt, 800, `muted`, UPPERCASE, tracking 0.7. Value 13pt, 900, `ink`, top margin 4, 1 line.
       - While `routeLoading`, a spinner is inserted as the first grid item.
       - Cells:
         - **`First point`**: time of the first route point, or **`None today`**.
         - **`Last point`**: time of the last route point, or **`None today`**.
         - **`Route gaps`**: `segments − 1`, never negative. The value is `#b4473d` when > 0.
         - **`Job`**: `project_name || "Not assigned"`.
       - Times use `h:mm a`, or **`Unknown`** if invalid.
     - **Overview → horizontal card list**: padding h14, gap 10, no scroll indicator. One card per status row, in fetch order.
       - Card: 168 wide, min height 174, radius 18, `surface`, 1pt `border`, padding 14. Opacity 0.72 while pressed. Tap selects the person.
       - Top row (space-between, bottom margin 10):
         - Avatar: 38×38 circle, `green`, initials 12pt 900 white. Initials come from `user_name` only: first letters of up to 2 whitespace parts, uppercased, fallback **`P`**.
         - 10×10 freshness dot.
       - `user_name || user_email || "Painter"`: 14.5pt, 900, `ink`, 1 line.
       - `project_name || "No active job"`: 12pt, 700, `muted`, top margin 3, 1 line.
       - `ageLabel`: 11.5pt, 800, `teal`, top margin 13. It turns `#b4473d` **only when level is `stale`**; aging stays teal, and so does `unavailable`.
       - `modeLabel`: 11pt, 700, `ink`, top margin 4.
     - **Empty**: a card 290×165, centred, padding h18. It shows Ionicon `location-outline` 25 `muted`, **`No tracking records yet`** (14pt, 900, `ink`, top margin 8) and **`Records appear after painters clock in with this version.`** (12pt, `muted`, centred, top margin 3).
- Offline has no dedicated state. The fetch error message (usually a network error string from supabase-js) appears in the error row.

### 2.5 `.web.js` differences (not needed for iOS; for reference only)

- Map and markers: Leaflet with OSM tiles, a zoom control at the bottom right, and background `#eef4f1`.
  - Markers are circle markers (radius 9, white 3pt ring) with hover tooltips `name<br>Updated …`.
  - The selected-location marker has radius 10 and tooltip `Last recorded location`. The job marker is a white circle with a brown ring.
  - The gap tooltip reads `Tracking resumed after a gap`.
  - Fit padding: top-left `[45,110]`, bottom-right `[45,250]`. A single point uses zoom 15.
- Copy:
  - Subtitle `Select a painter to view today’s route.` When someone is selected, the subtitle shows `mode · age` inline.
  - Loading text is `Loading locations…`.
  - `modeLabel` fallback is `Unknown`.
- Layout:
  - The bottom panel floats (inset 16, radius 22, max height 220).
  - Summary cells are `Route points` (`Loading…` while loading), `Tracking gaps`, `Last recorded` and `Job` (`No active job`).
  - Cards are 180 wide with the mode at the top right.
  - The error is plain text in `#a45623`.
  - There are no accessibility labels.

---

## 3. Supabase contracts

### 3.1 Reads

| Call | Exact query | Used by |
|---|---|---|
| Time entries | `from("time_entries").select("*").neq("status","deleted").order("started_at",{ascending:false}).limit(500)` → `GET /rest/v1/time_entries?select=*&status=neq.deleted&order=started_at.desc&limit=500`. Always preceded by `flushQueuedWrites()`. Rows whose `id` or `client_entry_id` has a queued delete are dropped. On error, returns `null`. | `refreshServerEntries` (45 s / foreground / mount) |
| Team statuses | `from("employee_tracking_status").select("*").order("last_location_at",{ascending:false, nullsFirst:false})` → `?select=*&order=last_location_at.desc.nullslast`. No filter, no limit. | Team Map, 30 s |
| Route | `from("employee_location_points").select("*").eq("employee_id", userId).gte("captured_at", localMidnightISO).lt("captured_at", nextLocalMidnightISO).order("captured_at",{ascending:true}).limit(2000)`. The bounds are **today in device-local time**. | Team Map selected, 30 s |

`location_alerts` is **not read by the mobile app**. It is written only by the `stale-location-alerts` edge function (§3.4).

Client normalisation:
- `entryFromSupabase(row)` maps a time entry row to:
  - `id=row.id`, `localId=client_entry_id||id`, `serverId=id`, `userId=employee_id`, `userEmail=employee_email`, `userName=employee_name||"Painter"`.
  - `project={companycam_id: job_id, job_id, id: job_id, name: job_name||"Job", address: job_address, formatted_address: job_address}`.
  - `originalStartedAt=original_started_at||started_at`, `startedAt`, `startEditedAt`.
  - `endedAt` = `null` if `status==="active" && !ended_at`, else `ended_at || now`.
  - `durationMs` = (`endedAt || now`) − `started_at`.
  - `clockOutReason` = `"active"` if `status==="active"`, else `"server"`.
  - `startedLocation` from `clock_in_lat/lng`; `lastLocation` from `clock_out_lat/lng`.
  - `lastDistanceMeters=last_distance_meters`, `onSite=is_on_site`.
  - `segments` and `adjustmentHistory` are arrays, defaulting to `[]`.
- Tracking status adds aliases `user_id=employee_id`, `user_email`, `user_name`, `companycam_project_id=job_id`, `project_name=job_name`, `project_address=job_address`.
- A location point adds `user_id`, `companycam_project_id=job_id`, `distance_from_project_meters=distance_from_job_meters`.

### 3.2 Table shapes (live, 2026-09-26)

`public.time_entries`:

| Column | Type / notes |
|---|---|
| `id` | uuid PK |
| `client_entry_id` | text, unique |
| `employee_id` | uuid → employees.id (= auth.users.id) |
| `job_id` | uuid → jobs.id |
| `employee_email`, `employee_name` | text (denormalised at clock-in) |
| `job_name` | text not null |
| `job_address` | text |
| `original_started_at`, `started_at` (not null), `start_edited_at`, `ended_at` | timestamptz |
| `status` | text: `active` \| `completed` \| `deleted` |
| `clock_in_latitude`, `clock_in_longitude`, `clock_out_latitude`, `clock_out_longitude` | double |
| `last_distance_meters` | integer |
| `is_on_site` | boolean |
| `segments`, `adjustment_history` | jsonb, default `[]` |
| `notes` | text (the server stores the command `reason` here) |
| `approved_at`, `approved_by` | unused by the app |
| `created_at`, `updated_at` | timestamptz |
| `org_id` | uuid (set by trigger) |

Constraints:
- `check ((status='active' and ended_at is null) or status <> 'active')`.
- Unique index `time_entries_one_active_per_employee_idx` on `(employee_id)` for active rows.
- Also indexed: `(employee_id, started_at desc)`.

`public.employee_tracking_status` has one row per employee (PK `employee_id`). Columns: `employee_email`, `employee_name`, `time_entry_id`, `client_entry_id`, `job_id`, `job_name`, `job_address`, `latitude`, `longitude`, `accuracy_meters`, `last_location_at`, `last_sync_at`, `tracking_mode` (not null), `task_status` (not null), `permission_foreground`, `permission_background`, `platform`, `app_version`, `last_error_code`, `metadata` jsonb, `created_at`, `updated_at`, `org_id`.

`public.employee_location_points` columns: `id`, `client_event_id` (unique), `employee_id`, `time_entry_id`, `client_entry_id`, `job_id`, `latitude`, `longitude` (not null), `accuracy_meters`, `speed_mps`, `heading_degrees`, `is_mocked`, `tracking_mode` (not null), `event_type` (not null; client values `location`, `clock_in`, `clock_out`, `project_switch`, `tracking_status`), `distance_from_job_meters`, `is_on_site`, `captured_at`, `received_at`, `created_at`, `org_id`. Index `(employee_id, captured_at desc)`. Retention: a cron job runs `purge_expired_employee_location_points(60)`, which deletes points older than **60 days**.

`public.location_alerts` columns: `id`, `employee_id`, `time_entry_id` (unique), `stale_since`, `last_notified_at`, `resolved_at`, `created_at`, `updated_at`, `org_id`.

**RLS (latest, `20260925201731_scope_rls_to_organizations.sql`):**
- `time_entries`: `org_member_read`, SELECT when `org_id in private.my_org_ids()`. **Every member of the company can read every entry in it.** There are no client INSERT/UPDATE/DELETE policies; all writes go through the RPC.
- `employee_tracking_status`, `employee_location_points`, `location_alerts`: `own_or_org_manager_read`, SELECT when `employee_id = auth.uid()` **or** `org_id in private.my_managed_org_ids()` (org_members role `owner`/`admin`/`manager`, active member, active org). Writes only through `record_location_update`.

### 3.3 RPC `public.record_time_entry_command(action text, command jsonb, next_command jsonb default null) returns jsonb`

- Security definer; granted to `authenticated`.
- The public wrapper (`20260925205112`) resolves the org from `command.job_id`/`task_id` and the existing entry (`server_id` or `client_entry_id`). It raises `This action spans two companies.` (42501) on a mismatch, calls `private.set_acting_org(...)`, then runs `private.record_time_entry_command__unscoped` (body from `20260805033248`, active-member check patched in `20260925210514`).
- Common guards:
  - `Authentication required`.
  - `Active employee profile required`: the caller must have an `employees` row and be `private.acting_member()` of the acting org.
- Actions relevant here:
  - `adjust`:
    - Finds the entry by `server_id` or `client_entry_id` (`Time entry not found` otherwise).
    - Guards: owner or `private.is_manager()`. Errors are `Time entry belongs to another employee` and `Only a manager can adjust another employee time entry`.
    - `original_started_at = coalesce(original_started_at, started_at)`.
    - `started_at = command.started_at ?? existing`.
    - If the key `started_at` is present, `start_edited_at = now()`.
    - If the key `ended_at` is present, `ended_at = command.ended_at` (may be null). A non-null value also sets `status='completed'`.
    - Appends `{adjusted_at, adjusted_by, source: adjustment_source||'app', previous_started_at, previous_ended_at}` to `adjustment_history`.
    - `notes = coalesce(reason, notes)`.
    - Writes a `time_entry_events` row (`event_type 'adjust'`, `source = command.source||'app'`, `metadata.command = command − 'segments'`).
    - **Does not update `segments`, locations or `job_id`.**
    - Returns the row as JSON.
  - `delete`:
    - Same lookup; a missing entry returns `false`.
    - Same ownership/manager guard.
    - Sets `status='deleted'`, `ended_at = coalesce(ended_at, now())`, logs an event, and returns `true`.
  - Also used by clocking (spec 03): `clock_in`, `clock_out`, `switch` (runs `clock_out(command)` then `clock_in(next_command)`, returns `{completed_entry, active_entry}`), and `observation` (updates clock-out lat/lng, distance, on-site and segments on the active row; no event).
- Command payload the client sends (`commandPayload`): `client_entry_id`, `server_id` (uuid or null), `user_name`, `job_id`, `project_name`, `project_address`, `original_started_at`, `started_at`, `ended_at` (only with `includeEndedAt`), `clock_in_latitude`, `clock_in_longitude`, `clock_out_latitude`, `clock_out_longitude`, `last_distance_meters`, `is_on_site`, `segments`, `reason`, `source` (`"mobile"`), `adjustment_source` (`"mobile_time_edit"` for edits).

### 3.4 Location writes and alerts (context for §4)

- `public.record_location_update(point jsonb, tracking jsonb default null) returns boolean`:
  - Resolves the org from the entry or job.
  - Requires an acting member. If `time_entry_id` is given it must belong to the caller.
  - Inserts `point` into `employee_location_points` (`on conflict (client_event_id) do nothing`).
  - If `tracking` is non-null, upserts `employee_tracking_status` for the caller. `employee_name`/`email` come from `employees`, `job_name`/`address` from `jobs`; lat/lng/accuracy/`last_location_at` from `point`; mode, `task_status`, permissions, `platform`, `app_version`, error and metadata from `tracking`.
  - The client (`syncPendingLocationData`) sends each queued point, attaching `tracking` only to the last one.
  - With no points but a pending status that has coordinates, the client synthesises a point with `event_type: "tracking_status"`.
- Edge function `stale-location-alerts` (cron, bearer `LOCATION_TRACKING_ALERT_CRON_SECRET`):
  - It checks every active entry whose employee **has** a status row.
  - The entry is stale when both `started_at` and `last_location_at` are older than a threshold: `painting` 8 h, `stationary` 2 h, otherwise **15 min**.
  - For each stale entry, and at most hourly, it pushes to every active admin/manager: title `${employee_name || "Painter"} tracking was interrupted`, body `No work-location update for ${window} while clocked in to ${job_name || "a job"}. Ask them to reopen ServiceFlow.` It then upserts `location_alerts`.
  - It resolves alerts that are no longer stale.

### 3.5 Realtime

None for these screens. `mobile/src` uses `.channel(...)` only in `projectLabourTasks.js`, which is outside this area.

---

## 4. Native iOS changes required by App Store review

Premise: the native app will **not** use background location. There will be no `UIBackgroundModes: location` and no "Always" permission; only `NSLocationWhenInUseUsageDescription`. RN's `app.config.js` currently declares `UIBackgroundModes: ["location","fetch"]` and `isIosBackgroundLocationEnabled: true`; drop both. Location is captured only at **clock-in**, **clock-out**, **project switch**, and **while the app is in the foreground** (RN's foreground heartbeat is `FOREGROUND_LOCATION_HEARTBEAT_MS` = 4 min, plus a watch).

Consequence: `employee_tracking_status.last_location_at` and the route points describe "the last time the app was open or the person clocked in/out". They do not describe where the person is now. Every "live tracking" affordance becomes misleading.

### 4.1 Team Map: required changes

| RN element | Problem without background location | Required native behaviour |
|---|---|---|
| Freshness colours: `fresh` ≤5 min teal, `aging` orange, `stale`/`unavailable` red `#b4473d` | Almost everyone clocked in would be red "stale" within 15 min. Red implies a fault or evasion. | Use 3 neutral states: **Clocked in** (teal `#2f8d7f`), **Clocked out** (grey `#8b9692`), **No location recorded** (grey outline or `#8b9692` with a hollow dot). Clocked in means the status row has `tracking_mode != "clocked_out"` and `time_entry_id` is set; confirm against `time_entries.status='active'` if needed. **Do not colour by age.** The red `stale` colour must not be used. |
| `ageLabel`: `Updated just now` / `Updated 12m ago` | "Updated" implies continuous updates. | **`Last seen {time}`** using an absolute local time: `Last seen 2:41 PM` today, `Last seen Yesterday, 4:10 PM`, `Last seen Sep 22, 4:10 PM`. Optionally add a relative suffix ("· 12 min ago"). Keep **`No location received`** → recommend **`No location recorded`**. |
| `modeLabel`: `Painting mode`, `Travelling`, `Stationary`, `Tracking unavailable`, `Tracking status unknown` | These are states of a continuous tracker. | Replace them with an event-based line built from the last recorded point's `event_type` and `is_on_site`. `clock_in` → `Clocked in at {job}` / `Clocked in off site`. `clock_out` → `Clocked out`. `location`/`tracking_status` → `Seen on site` / `Seen off site` / `Location recorded`. `project_switch` → `Switched to {job}`. This needs the latest point per person, one extra query (see below). The fallback is the status row's `metadata.on_site`. |
| Header subtitle **`Tap a painter to see today’s route and tracking gaps.`** | Promises a route, and treats gaps as anomalies. | **`Tap a painter to see where they were recorded today.`** Also add a persistent small note in the bottom panel or legend: **`Locations are recorded at clock-in, clock-out and while ServiceFlow is open. They are not live.`** |
| Title **`Today’s field map`** | Acceptable. | Keep. |
| Route polylines joining points; gaps > 15 min split them | Straight lines between widely separated foreground samples look like a travelled route, which is false. | **Do not draw polylines.** Show the day's recorded points as discrete markers in time order. Label each point with its time, or number it and list the times, and give each a distinct glyph by `event_type` (clock-in, clock-out, app-open sample). |
| Gap pins **`Tracking resumed`** / **`The route has a gap before this point.`** | Gaps are now normal. | **Remove.** |
| Route summary cells `First point`, `Last point`, **`Route gaps`**, `Job` | "Route gaps" is meaningless and alarming. | Use `Clocked in` (time of the day's first `clock_in` point, or `—`), `Last seen` (last point time), `Points recorded` (count), and `Job`. Drop `Route gaps`. |
| Header meta `{n} route points` | "Route" wording. | `{n} location records` (singularise: `1 location record`). |
| Selected-status pin title `… · last recorded` | Acceptable wording. | Keep `{name} · last seen`, with the description `Last seen {time}`. |
| Accuracy circle | Fine. | Keep. |
| Overview shows every status row ever, including people clocked out for days | Implies an ongoing watch over staff off shift. | Show on the map only people **clocked in now**, or with a point **today** (local). Everyone else goes in the card list with `Clocked out · Last seen {date}` and **no map pin**. **[Decision needed]** the recommended default is to hide clocked-out people's pins. |
| 30 s polling and camera re-fit on each change | The data changes only on events, and the re-fit pulls the camera. | Keep a 30 s poll (cheap) plus pull-to-refresh or the refresh button. **Fit the camera only on first load and on selection change**, not on every poll. |
| Empty state `Records appear after painters clock in with this version.` | Fine. | Keep the copy. Add the "not live" note above. |
| Always-visible name labels / clustering | Absent in RN. | Optional. If "last seen" markers are added, an always-visible name + time label per clocked-in person is the clearest honest design. With more than ~10 people, add MapKit clustering (`MKClusterAnnotation`). This is a product call, not required by review. |

The extra query for the "last seen" line is **the latest point per visible employee today**: `employee_location_points?select=employee_id,event_type,is_on_site,captured_at,job_id&captured_at=gte.{localMidnight}&order=captured_at.desc&limit=500`, reduced client-side to the first row per `employee_id`. RLS already permits this for managers. A server view or RPC would be better; that is outside this spec.

Server-side (must change with the native release, or managers get false alarms):
- `stale-location-alerts` will flag **every** native-iOS worker who is clocked in and has not opened the app for 15 min (travel), 2 h (stationary) or 8 h (painting). It pushes "`… tracking was interrupted`" / "`Ask them to reopen ServiceFlow.`". Rows where `employee_tracking_status.platform = 'ios'` from the native build need to be excluded (distinguish by `app_version`, or add a `metadata.background_tracking = false` flag the native app writes). Otherwise the function should be retired.
- The native app must still call `record_location_update` at clock-in, clock-out, switch and foreground samples:
  - Points use `event_type`s `clock_in`, `clock_out`, `project_switch`, `location`.
  - `tracking.permission_background = false`.
  - `tracking.tracking_mode` is derived from on-site (`painting`) or off-site (`travel`) at that sample, or `clocked_out` at clock-out.
  - `task_status` is `"running"` while clocked in and `"stopped"` at clock-out.
  - This keeps the web admin and the map working.

### 4.2 Timesheet: what depends on continuous location

| Element | Dependency | Required native behaviour |
|---|---|---|
| Day `On site {x}` / `Drive {x}` / `No GPS {x}`; Day detail chips; entry `Mixed` breakdown `On site … · Travel/off site …`; entry status `On Site`/`Off Site`/`Mixed` | These come from `segments`, built by `appendSegment` on every GPS sample. Without background samples, a same-mode sample after hours of absence **silently extends** the previous segment across the gap. A mode change starts a new segment at the sample time, leaving the gap uncounted. "Drive" then really means "the last reading before the app closed was off site". | When appending a sample, if `now − lastSegment.endedAt > 15 min` (reuse `TRACKING_POLICY.routeGapMs`), first insert a `{mode: "unknown", startedAt: lastSegment.endedAt, endedAt: now}` segment, then append or extend as usual. At clock-out, if the gap since the last sample exceeds 15 min, insert an `unknown` segment up to `endedAt`. This uses the existing data shape (`unknown` is already supported and shown as **No GPS**), so the web and other clients need no change. **[Decision]** Rename the `No GPS` label to **`Not recorded`** / **`not recorded`**. "No GPS" suggests a device fault. Also consider renaming `Drive` to **`Off site`** (there is no drive detection). Both are copy changes to agree with product. |
| Day total vs buckets | The total uses `durationMs`, so it is unaffected. | Keep. Because of the unknown-gap rule above, on-site + off-site + not-recorded will now sum to the total. |
| Entry `distance` "`{x} from site`" | This is the last sample's distance. | Keep. Optionally make it explicit: `{x} from site at last reading`. |
| `IN`/`OUT` sources `GPS`/`Manual` | `startedLocation` comes from the clock-in fix and `lastLocation` from the clock-out fix. | Unaffected, **provided** the native app takes a fresh fix at clock-out (with a timeout; RN uses `CLOCK_OUT_LOCATION_TIMEOUT_MS = 8000`) and stores it as `lastLocation`/`clock_out_*`. Foreground samples also update `lastLocation`. So `OUT · GPS` can mean "a sample from while open", not "at clock-out". Acceptable; note it only. |
| Edit screen status `On site during clock-in` / `Off site during clock-in` / `Location was not recorded for this clock-in` | This comes from the segment summary. | Unaffected in wording. It now reflects the honest segments. |
| Pay periods, totals, editing, deleting | No location dependency. | Unchanged. |

### 4.3 Permission copy (for reference; it belongs to spec 03)

The More screen's RN copy (`Tracking may pause if ServiceFlow is force-closed.`, `ServiceFlow requests location when you clock in and stops tracking when you clock out.`, `Location access: Active shifts only`) implies continuous tracking. It should become something like `ServiceFlow records your location when you clock in, when you clock out, and while the app is open during a shift.`. The purpose string (`NSLocationWhenInUseUsageDescription`) must match: it must say location is recorded at clock-in/out and while the app is open during a shift, for verifying job-site attendance.

---

## 5. Open questions (summary)

1. `row.user_id` bug (§1.1): should native load own history from the server (`employee_id`)? The recommendation is yes. It changes what users see.
2. Should Timesheet sub-screens push with animation and swipe-back (native stack), or replace instantly as RN does?
3. Edit screen treats `Mixed` as off site: keep, or fix?
4. The active entry's duration on the list does not tick: keep, or refresh every minute?
5. The camera re-fits on every Team Map poll: keep, or fit only on first load and selection?
6. Team Map pins for clocked-out people: hide them (recommended)?
7. Copy renames `No GPS` → `Not recorded` and `Drive` → `Off site`.
8. `stale-location-alerts` exclusion for native iOS workers (server change, required).
9. Role gate: `employees.role` vs `org_members.role`.
