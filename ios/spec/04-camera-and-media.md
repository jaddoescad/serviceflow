# 04 — Camera, Photos/Videos, Upload Pipeline, Media Viewing

Source of truth (read in full for this spec):

- `mobile/src/components/ProjectCameraScreen.js` (camera + in-camera capture viewer)
- `mobile/src/lib/projectMedia.js`, `mobile/src/lib/projectMediaModel.js` (HTTP client)
- `mobile/src/lib/useProjectMediaUploadQueue.js` (upload queue)
- `mobile/src/screens/clock-in/JobPhotosPanel.js` (clock-in "Photos" card)
- `mobile/src/screens/ProjectDetailScreen.js` (Media tab, grid, lightbox, zoom, delete, camera FAB)
- `mobile/cloudflare/project-media-worker/` (`src/index.js`, `test/worker.test.js`, `README.md`, `wrangler.jsonc`)
- `mobile/supabase/migrations/20260817153716_create_job_media.sql`, `…173057_add_companycam_source_to_job_media.sql`, `…20260824144703_restrict_media_deletion_to_uploader.sql`, and every `supabase/migrations/*` file that touches `job_media`
- `mobile/patches/react-native-vision-camera+5.2.2.patch`, `mobile/app.config.js`

Library versions in the RN app: `react-native-vision-camera` ^5.2.2, `expo-video` ~3.0.16, `expo-image-picker` ~17.0.11, `expo-file-system` ~19.0.24, `expo` ~54.0.37, RN 0.81.5. App is portrait-only (`orientation: "portrait"`), light UI (`userInterfaceStyle: "light"`).

Legend: **[iOS-NATIVE]** = something that must or should differ in the SwiftUI build. **[AMBIGUOUS]** = the JS does not pin the behaviour down; decide and verify. **[QUIRK]** = current behaviour that looks unintended; replicate only if an exact replica is wanted, otherwise raise with product.

---

## 0. Summary of the architecture

```
iOS app ──Supabase JWT (Bearer)──▶ Cloudflare Worker "project-media-worker" ──R2 binding──▶ private bucket ottawa-painters-project-media
   │                                   │
   │                                   └── same JWT ──▶ Supabase PostgREST (job_media, jobs, leads, RPC set_photo_trash) — RLS decides
   └── Supabase JS client ──▶ job_media (list) + employees (uploader names)
```

- Bytes only ever go through the Worker. The app never talks to R2 and there are no public URLs.
- Listing is done by the app directly against Supabase (`job_media` select), then each row gets a Worker URL + `Authorization` header attached client-side.
- Delete is a **soft delete** (moves to "recoverable trash"); bytes and row are retained.
- Upload queue is **in-memory only** (no persistence), one upload at a time per queue, 3 attempts with 1 s / 3 s backoff.

---

## 1. Entry points (how the camera and media surfaces are reached)

| Surface | Where | Opens |
|---|---|---|
| Clock-in "Photos" card (`JobPhotosPanel`, `showCamera` default `true`) | Active clock-in screen (`ActiveClockInBody`), `photosSection: { marginHorizontal: 10, marginTop: 10 }` | Header row & thumbnail strip → `onOpenAll` = open Project Detail with action `"photos"`. "Take Photo or Video" button → camera (owned by this panel, with its own queue). |
| Project Detail, Clock Ins tab | `JobPhotosPanel` embedded with `showCamera={false}`, slot style `photosPanelSlot: { marginTop: 16, marginBottom: 4 }` | Header/strip → switches to Media tab (`setActiveTab('photos')`). |
| Project Detail, Media tab | `ProjectMediaPanel` | Grid, lightbox. |
| Project Detail camera FAB | Floating button, visible on **both** tabs whenever the painter drill-down (`selectedPainter`) is not open | Clears completed queue items, opens camera. |
| Project Detail `initialAction` prop | `App.js` `openProject(project, action)` | `"photos"` → Media tab; `"camera"` → Media tab + camera open. Only `"photos"` is passed by any caller today (`ClockInScreen`); `"camera"` is supported but unused. |

Project identity: `projectId = String(project.id || project.job_id || project.companycam_id || "")` (`getProjectId`). `projectKind = project.is_lead === true ? "lead" : "job"`. For a job, `linkedLeadId = project.lead_id || null` (used only by Project Detail listing, **not** by `JobPhotosPanel` — see §5).

---

## 2. Camera screen (`ProjectCameraScreen`)

### 2.1 Presentation

- RN `Modal`: `animationType="slide"` (slides up from bottom), `presentationStyle="fullScreen"`, `statusBarTranslucent`. Android back → same as Close.
- Status bar: light content, background `#050708`.
- Props: `visible`, `projectName`, `queueItems` (live upload queue entries), `onCapture(asset)`, `onRetryUpload(localId)`, `onClose()`.
- The component stays mounted while the host screen is mounted; only `visible` toggles. Consequence: `facing` (front/back) and `flash` are **not** reset between openings; mode resets to Photo on close (see 2.10). **[QUIRK]** replicate by keeping flash/lens state on the host screen's lifetime.

Host behaviour on capture/close:

| Host | `onCapture(asset)` | `onClose()` | Before open |
|---|---|---|---|
| Project Detail | `mediaUploads.enqueue(asset)`, mark media as loaded (no refetch), switch to Media tab | close, switch to Media tab | `mediaUploads.clearCompleted()` (drop `uploaded` entries so filmstrip starts fresh) |
| `JobPhotosPanel` | `uploads.enqueue(asset)` | close | nothing (completed entries stay; filmstrip shows them as uploaded) |

Title passed: Project Detail passes `getProjectTitle(project)` (first non-empty of `name`, `project_name`, `customer_name`, `client_name`, `contact_name`, else `"Project"`); `JobPhotosPanel` passes `project?.name || "Project"`.

### 2.2 Layout (z-order bottom → top)

Screen background `#050708`, full-screen.

1. **Camera preview** — absolutely positioned at (0,0), sized to the measured screen size, `resizeMode="cover"` (aspect-fill), full bleed behind both bars. Only rendered when visible && camera permission granted && a device exists && layout measured. Front camera mirrored (`mirrorMode` on), back not.
2. **Preview status card** (zIndex 1, centred, touch-through) — shown when permission granted, device exists, and first preview frame not yet received.
3. **Top bar** (zIndex 2) — absolute top, full width.
4. **Bottom controls** (zIndex 2) — absolute bottom, full width.
5. **Permission card** (zIndex 3, full-screen) — when camera permission missing.
6. **Capture viewer** (zIndex 5, full-screen) — when a filmstrip item is open.

#### Top bar
- Background `rgba(4,8,10,0.56)`; padding: top = `max(safeAreaTop, 14)`, horizontal 14, bottom 12.
- Nav row height 48, `space-between`:
  - **Left: Close** round button (icon `close` 26 pt white). a11y label `"Close camera"`, hitSlop 10.
  - **Right**: row with gap 8: **Flash** button then **Flip** button.
  - **Centre title layer** (absolute fill, non-interactive, horizontal padding 112 on both sides so it never overlaps buttons):
    - Line 1: `projectName || "Project"` — white, 15 pt, weight 800, centred, 1 line (truncate tail).
    - Line 2: if `uploadCount > 0`: `"{n} upload in progress"` / `"{n} uploads in progress"`; else `"Project camera"` — `rgba(255,255,255,0.66)`, 11 pt, weight 600, marginTop 2, 1 line.
    - `uploadCount` = number of `queueItems` whose `status !== "uploaded"` (so **failed items count as "in progress"**) **[QUIRK]**.

Round button style (Close/Flash/Flip, also viewer close): 44×44, radius 22, bg `rgba(18,26,30,0.72)`, 1 px border `rgba(255,255,255,0.22)`; pressed opacity 0.7; disabled opacity 0.4; "active" (flash on) bg `rgba(43,132,150,0.9)`, border `rgba(255,255,255,0.45)`.

- **Flash**: icon `flash` (on) / `flash-off` (off), 20 pt white. a11y label `"Turn flash off"` when on, `"Turn flash on"` when off; selected state = on. Disabled while recording or when `!canUseFlash`. `canUseFlash` = in Video mode `device.hasTorch`, in Photo mode `device.hasFlash`. hitSlop 6. Toggles `flash` between `"off"`/`"on"` (starts `"off"`).
  - Photo mode: flash fires on capture only if `flash === "on" && device.hasFlash`.
  - Video mode: torch is lit continuously while `mode === "video" && flash === "on" && device.hasTorch` (i.e. as soon as you are in Video mode with flash on, not only while recording).
- **Flip**: icon `camera-reverse-outline` 22 pt white. a11y label `"Flip camera"`. Disabled while recording or when both front and back devices are not available. Flipping resets preview state (ready flags, retry counter) and re-reads zoom bounds from the new device on start.

#### Bottom controls
- Background `rgba(4,8,10,0.68)`; paddingTop 14; paddingBottom = `max(safeAreaBottom, 16) + 10`.
- Vertical stack, top → bottom, each only when applicable:
  1. Error notice (2.8)
  2. Session filmstrip (2.7)
  3. "Saving…" pill (while a stopped recording is being finalised)
  4. Recording timer pill (while recording)
  5. Zoom pills row (only once the preview has its first frame)
  6. Photo/Video mode switch
  7. Shutter row

**There is no gallery / photo-library picker on the camera screen or anywhere in the native iOS app.** (`selectProjectMediaAsset` in `ProjectDetailScreen.js` using `expo-image-picker` is only reached on `Platform.OS === 'web'`.) Do not add one for an exact replica.

**Zoom row**: centred, gap 6, marginBottom 10. One pill per available step.
- Steps `ZOOM_STEPS = [0.5, 1, 2]` expressed as multiples of the device's default (1×) lens. `1` is always offered; `0.5` and `2` only if `step * rawPerDisplay` is within the device's `[minZoom, maxZoom]`.
- Pill: minWidth 34, height 30, radius 15, horizontal padding 7, bg `rgba(18,26,30,0.72)`, 1 px border `rgba(255,255,255,0.22)`; text `rgba(255,255,255,0.86)` 12 pt weight 800, tabular numbers. Active pill: bg `#fff`, border `#fff`, text `#0b1518`.
- Active pill = step closest to the current displayed zoom. Label: `"{step}×"` (e.g. `0.5×`, `1×`, `2×`, using U+00D7). While the active pill's step differs from the live zoom by > 0.05, it shows the live value `"{zoom.toFixed(1)}×"` (e.g. `1.4×`).
- a11y label `"Zoom {step}x"` (ASCII x), selected state for active. hitSlop 8.
- Tap → set zoom to that display factor (single call, clamped to device bounds).
- Native pinch-to-zoom on the preview is enabled, as is native tap-to-focus. The RN code polls the controller's displayable zoom every 250 ms while preview is up to update pills (only when change > 0.02). **[iOS-NATIVE]** Just observe `videoZoomFactor` (KVO) and map to display factor.
- On session start the camera is set to **1×** (on a triple-lens iPhone the virtual device opens at the ultra-wide, raw 1.0 = 0.5× display; the code converts `rawPerDisplay = rawZoom / displayableZoomFactor` and sets raw = `rawPerDisplay` clamped). **[iOS-NATIVE]** With `AVCaptureDevice.DiscoveryDevice` pick `.builtInTripleCamera` → `.builtInDualWideCamera` → `.builtInDualCamera` → `.builtInWideAngleCamera` for back; use `virtualDeviceSwitchOverVideoZoomFactors.first` (or 2.0 on triple/dual-wide) as the 1× raw factor; display factor = raw / that value. Front: default `.builtInWideAngleCamera` front.

**Mode switch**: centred pill container, padding 3, radius 20, bg `rgba(255,255,255,0.14)`, 1 px border `rgba(255,255,255,0.18)`, marginBottom 12. Two segments:
- Segment: minWidth 88, minHeight 34, radius 17, row with gap 5, horizontal padding 12.
- Icon (15 pt) + label (13 pt, weight 800, letterSpacing 0.3).
- `Photo` with icon `camera`; `Video` with icon `videocam`.
- Inactive: no bg, icon/text `rgba(255,255,255,0.72)`. Active: bg `#fff`, icon/text `#0b1518`.
- a11y labels `"Photo mode"`, `"Video mode"`; disabled while recording. hitSlop 8.
- Choosing Video first ensures microphone permission (2.4). If refused, mode does not change and error shows `"Microphone access is required to record video with sound. Enable it in Settings."`.

**Shutter row**: three columns: flexible spacer | shutter | flexible spacer containing the upload counter.
- Outer ring: 80×80, radius 40, 4 px border `#fff` (border `#ef4d4d` while recording).
- Inner:
  - Photo mode: 64×64 circle `#fff`.
  - Video mode idle: 64×64 circle `#ef4d4d`.
  - Recording: 32×32 rounded square radius 8 `#ef4d4d`.
  - Pressed (not recording): 56×56 circle, opacity 0.85.
- Disabled (opacity 0.45) until the camera session is running **and** the first preview frame arrived, and while permission missing.
- a11y label: `"Stop recording"` while recording, else `"Record video"` (Video mode) or `"Take photo"` (Photo mode).
- Right column counter (only if `uploadCount > 0`): minWidth 38, height 38, horizontal padding 10, radius 19, bg `rgba(43,132,150,0.92)`, 1 px border `rgba(255,255,255,0.6)`; text = `uploadCount`, white 14 pt weight 900. Not tappable.

**Recording pill** (while recording): centred, row gap 7, padding 14×6, radius 15, bg `rgba(160,36,30,0.92)`, marginBottom 12; 8×8 white dot; text `"MM:SS / 10:00"` (e.g. `"00:07 / 10:00"`), white 15 pt weight 900 tabular. Timer = floor((now − start)/1000), updated every 500 ms, clamped to 0…600. a11y role timer, label `"Recording, {s} of 600 seconds"`.

**Saving pill** (after tapping stop, until file lands): same geometry, gap 8, bg `rgba(8,15,18,0.82)`; small white spinner + `"Saving…"` (U+2026) in the recording-time text style.

#### Preview status card (camera starting / failed)
- Card: minWidth 220, centred content, padding 22×18, radius 18, bg `rgba(8,15,18,0.82)`, 1 px border `rgba(255,255,255,0.18)`.
- Starting: white spinner + `"Starting camera…"` (title: white 14 pt weight 800, marginTop 10).
- Failed: `camera-outline` 28 pt white + `"Camera preview unavailable"` + button **`"Retry camera"`** (icon `refresh` 18 pt `#0b2025`; button minHeight 44, padding h16, radius 22, bg accent `#58c7d6`, gap 7, marginTop 14; text `#0b2025` 14 pt weight 900). a11y label `"Retry camera preview"`.

Preview watchdog: once the session reports started, if no first preview frame within **3000 ms**: first time → error text `"Restarting camera preview…"` and tear down/recreate the preview (automatic retry count 1); second time → failed state + error `"The camera preview did not start."`. Retry button resets counters, clears error and recreates the preview. **[iOS-NATIVE]** Equivalent: observe the `AVCaptureVideoPreviewLayer` / first sample buffer; on timeout, remove and re-add the preview layer / restart the session.

#### Permission card (camera)
- Full-screen, bg `#10181c`, content centred, horizontal padding 34.
- Icon `camera-outline` 42 pt white.
- Title `"Camera access needed"` — white 21 pt weight 900, marginTop 16.
- Body `"ServiceFlow needs camera access to capture project photos and videos."` — `rgba(255,255,255,0.72)` 14/20 pt weight 600, centred, marginTop 8.
- Button (marginTop 22, minWidth 150, padding 20×13, radius 14, bg `#58c7d6`; label `#0b2025` 14 pt weight 900):
  - `"Allow Camera"` → request permission (status `.notDetermined`).
  - `"Open Settings"` → `UIApplication.openSettingsURLString` (status denied/restricted).
- **[QUIRK]** The permission card's zIndex (3) is above the top bar (2), so the Close button is covered while permission is missing; on iOS there is then no visible way to dismiss the camera except granting access. Verify on device; recommend keeping Close visible in the native build (flag to product if strict replica).

### 2.3 Camera permission flow
- When the camera becomes visible and permission is not granted but can be requested, it requests **once automatically** per opening (flag reset on close).
- Info.plist strings (verbatim, from `app.config.js`):
  - `NSCameraUsageDescription`: `ServiceFlow uses the camera to take job-site photos and videos for project records.`
  - `NSMicrophoneUsageDescription`: `ServiceFlow uses the microphone to record audio when you capture job-site videos.`
  - `NSPhotoLibraryUsageDescription`: `ServiceFlow accesses your photo library so you can attach existing photos and videos to a project.` (declared, but the iOS app never accesses the library and never saves captures to it.)

### 2.4 Microphone permission
- Requested only when switching to Video mode or starting a recording (`ensureMicrophonePermission`): granted → ok; can request → request and use result; otherwise false.
- Denied copy (shown in error notice): `"Microphone access is required to record video with sound. Enable it in Settings."` No Settings button — text only.
- Audio input is attached to the session **only while in Video mode and mic is granted** (`enableAudio: mode === "video" && hasPermission`). Rationale in code: a phone call owns the iPhone mic; attaching audio in Photo mode interrupted the whole camera. **[iOS-NATIVE]** Add/remove the `AVCaptureDeviceInput` for audio when entering/leaving Video mode; never add it in Photo mode.

### 2.5 Photo capture
- Guard: session running && preview first frame && not already capturing && not recording.
- Output: **JPEG**, quality **0.85** (`containerFormat: "jpeg"`). Shutter sound on. Flash per 2.2.
- Resolution: library default for the chosen device format. **[AMBIGUOUS]** VisionCamera v5 default format is not specified in code; recommend `AVCapturePhotoOutput` with `maxPhotoDimensions` = largest supported for the active format and `photoQualityPrioritization = .balanced`. Code comment elsewhere says "Job photos are up to 3000px wide".
- **[iOS-NATIVE]** Force JPEG (`AVVideoCodecType.jpeg`, `AVVideoQualityKey 0.85`); do **not** use the iOS default HEIC — Android crew members view the same files.
- File written to a temporary path; not saved to the Photos library.
- Dimensions read from the written file (`Image.getSize`, i.e. orientation-applied pixel size); if unreadable, width/height omitted.
- Asset passed to `onCapture`:
  ```
  { uri: "file://…", width, height, mimeType: "image/jpeg", type: "image",
    fileName: "project-{capturedAtMs}.jpg", creationTime: capturedAtMs }
  ```
  `capturedAtMs = Date.now()` **after** the file is written.
- Error copy: `"The photo could not be captured."` (details = native message).
- Output orientation: **[AMBIGUOUS]** not set in JS (VisionCamera default). App UI is portrait-locked; recommend capture orientation follows device orientation (like the stock camera).

### 2.6 Video recording
- Constants: `MAX_VIDEO_SECONDS = 600` (10 min) — recorder `maxDuration: 600`, auto-stops.
- Container **MP4** (`fileType: "mp4"`), codec **H.264** (`setOutputSettings({ codec: "h264" })`, failure ignored). Rationale: `.mov`/HEVC from iPhone often failed to play on Android.
- Resolution/frame-rate/bitrate: library default ("Full quality" per comment). **[AMBIGUOUS]** Recommend 1920×1080 @ 30 fps H.264 High, AAC 44.1/48 kHz audio. **[iOS-NATIVE]** `AVCaptureMovieFileOutput` writes QuickTime; use `AVAssetWriter` with `AVFileType.mp4` + `AVVideoCodecType.h264` (or MovieFileOutput + `.h264` codec and ensure the file is an `.mp4`-compatible container) so the uploaded MIME is `video/mp4`.
- Start sequence (tap shutter in Video mode):
  1. Guard: session running && preview ready; ignore if a photo capture or a finalisation is in progress.
  2. Ensure mic permission (fail → error copy from 2.4, no recording).
  3. Flip UI to "recording" **immediately** (before the recorder is actually running) so a second tap is a stop.
  4. Create recorder, start. `startedAt = Date.now()` taken just before `startRecording`.
  5. In parallel, grab a **poster frame** by taking a silent, flash-off JPEG photo; stored for the filmstrip only.
  6. If the user tapped stop while the recorder was still starting, stop as soon as it runs.
- Stop: UI leaves "recording" instantly, shows "Saving…" until the file is finished.
- On finished file → asset to `onCapture`:
  ```
  { uri: "file://…", mimeType: "video/mp4", type: "video",
    duration: Date.now() - startedAt  /* ms, wall clock */,
    fileName: "project-{startedAtMs}.mp4", creationTime: startedAtMs }
  ```
  No `width`/`height` for videos. **No `posterUri`** is attached to the asset (see §3.6 — the poster upload path is therefore dead for camera captures) **[QUIRK]**.
- Error copy: `"The video could not be recorded."` (details = native message).
- While recording: Flash, Flip and mode switch disabled.
- Closing during a recording: stop the recording, wait for the file to finish (it is still enqueued), then close.
- Dismiss while recording via `visible=false` from outside: recording is stopped, result discarded.

### 2.7 Session filmstrip
Horizontal scroller (no indicator), content padding h14, gap 8, paddingBottom 12. Items built as:
1. Captures from this camera session, newest first (prepended on capture), matched to queue entries by `asset.uri`; unmatched → shown as status `"queued"`.
2. Then any other queue entries not matched above (i.e. from earlier sessions still in the queue), newest first.

Tile: 48×48, radius 9, clip, 1 px border `rgba(255,255,255,0.5)`, pressed opacity 0.7.
- Photo: the local file image, aspect-fill.
- Video: the poster image if captured, else bg `#223746` with `videocam` 20 pt white centred; plus play badge bottom-left (3,3): 18×18 circle `rgba(8,15,18,0.72)`, `play` 11 pt white.
- Failed: full overlay `rgba(160,48,36,0.45)` with `alert` 16 pt white centred.
- Status badge bottom-right (3,3), 18×18 circle:

| State | Icon (white) | Badge bg | Status text (a11y + viewer) |
|---|---|---|---|
| `uploading` | small spinner (10) | `rgba(20,86,97,0.92)` | `uploading` |
| `uploaded` | `checkmark` 11 | `#2e9e5b` | `uploaded` |
| `failed` | `refresh` 11 | `#c24836` | `upload failed, tap to retry` |
| `queued`, attempts > 0 | `sync` 11 | `#b07c1f` | `retrying upload` |
| `queued`, attempts = 0 | `time-outline` 11 | `rgba(20,86,97,0.92)` | `waiting to upload` |

a11y label: `"Open {photo|video} capture, {status text}"`. Tap → capture viewer (disabled if no uri).

### 2.8 Error notice (in-camera banner)
- Container: marginHorizontal 14, marginBottom 12, padding 10×7, radius 10, bg `rgba(160,48,36,0.9)`, row, align top, gap 7.
- `alert-circle` 15 pt white; message white 11/14 pt weight 700, **1 line** when collapsed; details (selectable) `rgba(255,255,255,0.76)` 9.5/12 pt, marginTop 4, only when expanded.
- `"Show more"` / `"Show less"` toggle (white 10/14 pt weight 900; a11y `"Show more error detail"` / `"Show less error detail"`), shown if details exist or message > 80 chars. Collapses whenever the notice changes.
- Details are dropped if equal to the message.
- Auto-clear: 6 s after it appears **if** the preview is running. Also cleared on: first preview frame, successful mode switch, interruption end, start of a capture.
- Native error handling: any error whose message matches `/cancel/i` is ignored (logged only).

Copy table:

| Trigger | Message | Details |
|---|---|---|
| Interruption `audio-device-in-use-by-another-client` (also forces Photo mode) | `Your phone call is using the microphone. Photo mode is still available.` | `iPhone camera interruption: {reason}` |
| Interruption `video-device-in-use-by-another-client` or `video-device-not-available-with-multiple-foreground-apps` | `Your iPhone is using the camera in another app or call.` | `iPhone camera interruption: {reason}` |
| Any other interruption | `The camera was temporarily interrupted by your iPhone.` | `iPhone camera interruption: {reason}` (empty if no reason) |
| Native error matching `/audio-device-in-use-by-another-client|audio.*(?:busy|in use|another client)/i` | `Your phone call is using the microphone. Photo mode is still available.` | raw error |
| Native error matching `/video-device-in-use-by-another-client|camera.*(?:busy|in use|another client)/i` | `Your iPhone is using the camera in another app or call.` | raw error |
| Other native error | `The camera could not start.` | raw error |
| Preview auto-restart | `Restarting camera preview…` | — |
| Preview failed | `The camera preview did not start.` | — |
| Mic denied | `Microphone access is required to record video with sound. Enable it in Settings.` | — |
| Photo failed | `The photo could not be captured.` | native message |
| Video failed | `The video could not be recorded.` | native message |

**[iOS-NATIVE]** Map `AVCaptureSession.InterruptionReason`: `.audioDeviceInUseByAnotherClient` → `audio-device-in-use-by-another-client`; `.videoDeviceInUseByAnotherClient` → `video-device-in-use-by-another-client`; `.videoDeviceNotAvailableWithMultipleForegroundApps` → `video-device-not-available-with-multiple-foreground-apps`; others (`.videoDeviceNotAvailableInBackground`, `.videoDeviceNotAvailableDueToSystemPressure`, `.sensitiveContentMitigationActivated`) → generic copy. Clear on `AVCaptureSessionInterruptionEnded`. `AVCaptureSessionRuntimeError` → native error mapping.

### 2.9 App lifecycle
- Camera session active only while visible **and** app state is `active`. Background/inactive stops the session (ready flags reset); returning restarts it and the watchdog runs again.

### 2.10 Reset on close
On `visible → false`: clear ready/preview/retry/failed flags, viewport, error; mode → `photo`; recording/finalising off; session captures cleared; viewer closed; poster ref cleared; any active recorder is stopped (result discarded).

### 2.11 Capture viewer (in-camera preview of a filmstrip item)
- Full-screen overlay inside the camera modal, bg `#05080a`, paddingTop `max(safeTop,14)`.
- Photo: local file, aspect-fit (no zoom).
- Video: player with native controls, aspect-fit, **autoplays and loops**. Player created when the viewer opens and destroyed when it closes.
- Top bar (absolute top, padding h14, bottom 12, top `max(safeTop,14)`, bg `rgba(4,8,10,0.5)`, gap 12): Close round button (`close` 26; a11y `"Close preview"`) + status text (`rgba(255,255,255,0.82)` 13 pt weight 700, 1 line) = status text from 2.7. **[QUIRK]** status is a snapshot taken when the viewer opened; it does not update live.
- If status `failed` and the item has a queue id: bottom-centre button `"Retry upload"` (icon `refresh` 18 `#0b2025`; minHeight 44, padding h18, radius 22, gap 7, bg `#58c7d6`, text `#0b2025` 14 pt 900; bottom = `max(safeBottom,16)+16`; a11y `"Retry upload"`). Tap → `onRetryUpload(localId)` then close viewer.
- Swipe-down to dismiss — identical to the lightbox (§4.4): claim when `dy > 10 && |dy| > 1.5·|dx|`; follows finger (translateY = max(0, dy)); opacity 1 → 0.25 and scale 1 → 0.88 over 0…320 pt; release with `dy > 140` or `vy > 0.8` → animate to translateY 900 over 180 ms then close; else spring back (no bounce).

### 2.12 Colours used by the camera
`#050708` screen, `#05080a` viewer, `#10181c` permission card, accent `#58c7d6`, accent text `#0b2025`, ink on white `#0b1518`, record red `#ef4d4d`, recording pill `rgba(160,36,30,0.92)`, error `rgba(160,48,36,0.9)`, teal active `rgba(43,132,150,0.9)`/`0.92`, success `#2e9e5b`, failed `#c24836`, retrying `#b07c1f`, uploading `rgba(20,86,97,0.92)`, video placeholder `#223746`. Icons are Ionicons; map to SF Symbols of equivalent weight (e.g. `close`→`xmark`, `flash`→`bolt.fill`, `flash-off`→`bolt.slash.fill`, `camera-reverse-outline`→`arrow.triangle.2.circlepath.camera`, `camera`→`camera.fill`, `videocam`→`video.fill`, `refresh`→`arrow.clockwise`, `sync`→`arrow.triangle.2.circlepath`, `time-outline`→`clock`, `checkmark`→`checkmark`, `alert`→`exclamationmark`, `alert-circle`→`exclamationmark.circle.fill`, `play`→`play.fill`) or bundle Ionicons for pixel parity.

---

## 3. Upload pipeline

### 3.1 Queue model (`useProjectMediaUploadQueue({ projectId, projectKind, onUploaded })`)

- **Storage: in-memory only** (React `useReducer`). No AsyncStorage/disk persistence, no storage keys, **no resumption after app restart**, no background URLSession. A queue lives as long as the owning view: Project Detail screen has one; each `JobPhotosPanel` instance has its own. Leaving the screen drops queued items (an in-flight request keeps running but its result is ignored). Captured files live only in the camera's temp directory — they are **not** saved to the Photos library, so an unsent capture is lost if the screen is left or the app is killed. **[QUIRK / product decision]** An exact replica keeps this; a safer native build could persist the queue — flag before changing.
- **Concurrency: 1** upload at a time per queue, FIFO by enqueue order; the next item picked is the first `queued` item whose `retryAt` is null or past. Items waiting for a retry do not block later items. If nothing is ready, a timer wakes the queue at the earliest `retryAt`.
- **Offline**: no reachability check. A failed request just follows the retry schedule, then goes to `failed`, and the user must retry.

Queue item:

| Field | Value |
|---|---|
| `localId` | `"capture-{Date.now()}-{7 random base36 chars}"` |
| `projectId`, `projectKind` | from the hook at enqueue time |
| `asset` | capture asset (§2.5/§2.6) |
| `kind` | `"video"` if `asset.mimeType` starts with `video/`, else `"image"` |
| `capturedAt` | ISO string of `asset.creationTime || now` |
| `status` | `queued` \| `uploading` \| `uploaded` \| `failed` |
| `attempts` | number of attempts started |
| `retryAt` | epoch ms or null |
| `remote` | the created media row (with access fields) after success |
| `error` | last error message or null |

Enqueue is a no-op (returns null) if the hook has no `projectId` or the asset has no `uri`.

Transitions:

| Action | Effect |
|---|---|
| enqueue | append `{status: queued, attempts: 0}` |
| start | `status = uploading`, `attempts += 1`, clear `retryAt`, `error` |
| success | `status = uploaded`, `remote = row`; then `onUploaded(row, item)` (exceptions swallowed) |
| fail (attempts < 3) | `status = queued`, `retryAt = now + [1000, 3000][attempts-1]` ms, `error = message` |
| fail (attempts = 3) | `status = failed`, `error = message` |
| retry(localId) | `status = queued`, `attempts = 0`, clear `retryAt`, `error` |
| retryAll | same as retry for every `failed` item |
| discard(localId) | remove item |
| clearCompleted | remove all `uploaded` items |

`MAX_ATTEMPTS = 3`, `RETRY_DELAYS_MS = [1000, 3000]`. Error message stored = `error.message || "Upload failed. Tap to retry."`.

Counts: `queued`, `uploading`, `failed`, `uploaded`, `total = queued + uploading + failed`.

`onUploaded` in both hosts: ignore if the item's `projectId` (and on Project Detail, `projectKind`) differs from the current project; otherwise put the row at the front of the local media list (deduped by `id`) without refetching. On Project Detail also clears the media error and marks media loaded.

### 3.2 Upload algorithm (`uploadProjectMedia(projectId, asset, { projectKind })`)

1. Base URL = `EXPO_PUBLIC_PROJECT_MEDIA_API_URL` (or `expo.extra.projectMediaApiUrl`), trailing slashes stripped. Missing → error `"Project media is not configured. Set EXPO_PUBLIC_PROJECT_MEDIA_API_URL to the media Worker URL."` The production value lives in the EAS `production` environment, not in the repo (`.env.example` placeholder `https://your-project-media-worker.workers.dev`). **[iOS-NATIVE]** put it in the build config (xcconfig/Info.plist).
2. `projectId` empty → `"Missing project id."`; no `asset.uri` → `"No file selected."`.
3. MIME = `inferAssetMimeType(asset)`:
   - declared `asset.mimeType` (lowercased, parameters stripped) if allowed;
   - else by extension of `fileName` or `uri`: `jpg|jpeg→image/jpeg`, `png→image/png`, `webp→image/webp`, `heic→image/heic`, `heif→image/heif`, `mp4|m4v→video/mp4`, `mov|qt→video/quicktime`;
   - else `type === "image"` → `image/jpeg`, `type === "video"` → `video/mp4`; else null.
   Kind: image MIME ∈ {jpeg, png, webp, heic, heif}; video ∈ {mp4, quicktime}. None → `"Unsupported file type. Use JPEG, PNG, WebP, HEIC photos or MP4/MOV videos."`
4. Size limit: images `MAX_IMAGE_BYTES = 25 MiB`; videos `MAX_MULTIPART_VIDEO_BYTES = 1 GiB`. Checked against `asset.fileSize` (if present) and the real file size. Over → `"This {image|video} is too large. The limit is {25|1024} MB."`. Size ≤ 0 or unreadable → `"The selected file is empty or cannot be read."`
5. Token: `supabase.auth.getSession()` → `access_token`; missing → `"You need to be signed in to view project media."` Token is read **once per upload attempt** and reused for every request of that attempt (including all multipart parts). **[QUIRK]** A long multipart upload can outlive a 1-hour JWT; consider refreshing per part natively.
6. If video && size > `MULTIPART_THRESHOLD_BYTES = 16 MiB` → multipart (3.3). If multipart throws and size ≤ `MAX_VIDEO_BYTES = 95 MiB` → log and fall through to single request; if larger, rethrow.
7. Single request: `PUT {base}/v1/{jobs|leads}/{encodeURIComponent(projectId)}/media`, body = file bytes streamed from disk (real `Content-Length`), headers from `buildUploadHeaders` (3.4). Non-2xx → error (3.5). Success → JSON row.
8. Attach access fields (3.7). For videos, attempt poster upload (3.6) — never fails the upload.

**No idempotency key is sent by the app** (`x-upload-id` is not used). A retry after a lost response can therefore create a duplicate row. **[iOS-NATIVE, recommended]** The Worker supports `x-upload-id: <UUID>` on the single PUT: generate one UUID per queue item (stable across its retries) and send it — the Worker returns `200` with the existing row on replay and `409` if reused for a different file. This is additive and safe; call it out as a deliberate improvement if adopted. Multipart has no idempotency support.

### 3.3 Multipart video upload
1. `POST {base}/v1/{jobs|leads}/{projectId}/media/multipart` with headers `Authorization: Bearer …`, `x-media-content-type: <mime>`, `x-file-size: <bytes>`, and `x-original-filename: <asset.fileName>` if present (sent **raw, unsanitized, not URI-encoded** here — camera names are ASCII so this is fine). Response JSON `{ mediaId, objectKey, uploadId, partSize }`. `chunkSize = partSize > 0 ? partSize : 8 MiB` (server returns 8 MiB).
2. For each chunk in order (part numbers from 1), read `[offset, offset+length)` directly from the file handle, then `PUT {base}/v1/media-uploads/{encodeURIComponent(uploadId)}/parts`, headers `Authorization`, `Content-Type: application/octet-stream`, `x-object-key: <objectKey>`, `x-part-number: <n>`; body = chunk bytes. Response `{ partNumber, etag }`. Per-part retry: up to **3 attempts, no delay**; 4xx → fail immediately; 5xx/network → retry. An empty read → `"Could not read the video from storage."`
3. On any failure in step 2: best-effort `DELETE {base}/v1/media-uploads/{uploadId}` with `x-object-key` (abort), then rethrow.
4. `POST {base}/v1/media-uploads/{uploadId}/complete`, `Content-Type: application/json`, body:
   ```json
   { "objectKey": "...", "parts": [{"partNumber":1,"etag":"..."}],
     "mimeType": "video/mp4", "byteSize": 123,
     "originalFilename": "project-1727…mp4" | null,
     "width": null, "height": null,
     "durationMs": 7345 | null, "capturedAt": 1727… | null }
   ```
   Note `capturedAt` is sent as **epoch milliseconds** (the Worker's `new Date(value)` accepts it). Response `201 { "media": <row> }`.

### 3.4 Single-request headers (`buildUploadHeaders`)
| Header | Value |
|---|---|
| `Authorization` | `Bearer <access_token>` |
| `Content-Type` | MIME |
| `x-media-type` | `image` \| `video` (must match MIME kind) |
| `x-original-filename` | `sanitizeDisplayFilename(fileName)`: basename; runs of chars outside `[A-Za-z0-9._-]` → `_`; strip leading `.`/`_`/`-`; max 120 chars; omitted if empty |
| `x-media-width` / `x-media-height` | rounded positive integer ≤ 100000; omitted otherwise |
| `x-media-duration-ms` | videos only; rounded positive integer ≤ 86 400 000 |
| `x-captured-at` | ISO-8601 of `creationTime || now` |

### 3.5 Error message formation
`readWorkerError(response, fallback)`: if body is JSON with non-empty string `error`, use it; else fallback (`"Upload failed"`, `"Delete failed"`). Final message: `"{message} (HTTP {status})"`, e.g. `"File too large. Limit is 25 MB for images. (HTTP 413)"`. This string is what the failure UI shows as the reason.

### 3.6 Video poster upload (currently dead for camera captures)
If `asset.posterUri` exists: `PUT {base}/v1/media/{id}/thumbnail`, `Content-Type: image/jpeg`, body = poster file, 15 s timeout; failure only logged. **The camera never puts `posterUri` on the asset**, so this never runs; the grid relies on the Worker generating a still frame on demand. **[QUIRK]** For an improvement, the native build could send the poster; for exact replica, omit it.

### 3.7 Access fields attached to every media row (`attachMediaAccess`)
- `url = {base}/v1/media/{id}`
- `thumbnailUrl = {base}/v1/media/{id}/thumbnail` for `media_type === "video"`, else `null`
- `headers = { Authorization: "Bearer {token at list/upload time}" }` **[QUIRK]** token is frozen into the row; after it expires images fail until the list is refetched. Natively, attach the current token at request time.

### 3.8 Progress and failure UI (outside the camera)

**Project Detail → Media tab** (`ProjectMediaPanel`), for items of the current project/kind:
- Status banner when `total > 0` (queued + uploading + failed): row, gap 8, marginBottom 14, padding 13×11, radius 14, bg `#eaf4f6` (failed: `#fbecea`).
  - Icon: failed → `alert-circle` 18 `#a6402d`; else small spinner `#2b8496`.
  - Text (`#2b8496` 12 pt weight 800): failed > 0 → `"{n} upload need attention"` / `"{n} uploads need attention"`; else `"Uploading {total} item"` / `"Uploading {total} items"`.
  - Hint (muted `#8a8f95` 10.5 pt weight 600, marginTop 2): `"Uploads continue after you close the camera."`
  - Failed → trailing link `"Retry all"` (`#2b8496` 13 pt weight 800) → `retryAll`.
- Pending tiles in the grid (see §4.2).

**`JobPhotosPanel`** (clock-in card):
- While `uploading > 0`: row (gap 8, marginTop 10) small spinner muted `#6d7f7b` + `"Uploading {n} item…"`/`"Uploading {n} items…"` (muted 12.5 pt weight 700). Note: counts only `uploading`, which is 0 or 1.
- If any failed: pressable row (marginTop 10, padding 10×9, radius 10, bg `#fdecea`, pressed opacity 0.85), `alert-circle` 15 `#a5321f`, text `#a5321f` 12 pt weight 700, max 2 lines: `"{n} upload failed: {reason}. Tap to retry."` / `"{n} uploads failed: {reason}. Tap to retry."` (reason = first failed item's error; if it has none: `"{n} upload failed. Tap to retry."` / `"{n} uploads failed. Tap to retry."`). a11y `"Retry failed uploads"`. Tap → `retryAll`.

---

## 4. Viewing media

### 4.1 Project Detail tabs
- Tab bar (row, gap 8, padding h14 top 4 bottom 10, white): pill tabs (padding 14×8, radius 999, bg `#f6f8f9`, 1 px border `#e6e8eb`, text `#5a6068` 13 pt weight 600; active bg/border `#31495d`, text white weight 700; icon + text gap 7).
  - `"Clock Ins"` (icon `time` 14) — hidden for leads.
  - `"Media"` (icon `images` 18, colour `#2b8496`, white when active). a11y `"Photos and videos"`.
- Default tab: leads → Media; jobs → Clock Ins. Reset to that default whenever the project (id or lead flag) changes.
- **Every tap on the Media tab refetches** (sets loaded=false). Otherwise the list is fetched when the Media tab is active and not yet loaded.
- Content scroll padding: horizontal 14, top 4, bottom `safeBottom + 120`.

**Camera FAB**: absolute, right 16, bottom `safeBottom + 22`, 58×58 circle `#2b8496`, shadow (black, opacity 0.2, radius 14, offset 0/6). Icon `camera` 28 white; while a delete is in progress: disabled, opacity 0.65, white small spinner. a11y `"Take project photo"`. Tap: if no project id or delete pending → ignore; clear media error; switch to Media tab; `clearCompleted()`; open camera.

### 4.2 Media tab (`ProjectMediaPanel`)
Container marginTop 18, paddingBottom 42. Elements in order:

1. Upload status banner (§3.8).
2. Inline load/delete error (if `error`): row, gap 8, marginBottom 14, padding 12×10, radius 12, bg `#fbecea`; `alert-circle-outline` 20 `#a6402d`; text `#873523` 12/17 pt weight 600; trailing `"Retry"` link (`#2b8496` 13 pt 800) → refetch.
3. Loading (only when loading and no remote media yet): centred, paddingTop 58, spinner `#2b8496`, `"Loading project media"` (muted `#8a8f95` 12 pt weight 600, marginTop 10).
4. Empty (not loading, no remote, no pending): centred, marginTop 40, padding h20: 88×88 art = circle `#eef6f8` behind `images` 18 `#2b8496`, marginBottom 14; title `"No photos or videos yet"` (`#1f2933` 15 pt weight 700); hint `"Capture the site before, during, and after the work to build the project record."` (muted 12/17 pt weight 500, centred, marginTop 4).
5. When any remote or pending item:
   - Header (row, space-between, marginBottom 18): eyebrow `"PROJECT RECORD"` (`#2b8496` 9.5 pt weight 900, letterSpacing 1.1) above title `"Photos & Videos"` (`#1f2933` 22 pt weight 900, letterSpacing −0.5, marginTop 2); right count pill (minWidth 34, height 34, padding h10, radius 17, bg `#edf4f5`, text `#2b8496` 13 pt weight 900) = remote count + pending count.
   - Day sections (marginBottom 24). Header row: title (`#31495d` 15 pt weight 900, flex) + count (muted 12 pt weight 700, marginLeft 12); marginBottom 9, paddingBottom 8, bottom hairline 1 px `#dfe5e8`.
   - Grid: wrap, gap 7, tile width **31.5 %** (3 columns).

Sorting/grouping (`buildProjectMediaSections`):
- Combined list = pending items (mapped) + remote rows, sorted by `captured_at || created_at` descending (JS stable sort; unparsable/missing → 0 → bottom). Server order is `captured_at desc nulls last, created_at desc`.
- Grouped by **local calendar day** of that timestamp (`YYYY-MM-DD` key; missing → key `recent`), sections in first-seen order.
- Section title: `toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })` → e.g. `Friday, September 26, 2026`; invalid/0 → `Recently`.
- Time: `toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })` → e.g. `3:05 p.m.`; invalid/0 → `Recently`. **[iOS-NATIVE]** Use `Locale(identifier: "en_CA")` DateFormatter with template `EEEEMMMMdy` and `jmm`; verify output matches (`a.m.`/`p.m.` lowercase with dots).

Pending items mapped as: `id = local_id = localId`, `local_uri = asset.uri`, `media_type` from kind, `captured_at = created_at = capturedAt`, `upload_status`, `upload_error`, `is_pending_upload: true`, `source_name = painterName` (`employees.full_name` → auth `user_metadata.full_name` → `user_metadata.name` → email local part → `"Painter"`).

Tile (card): 1 px border `#e6e8eb` (pending: `#b9d9df`), radius 11, white, clipped, pressed opacity 0.9.
- Media area: square (aspect 1), bg `#f6f8f9`.
  - Remote photo: full original from `url` with auth header, aspect-fill (while no URL: spinner `#2b8496`). **[iOS-NATIVE]** Downsample to tile size when decoding (RN comment: originals up to ~3000 px; full decode stalls the grid). The Worker also serves a 640×480 WebP preview for images at `/thumbnail` — the RN app does **not** use it for photos; using it would be an optimisation, not a replica.
  - Remote video: tile bg `#31495d`, still frame from `thumbnailUrl` (auth header) aspect-fill; on load error keep the plain tile; centred 38×38 circle `rgba(255,255,255,0.2)` with `play` 24 white (paddingLeft 3).
  - Pending photo: local file aspect-fill. Pending video: navy tile + play circle (no frame).
  - Pending overlay over the square: bg `rgba(19,45,51,0.5)` (failed `rgba(137,49,36,0.72)`), gap 5; failed → `refresh` 20 white + `"Tap to retry"`; otherwise (queued **or** uploading) white spinner + `"Uploading"`. Text white 8.5 pt weight 900.
- Meta row under the square: minHeight 42, row, gap 5, padding h6, white. `person-outline` 13 muted; name (`#1f2933` 8.5 pt weight 800, 1 line) = source name (§4.5); second line (muted 8 pt weight 700, 1 line): pending → `"Upload failed"` if failed else `"Just captured"`; remote → time of `captured_at || created_at`.
- a11y label: pending → `"{Photo|Video} {upload_status}"` (e.g. `Photo uploading`); remote → `"Open {photo|video}"`.
- Tap: pending & failed → `retry(localId)`; other pending → nothing; remote → open lightbox at that item.
- Long-press (pending only) → alert title `"Remove pending upload?"`, message `"This removes the local capture from the upload queue."`, buttons `"Keep"` (cancel) / `"Remove"` (destructive → `discard(localId)`).

### 4.3 Clock-in "Photos" card (`JobPhotosPanel`)
- Card: white, radius 14, 1 px border `#e4eae8`, padding h14 top 12 bottom 14. Colours: navy `#31495d`, ink `#11201d`, muted `#6d7f7b`.
- Header (pressable → `onOpenAll`, a11y `"Open job photos"`): `images-outline` 17 navy, `"Photos"` (ink 14 pt weight 900, flex), count (muted 13 pt weight 800 tabular) = remote + pending — or a small muted spinner while loading with no media — then `chevron-forward` 15 muted. Gap 8.
- Strip (pressable → `onOpenAll`, a11y `"View all {total} photos and videos"`; row gap 8, marginTop 12): first **4** of [pending (queue order) …, remote (server order) …]; each tile flex 1, square, radius 9, bg `#dfe6e4`. Image = local uri (pending) / `url` for photos, `thumbnailUrl` for videos (with auth header), aspect-fill; no uri → `#c9d4d1`. Video badge bottom-left (4,4) 16×16 circle `rgba(8,15,18,0.7)` `play` 10 white. Pending overlay `rgba(17,32,29,0.45)`: failed → `alert` 13 white, else small white spinner. If more remain: extra tile bg `#eef2f1` with `"+{remaining}"` (navy 14 pt 900).
- No items: text (muted 12.5 pt weight 600, marginTop 10): `"Loading photos…"` while loading else `"No photos on this job yet."`.
- Upload rows per §3.8.
- `"Take Photo or Video"` button (only if `showCamera`): row, centred, gap 8, minHeight 46, radius 12, marginTop 12, bg navy; `camera` 19 white + text white 14 pt weight 900 letterSpacing 0.2; pressed opacity 0.85; disabled without project id; a11y `"Take a photo or video for this job"`.
- Loads once on mount / when project changes; no linked-lead media (see §5). Error from listing is ignored (shows empty). **[QUIRK]** If listing throws (no session / no base URL) loading never clears.

### 4.4 Lightbox (`MediaLightbox`)
- Contains **remote media only** (pending captures are not viewable here), in the same sort order as the grid (`captured_at || created_at` desc). Opens at the tapped item; closes itself if that item disappears.
- RN `Modal`, `animationType="fade"`, full-screen; status bar light, bg `#050607`.
- Layout: paddingTop `max(safeTop,16) + 10`, paddingBottom `safeBottom`; bg `#050607`.
  - **Top bar** height 54, padding h16, row space-between, bg `#050607`:
    - Close button (minWidth 68, minHeight 44, gap 4, hitSlop 8): `close` 24 white + `"Close"` (white 15 pt weight 700). a11y `"Close media viewer"`.
    - Centre (flex, padding h6): `"{Photo|Video} {index+1} / {count}"` (white 14 pt weight 800, centred) and `"Taken by {source name}"` (`#b7c0c5` 10.5 pt weight 600, marginTop 2, 1 line).
    - Right: if deletable → 68×44 button `trash-outline` 21 white (spinner while deleting; disabled while deleting; a11y `"Delete media"`); else 68-wide spacer.
  - **Pager**: horizontal paging, one page per item, page width = screen width, page height = `screenHeight − (max(safeTop,16)+10) − safeBottom − 84`. Page content padding h10, centred. Paging disabled while the current photo is zoomed. Current index updated when scrolling settles.
  - **Caption bar** height 30, padding h18, centred row gap 7: icon `videocam-outline` / `camera-outline` 15 `rgba(255,255,255,0.7)` + `"{day heading} · {time}"` (e.g. `Friday, September 26, 2026 · 3:05 p.m.`) in `rgba(255,255,255,0.72)` 11 pt weight 700.
- **Photo page**: original from `url` with auth header, aspect-fit, wrapped in pinch-zoom:
  - Two fingers: scale = clamp(startScale × distance/startDistance, 1, **4**). One finger pans only when scale > 1; pan clamped to ±`extent·(scale−1)/2` per axis. Release at ≤ 1.01 → spring back to scale 1, offset 0 and report "not zoomed"; else keep and report "zoomed".
  - No double-tap zoom. Zoom does not anchor at the pinch midpoint (scales about centre). **[QUIRK]** RN transform order `[scale, translateX, translateY]` means pans move `scale×` the finger and can overshoot edges.
  - **[iOS-NATIVE]** Implement with a `UIScrollView` (`minimumZoomScale 1`, `maximumZoomScale 4`, bounces back below 1) wrapped for SwiftUI; this gives correct edge clamping. Keep: no double-tap zoom (for replica), paging disabled while zoomed, swipe-dismiss disabled while zoomed. Reset zoom when the page changes.
- **Video page**: only the current page mounts a player; others show `videocam` 42 white on `#101820`. Player: source `url` with `Authorization` header, native controls, aspect-fit, inline, fullscreen allowed, **no autoplay**, **no loop**. Worker supports HTTP Range (206) for scrubbing. **[iOS-NATIVE]** `AVURLAsset(url:, options: ["AVURLAssetHTTPHeaderFieldsKey": ["Authorization": "Bearer …"]])` (what expo-video does) or an `AVAssetResourceLoaderDelegate`; `AVPlayerViewController` for native controls.
- **Swipe down to dismiss**: only single-finger, not zoomed, `dy > 10 && |dy| > 1.5·|dx|`; whole viewer follows finger (translateY = max(0,dy)), opacity 1→0.25 and scale 1→0.88 over 0…320 pt; release `dy > 140` or `vy > 0.8` → animate to 900 over 180 ms then close; else spring back without bounce. **[AMBIGUOUS]** what is visible behind the fading full-screen modal on iOS (likely black); natively show the presenting screen dimmed behind, like Photos.
- Accessibility: modal container; escape gesture closes.
- **No download, share, save-to-Photos, edit, tag or description UI** anywhere in the mobile app.

### 4.5 Attribution (source name)
Computed at list time (`projectMedia.js`) into `source_name`:
1. `source_metadata.creator_name` (trimmed) — imported media's original creator;
2. else `"CompanyCam"` if `source_provider === "companycam"`;
3. else uploader's `employees.full_name`; else local part of `employees.email`; else `"Team member"`.

Display fallback (`ProjectDetailScreen.getMediaSourceName`): `source_name || source_metadata.creator_name || ("CompanyCam" if companycam else "Team member")`, trimmed.

**[QUIRK]** A just-uploaded row inserted via `onUploaded` has no `source_name`, so its tile shows `"Team member"` (and lightbox `"Taken by Team member"`) until the next refetch. Native replica: consider setting it to the current painter's name — flag.

### 4.6 Delete (soft delete to trash)
- Who (client rule): delete button shown only when `item.uploaded_by === currentUser.id` (auth user id). Managers are **not** offered delete of others' media in the mobile app even though the server would allow it. Imported (CompanyCam) rows have `uploaded_by = null` → never deletable.
- Server rule (`set_photo_trash`): non-managers may only trash (never restore) media they uploaded and must be an active employee; org managers may trash/restore any media in their org.
- Flow: tap trash → alert title `"Delete photo?"` or `"Delete video?"`, message `"This permanently removes it from the project."`, buttons `"Cancel"` (cancel) / `"Delete"` (destructive); dismiss = cancel. On Delete: set delete-pending (FAB disabled+spinner; lightbox trash shows spinner), clear media error, `DELETE {base}/v1/media/{id}`; success (204) → remove row locally, close lightbox; failure → set inline error to message and alert `"Delete failed"` with the message (fallback `"Unable to delete this media."`); lightbox stays open. (Copy says "permanently" but it is a recoverable trash.)
- Client errors: `"Missing media id."`; HTTP failures per §3.5 with fallback `"Delete failed"`.

### 4.7 Load errors (Project Detail)
- No project id → `"This job is missing its project id."`
- Supabase error → its `message` or `"Unable to load project media."`; thrown errors (no base URL / no session) → their message or the same fallback. Media list cleared on error.

---

## 5. Supabase calls (exact)

App side (supabase-js, user session):

| # | Call | Notes |
|---|---|---|
| 1 | `supabase.auth.getSession()` → `data.session.access_token` | Bearer token for every Worker call. |
| 2 | `from("job_media").select("*")` + filter + `.order("captured_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })` | Filter: lead → `.eq("lead_id", projectId)`; job with `linkedLeadId` (Project Detail only) → `.or("job_id.eq.{projectId},lead_id.eq.{linkedLeadId}")`; otherwise `.eq("job_id", projectId)`. No `limit`/pagination (PostgREST server max-rows applies). |
| 3 | `from("employees").select("id,email,full_name").in("id", uploaderIds)` | Distinct non-null `uploaded_by`; errors ignored. |

Equivalent REST: `GET {SUPABASE_URL}/rest/v1/job_media?select=*&job_id=eq.{id}&order=captured_at.desc.nullslast,created_at.desc` with `apikey` + `Authorization: Bearer`.

Worker side (same user JWT + publishable key; for reference):
- `GET /rest/v1/{jobs|leads}?id=eq.{projectId}&select=id&limit=1` (access check)
- `GET /rest/v1/job_media?id=eq.{mediaId}&select=*&limit=1`
- `POST /rest/v1/job_media` (`Prefer: return=representation`) insert body: `id, job_id|lead_id, object_key, media_type, mime_type, original_filename, source_metadata {filename_version: 2}, byte_size, width, height, duration_ms, captured_at, uploaded_by` (`org_id` defaults/inherits via trigger)
- `POST /rest/v1/rpc/set_photo_trash` `{ requested_project_id: job_id||lead_id, requested_media_id, requested_trashed: true, expected_revision: source_metadata.photo_trash_revision || null, requested_revision: <new uuid> }` → must return JSON with `photo_trashed_at`
- `POST /rest/v1/rpc/get_photo_trash` `{ requested_media_id }` (trash reads, managers only; not used by mobile)

### 5.1 `public.job_media` (current definition, reconstructed)

| Column | Type / constraint |
|---|---|
| `id` | uuid PK, default `gen_random_uuid()` |
| `job_id` | uuid null → `jobs(id)` on delete cascade |
| `lead_id` | uuid null → `leads(id)` on delete cascade; exactly one of `job_id`/`lead_id` non-null |
| `object_key` | text unique; must match `^(jobs/{job_id}|leads/{lead_id})/{id}(~{uuid})?.{ext}$`, ext from MIME: jpg, png, webp, heic, heif, mp4, mov |
| `media_type` | `'image'` \| `'video'` |
| `mime_type` | one of `image/jpeg, image/png, image/webp, image/heic, image/heif, video/mp4, video/quicktime` |
| `original_filename` | text ≤ 120 chars, null |
| `byte_size` | bigint > 0 |
| `width`, `height` | int > 0, null |
| `duration_ms` | bigint ≥ 0, null |
| `captured_at` | timestamptz null |
| `uploaded_by` | uuid → `auth.users`, null only for `companycam` |
| `created_at`, `updated_at` | timestamptz default now() |
| `source_provider` | `'app'` \| `'companycam'` (default `'app'`) |
| `source_id`, `source_project_id` | text ≤ 120 (companycam only) |
| `source_metadata` | jsonb object, default `{}`. Keys seen: `filename_version`, `creator_name`, `creator_id`, `description`, `tags`, `photo_revision`, `photo_edited_by/_at`, `photo_trashed_at`, `photo_trashed_by`, `photo_trash_revision`, `photo_trash_changed_by/_at` |
| `org_id` | uuid not null → `organizations`, default Ottawa Painters org, overwritten by `inherit_org_id` trigger from the parent job/lead |

Indexes: `(job_id, captured_at desc nulls last, created_at desc)`, `(lead_id, …)` partial, `(uploaded_by)`, `(captured_at desc nulls last, created_at desc, id desc)`, `(job_id|lead_id, coalesce(captured_at, created_at), id)`, `(org_id)`, unique `(source_provider, source_id)` where source_id not null.

Grants: `authenticated` has SELECT, INSERT (DELETE revoked by `finalize_photo_trash_permissions`; no UPDATE).

RLS (latest):
- `org_member_read` (SELECT, permissive): `org_id in private.my_org_ids()` and the parent job/lead is visible.
- `job_media_hide_trash` (SELECT, restrictive): `source_metadata->>'photo_trashed_at' is null` → **trashed media never appears in the list or via the Worker**.
- `project_media_hide_project_trash` (SELECT, restrictive): hidden if the parent's `project_workspace.trashed_at` is set.
- `org_member_insert`: `uploaded_by = auth.uid()`, `source_provider = 'app'`, no source ids, org matches and parent job/lead in same org.
- `uploader_delete` policy exists but DELETE is not granted; removal goes through `set_photo_trash`.

---

## 6. Worker HTTP API (`project-media-worker`)

General:
- Base URL = configured Worker URL (no trailing slash). All errors: JSON `{"error": "<message>"}`, `Content-Type: application/json; charset=utf-8`.
- Every response carries CORS (`Access-Control-Allow-Origin: *`, methods `GET, HEAD, POST, PUT, DELETE, OPTIONS`, max-age 86400); irrelevant to native.
- Auth: `Authorization: Bearer <Supabase access token>` on every route except `GET /health` and `OPTIONS`. The Worker does not verify the signature itself; it forwards the JWT to Supabase (RLS). It decodes the JWT `sub` (must be UUID) for `uploaded_by`. Missing token → `401 "Missing bearer token."`; bad `sub` → `401 "Invalid bearer token."`; Supabase 401/403 on lookups → `401 "Not authorized."`.
- Not configured → `503 "Media service is not configured."`.
- Tokens whose `iss` is `https://pyzejfhsdewpnvmtqtlw.supabase.co/auth/v1` (the separate "Ottawa Painters" project) are read-only: only `GET/HEAD /v1/media/:id[/thumbnail]`; anything else → `403 "Ottawa Painters media access is read-only."`. Not relevant to ServiceFlow users.
- IDs must be UUIDs (`400 "Invalid project id."` / `"Invalid media id."`). Unknown path → `404 "Not found."`; wrong method → `405 "Method not allowed."`.
- R2 key format: `jobs/{jobId}/{mediaId}.{ext}` or `leads/{leadId}/{mediaId}.{ext}`; with `x-upload-id`, `{mediaId}~{attemptUuid}.{ext}`. Video still frame: `{object_key}.thumb.jpg`; image preview: `{object_key}.preview-v1.webp`. Keys are always server-generated.

| Route | Purpose |
|---|---|
| `GET /health` | `200 {"ok": true}` |
| `PUT /v1/jobs/:jobId/media`, `PUT /v1/leads/:leadId/media` | single-request upload |
| `POST /v1/{jobs|leads}/:id/media/multipart` | start multipart (videos) |
| `PUT /v1/media-uploads/:uploadId/parts` | upload part |
| `POST /v1/media-uploads/:uploadId/complete` | complete multipart |
| `DELETE /v1/media-uploads/:uploadId` | abort multipart |
| `GET` / `HEAD /v1/media/:mediaId` | stream original |
| `GET /v1/media/:mediaId/thumbnail` | preview (video frame JPEG / image WebP) |
| `PUT /v1/media/:mediaId/thumbnail` | uploader supplies a video poster |
| `DELETE /v1/media/:mediaId` | move to trash |
| `GET/HEAD /v1/media/:id/trash`, `POST /v1/media/:id/move`, `POST /v1/media/:id/duplicate` | manager/admin web only — **not used by mobile** |

### 6.1 `PUT /v1/{jobs|leads}/:id/media`
Request headers: `Authorization`, `Content-Type` (allowed MIME), `x-media-type` (`image`/`video`, must match), `Content-Length` (or `x-file-size`), optional `x-original-filename` (with `x-filename-encoding: uri` → URI-decoded), `x-media-width`, `x-media-height`, `x-media-duration-ms` (videos), `x-captured-at` (≤ 64 chars, any `Date`-parsable), `x-upload-id` (UUID, optional). Body: raw bytes.

Server steps: validate → size check → project access check → (if `x-upload-id`) replay check → R2 put → verify stored size == Content-Length → insert row → return.

| Status | Body / message |
|---|---|
| `201` | the inserted `job_media` row (JSON object) |
| `200` | existing row, when `x-upload-id` was already committed for the same file (same uploader, project, MIME, byte size, filename) |
| `400` | `Invalid project id.` / `x-media-type must be "{kind}" for {mime}.` / `Invalid upload id.` / `Invalid filename encoding.` / `Uploaded bytes did not match Content-Length.` |
| `401` | `Missing bearer token.` / `Invalid bearer token.` / `Not authorized.` |
| `403` | `Not allowed to add media to this project.` |
| `404` | `Project not found or not accessible.` |
| `409` | `Upload id is already used for another file.` / `Duplicate media upload.` |
| `411` | `A valid Content-Length header is required.` |
| `413` | `File too large. Limit is 25 MB for images.` / `File too large. Limit is 95 MB for videos.` |
| `415` | `Unsupported content type. Allowed: JPEG, PNG, WebP, HEIC/HEIF, MP4, QuickTime.` |
| `502` | `Could not verify project access.` / `Storing the file failed. Try again.` / `Saving media details failed. Try again.` |
| `503` | `Could not check upload status. Retry with the same upload id.` / `Upload confirmation unavailable. Retry with the same upload id.` |

Limits: images 25 MiB, single-request videos 95 MiB (Worker request cap 100 MB). Stored `original_filename`: basename with control chars/surrogates removed, ≤ 120 code points; R2 custom metadata uses the sanitized form.

### 6.2 Multipart
- **Start** `POST /v1/{jobs|leads}/:id/media/multipart` — headers `x-media-content-type` (must be a video MIME), `x-file-size` (≤ 1 GiB), optional `x-original-filename`/`x-filename-encoding`. → `200 {"mediaId","objectKey","uploadId","partSize": 8388608}`. Errors: `415 Unsupported content type.`, `400 Multipart uploads are for videos; send photos in one request.`, `411 A valid x-file-size header is required.`, `413 File too large. Limit is 1024 MB for videos.`, access errors as 6.1, `502 Could not start the upload. Try again.`
- **Part** `PUT /v1/media-uploads/:uploadId/parts` — headers `x-object-key`, `x-part-number` (1…10000); body bytes. Access re-checked from the key's project. → `200 {"partNumber", "etag"}`. Errors: `400 Invalid object key.`, `400 A valid x-part-number header is required.`, `400 Missing part body.`, access errors, `502 Storing that part failed. Try again.`
- **Complete** `POST /v1/media-uploads/:uploadId/complete` — JSON `{objectKey, parts[{partNumber, etag}], mimeType, byteSize?, originalFilename?, width?, height?, durationMs?, capturedAt?}`. → `201 {"media": <row>}` (`byte_size` = assembled object size). Errors: `400 Invalid body.`, `400 No parts to complete.`, `401 Invalid bearer token.`, `415 Unsupported content type.`, `502 Assembling the upload failed. Try again.`, `403 Not allowed to add media to this project.`, `409 Duplicate media upload.`, `502 Saving media details failed. Try again.` (object deleted on insert failure).
- **Abort** `DELETE /v1/media-uploads/:uploadId` — header `x-object-key` → `200 {"aborted": true}` (also for unknown uploads).

### 6.3 `GET` / `HEAD /v1/media/:mediaId`
- Row looked up with the caller's JWT (RLS; trashed rows invisible → 404).
- Response headers: `Content-Type` = row MIME, `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="<sanitized>"; filename*=UTF-8''<encoded>`, `Accept-Ranges: bytes`, `Content-Length`, `ETag`.
- `Range: bytes=a-b`, `bytes=a-`, `bytes=-n` → `206` + `Content-Range: bytes a-b/size`. Invalid/unsatisfiable → `416 "Requested range not satisfiable."` with `Content-Range: bytes */size`. Multi-range not supported.
- Errors: `401`, `400 Invalid media id.`, `502 Could not verify media access.`, `404 Media not found.` / `404 Media file not found.`

### 6.4 `GET /v1/media/:mediaId/thumbnail`
- Video → JPEG still at 1 s, 640×360 cover (Cloudflare Media Transformations), cached to `{key}.thumb.jpg` after first generation. Image → WebP 640×480 cover q78, cached to `{key}.preview-v1.webp`.
- Headers: `Content-Type`, `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, `ETag` (cached).
- Errors: `404` (row/file), `501 Preview transformations are not enabled.`, `422 This original exceeds the preview processor limit.` (images > 20 MiB), `422 Could not generate a valid preview.` / `422 Could not generate a preview for this file.` (e.g. video transformer cannot read it; originals > 100 MB). The app treats any failure as "show the plain navy tile".

### 6.5 `PUT /v1/media/:mediaId/thumbnail` (poster)
- Only for `media_type = video` and only the uploader (`uploaded_by == sub`), else `403 "Only the uploader can supply a video preview."`. `Content-Type: image/jpeg` (else `415 "The preview must be a JPEG."`), ≤ 5 MiB (`413 "Preview exceeds 5 MB."`). Re-encoded to 640×360 JPEG q80 and stored at `{key}.thumb.jpg`. → `200 {"id"}`. Other errors: `400 Missing preview.`, `503 Preview processing is unavailable.`, `422 Invalid preview.`

### 6.6 `DELETE /v1/media/:mediaId`
- Looks up row, calls `set_photo_trash` (§5). → `204` no body. Errors: `401`, `404 Media not found.`, `403 Not allowed to delete this media.`, `502 Deleting media details failed. Try again.`, `502 Could not confirm this photo was moved to trash.` R2 bytes and previews are kept.

---

## 7. iOS-native differences and decisions (checklist)

| # | Topic | RN today | Native iOS |
|---|---|---|---|
| 1 | Camera engine | `react-native-vision-camera` 5.2.2 (Nitro; `patches/…vision-camera+5.2.2.patch` only changes generated C++ `RawPropsParser(useRawPropsJsiValue true)` — no behavioural impact; drop it) | `AVCaptureSession` + `AVCaptureVideoPreviewLayer` (aspect fill) in a `UIViewRepresentable`; session work on a dedicated serial queue |
| 2 | Lens device | virtual multi-lens back device (ultra-wide + wide + tele); default front | `.builtInTripleCamera` → `.builtInDualWideCamera` → `.builtInDualCamera` → `.builtInWideAngleCamera`; start at display 1× |
| 3 | Pinch zoom / tap focus | VisionCamera native gestures | `UIPinchGestureRecognizer` → `videoZoomFactor` (clamped to min/max available), tap → `focusPointOfInterest`/`exposurePointOfInterest` |
| 4 | Photo format | JPEG q0.85 | Force JPEG q0.85 in `AVCapturePhotoSettings`; no HEIC (Android viewers). Uploaded MIME `image/jpeg` |
| 5 | Video format | MP4 + H.264, max 600 s | `AVAssetWriter` MP4/H.264 + AAC (or MovieFileOutput with `.h264`, verify container); `maxRecordedDuration` 600 s; MIME `video/mp4` |
| 6 | Audio input | attached only in Video mode | add/remove audio input on mode change |
| 7 | Poster frame | silent photo at record start, filmstrip only | e.g. first video frame or silent photo; do not send to server (replica) — or send via PUT `/thumbnail` as an improvement |
| 8 | Interruptions | VisionCamera reasons | `AVCaptureSession.wasInterruptedNotification` reasons, mapped per §2.8 |
| 9 | Preview watchdog | 3 s timeout, one remount | same using first sample buffer / preview layer readiness |
| 10 | Video player | `expo-video` with headers | `AVPlayerViewController` + `AVURLAsset` with `AVURLAssetHTTPHeaderFieldsKey` |
| 11 | Authenticated images | RN `Image` with `headers` | `URLSession` loader with `Authorization`, respect `Cache-Control`; downsample (ImageIO) for tiles |
| 12 | Uploads | `expo/fetch` streaming `File`; multipart via file handle | `URLSession.uploadTask(with:fromFile:)` for single PUT; `FileHandle` seek/read for parts. Foreground session (replica). Consider `beginBackgroundTask` so a capture finishing as the app backgrounds is not cut off |
| 13 | Idempotency | none | optionally send `x-upload-id` (per-item UUID) — flagged improvement |
| 14 | Queue persistence | none | replica = in-memory per screen; persistence is a product decision |
| 15 | Library import | none on iOS (web only) | none (do not add `PhotosPicker` for replica). `NSPhotoLibraryUsageDescription` still declared |
| 16 | Save to camera roll | never | never |
| 17 | Lightbox zoom | custom PanResponder, max 4×, no double-tap | `UIScrollView` zoom 1…4×; no double-tap (replica) |
| 18 | Date formatting | `en-CA` via Hermes Intl | `DateFormatter` `en_CA`; verify strings match |
| 19 | Token freshness | token frozen in listed rows; one token per upload attempt | fetch current session token at request time (behaviourally invisible improvement) |
| 20 | Config | `EXPO_PUBLIC_PROJECT_MEDIA_API_URL` | build setting / Info.plist key; same Worker URL as production EAS env |

Open questions to confirm with product before diverging from the replica: permission card hiding Close (§2.2), in-memory queue (§3.1), missing idempotency (§3.2), "Team member" attribution on fresh uploads (§4.5), delete copy saying "permanently" while it is recoverable (§4.6), `JobPhotosPanel` not including linked-lead media while Project Detail does (§5).
