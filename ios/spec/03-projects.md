# 03 — Projects list, project detail, budgets and labour tasks

Source of truth (React Native, read in full):
`mobile/src/screens/ProjectsScreen.js`, `mobile/src/screens/ProjectDetailScreen.js`,
`mobile/src/components/BudgetProgress.js`, `mobile/src/components/ProjectLabourTasksPanel.js`,
`mobile/src/components/OverBudgetReasonSheet.js`, `mobile/src/lib/projectRepository.js`,
`projectBudget.js`, `projectLabourTasks.js`, `projectLabourTaskModel.js`, `useProjectLabourTasks.js`,
`jobOverBudget.js`, plus helpers they depend on: `mobile/src/theme.js`, `mobile/App.js`,
`useEmployeeProjectContext.js`, `employeeRepository.js`, `projectClockInSummary.js`,
`timeEntryPresenters.js`, `trackingModel.js`, `timeTrackingStorage.js` (over-budget marker only),
`mobile/src/screens/clock-in/JobPhotosPanel.js`.

Server contracts are taken from the latest migrations in **two** directories:
`supabase/migrations/` and `mobile/supabase/migrations/` (the latter holds the latest `job_feed`
definition and the original `ensure_lead_clock_in_job` body). See §5.

Out of scope here (covered by other specs): the camera and upload pipeline (`ProjectCameraScreen`,
`useProjectMediaUploadQueue`, `projectMedia.js`), the Clock In screen, and time-entry storage and sync.
This spec lists where those parts appear on these screens and what they show.

> **Docs are stale.** `mobile/docs/project-labour-tasks.md` and `over-budget-reasons-plan.md` describe
> task **timers**, `list_project_labour_tasks`, `set_project_labour_task_status`,
> `project_labour_task_*` tables, and a per-task over-budget prompt shown on timer Stop. **None of that
> is in the current code.** Server-side, task timers were removed (`record_time_entry_command` raises
> `'Task timers have been removed'` for `task_start|task_stop|task_adjust`). The current app has:
> a checklist only (no start/stop), reads `job_tasks` and `job_budgets` directly, and calls
> `set_job_task_status`. The only over-budget prompt shown is the **job-level** one after clock-out.
> Build from this spec, not from the docs.

---

## 0. Shared conventions

### 0.1 Typography
- The only font is the system font (SF Pro). Weights map as RN numeric → SwiftUI:
  `500`→`.medium`, `600`→`.semibold`, `700`→`.bold`, `800`→`.heavy`, `900`→`.black`.
  `'650'` (used once, `dayDate`) is not a valid RN weight. Treat it as `.semibold` (ambiguous).
- `letterSpacing` values are in points → SwiftUI `.tracking(x)`.
- `textTransform: 'uppercase'` → render the string uppercased (the source strings are mixed-case;
  the copy tables below give both where it matters).
- `fontVariant: ['tabular-nums']` → `.monospacedDigit()`.
- `numberOfLines: n` → `.lineLimit(n)` with tail truncation.

### 0.2 Palettes (hex exact)
Three palettes are in use. Do not merge them: the detail screen deliberately uses a different one.

**List palette** (`theme.js` `palette`, used by ProjectsScreen):

| token | hex |
|---|---|
| green | `#173f37` |
| teal | `#2f8d7f` |
| brown | `#7c5127` (unused here) |
| white | `#ffffff` |
| surface | `#f7f8f7` |
| border | `#e0e3e1` |
| muted | `#8b9692` |
| ink | `#11201d` |

**Detail palette** (constants at top of `ProjectDetailScreen.js`):

| token | hex |
|---|---|
| BRAND | `#2b8496` |
| NAVY | `#31495d` |
| INK | `#1f2933` |
| TEXT | `#2f3136` |
| MUTED | `#8a8f95` |
| SUBTLE | `#b8bcc1` |
| BORDER | `#e6e8eb` |
| SOFT | `#f6f8f9` |
| TILE_BG | `#ffffff` |

**Task panel / sheet palette** (`ProjectLabourTasksPanel.js`, `OverBudgetReasonSheet.js`):
TEAL `#2f8d7f`, INK `#11201d`, MUTED `#8b9692`, BORDER `#e0e3e1`, HAIRLINE `#edefee`,
WHITE `#ffffff`, WARNING `#b56025` (sheet only).

**Budget component palette** (`BudgetProgress.js`, hard-coded): see §3.

### 0.3 Date/time formatting (replicating Hermes `Intl` on iOS)
Hermes on iOS formats through `NSDateFormatter`, so use `DateFormatter` with templates:

| JS call | Swift equivalent |
|---|---|
| `toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})` | `Locale.current`, `setLocalizedDateFormatFromTemplate("jmm")` (e.g. `7:02 a.m.` for en_CA, `7:02 AM` for en_US) |
| `toLocaleTimeString('en-CA', {hour:'numeric', minute:'2-digit'})` | `Locale(identifier:"en_CA")`, template `"jmm"` |
| `toLocaleDateString('en-CA', {month:'short', day:'numeric', year:'numeric'})` | `en_CA`, template `"MMMdy"` (e.g. `Sep 3, 2026` or `Sep. 3, 2026`, whichever the OS emits. Do not hard-code) |
| `toLocaleDateString('en-CA', {weekday:'long', month:'long', day:'numeric', year:'numeric'})` | `en_CA`, template `"EEEEMMMMdy"` |
| `toLocaleDateString([], {weekday:'long'})` | `Locale.current`, `"EEEE"` |
| `toLocaleDateString([], {month:'short', day:'numeric'})` | `Locale.current`, `"MMMd"` |

### 0.4 Number formatting quirks (must match exactly)
JS number-to-string drops trailing zeros. `Math.round(v*10)/10` for 12.0 gives `12`, not `12.0`.
Four hour formatters exist. Use the right one in each place:

| name (file) | rule | examples |
|---|---|---|
| `formatHoursValue` (BudgetProgress) | `v<0 or non-finite → null`; `v≥100 → round(v)`; else `round(v*10)/10`; then `"\(n)h"` using the shortest JS representation | `0→"0h"`, `9.96→"10h"`, `9.5→"9.5h"`, `123.4→"123h"` |
| `formatHours` (tasks panel + over-budget sheet) | `h=max(0,Number(v)||0)`; `h<1 → "\(round(h*60))m"`; else `h.toFixed(1)+"h"` | `0→"0m"`, `0.25→"15m"`, `0.999→"60m"`, `1→"1.0h"` |
| `formatHours(value, fallback='0.0h')` (detail) | null/blank/non-finite → fallback; else `toFixed(1)+"h"` | `"12.0h"` |
| `formatMsAsHours` (detail) | `(max(0,ms)/3_600_000).toFixed(1)+"h"` | `"3.5h"` |
| `formatDuration` / `formatMinutesLabel` | `floor(ms/60000)` minutes → `"\(h)h \(m)m"` (no zero padding) | `"7h 5m"`, `"0h 0m"` |
| `formatElapsedClock` (detail) | `HH:MM:SS`, each part zero-padded to 2 digits; hours are not capped | `"01:07:09"` |

`toFixed(1)` rounds half away from zero in practice. Use `String(format:"%.1f")`.

---

## 1. Projects list (`ProjectsScreen`)

### 1.1 Placement and props
- This is the second tab of the root tab bar (tab key `projects`, label `Jobs`, Ionicons `folder`).
  All tab scenes stay mounted. Hidden tabs are only visually hidden.
- Props (from `App.js`):

| prop | value |
|---|---|
| `enabled` | `activeTab === "projects" && !selectedProject` |
| `onSelectProject` | `openProject(project)` → sets selected project and pushes the native-stack `ProjectDetail` screen (interactive swipe-back on) |
| `activeShift` | current shift or `null` (`activeShift.project`, `activeShift.onSite`, `activeShift.startedAt`) |
| `projectTimeTotals` | `{ [projectId]: "Xh Ym" }` over **all team** entries (live) |
| `myProjectTimeTotals` | `{ [projectId]: "Xh Ym" }` over **the signed-in user's** entries (live) |
| `projectLatestActivity` | `{ [projectId]: epochMs }` = max(`endedAt ?? startedAt`) over team entries |
| `assignedProjectIds` | job ids from `job_assignments` (see §5.3). Refreshed on login, every 60 s, and on app-active |
| `canManageProjects` | `employees.role ∈ {"admin","manager"}` (legacy `employees` row, not `org_members`) |
| `canViewTeamTime`, `onProjectsChanged` | passed but **unused** by ProjectsScreen |

### 1.2 Layout (top to bottom, inside one vertical `ScrollView`, no scroll indicator)
Screen background `#ffffff`. Scroll content `paddingTop 6`, `paddingBottom 24`, then a trailing
**110 pt spacer** so content clears the tab bar.

1. **Header** (`paddingHorizontal 20, paddingTop 6, paddingBottom 16`)
   - Kicker `ServiceFlow`, uppercased → **`SERVICEFLOW`**: teal `#2f8d7f`, 11.5 pt, `.heavy`, tracking 1.4, marginBottom 3.
   - Headline **`Jobs`**: ink `#11201d`, 28 pt, `.black`, tracking −0.6.
   - Nothing on the right. (Styles `headerSync*` exist but no sync button is rendered.)
2. **Search bar** (the whole bar is tappable and focuses the field)
   - Container: `marginHorizontal 20, marginBottom 16`, bg surface `#f7f8f7`, radius 18, `paddingHorizontal 18`, height 54, HStack spacing 12, centred vertically.
   - Leading Ionicons `search-outline` 25 pt, muted `#8b9692`.
   - TextField: placeholder **`Search jobs and leads`** (placeholder colour muted), text ink 15 pt `.semibold`, no autocapitalisation, no autocorrect, return key `search`, iOS clear button `while-editing`.
   - Trailing, only when the text is non-empty: Ionicons `close-circle` 22 pt muted, hit slop 8. Tap clears the text and the committed query immediately. (On iOS, while the field is focused, **both** the native clear button and this icon are visible. Replicate that.)
   - Debounce: the committed `searchQuery` is `searchText.trim()` **250 ms** after the last keystroke.
3. **Error line** (only if `error` is non-empty): raw `error.message` from Supabase. `marginHorizontal 20, marginBottom 10`, colour `#b42318`, 13 pt `.bold`.
4. **Initial loading state** (only before the first successful or failed load finishes): VStack spacing 10, `paddingVertical 60`, centred. Spinner teal, then **`Loading projects…`** (ellipsis `…` U+2026) in muted, 14 pt `.bold`. Items 5–8 are hidden while this shows.
5. **Current-job card** (`CurrentProjectCard`), see §1.4. Shown when there is an active shift and no search.
6. **Filter chips** (hidden while searching): HStack spacing 8, `paddingHorizontal 20, paddingTop 6, paddingBottom 14`.
   - Chips **`Active`** and **`Assigned`**. Each is a capsule, `paddingHorizontal 14, paddingVertical 9`, border 1, bg white.
   - Inactive: border `#e0e3e1`, text muted 13.5 pt `.bold`. Active: border ink `#11201d`, text ink.
   - Default filter is `active`. The filter is in-memory only and resets on app restart.
7. **Section header** (HStack, baseline aligned, spacing 6, `paddingHorizontal 20, marginBottom 12`)
   - Title (ink 17 pt `.black`, tracking −0.2): searching → **`Search Results`**; filter `assigned` → **`Assigned Jobs`**; otherwise **`Active Jobs`**.
   - Count (muted 15 pt `.bold`), formatted `"(\(n))"`, where
     `n = (filter == "assigned" || isSearching) ? filtered.count : (totalProjects ?? visibleProjects.count)`.
     `totalProjects` is always `null` for non-search loads (the query does not request a count), so in
     practice this is the number of loaded rows. While searching it is the loaded result count, not the total match count.
8. **Rows**: one `ProjectCard` per project in `remaining` (§1.5), then the pagination footer.
   - **Empty card**: shown if `remaining` is empty **and** there is no current-job card. `marginHorizontal 20`, bg white, radius 18, border 1 `#e0e3e1`, padding 22.
     - Title (ink 17 pt `.black`, marginBottom 6) and body (muted 14 pt, line height 20):

| condition (first match wins) | title | body |
|---|---|---|
| `searchQuery` non-empty | `No matching jobs` | `Try another name, email, phone, address, city, or postal code.` |
| filter `assigned` | `No assigned jobs` | `Assignments can be created from the office/backend.` |
| `canManageProjects` | `No active jobs yet` | `Accepted DripJobs proposals will appear here automatically.` |
| otherwise | `No active jobs yet` | `Ask a manager to assign you to an active job.` |

   - **Pagination footer** (only while `hasMore`): `marginHorizontal 20, marginTop 4, marginBottom 10`, height 48, centred. Shows a spinner in green `#173f37` **only** while a next page is loading. Otherwise it is an empty 48 pt block.

### 1.3 Data, filtering, sorting
**Load function** `loadProjects({quiet, pageToLoad, append})`:
- Page size `PROJECTS_PAGE_SIZE = 20`.
- `trackedProjectIds` = keys of `projectTimeTotals` (projects that have any team time entry).
- `relevantAssignedIds` = unique, sorted union of `assignedProjectIds` + `trackedProjectIds` + active shift project id.
  **The "Assigned" filter therefore shows assigned jobs plus any job with visible team time plus the current job.**
- Query (see §5.1): `listActiveProjectPage({page, pageSize:20, search: trimmed, projectIds})`, where
  `projectIds = relevantAssignedIds` only when not searching and filter is `assigned`, otherwise `null`.
  An empty `projectIds` array returns no rows and no network call.
- Extra merge. On page 0, when not searching, filter is `active`, and there are tracked ids, a second
  query fetches those tracked ids (`pageSize = max(20, count)`). Any rows not already on page 0 are
  appended. This keeps jobs with time on them visible even when they are older than page 0.
- Responses that are out of order are dropped (`requestId`). A synchronous `isFetching` flag stops two page fetches starting in the same frame.
- On error: set `error = error.message` and **keep** the previously shown rows.
- On success: replace the list (page 0) or append, de-duplicating by `companycam_id` (= job id).
  `hasMore = count == nil ? (pageRowCount == 20) : (page*20 + pageRowCount < count)`.
- The first load ever shows the full-screen loader (§1.2 item 4). Every later load (filter change,
  search change, refresh, interval) is **silent**: the old list stays until new data arrives.

**Triggers**

| trigger | behaviour |
|---|---|
| Screen mount | load page 0, even if the tab is hidden |
| Any change to filter, committed search, `relevantAssignedIds`, or `trackedProjectIds` | reload page 0, silent after the first load |
| `enabled` becomes true after the first load | silent reload of page 0 |
| Every **45 s** while `enabled` | silent reload of page 0. **This collapses any appended pages back to the first 20 rows** and resets `page` to 0. Replicate. |
| Pull-to-refresh | `RefreshControl`, tint teal `#2f8d7f`. Shows the native refresh spinner while a quiet page-0 reload runs |
| Scroll | when `contentHeight − (viewportHeight + offsetY) < 260`, load `page+1` (append), unless loading, already loading more, `!hasMore`, or a fetch is in flight |

There is no Realtime subscription on this list.

**Client-side pipeline** (runs every render):
1. `visibleProjects` = searching ? `projects` : `projects.filter(!is_archived)`.
2. `filtered` = (filter `assigned` && !searching) ? keep rows whose id ∈ `relevantAssignedIds` : `visibleProjects`.
3. `sortedFiltered` = sort by:
   1. `projectLatestActivity[id]` descending (missing = 0),
   2. `updated_at` descending (`companycam_updated_at` ?? `last_synced_at`, both = `updated_at`),
   3. `name` ascending (`localeCompare`).
   Display order is this sort, not the server's `updated_at` order.
4. **Featured (current job)** = when there is an active shift and no search: the loaded row with that id, otherwise `activeShift.project`. It is removed from `remaining` and shown regardless of filter.

### 1.4 Current-job card (`CurrentProjectCard`)
- Container: `marginHorizontal 20, marginBottom 22`, bg **teal `#2f8d7f`**, radius 22, padding 16, HStack spacing 14, centred. Shadow colour `#173f37`, opacity 0.18, radius 18, offset (0,10). Pressed opacity 0.7.
- Leading `MapThumb` dark: 64×64, radius 12, bg green `#173f37`, no border, Ionicons `location` 35 pt white, centred.
- Middle VStack (flexible, min width 0):
  - Status row (HStack spacing 6, marginBottom 6): dot 7×7 radius 3.5 `#a9f1c4`, then the label uppercased, `rgba(255,255,255,0.85)`, 11 pt `.heavy`, tracking 1.1.
    Label: `activeShift.onSite === false` → **`OFF SITE`** (source `Off site`), otherwise **`CLOCKED IN`** (source `Clocked in`).
  - Name: white 17 pt `.black`, tracking −0.3, 1 line.
  - Address: `formatted_address` or `[city, state, postal_code]` joined `", "`, otherwise **`No address on file`**. `rgba(255,255,255,0.82)`, 13 pt `.medium`, marginTop 2, 1 line.
  - `BudgetProgressBadge(dark: true)`, see §3.5.
- Trailing, only if `myProjectTimeTotals[id]` is truthy: VStack aligned trailing, `paddingLeft 6`:
  value (e.g. `7h 5m`) white 26 pt `.black`, tracking 0.5, monospaced digits. Under it **`YOUR HOURS`** (source `Your hours`) `rgba(255,255,255,0.82)`, 11 pt `.heavy`, tracking 1.2, marginTop 2.
- Tap → `onSelectProject(featured)`.

### 1.5 Row (`ProjectCard`)
- Container: `marginHorizontal 20, marginBottom 10`, bg white, radius 16, border 1 `#e0e3e1`, padding 12, HStack spacing 12, centred. Pressed opacity 0.7. The whole row is one tap target → `onSelectProject(project)`.
- Leading `MapThumb` light: 52×52, radius 12, bg `#f7f8f7`, border 1 `#e0e3e1`, Ionicons `location` 30 pt teal `#2f8d7f`. Static: no map image, no deep link.
- Middle VStack:
  - Name: ink 15 pt `.black`, tracking −0.2, 1 line.
  - Address (same rule as §1.4, fallback **`No address on file`**): muted 13 pt `.medium`, marginTop 3, 1 line.
  - If `is_lead`: lead badge, a capsule aligned leading, marginTop 7, bg `#e6f4f7`, padding 9 horizontal / 4 vertical. Text `Lead · {Stage}` uppercased, teal 10.5 pt `.black`, tracking 0.4.
    `Stage` = `pipeline_stage_raw || status || "new"` → replace runs of `[_-]` with a space → capitalise the first letter of each word. Example: `proposal_sent` → `LEAD · PROPOSAL SENT`.
  - Otherwise: `BudgetProgressBadge(dark: false)` (§3.5). It renders nothing unless the job has a budget and hours.
- Trailing, only if `myProjectTimeTotals[id]`: VStack aligned trailing, `paddingLeft 6`: value green `#173f37` 15 pt `.black`, tracking −0.2, monospaced digits. **`YOUR HOURS`** muted 10 pt `.heavy`, tracking 1.1, marginTop 2.
- No swipe actions, no context menu, no long-press.

### 1.6 Search
- Search is active when the committed query is non-empty. It hides the filter chips and the current-job card, sets the section title to `Search Results`, and ignores the filter.
- It searches jobs **and** unconverted leads (see §5.1.2). Pages are sliced client-side, 20 at a time, over up to 1000 matches from each source.
- Search does not require a minimum length. Phone matching only runs when the query has at least 3 digits.

### 1.7 Manager vs crew
The only difference on this screen is the empty-state body copy (§1.2). Both roles see every
`job_feed` row their organisation can read (RLS is organisation-membership based, not assignment based: §5.4).
There are no manager-only buttons.

### 1.8 States summary

| state | UI |
|---|---|
| First load | Header + search + `Loading projects…` spinner block |
| Loaded, empty | Empty card (copy table §1.2) |
| Error | Red raw error line under the search bar. Previous rows stay. On a first-load error with no rows, the empty card also shows |
| Offline | No list cache. Behaves as Error (e.g. `Network request failed`). Embedded budget badges come only from the fetched rows |
| Loading next page | Green spinner in the 48 pt footer |
| Refreshing | Native pull-to-refresh spinner (teal) |

---

## 2. Project detail (`ProjectDetailScreen`)

### 2.1 Entry and props
Pushed on a native stack (`ProjectDetail`, header hidden, interactive pop gesture). Entered from a
list row, the current-job card, or the Clock In screen (optionally with `initialAction`).

| prop | notes |
|---|---|
| `project` | normalised job (§5.1.1) or lead |
| `initialAction` | `null`, `'photos'` or `'camera'`. Any non-null value switches to the Media tab. `'camera'` also opens the camera |
| `entries` | `tracking.teamEntries`: the last 500 non-deleted `time_entries` visible to the user (time-tracking spec) |
| `activeShift`, `activeElapsedMs` | live shift and elapsed ms (ticks from the time-tracking layer) |
| `clockOutPending` | true while a clock-out is settling. Hides live-shift UI |
| `trackingNotice` | `{message}` or `null`. Message is shown under the clock button |
| `projects` | `trackingProjects` = active jobs that have lat/lng (for "Change Project") |
| `user` | Supabase auth user (`id`, `email`) |
| `painterName` | display name (`employees.full_name` → metadata → email prefix → `Painter`) |
| `canViewTeamTime` | `= canManageProjects` |
| `onClockIn(project)`, `onClockOut(reason)`, `onSwitchProject(project)` | return the shift or entry, or a falsy value on failure |
| `onOpenActiveClock()` | sets the root tab to `clock` and pops this screen |
| `onUpdateTimeEntry(raw, updates)`, `onDeleteTimeEntry(raw)` | time-tracking layer |

Derived values:
- `isLead = project.is_lead === true`. `projectKind = isLead ? 'lead' : 'job'`.
- `jobId = getProjectId(project)` = `id || job_id || companycam_id`.
- `linkedLeadId = isLead ? null : project.lead_id` (exposed by `job_feed`: §5.2).
- `title` = first non-blank of `name, project_name, customer_name, client_name, contact_name`, otherwise `Project`.
- `address` = first non-blank of `address, full_address, formatted_address, location.address`. Otherwise join non-empty `[street_address, address_line_1, city, province, state, postal_code, zip]` with `", "`. Otherwise **`No address on file`**.
- `addedDate` = first non-blank of `created_at, added_at, inserted_at` → `Added {en_CA MMMdy}`. If missing or invalid → **`Added recently`**.
  Note: `job_feed` has **no `created_at`**, so jobs opened from the list always show `Added recently`. Leads from search, and jobs returned by `ensure_lead_clock_in_job`, have `created_at`.

### 2.2 Screen skeleton
Safe area on top/left/right, bg `#ffffff`. Three fixed parts, then one scroll view:

1. **Header** (HStack, centred, `paddingHorizontal 14, paddingTop 4, paddingBottom 8`, bg white)
   - Back button: 32×36 frame, leading-aligned, Ionicons `chevron-back` 34 pt INK `#1f2933`, hit slop 10. Tap → pop.
   - VStack (flexible, `paddingRight 8`): title INK 18 pt `.bold`, tracking −0.2, 1 line. Subtitle `addedDate` MUTED `#8a8f95` 12 pt `.medium`, marginTop 1, 1 line.
   - No right-side actions.
2. **Tab pills** (HStack spacing 8, `paddingHorizontal 14, paddingTop 4, paddingBottom 10`, bg white, leading-aligned, content-sized)
   - Pill: HStack spacing 7, `paddingHorizontal 14, paddingVertical 8`, capsule, border 1.
     Inactive: bg SOFT `#f6f8f9`, border BORDER `#e6e8eb`, label `#5a6068` 13 pt `.semibold`, icon BRAND.
     Active: bg and border NAVY `#31495d`, label white `.bold`, icon white.
   - **`Clock Ins`** (jobs only): Ionicons `time` 14 pt. Accessibility label `Clock Ins`.
   - **`Media`**: Ionicons `images` 18 pt. Accessibility label `Photos and videos`. Tapping it (even when already selected) **forces a media refetch**.
   - Default tab: leads → `photos` (Media). Jobs → `clock`. Resets whenever `isLead` or `jobId` changes.
3. **Scroll content**: `paddingHorizontal 14, paddingTop 4, paddingBottom safeBottom + 120`, no indicator.
4. **Camera FAB** (floating, see §2.6), plus the camera modal and the job over-budget sheet.

If a time entry is selected for editing, the whole screen is replaced by **Edit Time** (§2.5).

### 2.3 Clock Ins tab (jobs only). Order top to bottom
When a painter is selected (§2.4), items (a)–(h) are all replaced by the Painter Detail view.

**(a) Project info card**
- HStack, centred, padding 12, border 1 BORDER, radius 14, bg white, shadow `#000` opacity 0.03 radius 6 offset (0,2).
- Avatar 42×42 circle, bg `#eaf4f6`, initials BRAND 14 pt `.heavy`, tracking 0.3, marginRight 12.
  Initials = first letter of the first two whitespace-separated words of `title`, uppercased. Fallback `P`.
- VStack: **`PROJECT`** SUBTLE `#b8bcc1` 10 pt `.bold`, tracking 1. Title INK 15 pt `.bold`, tracking −0.1, marginTop 2, 1 line.
  Address row (HStack top-aligned, spacing 6, marginTop 4): Ionicons `location` 16 BRAND, then address `#73777a` 12 pt / line height 16 `.medium`, 2 lines.
- **Not tappable.** There is no map or directions link, and no contact/phone/email section anywhere on this screen.

**(b) Current clock-in banner** (only when `isActiveProject` = active shift's project is this project **and** `!clockOutPending`)
- HStack spacing 12, marginTop 12, `paddingVertical 12, paddingHorizontal 14`, radius 14, bg `#eaf4f6`, border 1 `#cfe6ea`.
- Circle 38×38 BRAND with Ionicons `time` 18 white.
- VStack: label `Current clock-in · since {startTime}` (the suffix appears only if `activeShift.startedAt` is set; time uses device-locale `jmm`), `#4a6b72` 12 pt `.bold`, tracking 0.1. Timer `formatElapsedClock(activeElapsedMs)` INK 22 pt `.heavy`, tracking 0.5, monospaced digits, marginTop 2.
- Trailing dot 10×10 `#27ae60` (static, no animation).

**(c) Job hours panel card**: card marginTop 12, `paddingVertical 13, paddingHorizontal 14`, border 1 BORDER, radius 14, bg white. It contains `BudgetHoursPanel` (§3.4) with:
`title = "Job hours"`, `primaryLabel = "Your hours"`, `primaryValue = yourHours`, `primaryCaption = "you"`,
`fallbackSecondaryLabel = canViewTeamTime ? "Team total" : "Entries shown"`, `fallbackSecondaryValue = teamHours`.
- `yourHours`: sum of durations of `entries` for this project where `entry.userId == user.id || entry.userEmail == user.email`. Entries are de-duplicated by `serverId || id || localId`. Active entries (`clockOutReason=='active'` or no `endedAt`) count `now − startedAt`. Completed entries use `durationMs`, otherwise `endedAt − startedAt`. If > 0 → `formatMsAsHours`. Otherwise fallback to `project.your_hours | user_hours | my_hours` → `formatHours(…,'0.0h')`.
- `teamHours`: same over all users → `formatMsAsHours`. Otherwise `team_hours | total_hours | crew_hours`, else 0 → `"%.1fh"`.
- "now" here is `liveNowMs`, refreshed **every 15 s** while any entry is active or a shift exists.
- Ambiguity: these totals use only `entries` (team entries), not `activeShift`. A running shift counts only if the team-entries list already holds its active row.

**(d) Primary clock button**
- Height 50, marginTop 14, border 1.5 BRAND, radius 12, bg white, HStack spacing 10, centred.
- Icon circle 28×28 BRAND with a white icon 23 pt: `play` / `swap-horizontal` / `stop-circle-outline`. While pending it shows a white small spinner instead.
- Label BRAND 15 pt `.bold`, tracking 0.1. While pending the label is **`Working…`**, opacity 0.6, and the button is disabled.

| condition | label | icon | action |
|---|---|---|---|
| `isActiveProject` | `Clock Out` | `stop-circle-outline` | `onClockOut('project_detail')`. Falsy → error `Clock out could not complete. Try again.` Otherwise refresh budget, then run the job over-budget check (§3.6) |
| another shift is active | `Switch Job` | `swap-horizontal` | `onSwitchProject(project)`. Falsy → `Switch job could not complete. Check location permissions and try again.` Otherwise refresh budget, then `onOpenActiveClock()` |
| no shift | `Clock In` | `play` | `onClockIn(project)`. Falsy → `Clock in could not start. Check location permissions and try again.` Otherwise refresh budget, then `onOpenActiveClock()` |
| thrown error | — | — | `error.message` or `Clock action could not complete. Try again.` |

- **Feedback text**, shown under the button if present: `trackingNotice.message` (takes priority) or the local error. `#c0432b`, 13 pt `.bold`, centred, marginTop 10. The local error clears when the button is tapped again.

**(e) Photos preview card** (`JobPhotosPanel`, `showCamera=false`). Wrapper marginTop 16, marginBottom 4. Media spec owns the data; the UI is:
- Card: bg white, radius 14, border 1 `#e4eae8`, `paddingHorizontal 14, paddingTop 12, paddingBottom 14`. This card uses its own palette: NAVY `#31495d`, INK `#11201d`, MUTED `#6d7f7b`.
- Header row (tappable → switch to the Media tab), HStack spacing 8: Ionicons `images-outline` 17 NAVY. **`Photos`** INK 14 pt `.black` (flexible). Then the count (MUTED 13 pt `.heavy`, monospaced) or a small spinner while loading with nothing loaded. Then Ionicons `chevron-forward` 15 MUTED.
- Strip (tappable → Media tab), HStack spacing 8, marginTop 12: up to **4** square tiles (flexible, radius 9, bg `#dfe6e4`). Pending captures come first, then server media. Video tiles have a 16 pt circular badge bottom-left (`rgba(8,15,18,0.7)`, `play` 10 white). Pending tiles have an overlay `rgba(17,32,29,0.45)` with a spinner, or `alert` 13 white when failed. If more items exist, an extra tile shows `+{remaining}` NAVY 14 pt `.black` on `#eef2f1`.
- Empty text (MUTED 12.5 pt `.semibold`, marginTop 10): **`Loading photos…`** while loading, otherwise **`No photos on this job yet.`**
- Uploading row: small spinner + `Uploading {n} item…` / `Uploading {n} items…` (MUTED 12.5 `.bold`).
- Failed row (tappable → retry all; bg `#fdecea`, radius 10, padding 10/9): Ionicons `alert-circle` 15 `#a5321f` + `{n} upload failed[: reason]. Tap to retry.` / `{n} uploads failed…` in `#a5321f` 12 pt `.bold`, 2 lines.
- It loads media with `listProjectMedia(projectId, {projectKind})` **without** `linkedLeadId`, so lead-era photos are not in this preview (they are in the Media tab).

**(f) Recent header**: HStack, space-between, marginTop 22, `paddingHorizontal 2`, marginBottom 10.
- Title INK 15 pt `.heavy`: managers **`Hours by Painter`**, crew **`Your Clock-ins`**.
- Right text BRAND 13 pt `.bold` (**not tappable**): managers `{painterCount} crew`, crew `{dayCount} day` / `{dayCount} days`.

**(g) Painter summary rows**, or the empty state
- Data: `buildProjectClockInDays(entries, activeShift, project, user, liveNowMs)` → `buildPainterClockInSummaries(days)`:
  - Entries (active shift first) are de-duplicated and filtered to this project. They are grouped by **local calendar day** (desc) and then by `entry.userName` (fallback `Painter`).
  - Each entry is split into GPS segments. Segments are grouped back into one "clock-in" per entry id.
  - A painter's summary is keyed by **name**, not user id. `id` = name lowercased with whitespace runs → `-`.
  - Per painter: `totalMinutes` (sum of `floor(durationMs/60000)` per clock-in), `clockInCount`, and a location status count per clock-in (`on` / `off` / `mixed` / `unknown`).
  - Sort: rows where `isYou` come first, then `totalMinutes` descending.
  - Crew see every painter row the time-entries query returned. RLS allows organisation-wide reads, so crew also see teammates' rows. Only the header copy differs by role.
- Row (tappable → Painter Detail): HStack centred, border 1 BORDER, radius 14, bg white, padding 12, marginBottom 10, spacing 4, pressed opacity 0.85.
  - Avatar 30×30 circle, marginRight 10. Normal: bg `#eef1f4`, initials NAVY 11 pt `.heavy`, tracking 0.4. When `isYou`: bg BRAND, initials white.
  - Top row: name INK 14 pt `.heavy`, tracking −0.1, 1 line. When `isYou`, a `You` tag follows: BRAND 10 pt `.heavy` on `#eaf4f6`, padding 6/2, radius 6. Right side: total `formatMinutesLabel` INK 14 pt `.heavy`.
  - Meta row (wrapping HStack, spacing 8, marginTop 6), items separated by 3×3 SUBTLE dots:
    `{n} clock-in(s)` (MUTED 11.5 `.semibold`).
    If > 0: `●{n} On Site` (6 pt BRAND dot, BRAND `.heavy`), `●{n} Off Site` (`#c0432b` dot and text, `.heavy`), `{n} Mixed` (`#9a611f` `.heavy`), `{n} Location unavailable` (MUTED).
  - Trailing Ionicons `chevron-forward` 20 SUBTLE.
- Empty state (VStack centred, marginTop 14, marginBottom 6, `paddingHorizontal 20`): Ionicons `time` 32 BRAND in a 44×44 box (marginBottom 6). **`No clock-ins yet`** INK 15 pt `.bold`. **`Time entries will appear here after painters clock into this project.`** MUTED 12 pt / line height 17 `.medium`, centred, marginTop 4.

**(h) Tasks**: wrapper marginTop 18 → `ProjectLabourTasksPanel(showHoursMeter: false)` (§4.3). No hours meter here, because (c) already shows the budget.

### 2.4 Painter detail (sub-view inside the Clock Ins tab)
Replaces (a)–(h). The camera FAB is **hidden** while it is shown.
- Back row (HStack spacing 2, `paddingVertical 6`, marginTop 6, marginBottom 6, leading, hit slop 8): Ionicons `chevron-back` 18 BRAND + **`All painters`** BRAND 13 pt `.bold`. Tap → clears the selection.
- Header card: HStack, padding 14, border 1 BORDER, radius 14, bg white, marginBottom 16, spacing 12.
  - Avatar 44×44 (same colours as the row). Initials 14 pt.
  - Name (INK 16 pt `.heavy`, tracking −0.2, 1 line), with ` (You)` appended when `isYou`.
  - Meta (MUTED 11.5 `.semibold`, 1 line): parts joined `" · "`: `{n} clock-in|clock-ins`, then when > 0 `{n} on site`, `{n} off site`, `{n} mixed`, `{n} location unavailable` (all lowercase here).
  - Total `formatMinutesLabel` NAVY 17 pt `.heavy`, tracking −0.3.
- For each day (marginBottom 14):
  - Day header: HStack space-between, `paddingHorizontal 12, paddingVertical 9`, bg SOFT, radius 10, border 1 BORDER, marginBottom 8.
    Left: `{label},` (INK 13 `.heavy`, where label = `Today` if the local day is today, otherwise the device-locale long weekday), then ` {dateLabel}` (MUTED 12, en_CA `MMMdy`). Right: day total `formatMinutesLabel` NAVY 13 `.heavy`.
  - Segment list card: border 1 BORDER, radius 14, bg white, `paddingHorizontal 12, paddingVertical 4`, marginBottom 14. Rows are separated by a 1 pt BORDER top line.
  - Clock-in row (HStack space-between, `paddingVertical 10`). **Tappable only when the painter is you**, which opens Edit Time (§2.5). Other painters' rows are plain views.
    - Time line (1 line, 12.5 pt): `{start}` BRAND `.heavy`, ` {startSrc}` BRAND `.semibold` opacity 0.85, `  -  ` SUBTLE `.semibold`, `{end}` BRAND `.heavy`, ` {endSrc}`.
      `start`/`end` use the device-locale `jmm`. `end` = `Now` while the entry is active. `--` if the value is invalid.
      `startSrc` = `GPS` if `entry.startedLocation` else `Manual`. `endSrc` = `GPS` if `entry.lastLocation` else `Manual`.
    - Status pill (leading, marginTop 5, capsule, padding 8/3, HStack spacing 5): 6 pt dot + label 10.5 pt `.heavy`, tracking 0.2. If there is a distance label, ` - ` (margins −2) and the distance (e.g. `120 m from site`, `1.4 km from site`) follow.

| status | label | colour | bg |
|---|---|---|---|
| `on` | `On Site` | `#2b8496` | `#e6f2f4` |
| `off` | `Off Site` | `#c0432b` | `#fbecea` |
| `mixed` | `Mixed location` | `#9a611f` | `#fff3df` |
| other | `Location unavailable` | `#6f7774` | `#eef1ef` |

    - GPS breakdown (MUTED 10.5 `.semibold`, marginTop 5). Shown only when **more than one** of on/off/unknown has time: `GPS breakdown · {Xh Ym} on site · {Xh Ym} off site · {Xh Ym} location unavailable` (only the parts that are > 0).
    - Right: duration `Xh Ym` INK 13 `.bold`, plus Ionicons `chevron-forward` 16 SUBTLE when editable.

### 2.5 Edit Time screen (own clock-ins only)
Full-screen replacement (safe area top/left/right, bg `#f6f6f6`).
- Header: height 116, `paddingHorizontal 18, paddingTop 20`, bg white, bottom border 1 `#e8e8e8`. Back: 42×42 `chevron-back` 34 `#000`, marginRight 10. Title **`Edit Time`** `#202124` 38 pt `.heavy`, tracking −1.2.
- Scroll (no bounce), padding 18/24/18/14:
  1. Shift card: border 1.2 `#8f9296`, radius 12, bg white, padding 18/18/14.
     - Top row: painter name TEXT `#2f3136` 18 `.heavy`. Location row (marginTop 12): Ionicons `location` 20 `#4e659f` + project title (the selected replacement project's title if one was chosen) `#4e659f` 16 `.heavy`, 1 line.
     - Right: decorative "map preview" 86×76 (radius 10, bg `#e8f2ef`, border `#d9e4df`). It holds three rotated white road bars, a translucent BRAND circle, a pin (27 pt circle `#91cbb1`, white border, `location` 17 white), and a clock badge (29 pt white circle, border `#8fc7d5`, `time` 14 BRAND). **Tap toggles** a distance bubble at the bottom (`rgba(49,73,93,0.92)`, white 9.5 pt `.heavy`) showing the segment's distance label or `distance unknown`.
     - Timeline (marginTop 28): start time `#6ba7ff` 18 `.heavy` with its source underneath (`#6482bd` 12 italic `.heavy`), a 1 pt `#c8ccd0` line, then the end time `#7087bd` (or `In progress` for an active entry) and its source.
  2. Six decorative dots (9 pt, `#e0e0e0`; the last one `#949494`), marginTop 28, marginBottom 16, spacing 11.
  3. Form card (border 1 BORDER, radius 6, bg white, padding 18/16). Rows have min height 48, label `#000` 20 pt `.medium` and a value pill (min height 41, radius 24, bg `#eeeeef`, text `#000` 20 `.medium`):
     `Date` → the day's `dateLabel` with a leading zero stripped from the day number. `Clock-In Time` → start. Optional original note (MUTED 12 `.bold`): `Original in {t}`, `original out {t}`, `edited {t}` joined `" · "`, shown only when the original differs by at least one minute. Then adjust buttons `-5m` / `+5m` for clock-in. `Clock-Out Time` → end or `In progress`. Adjust buttons for clock-out (disabled, opacity 0.4, when the entry is active). `Duration` → `Xh Ym`, which for an active entry is live from start to now.
     Adjust buttons: capsule, border 1 BORDER, padding 12/6, BRAND 12 `.heavy`. The row is trailing-aligned with spacing 8. Accessibility labels `Subtract 5 minutes from clock-in time` and similar.
  4. `Change Project` card (min height 72, border 1 BORDER, radius 7): label `#77bed1` 18 `.heavy` (`Change Project`, or `Project: {name}` once one is chosen) + Ionicons `location-outline` 27 `#77bed1`. Tap toggles the picker: a search field (placeholder **`Search projects`**) and up to 6 options from `projects` (not archived, not leads; matched on title, address, city, or postal code, case-insensitive). Each option shows its name (INK 13.5 `.heavy`) and address (MUTED 12). If nothing matches: **`No matching projects.`**
  5. Hint (MUTED 11 `.semibold`, 2 lines): `Tap the map preview to show distance from the job site. {address}`
- Bottom bar (`paddingHorizontal 18, paddingTop 10`, bottom = safeBottom + 16, bg `#f6f6f6`):
  - Error (red centred 13 `.bold`) if a save or delete failed.
  - Active-entry hint (MUTED 12.5 `.semibold`, centred, marginBottom 10): **`This shift is still in progress. Only the start time can be changed.`**
  - **`Save Changes`**: height 54, radius 4, bg BRAND (disabled: `#d7dcde`), white 20 `.heavy`. Shows a spinner while busy.
    Enabled when: active entry → start changed or project changed. Completed entry → (start, end, or project changed) **and** end > start.
    Calls `onUpdateTimeEntry(raw, {startedAt, project?, adjustmentSource:'project_detail_edit', endedAt? (completed only)})`, then refreshes the budget and closes. On a throw: `error.message` or `Could not save changes. Try again.`
  - HStack spacing 18, marginTop 12: **`Cancel`** (height 58, border `#8d8d8d`, text `#8d8d8d` 20 `.heavy`) closes. **`Delete`** (border `#f36b65`, text `#ef716d`) shows an alert **`Delete time entry?`** / **`This cannot be undone.`** with buttons `Cancel` (cancel) and `Delete` (destructive) → `onDeleteTimeEntry(raw)` → refresh budget → close. On a throw: `Could not delete entry. Try again.`

### 2.6 Media tab and camera FAB (UI only; pipeline in the media spec)
Media tab (`ProjectMediaPanel`), container marginTop 18, paddingBottom 42:
- Upload status banner (when there are pending uploads): bg `#eaf4f6` (failed: `#fbecea`), radius 14, padding 13/11. Spinner, or `alert-circle` 18 `#a6402d` on failure. Text BRAND 12 `.heavy`: `Uploading {n} item(s)`, or on failure `{n} upload(s) need attention`. Hint **`Uploads continue after you close the camera.`** On failure a trailing **`Retry all`** (BRAND 13 `.heavy`) appears.
- Inline load error (bg `#fbecea`, radius 12): `alert-circle-outline` 20 `#a6402d`, message `#873523` 12 `.semibold` (default `Unable to load project media.`), and **`Retry`**.
- Loading (no media yet): spinner + **`Loading project media`**.
- Empty: an 88 pt circle `#eef6f8` with an `images` icon, **`No photos or videos yet`**, **`Capture the site before, during, and after the work to build the project record.`**
- With items: eyebrow **`PROJECT RECORD`** (BRAND 9.5 `.black`, tracking 1.1), title **`Photos & Videos`** (INK 22 `.black`), and a count pill (34 pt min, bg `#edf4f5`, BRAND 13 `.black`). Then sections by local day (header NAVY 15 `.black` in en_CA long form, e.g. `Thursday, September 3, 2026`, fallback `Recently`, with the item count, and a bottom border `#dfe5e8`).
  Grid: 3 columns (`31.5%` width, gap 7). Card border BORDER, radius 11. Square thumbnail, then a meta strip (min height 42): `person-outline` 13, source name (INK 8.5 `.heavy`: `source_name` → `source_metadata.creator_name` → `CompanyCam` → `Team member`; pending items use `painterName`) and the time (MUTED 8 `.bold`, en_CA `jmm`; pending: `Just captured` / `Upload failed`).
  Pending overlay: `rgba(19,45,51,0.5)` + spinner + `Uploading`. Failed overlay: `rgba(137,49,36,0.72)` + `refresh` + `Tap to retry`. Tap on a failed item retries. Long-press on a pending item shows the alert **`Remove pending upload?`** / **`This removes the local capture from the upload queue.`** with `Keep` and `Remove`.
  Tapping an uploaded item opens a full-screen lightbox: black `#050607`, a `Close` button, `Photo|Video {i} / {n}`, `Taken by {name}`, a trash button only when `uploaded_by == user.id`, horizontal paging, pinch-zoom up to 4×, swipe-down to dismiss, and a caption `{day heading} · {time}`.
  Delete confirmation: **`Delete photo?`** / **`Delete video?`**, body **`This permanently removes it from the project.`**, buttons `Cancel` / `Delete`. On failure an alert **`Delete failed`** shows the message (default `Unable to delete this media.`).
- Media loads when the Media tab is shown and not yet loaded: `listProjectMedia(jobId, {projectKind, linkedLeadId})`. A missing id gives the error `This job is missing its project id.`

Camera FAB (visible on both tabs unless the painter detail is open): 58×58 circle BRAND, right 16, bottom safeBottom + 22. Ionicons `camera` 28 white. Shadow `#000` 0.2, radius 14, offset (0,6). Accessibility label `Take project photo`. While a delete is pending: disabled, opacity 0.65, white spinner.
Tap → switch to the Media tab, clear completed uploads, open `ProjectCameraScreen` (props: `projectName=title`, `queueItems`, `onRetryUpload`). A capture enqueues the upload and stays on Media. Closing the camera also switches to Media.

### 2.7 Leads (`is_lead === true`)
- Header is the same. Tabs: **only `Media`**. No info card, hours, clock button, painter list, or tasks. Budget and task hooks are disabled.
- Unused styles `leadOverviewCard` / `leadReadOnlyNotice` exist in the source, but **no lead overview UI is rendered**. Do not build one.
- The camera FAB and the Media tab work (`projectKind='lead'`).

### 2.8 Manager-only actions
None on this screen. Role (`canViewTeamTime`) only changes copy: `Team total` vs `Entries shown`, and `Hours by Painter` / `N crew` vs `Your Clock-ins` / `N days`. Editing is limited to **your own** clock-ins (client rule). Media delete is limited to your own uploads (client rule plus the RLS policy `job_media_delete`). Task checkboxes are available to anyone viewing. The server lets managers or active assignees change them (§5.2.2).

### 2.9 Refresh behaviour on detail
- Budget: `useProjectBudgetProgress([project], {enabled: !isLead})`. It seeds from `project.budgetProgress` or the persisted cache, fetches immediately, then every **45 s**, and on every app-foreground. It is also refreshed explicitly after clock in/out/switch and after a time entry is saved or deleted.
- Tasks: §4.5.
- Clock-in list: recomputed from props, with the live clock refreshed every 15 s.

---

## 3. Budget and progress

### 3.1 Source values
From `job_feed` (§5.2): `budget_minutes`, `used_minutes`, `budget_percent_used` (rounded to 2 decimals server-side), `budget_status`.
Normalised progress object:
```
percentUsed = Number(budget_percent_used) | null
hoursUsed   = used_minutes / 60 | null
budgetHours = budget_minutes / 60 | null      // only on list rows (normalizeJob), not on refetches
status      = map(budget_status)
isComplete  = job.status == "completed"
calculatedAt = updated_at
```
Status mapping: `over_budget → "over"`, `complete → "at"`, `active → "under"`, anything else passes through (`not_configured`).
Server rule (latest `job_feed`): budget null → `not_configured`. `used > budget` → `over_budget`. Job completed → `complete`. Otherwise `active`.
- So **`"at"` means "job completed and not over"**, not "exactly at budget". A job at exactly 100 % that is not completed is `under`.
- `incomplete` and `unavailable` are never produced by the server. `unavailable` is set client-side on detail when the fetch errors and no cached value exists.
- `budget_minutes = 0` gives `percentUsed = null`, but the status is still computed (`over_budget` if used > 0).

### 3.2 Presentation (`getBudgetProgressPresentation(progress)`)

| input | status | label | shortLabel | percentLabel | fill % | color | bg |
|---|---|---|---|---|---|---|---|
| `nil` | `loading` | `Loading budget…` | `Loading…` | `—` | 0 | `#8b9692` | `#eef1ef` |
| `not_configured` | same | `Budget pending` | `Pending` | `—` | 0 | `#6f7774` | `#eef1ef` |
| `incomplete` | same | `Budget data incomplete` | `Incomplete` | `—` | 0 | `#9a611f` | `#fff3df` |
| `unavailable` | same | `Budget unavailable` | `Unavailable` | `—` | 0 | `#6f7774` | `#eef1ef` |
| `over` | `over` | `{P}% used · {P−100}% over` | `{P}% · Over` | `{P}%` | 100 | `#c0432b` | `#fdecea` |
| `at` | `at` | `100% used · At budget` | `100% · At budget` | `100%` | 100 | `#9a611f` | `#fff3df` |
| otherwise | `under` | `{P}% used · Under budget` | `{P}% · Under` | `{P}%` | `min(100, pct)` | `#2f8d7f` | `#e6f2f4` |

Where `pct = max(0, percentUsed ?? 0)`. `P` = `max(101, round(pct))` for over, and `min(99, round(pct))` for under.
(`label` and `shortLabel` are not shown on these screens. The status chip uses `getBudgetStatusLabel`.)

`getBudgetStatusLabel(status)`: `under → "Under budget"`, `at → "At budget"`, `over → "Over budget"`, `loading → "Loading budget"`, `not_configured → "Budget pending"`, `incomplete → "Data incomplete"`, otherwise `"Budget unavailable"`.

Burn-zone colour: over `#c0432b`, at `#9a611f`, otherwise `#2f8d7f`.

### 3.3 Hours breakdown (`getBudgetHoursBreakdown`)
```
tracked   = status ∈ {under, at, over}
derivable = tracked && hoursUsed > 0 && percentUsed > 0   (both finite)
hoursLeft = derivable ? hoursUsed * (100 - percentUsed) / percentUsed : nil
usedLabel = formatHoursValue(hoursUsed)            // "0h" when 0; nil when nil
leftLabel = derivable ? formatHoursValue(|hoursLeft|) : nil
totalLabel= derivable ? formatHoursValue(hoursUsed * 100 / percentUsed) : nil
over      = derivable && hoursLeft < 0
noHoursYet= tracked && (hoursUsed nil or 0)
```
The budget in hours is **derived** from used hours and percent. The raw `budget_minutes` is never shown.
Example: used 30 h at 75 % → `10h` left, `40h expected total · 75% used`, 9 of 12 segments lit.
Example: used 46 h at 115 % → `6h over budget`, `115%`, all 12 segments red.

`Tank` (segmented bar): 12 segments, HStack spacing 3, marginTop 8, each flexible width × 12 pt height, radius 3. Unlit colour `#e6eae9`, lit colour = burn zone.
`lit = percent invalid ? 0 : percent > 100 ? 12 : min(12, max(percent > 0 ? 1 : 0, round(min(1,max(0,percent/100)) * 12)))`.

### 3.4 `BudgetHoursPanel` (project detail, hours card)
- Header row (space-between, spacing 12): title `Job hours` (`#11201d` 13 pt `.black`). When `tracked`, a status chip: capsule, padding 9/4, bg = presentation bg, text = burn colour, 11 pt `.black`, `getBudgetStatusLabel`.
- Stats row (marginTop 11, marginBottom 2). Columns are flexible with VStack spacing 2, separated by 1 pt `#e2e7e8` dividers with horizontal margin 12. Label `#8b9692` 11 `.heavy`. Value `#11201d` 20 `.black`, tracking −0.4. Caption `#aeb7b3` 10.5 `.bold`.
  - Column 1: `Your hours` / `{yourHours}` / `you`.
  - If `derivable`: Column 2 `Hours used` / `{usedLabel}` / `whole team`. Column 3 `Hours left` or `Hours over` / `{leftLabel}` (value in burn colour) / `in the budget` or `over budget` (when over, the caption is in burn colour and `.heavy`).
  - Otherwise: Column 2 `{Team total|Entries shown}` / `{usedLabel ?? teamHours}` / `whole team`, where the caption appears only when `usedLabel` is non-nil.
- When tracked **or** loading: Tank, then footnote (`#8b9692` 11.5 `.bold`, marginTop 8):
  loading → `Loading budget…`. `totalLabel` → `{total} expected total · {P}% used`. Otherwise `{P}% of the labour budget used` (e.g. `0% of the labour budget used`).
- For `not_configured` / `unavailable`: no chip, no tank, no footnote.

### 3.5 `BudgetProgressBadge` (list rows and current card)
- Renders **nothing** unless `derivable`.
- HStack spacing 7, marginTop 8. Track 40×5 capsule (light `#e5e9e8`, dark `rgba(255,255,255,0.25)`) filled to `fillPercent`. Text 12 pt `.heavy`, 1 line: `{leftLabel} over budget` or `{leftLabel} left`.
- Colours: light → text and fill = presentation colour. Dark → over: text and fill `#ffb3a1`. Not over: text `rgba(255,255,255,0.9)`, fill `#a9f1c4`.
- Source: the row's embedded `budgetProgress` from `job_feed`. The list does not refetch budgets separately.

### 3.6 `BudgetBurnMeter` (Clock In screen's task panel only; `showHoursMeter=true`)
- `progress == nil`: `–` (U+2013) + ` used`, an empty tank, and `Loading budget…`.
- Not tracked: renders nothing.
- Tracked: baseline row (marginBottom 8): `{usedLabel ?? "0h"}` (`#11201d` 20 `.black`, monospaced) + ` used` (`#8b9692` 12.5 `.bold`). When derivable, a trailing right-aligned `{left} left` / `{left} over budget` (burn colour, 12.5 `.black`). Then the Tank and the footnote as in §3.4.

### 3.7 Job over-budget detection and reason sheet
**Trigger**: only after a **successful clock-out** from the detail screen's button (and from the Clock In screen, same logic). Not on switch, and not for tasks.
```
if !jobId || !user.id → stop
if AsyncStorage has key "ottawaPainters.labourTaskOverBudgetReasonAnswered.v1:{userId}:job:{jobId}:unpublished" → stop
fetch job_feed(id,status,budget_minutes,used_minutes,budget_percent_used,budget_status,updated_at) where id = jobId
over      = fetch ok && percentUsed != nil && percentUsed > 100 && hoursUsed > 0
budgeted  = hoursUsed * 100 / percentUsed
hoursOver = max(0, hoursUsed - budgeted)
if over → present sheet(hoursOver)
```
All errors are swallowed; the prompt is best effort. The marker is device-local and asks at most once per user per job, ever.

**Sheet** (`OverBudgetReasonSheet`, a transparent modal with a fade, not a bottom sheet):
- Backdrop `rgba(17,32,29,0.45)`, content centred, `paddingHorizontal 24`, top = safeTop + 10, bottom = max(safeBottom, 10). It moves up with the keyboard on iOS. The Android back gesture equals Skip. Tapping the backdrop does nothing.
- Card: width 100 %, max width 380, max height 100 %, radius 16, bg white, padding 18 horizontal / 16 top / 14 bottom. The body scrolls (no bounce). The action row is fixed below it.
- Badge (capsule, bg `#fbf1e8`, padding 10/5, spacing 5): Ionicons `alert-circle` 18 `#b56025`. Text `#b56025` 11.5 `.black`, monospaced: `{formatHours(hoursOver)} over budget` if `hoursOver > 0`, otherwise `Over budget` (e.g. `45m over budget`, `3.2h over budget`).
- Title (marginTop 10, `#11201d` 16 / line height 21 `.black`, tracking −0.2, 2 lines): `{title} took longer than planned`, where title = project title (fallback `This task`).
- Subtitle (marginTop 5, `#8b9692` 12.5 / 17): **`What slowed it down? This helps us quote the next job better — it is not a performance review.`** (em dash).
- Options (marginTop 13, spacing 8). Each is an HStack spacing 10, padding 12/11, radius 12, border 1.5 `#e0e3e1`. Selected: border `#b9d6cd`, bg `#f2f9f7`. Leading icon 17 (selected `#2f8d7f`, else `#8b9692`), label 13.5 `.bold` (selected teal, else ink), 1 line, trailing `radio-button-on` / `radio-button-off` 18 (teal / `#e0e3e1`). Tapping the selected option **deselects** it.

| key | label | Ionicons |
|---|---|---|
| `budget_unrealistic` | `The budget was too tight` | `hourglass-outline` |
| `extra_prep` | `Extra prep or repairs` | `construct-outline` |
| `moving_furniture` | `Moving furniture or covering` | `cube-outline` |
| `waiting` | `Waiting on materials or client` | `pause-circle-outline` |
| `other` | `Something else` | `chatbubble-ellipses-outline` |

- Note field (only when `other` is selected; autofocus, multiline, max 280 characters, min height 68, padding 12/10, radius 12, border 1.5 `#e0e3e1`, 13.5 / 18): placeholder **`Tell us what happened…`**.
- Actions (marginTop 14, trailing, spacing 10): **`Skip`** (padding 14/10, `#8b9692` 13.5 `.heavy`) and **`Send`** (min width 84, padding 16/10, radius 10, bg teal, white 13.5 `.black`; disabled opacity 0.45; shows a white spinner while saving; accessibility label `Send reason`).
- Validation: Send is enabled only when an option is selected and, for `other`, the trimmed note is non-empty. While saving, the options, the note, Skip, and Send are all disabled.
- **Send** → `record_time_entry_command('job_issue', {client_id: "job-obr-{Date.now()}-{8 base36 chars}", job_id, reason, note: note.trim().prefix(280) or null, minutes_over: round(hoursOver*60)}, null)`. Then the answered marker is written and the sheet closes. **There is no offline queue and errors are ignored**: the sheet closes even if the insert failed, and the marker is still written.
- **Skip** → write the marker, close. No server row.
- The row lands in `job_issues` with `issue_type = 'job_over_budget'` (§5.2.4).

**Task-level variant (present in code, unreachable in the UI).** `useProjectLabourTasks` still exposes `submitOverBudgetReason(task, {reason, note, hoursOver})`, `skipOverBudgetReason(task)`, and `hasAnsweredOverBudgetReason(task)`. These use `record_time_entry_command('task_issue', …)` with the offline queue and marker key `…:{userId}:{taskId}:{revision|unpublished}`. On a queued save they set `syncNotice` = `Thanks — your note is saved on this device. It will sync when ServiceFlow reconnects.` No component calls them, because there is no Stop button any more. Port them only if you want parity with the library layer.

---

## 4. Labour tasks

### 4.1 Data model (client)
`plan = { budget: LabourBudget?, tasks: [LabourTask], fetchedAt: epochMs }`

`LabourTask` (from a `job_tasks` row):

| field | source | rule |
|---|---|---|
| `id` | `id` | string. A row without an id is dropped |
| `labourBudgetId` | `budget_id` | string or nil |
| `companycamProjectId` | `job_id` | string |
| `sourceKind` | `source_kind` | default `custom` |
| `title` | `title` | default `Task` |
| `notes` | `notes` | nil if empty |
| `budgetedHours` | `budget_minutes/60` | `max(0, …)`. Null minutes → 0 |
| `status` | `status` | `cancelled → skipped`. Must be one of `pending, in_progress, completed, skipped`, otherwise `pending` |
| `completedAt` | `completed_at` | ISO string or nil |
| `sortOrder` | `sort_order` | rounded integer, default 0 |
| `metadata` | `metadata` | object, else `{}` |

`LabourBudget` (built by `normalizeProjectLabourBudget`): `id, companycamProjectId, sourceQuoteId, sourceQuoteName (default "Labour plan"), instructions, totalBudgetedHours, revision (≥1, default 1), publishedAt`.
Source selection (replicate exactly, including the quirk):
1. First try the **first task row**. If it has `budget_id` (and `job_id`), the budget object is built **from that task row**. Its `totalBudgetedHours = 0`, `revision = 1`, `instructions = nil`, and `sourceQuoteName = "Labour plan"`, because task rows lack those fields.
2. Otherwise (no tasks, or the first task has no `budget_id`), use the `job_budgets` row: `id`, `job_id`, `quote_id`, `instructions`, `budget_minutes/60 → totalBudgetedHours`, `version → revision`, `created_at → publishedAt`.
3. If both are nil → `budget = nil`.

Sort: `sortOrder` ascending, then `title.localeCompare`.

Summary (`projectLabourTaskSummary`): `taskCount`, `completedCount` (status `completed`), `budgetedHours = max(0, budget.totalBudgetedHours if finite else Σ task.budgetedHours)`, `completionPercent = count ? completed/count*100 : 0`.
Consequence of quirk (1): when the first task has a `budget_id`, `budgetedHours = 0` and the `· Xh budgeted` suffix does not show.

### 4.2 Statuses
Server: `pending | in_progress | completed | cancelled`. Client: `pending | in_progress | completed | skipped` (`skipped ⇄ cancelled` when talking to the server).
The UI only distinguishes **completed** from **not completed**. The toggle sends `completed → pending`, and anything else → `completed`. There is **no start/stop/timer UI, no grouping, and no per-task hours spent**.

### 4.3 `ProjectLabourTasksPanel` UI
Card: bg white, radius 12, border 1 `#e0e3e1`, `paddingHorizontal 14, paddingTop 12, paddingBottom 6`.

States (first match wins):
1. `loading && no tasks && no budget` → centred card (`paddingVertical 26`): teal spinner + **`Loading tasks…`** (MUTED 12.5 `.semibold`, marginTop 9).
2. `no budget && no tasks` → centred card: Ionicons `checkbox-outline` 26 MUTED. **`No tasks for this job yet`** (INK 13.5 `.heavy`, marginTop 8). The error text, if any (§4.6). A **`Refresh`** chip (marginTop 12, capsule, border 1 `#b9d6cd`, padding 13/7, HStack spacing 6: Ionicons `refresh` 15 teal + text teal 12 `.black`; accessibility label `Refresh tasks`) → a non-silent refresh.
3. Otherwise:
   - Header **`TASKS`** (source `Tasks`, MUTED 11 `.heavy`, tracking 0.5).
   - `BudgetBurnMeter` (marginTop 10) only if `showHoursMeter`. It is **false on project detail** and true on the Clock In screen.
   - Progress block (marginTop 8, only if `taskCount > 0`): baseline row `{completed}` (INK 20 `.black`, tracking −0.4, monospaced) + ` of {n} done` + (if budgetedHours > 0) ` · {formatHours(budgetedHours)} budgeted` (MUTED 12.5 `.bold`). Below it a bar: height 5, radius 3, track `#edefee`, fill teal, width `min(100, completion%)`.
   - Instructions (`budget.instructions`, marginTop 9, `#4c5a56` 12.5 / 18, 3 lines).
   - Sync notice (marginTop 9, HStack spacing 6): Ionicons `cloud-upload-outline` 14 MUTED + text MUTED 11.5 / 15 `.semibold`.
   - Error text (§4.6).
   - Task list (marginTop 6), or when there are 0 tasks **`This job's plan has no tasks yet.`** (MUTED 12.5 / 17, centred, `paddingVertical 14`).

Task row (whole row tappable; HStack spacing 12, `paddingVertical 13`; rows after the first have a 1 pt top border `#edefee`):
- Checkbox 26×26, radius 8, border 2. Unchecked: border `#b9d6cd`, bg `#f7fbfa`. Checked: border and bg teal, white `checkmark` 17. While pending: a small spinner (white if checked, teal if not) and the row is disabled.
- Body: title 14.5 / 19 `.bold` INK, 2 lines. When completed: MUTED with strikethrough.
  - Completed and `completedAt` set: `Done · {time}` when the date is today, otherwise `Done · {MMM d}, {time}` (teal 11.5 `.heavy`, marginTop 2). Device locale. An invalid date gives `Done`.
  - Not completed and has notes: notes MUTED 11.5 / 15, 2 lines, marginTop 2.
- Trailing, if `budgetedHours > 0`: `formatHours(budgetedHours)` MUTED 12 `.heavy`, monospaced (e.g. `1.5h`, `45m`).
- Accessibility: role checkbox, label `{title}` + `, completed` when done.

### 4.4 Interaction: toggle (optimistic)
```
pendingTaskIds.insert(id)
previous = plan
requestId += 1                        // discard any in-flight refresh (prevents flicker)
plan.tasks[id].status = newStatus; completedAt = newStatus=="completed" ? now ISO : nil
persist to cache
result = setProjectLabourTaskStatus(id, newStatus, userId)   // §5.2.2, queues when offline
if result.queued      → syncNotice = "Saved on this device. It will sync when ServiceFlow reconnects."   (keep optimistic)
elif result.error     → plan = previous (and cache); error = friendlyTaskError(err)
else                  → error = ""; silent refresh
pendingTaskIds.remove(id)
```

### 4.5 Loading, refresh, realtime
Hook `useProjectLabourTasks(projectId, {enabled, userId})`. On detail: `enabled = jobId && !isLead`. On Clock In: enabled while the screen is enabled and clocked in.
- On project change: reset to the empty plan. `loading = enabled && id`. Clear the error and notice. Load the cached plan (if any) and show it, then run a **non-silent refresh**.
- `refresh`: first **flush the offline write queue** (§6.2), then fetch `job_tasks` and `job_budgets` in parallel (§5.2.3).
  On error: `error = friendlyTaskError`, and the old plan stays. On success: replace the plan, write the cache, clear the error **and** the sync notice. `loading = false` either way. Stale responses are ignored by request id.
- Silent refresh every **30 s**, and on app foreground.
- **Realtime**: channel name `project-labour-task-state:{projectId}:watch-{Date.now()}-{8 base36}` (unique per mount).
  `postgres_changes`, `event: "*"`, `schema: "public"`, `table: "job_tasks"`, `filter: "job_id=eq.{projectId}"`.
  Any payload → a silent refresh debounced by **150 ms**. Status `SUBSCRIBED` → the same debounced refresh.
  On unmount the channel is removed (`removeChannel`). If Realtime fails, the 30 s poll remains.
- Separately, the time-tracking layer flushes the task write queue **every 60 s** while signed in.

### 4.6 Errors (`friendlyTaskError`)
- Message matches `/not assigned|permission|row-level security/i` → **`This job is not assigned to your account.`**
- Matches `/function.*does not exist|schema cache/i` → **`Painter tasks are not available in this environment yet.`**
- Otherwise the raw message. If it is empty → **`Tasks could not sync. Your last saved list is still available.`**
- Shown in `#c0432b` 12 / 16 `.bold`, marginTop 9.
- Note: an unassigned crew member toggling gets the server exception `Task access denied`. It does not match the patterns, so that raw text is shown and the checkbox reverts.

### 4.7 Offline behaviour
- Reading: the cached plan (§6.1) shows immediately. If the network fails, the error text shows above the cached list.
- Writing: see the queue (§6.2). Queued writes keep the optimistic state and show the sync notice. The notice clears on the next successful refresh.

---

## 5. Supabase contracts

The client uses the signed-in user's JWT and the publishable key, never a service role. All calls go through PostgREST or RPC.

### 5.1 Projects list queries (`projectRepository.js`)

#### 5.1.1 Active page (no search)
```
from("job_feed").select("*")
  .eq("is_feed_visible", true)
  .in("status", ["scheduled","active"])
  [.in("id", projectIds)]              // Assigned filter / tracked merge
  .order("updated_at", {ascending:false})
  .range(page*20, page*20+19)
```
Rows are normalised with `normalizeJob`: `id` (string); aliases `job_id = companycam_id = companycam_project_id = id`; `street_address_1/2`, `state = province`; `formatted_address` (or `address_line_1, city, province, postal_code` joined `", "`); `is_archived = status=='archived'`; `is_deleted = status=='cancelled'`; `is_lead = false`; `companycam_updated_at = last_synced_at = updated_at`; `budgetProgress` as in §3.1.
Then rows are filtered out when deleted, archived, or when the name matches `/qa web smoke|do not use/i`.

#### 5.1.2 Search (`searchVisibleJobsAndLeads`)
`match = "%" + escape(trim(q).replace(/[,()]/g," ")) + "%"`, where escape prefixes `%` and `_` with `\`. An empty match → no results.
1. `from("contacts").select("id").or("name.ilike.{m},email.ilike.{m}[,phone.ilike.%{digits}%]").limit(1000)`. The phone filter is included only when the query has ≥ 3 digits (all non-digits stripped).
2. `from("leads").select("*,contact:contacts(id,name,email,phone),jobs(id)").or("address.ilike.{m},city.ilike.{m},province.ilike.{m},postal_code.ilike.{m},source.ilike.{m},pipeline_stage_raw.ilike.{m}[,contact_id.in.(ids)]").order("updated_at",desc).limit(1000)`
3. `from("job_feed").select("*").eq("is_feed_visible",true).neq("status","archived").neq("status","cancelled").or("name.ilike.{m},formatted_address.ilike.{m},city.ilike.{m},province.ilike.{m},postal_code.ilike.{m}[,id.in.(jobIdsLinkedToMatchingLeads)]").order("updated_at",desc).limit(1000)`. Completed jobs **are** included in search.
4. Results = visible jobs + leads with **no** jobs (`normalizeLead`), sorted by `updated_at ?? created_at` descending, then sliced to the page. `count = total`.

`normalizeLead`: `id`; `job_id = null`; `name = contact.name || row.name || "Unnamed lead"`; `contact_name/email/phone`; `formatted_address = address || [address_line_1, city, province, postal_code]`; `is_lead = true`; `lead_stage = pipeline_stage_raw || status || "new"`; `budgetProgress = null`.

Any step's error is returned as `{projects: [], count: 0, error}`.

#### 5.1.3 Assignments (`listActiveProjectAssignmentIds`)
`from("job_assignments").select("job_id").eq("employee_id", userId).eq("status","active")`

#### 5.1.4 Other reads by these screens
- Budget refresh: `from("job_feed").select("id,status,budget_minutes,used_minutes,budget_percent_used,budget_status,updated_at").in("id", ids)`, in chunks of 100 ids, run in parallel.
- `trackingProjects` (Edit Time project picker): all `job_feed` active pages (1000 per page) that have `latitude` and `longitude`.
- Role: `from("employees").select("id,email,full_name,role,is_active").eq("id", user.id).maybeSingle()`.

#### 5.1.5 `ensure_lead_clock_in_job` (used when clocking into a lead; Clock In flow)
`rpc("ensure_lead_clock_in_job", {requested_lead_id: leadId})` → one `public.jobs` row (normalised with `normalizeJob`. It has no budget fields, so budget status = `not_configured`).
Client errors: missing id → `This lead is missing its project id.`; empty response → `The lead could not be prepared for clock in.`
Server (`public.ensure_lead_clock_in_job(uuid) returns public.jobs`, an organisation-scoped wrapper over `private.ensure_lead_clock_in_job__unscoped`):
- Sets the acting org to the lead's org. Requires the caller to be a member (`42501` `You do not have access to this company.`) and an acting member (`Active employee profile required`, `42501`). A null id → `Lead id is required` (`22023`). Unknown lead → `Lead not found` (`P0002`).
- Locks the lead. Returns the existing `scheduled|active` job for that lead if there is one (prefers one with an accepted quote, then active, then oldest).
- Otherwise it inserts a job: `status 'active'`, `contract_amount_cents 0`, address copied from the lead, `name = contact name or 'Project'`, `started_on = current_date`, `is_feed_visible true`, `source 'app'`, `metadata {created_from:'lead_clock_in', created_by}`.

### 5.2 Server objects (latest shapes)

#### 5.2.1 View `public.job_feed` (latest: `mobile/supabase/migrations/20260818205939_expose_job_lead_identity.sql`; `security_invoker = true`, so `jobs` RLS applies)
Columns: `id, name, status, formatted_address, address_line_1, address_line_2, city, province, postal_code, country, latitude, longitude, companycam_project_ids, scheduled_on, started_on, completed_on, is_feed_visible, updated_at, budget_minutes, used_minutes, budget_percent_used, budget_status, lead_id`.
- The row filter is `job.is_feed_visible`.
- `budget_minutes`: from the single best `job_budgets` row with `status in ('active','closed')`, ordered by active first, source in (manual, project_budget) first, manual first, `version` desc, `updated_at` desc, `id`.
- `used_minutes`: `Σ max(0, (coalesce(ended_at, now()) − started_at) in minutes)` over `time_entries` with `status <> 'deleted'`, cast to integer. This includes running shifts live.
- `budget_percent_used = budget_minutes null or 0 ? null : round(used/budget*100, 2)`.
- `budget_status`: see §3.1.
- **No `created_at`, `contact_id`, or `org_id` columns.**

#### 5.2.2 RPC `set_job_task_status(requested_task_id uuid, requested_status text) returns public.job_tasks`
- Client call: `rpc("set_job_task_status", {requested_task_id, requested_status})` with `skipped` sent as `cancelled`. If the response is an array, the client takes the first element.
- Wrapper sets the acting org from the task's `org_id`.
- Body: requires auth (`Authentication required`). Status must be in `pending, in_progress, completed, cancelled` (`Invalid task status`). The caller must be a manager of the org **or** have an active `job_assignments` row for the task's job (`Task access denied`).
- Updates `status`. When the new status is completed: `completed_by = auth.uid()`, `completed_at = now()`; otherwise both are set to null. Also `updated_at = now()`. Returns the row. The realtime publication then fires for `job_tasks`.

#### 5.2.3 Tables read directly for tasks
```
from("job_tasks").select("*").eq("job_id", projectId).order("sort_order")
from("job_budgets").select("*").eq("job_id", projectId).in("status",["active","closed"])
   .order("version",{ascending:false}).limit(1).maybeSingle()
```
Note: this budget pick (highest `version` among active or closed) can differ from `job_feed`'s pick (active first, manual/project_budget first). The hours displayed come from `job_feed`. Only `instructions` and `revision` come from this row.

`public.job_tasks`: `id uuid pk, job_id uuid, budget_id uuid null, source_kind text, source_item_id text, title text, notes text, budget_minutes int, calculated_minutes int, sort_order int default 0, status text check (pending|in_progress|completed|cancelled), completed_by uuid, completed_at timestamptz, versions jsonb, metadata jsonb, created_at, updated_at, org_id uuid`. Unique `(job_id, source_kind, source_item_id)`. Index `(job_id, status, sort_order)`. It is in the `supabase_realtime` publication.

`public.job_budgets`: `id, job_id, quote_id, version int >0, status (draft|active|closed|superseded), budget_minutes, calculated_minutes, hourly_rate_cents, amount_including_tax_cents, labour_allocation_percent, actual_labour_cost_cents, instructions, notes, closed_at, closed_by, source, metadata, created_at, updated_at, org_id`. Unique `(job_id, source, version)`. Because the query uses `select("*")`, pricing columns reach the client even though they are never displayed.

`public.job_assignments`: `id, job_id, employee_id, status (active|inactive), assigned_by, created_at, updated_at, org_id`. Unique `(job_id, employee_id)`.

#### 5.2.4 RPC `record_time_entry_command(action text, command jsonb, next_command jsonb default null) returns jsonb` (issue actions only)
Client: `rpc("record_time_entry_command", {action, command, next_command: null})`.
- The wrapper resolves the job from `command.job_id`, or from `command.task_id` via `job_tasks`, and sets the acting org.
- Requires an authenticated caller who is an acting member (`Active employee profile required`).
- `task_start | task_stop | task_adjust` → exception `Task timers have been removed`.
- `job_issue | task_issue`: resolves `job_id`, which must exist (`A valid job_id is required`). Inserts into `public.job_issues`:
  `client_id = command.client_id`, `job_id`, `task_id`, `employee_id = auth.uid()`, `issue_type = 'task_over_budget' | 'job_over_budget'`, `reason = command.reason or 'other'` (no server-side enum check), `note`, `minutes_over = max(0, int)`, `metadata = command.metadata or {}`, `created_at = now()`.
  `on conflict (client_id) where client_id is not null do nothing` (unique index `job_issues_client_id_idx`). Returns `{"id": uuid|null, "duplicate": bool}`.
- Command payloads sent by the app:
  - job: `{client_id, job_id, reason, note|null, minutes_over}`
  - task (unused in the UI): `{client_id, task_id, reason, note|null, minutes_over, metadata:{budget_revision}}`

### 5.3 Realtime channels used by these screens

| channel | config | used by |
|---|---|---|
| `project-labour-task-state:{jobId}:watch-{ts}-{rand}` | `postgres_changes`, `*`, `public.job_tasks`, `job_id=eq.{jobId}` | task panel (detail and Clock In) |

None on the list, the budget, or media.

### 5.4 RLS (latest: `20260925201731_scope_rls_to_organizations.sql`)
Select on `contacts, leads, jobs, job_budgets, job_assignments, job_tasks, job_issues, time_entries` is allowed for **any active member of the row's organisation** (`org_id in private.my_org_ids()`). It is not restricted by assignment. All writes go through SECURITY DEFINER RPCs with the organisation-scoped wrappers of `20260925205112_scope_definer_functions_to_organizations.sql`.
Possible wrapper errors (code `42501`): `You do not have access to this company.`, `This action spans two companies.`; and `You are not an active member of a company.`

---

## 6. Caching and local storage (AsyncStorage → use `UserDefaults` or a file store with the same keys and semantics)

### 6.1 Keys

| key | contents | written | read |
|---|---|---|---|
| `ottawaPainters.budgetProgressCache.v1` | JSON object `{ projectId: {companycamProjectId, percentUsed, hoursUsed, status, isComplete, calculatedAt, [budgetHours]} }`, merged across all projects ever seen | after every successful budget fetch (the whole in-memory map) | once per app launch (lazy hydration). Seeds budget panels before the network result arrives. The in-memory map is also seeded from embedded `budgetProgress` |
| `ottawaPainters.projectLabourTasks.v1:{userId}:{projectId}` | plan JSON (`budget`, `tasks`, `fetchedAt`), with task fields `hoursSpent`, `myActiveStartedAt`, `activePainters` stripped | on every successful refresh and every optimistic change (only when `userId` is set) | on hook mount, before the first refresh |
| `ottawaPainters.projectLabourTaskWrites.v1` | JSON array of queued task operations | enqueue and flush | flush |
| `ottawaPainters.labourTaskOverBudgetReasonAnswered.v1:{userId}:{taskId}:{revision}` | ISO timestamp | on Send or Skip | before prompting. For the job-level prompt, `taskId = "job:{jobId}"` and `revision = "unpublished"` |

There is no cache for the projects list, the detail screen's project object, or media (media: see the media spec).

### 6.2 Task write queue semantics (`projectLabourTasks.js`)
- Operation shapes:
  - `{id:"task-status-{ts}-{rand}", action:"status", taskId, userId|null, status, createdAt}`
  - `{id:"over-budget-reason-{ts}-{rand}", action:"over_budget_reason", clientId:"obr-{ts}-{rand}", taskId, userId, reason, note, hoursOver, budgetRevision:int|null, createdAt}`
- Try to execute. If it errors and the error is **retryable**, append to the queue and return `queued: true`.
  Retryable = the code is **not** `42501`, does not start with `22`, `23`, or `PGRST`, **and** the message matches `/fetch|network|offline|timeout|connection/i`. Everything else is permanent (not queued).
- Enqueueing a `status` op first removes any queued `status` op for the same `taskId` and `userId` (last write wins).
- Queue mutations are serialised (one at a time).
- Flush (single-flight): drop obsolete ops whose `action` starts with `timer_`. Get the current session user and stop if there is none. Execute each op in order, **skipping ops whose `userId` differs from the current user** (they stay queued). Remove ops that succeeded or failed permanently. Keep ops that failed retryably or threw.
- Flush runs: before every task list fetch, and every 60 s from time tracking. (The docs also mention app-foreground; that happens indirectly through the foreground refresh, which fetches and therefore flushes.)
- Validation for `over_budget_reason` before sending: the task, user, and client id must be present and `reason` must be one of the 5 keys (error `A task, signed-in painter, and valid reason are required.`). A note over 280 characters → `The over-budget note is too long.` Both are permanent errors, because their messages do not match the network pattern.

---

## 7. Ambiguities and quirks to preserve (checklist)
1. `job_feed` lacks `created_at`, so the detail subtitle for list-opened jobs is always `Added recently`.
2. The "Assigned" filter includes jobs that have any team time and the current job, not only assignments.
3. The 45 s auto-refresh of the list collapses paginated rows back to page 0.
4. The section count is the loaded count, not a server total.
5. `budget_status 'complete'` shows as "At budget" (the job is completed), and an under-budget job at exactly 100 % shows `99%`.
6. The plan budget is built from the first task row when it has a `budget_id` (total 0 h, revision 1, no instructions). Because of that, `· Xh budgeted` is hidden.
7. The task-level over-budget prompt, timers, and live-painter state described in `docs/` do not exist in the current UI or server.
8. The job over-budget answer is not queued offline and failures are silent. The marker is written anyway.
9. Detail "Your hours" and "team" totals come from team entries only (the active shift is not merged). The painter list, however, includes the active shift.
10. Crew see every painter's clock-ins (organisation-wide RLS) under the heading `Your Clock-ins`.
11. On iOS, the search field shows both the native clear button and the custom close icon while editing.
12. `fontWeight '650'` is invalid in RN; use semibold.
13. There are two migration directories. `job_feed`'s latest definition is in `mobile/supabase/migrations/`.
