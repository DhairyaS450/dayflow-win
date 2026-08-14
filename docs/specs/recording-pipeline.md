# Dayflow Recording & Analysis Pipeline — Windows Port Spec

Source: Dayflow macOS app (MIT), extracted 2026-08-13 from Swift sources under
`Dayflow/Dayflow/Core/Recording/`, `Dayflow/Dayflow/App/`, `Dayflow/Dayflow/Core/Analysis/`,
`Dayflow/Dayflow/System/`, plus supporting files (`Core/AI/LLMService.swift`,
`Core/AI/LLMTypes.swift`, `Core/Recording/StorageManager*.swift`, `Core/Recording/StorageDateHelpers.swift`)
read only where the primary files referenced them for exact constants.

This document is self-contained. The implementer should NOT need the Swift source.

---

## 0. Critical architectural fact (read first)

**Dayflow does NOT record video.** The recorder was rewritten to take a **periodic JPEG
screenshot** (default every 10 seconds) via ScreenCaptureKit's one-shot screenshot API,
specifically to avoid the macOS "screen is being recorded" indicator. There is no video
chunking, no encoder running during capture, and no fps in the capture path.

- The "chunk" terminology survives only as legacy: the SQLite file is named `chunks.sqlite`
  and there are legacy `batch_chunks`/chunk tables, but the live pipeline is
  **screenshots → analysis batches → observations → timeline cards**.
- Video only appears later: `VideoProcessingService` composites stored screenshots into MP4
  **timelapses** on demand (and for the Gemini provider, which requires video input).

On Windows: capture with e.g. `Windows.Graphics.Capture` / DXGI duplication / Electron
`desktopCapturer.getSources` thumbnail — one frame per interval, encode to JPEG, done.

---

## 1. Screen recording (ScreenRecorder)

### 1.1 Capture cadence

| Constant | Value | Notes |
|---|---|---|
| Screenshot interval | **10.0 s default** | Read from settings key `screenshotIntervalSeconds` (double, seconds); any value `> 0` overrides; used app-wide (capture, compression, LLM timestamp expansion) |
| First shot | **immediately** on capture start | Then a repeating timer at the interval |
| Timer | repeating dispatch timer on a dedicated serial queue | Interval re-read only when the timer is (re)started |

### 1.2 Resolution / scaling / format

| Constant | Value |
|---|---|
| Target height | **1080 px** (`targetHeight`) |
| Target width | `round(1080 × displayAspectRatio)`, **forced even** (`+1` if odd); height also forced even |
| Scale mode | `scalesToFit = true` (capture engine scales, aspect preserved) |
| Cursor | **included** (`showsCursor = true`) |
| Format | **JPEG**, quality **0.85** |
| Typical size | logged in KB; expect ~100–400 KB per frame |

### 1.3 File naming and location

- Filename: **`yyyyMMdd_HHmmssSSS.jpg`** (local time, millisecond precision), e.g.
  `20260813_142530123.jpg`.
- Directory (macOS): `~/Library/Application Support/Dayflow/recordings/`.
  Windows equivalent: `%APPDATA%/Dayflow/recordings/` (or Electron `app.getPath('userData')/recordings`).
- The filename format is load-bearing: `VideoProcessingService` parses
  `yyyyMMdd_HHmmssSSS` from filenames to recover timestamps when only URLs are available.

### 1.4 DB registration

Database: SQLite, file `Dayflow/chunks.sqlite` (sibling of `recordings/`), **WAL mode**,
max 5 concurrent readers, a dedicated serial write queue for async status writes.

Every captured frame (including privacy placeholders) is registered immediately after the
file is written:

```sql
INSERT INTO screenshots(captured_at, file_path, file_size, idle_seconds_at_capture)
VALUES (?, ?, ?, ?)
```

- `captured_at`: **Unix seconds (Int)** of the moment capture began (not file-write time).
- `file_path`: absolute path.
- `file_size`: bytes from file attributes; NULL if stat fails.
- `idle_seconds_at_capture`: whole seconds since the last hardware (HID) input event at the
  moment of capture, floored; **NULL** if unavailable/invalid. On macOS this is
  `CGEventSource.secondsSinceLastEventType(.hidSystemState, anyInput)`. Windows:
  `GetLastInputInfo()` → `(GetTickCount() - lastInputTick)/1000`, floored.
- Table also has `id` (rowid) and `is_deleted` (int, 0/1) — soft delete used by retention purge.

This idle-seconds column is essential: the idle-batch classifier (§3.4) depends on it.

### 1.5 Recorder state machine

States: `idle`, `starting`, `capturing`, `paused`.

- `canStart` only from `idle` or `paused`.
- `start()`: requires `wantsRecording == true` and `canStart`; transitions to `starting`,
  then async setup.
- Setup (`setupCapture`):
  1. Verify screen-recording permission; if missing → §1.8.
  2. Enumerate shareable displays.
  3. Choose display: `requestedDisplayID` (from active-display tracker events)
     → else tracker's current `activeDisplayID` → else **first display**; no display at all
     is an error.
  4. Cache display, clear `requestedDisplayID`, start capture timer, transition to
     `capturing`, take first screenshot immediately.
  5. If state changed away from `starting` while setup ran, abort silently (race guard).
- Setup failure retry: only for the **no-display** error, up to **4 attempts**, delay =
  attempt number in seconds (1s, 2s, 3s before attempts 2–4). Other failures transition to
  `idle` and emit a startup-failed analytics event.
- `stop()`: cancels timer, clears cached display/content, state → `idle` **unless** state
  is `paused` (paused survives stop so auto-resume works).
- Each capture tick is skipped unless state is `capturing` and a display is cached.
- Capture error handling: if the capture API reports a stream/display error, refresh the
  display list before the next tick (prefer `requestedDisplayID`, then current ID, then
  first display). Frames are simply dropped on error — no retry within a tick.

The recorder subscribes to the app-wide `isRecording` flag (§4.6): flag true → `start()`,
false → `stop()`; turning recording off while `paused` also clears paused → `idle`.

### 1.6 Multi-display handling (ActiveDisplayTracker)

Dayflow records **one display at a time**: the display the mouse cursor is on.

Tracker algorithm:

| Tunable | Value |
|---|---|
| Poll rate | **0.1 Hz = one poll every 10 s** (battery: 6 Hz was 21,600 wakeups/hour) |
| Timer leeway | 10% of interval (allow OS coalescing) |
| Debounce | **400 ms** — a candidate display must still be under the cursor when the debounce time has elapsed; with 10 s polling this effectively means **2 consecutive polls** on the same display |
| Hysteresis inset | **10 px** — prefer the screen whose frame *inset by 10px* contains the cursor; fall back to exact containment. Prevents flapping at monitor borders |

- Poll: read global mouse position, find screen (with hysteresis), extract its display ID.
- If ID differs from current candidate → set candidate + timestamp, wait.
- If candidate stable ≥ debounce → publish new `activeDisplayID` (only if changed).
- On display-configuration change (monitors added/removed/re-arranged): reset debounce
  state and poll immediately.
- Runs continuously from recorder construction, independent of recording state.

Recorder reaction to a published change (`handleActiveDisplayChange`):
- Always store as `requestedDisplayID`.
- If not recording → defer (used at next start).
- If not currently `capturing` or no current display → defer.
- If same as current display → ignore.
- Else refresh display list asynchronously; the **next** screenshot uses the new display.
  No frame is taken at switch time.

Windows: track cursor with `GetCursorPos` + `MonitorFromPoint`, same
debounce/hysteresis, listen for `WM_DISPLAYCHANGE`/Electron `screen` events.

### 1.7 Privacy exclusions

Settings (UserDefaults → port to your settings store):

- `recordingPrivacyBlockedApplicationIdentifiers`: string array of blocked identifiers.
  Normalization: trim whitespace, lowercase, de-dupe preserving order. Text-editing UI
  round-trips this as newline-separated text.
- `recordingPrivacyDidSeedDefaultSecretApps` (bool): one-time seeding flag.

**Default seed** (run once): scan installed applications; block any whose *name*
(lowercased) is in this set — `1password, authy, bitwarden, dashlane, enpass, keeper,
keepassxc, keychain access, lastpass, ledger live, nordpass, passwords, proton pass,
secrets, trezor suite, yubico authenticator` — or whose *bundle identifier* (lowercased,
with `.`/`-`/`_` stripped) contains any of — `1password, authy, bitwarden, dashlane,
enpass, keeper, keepass, keychainaccess, lastpass, ledger, nordpass, passwords,
protonpass, secrets, trezor, yubico`. Seeded IDs are appended to any existing user list;
the flag is set even if nothing matched. On Windows, match by executable name / AppUserModelID.

**Match rule** at capture time: an app is blocked if its bundle identifier **or** its
display name, normalized (trimmed+lowercased), appears in the blocked set.

Two enforcement layers per screenshot, evaluated in order:

1. **Foreground-app redaction**: if the *frontmost* application is blocked, do not capture
   at all. Instead synthesize a placeholder JPEG at the exact capture size and save it
   through the normal path (registered in DB, idle seconds recorded):
   - Background fill: near-black gray (8% white, `#141414`-ish).
   - Title (semibold, white @ 82% alpha, font size `min(w,h) × 0.035`, shrink-to-fit down
     to 55% of start size, max text width `w × 0.82`, vertically centered offset +18 px):
     `"<App name> hidden by your privacy settings"` (fallback name `"Private app"`).
   - Subtitle (same style, size `min(w,h) × 0.018`, offset −26 px):
     `"This screenshot was saved without the app's contents because you blocked it from recording."`
2. **Window exclusion**: otherwise, build the capture with all blocked applications'
   windows excluded from the frame (macOS content filter). On Windows there is no direct
   OS-level per-app exclusion for full-screen duplication; acceptable ports: skip layer 2
   and rely on layer 1, or enumerate windows of blocked processes and black out their
   rects post-capture. Document whichever you choose.

### 1.8 Permission loss handling

If screen-recording permission is missing at setup, at capture, or on refresh:
- Stop timer, clear cached display state, state → `idle`.
- Set `wantsRecording = false`.
- Set the app-wide recording flag off with analytics reason `"permission_missing"`, **without
  persisting** the off state (so the user's saved preference survives).
- Post a "screen recording permission" notice event for the UI (reason string identifies
  the call site, e.g. `setupCapture`, `captureScreenshot_failed_permission`).

(Windows has no screen-recording permission for desktop apps; keep the hook for parity/
future, likely a no-op.)

### 1.9 Sleep / lock / screensaver (system pause)

Registered system events and behavior:

| Event | Behavior |
|---|---|
| System will sleep | If recording flag is on: state → `paused` ("system sleep"); stop capture; analytics `recording_stopped` reason `system_sleep` (1% sampled) |
| System did wake | If state is `paused`: **resume after 5 s delay**, re-checking that the recording flag is still on at fire time |
| Screen locked | Same as sleep; reason `lock` |
| Screen unlocked | If `paused`: resume after **0.5 s** |
| Screensaver started | Same as sleep; reason `screensaver` |
| Screensaver stopped | If `paused`: resume after **0.5 s** |

Key semantics: `paused` is a *system* pause that auto-resumes; it never clears the user's
recording preference. Resume = `start()` (full re-setup, so display list is re-enumerated).
Windows equivalents: `SM_SESSION_LOCK/UNLOCK` via `WTSRegisterSessionNotification`,
power broadcast `PBT_APMSUSPEND/PBT_APMRESUMEAUTOMATIC`, or Electron `powerMonitor`
(`suspend`, `resume`, `lock-screen`, `unlock-screen`).

---

## 2. Pause / resume, idle detection, shortcut tracking

### 2.1 User pause (PauseManager) — exact durations

`PauseDuration` options: **15 minutes (900 s), 30 minutes (1800 s), 1 hour (3600 s),
indefinite (no timer)**. There is **no "until tomorrow"** option. Analytics values:
`15_mins`, `30_mins`, `1_hour`, `indefinite`.

Pause sources: `menu_bar`, `main_app`, `deeplink`.
Resume sources: `user_menu_bar`, `user_main_app`, `timer_expired`, `wake_from_sleep`.

`pause(duration, source)`:
1. Clear any existing pause state (timer, end time, indefinite flag).
2. Timed → `pauseEndTime = now + interval`, start a **1 s** repeating timer (must fire in
   modal/menu run loops too) that (a) pushes a UI tick for the countdown and (b) resumes
   when `now >= pauseEndTime` with source `timer_expired`.
   Indefinite → `isPausedIndefinitely = true`, no timer.
3. Turn the recording flag off with analytics reason = source.
   **Persistence rule**: persist the off state **only for indefinite** pause. Timed pauses
   do NOT persist, so an app restart mid-15-min-pause comes back recording.
4. Analytics `recording_paused {source, pause_type}`.

`resume(source)`: clear pause state, set recording flag on (persisted), analytics
`recording_resumed {source, was_timed, original_pause_type}`.

Countdown display: `remainingSeconds = ceil(endTime - now)`, formatted `M:SS`
(e.g. `14:59`); nil when not on a timed pause.

Wake handling (separate from the recorder's): on system wake, if a timed pause's end time
has already passed, auto-resume with source `wake_from_sleep`. Indefinite pause stays
paused across sleep.

Timed pause state is **session-local** (not persisted); indefinite pause persists via the
persisted recording=off preference.

### 2.2 Recording control facade (RecordingControl)

Derived mode for UI, in priority order:
1. `pauseEndTime != nil` → `pausedTimed(endTime)`
2. `isPausedIndefinitely` → `pausedIndefinite`
3. `isRecording` → `active`, else `stopped`

Invariant (assert in debug): recording flag on while pause metadata set is a bug; treat as
`active`.

- `start(reason)`: preflight capture permission (on Windows can be a no-op returning true);
  if missing, post permission notice and ignore. Else clear pause state, set recording on.
- `stop(reason)`: clear pause state, set recording off.
- Both clear pause state so pause and manual toggle can't get out of sync.

### 2.3 Idle / inactivity detection (InactivityMonitor)

**Purpose: UI "idle reset", NOT recording control.** When the user has not interacted with
the *Dayflow app itself* for the threshold, a `pendingReset` flag is published; views react
(e.g. reset navigation/scroll state) and call `markHandledIfPending()` to clear it.
Recording continues regardless. (Recording-level idleness is handled downstream by the
idle-batch classifier, §3.4, using OS-global idle seconds captured per screenshot.)

| Constant | Value |
|---|---|
| Default threshold | **15 min (900 s)** |
| Override key | `idleResetSecondsOverride` (double, seconds, `> 0` wins) |
| Legacy key | `idleResetMinutes` (int minutes, used if override unset) |
| Check timer interval | `clamp(threshold / 2, 5 s, 60 s)` |

- Interaction events monitored (app-local only): key down, left/right/other mouse down,
  scroll wheel. Any of these updates `lastInteractionAt` and clears `lastResetAt`.
- Timer runs **only while the app is active/focused** (started on did-become-active,
  stopped on resign-active); an immediate check also runs on will-become-active so a reset
  is detected the moment the user returns.
- Trigger condition: `now - lastInteractionAt >= threshold`, AND not already pending, AND
  (no previous reset OR `now - lastResetAt >= threshold` — re-arm throttle).

### 2.4 Screenshot shortcut tracking (ScreenshotShortcutTracker)

**Pure analytics heuristic — no functional effect.** A local key-down monitor (only when
the app is active/focused) detects the macOS screenshot shortcuts:

- Required modifiers: Cmd+Shift (Ctrl additionally allowed; any other modifier disqualifies).
- Keys: `3`, `4`, `5` (macOS keycodes 20/21/23).
- Ctrl present ⇒ "copies to clipboard" variant.
- Emits analytics event `screenshot_taken` with
  `{source: "keyboard_shortcut_heuristic", shortcut: "cmd_shift_3|4|5" or "cmd_shift_ctrl_…", copies_to_clipboard}`.

Windows port: equivalent would be Win+Shift+S / PrtScn detection; optional — port only if
you keep the analytics event. Started at app launch, stopped at termination.

---

## 3. AnalysisManager — batching, statuses, retries, cards

### 3.1 Scheduler

| Constant | Value |
|---|---|
| Check interval | **60 s** repeating timer (plus one immediate run when the job starts) |
| Job start | **2 s after app launch** (delayed so init completes) |
| Lookback | **24 h** — screenshots older than `now − 86400 s` are never batched |
| Reentrancy | single `isProcessing` guard; overlapping triggers are dropped, all work on one serial utility queue |

`triggerAnalysisNow()` may also be called manually; same guard applies.

### 3.2 Batch formation algorithm (exact)

Config (from `BatchingConfig.standard`; providers may substitute — the standard values are):

| Constant | Value |
|---|---|
| `targetDuration` | **15 min (900 s)** |
| `maxGap` | **2 min (120 s)** |
| `cardLookbackDuration` | **45 min (2700 s)** (used in §3.6, not in batching itself) |

Each scheduler tick:

1. **Fetch unprocessed screenshots**:
   ```sql
   SELECT * FROM screenshots
   WHERE captured_at >= :now_minus_24h
     AND is_deleted = 0
     AND id NOT IN (SELECT screenshot_id FROM batch_screenshots)
   ORDER BY captured_at ASC
   ```
   "Processed" = *assigned to any batch*, regardless of that batch's outcome. A failed
   batch's screenshots are never re-batched automatically.

2. **Group into buckets** (screenshots sorted ascending by `captured_at`):
   - Start a bucket with the first screenshot.
   - For each next screenshot compute:
     - `gap = candidate.captured_at − bucket.last.captured_at`
     - `currentDuration = candidate.captured_at − bucket.first.captured_at`
   - If `gap > 120` **or** `currentDuration > 900`: close the bucket (batch range =
     first..last captured_at of the bucket, **excluding** the candidate) and start a new
     bucket with the candidate. Otherwise append.
   - Flush the trailing bucket at the end.
   - Consequence: a closed batch's first-to-last span is ≤ 900 s (the screenshot that would
     push past 900 starts the next batch).

3. **Hold back the newest batch**: if the *last* bucket's span `< 900 s`, drop it — it is
   still accumulating and will be re-formed on a later tick. So a batch is only persisted
   once ≥ 15 min of near-contiguous data exists **or** a > 2-min gap (or the 24 h window)
   sealed it earlier. Note: a short bucket sealed by a *gap* is still persisted (only the
   final/most-recent bucket is held back); short sealed batches get `skipped_short` in §3.3.

4. **Persist each batch**:
   ```sql
   INSERT INTO analysis_batches(batch_start_ts, batch_end_ts) VALUES (?, ?);
   -- then for each screenshot id:
   INSERT INTO batch_screenshots(batch_id, screenshot_id) VALUES (?, ?);
   ```
   `batch_start_ts`/`batch_end_ts` = first/last screenshot `captured_at` (Unix seconds).
   New rows default to status `'pending'`. Table also carries `status`, `reason` (failure
   text), `llm_metadata` (JSON array of LLM call logs).

5. **Queue LLM processing** for each new batch id (sequentially, same tick).

### 3.3 Batch status state machine

Statuses observed in code (strings in `analysis_batches.status`):

```
pending ──▶ processing ──▶ analyzed ──▶ completed        (normal success)
   │            │
   │            └────────▶ failed                        (LLM error; reason set)
   ├──▶ failed_empty                                     (batch has no screenshots)
   ├──▶ skipped_short                                    (span < 5 min)
   └──▶ analyzed  (reason 'idle_shortcut_applied')       (idle shortcut, LLM skipped)
```

- `pending`: initial, and the reset target for reprocessing.
- `failed_empty`: set in `queueLLMRequest` when the batch resolves to zero screenshots.
- `skipped_short`: set when `last.captured_at − first.captured_at < 300 s` (**5 min**).
- `processing`: set by AnalysisManager just before invoking the LLM service; the LLM
  service also sets it again internally (harmless double-write).
- `analyzed`: set by the LLM service on success (including the zero-observations success
  path) and by the idle shortcut.
- `completed`: set by AnalysisManager on top of `analyzed` when the LLM callback reports
  success. (Idle-shortcut batches stay `analyzed`.) Treat `completed` and `analyzed` as
  equivalent success states everywhere.
- `failed`: set with `reason = error.localizedDescription`.
- Terminal states recognized by the reprocessing pollers: `completed`, `analyzed`,
  `failed`, `failed_empty`, `skipped_short`.
- Status writes go through an async DB write queue — they are eventually consistent, and
  pollers must tolerate a short lag after queueing.

**Retry policy: there is NO automatic retry.** A `failed` batch stays failed (an error
card occupies its time range, telling the user it can be reprocessed). Retry is entirely
user-driven via the reprocessing APIs (§3.7).

### 3.4 Idle-batch shortcut (pre-LLM classifier)

Before calling the LLM, `queueLLMRequest` checks whether the whole batch was idle time and,
if so, writes an "Idle" timeline card directly, skipping the LLM.

`IdleBatchRules` constants:

| Rule | Value |
|---|---|
| Classifier version tag | `"idle_v1"` |
| Minimum eligible batch span | **12 min (720 s)** |
| Required coverage ratio | **≥ 0.95** |
| Required qualified-idle ratio | **≥ 0.90** |
| Required idle-sample availability ratio | **≥ 0.90** |
| Qualifying idle seconds per screenshot | **≥ 60 s** |
| Max allowed uncovered gap | **≤ 30 s** |
| Merge gap with previous idle card | **< 5 min (300 s)** |

Assessment (returns nil = not idle, proceed to LLM):

1. Sort screenshots ascending; batch span = `last − first`; require span ≥ 720 s.
2. Idle samples = screenshots with `idle_seconds_at_capture > 0`. Require at least one.
3. Build coverage segments: for each idle sample, segment
   `[captured_at − idle_seconds, captured_at]` clipped to `[batchStart, batchEnd]`;
   sort by start (then end) and merge overlapping/touching segments.
4. `coveredSeconds` = total merged length; `coverageRatio = covered / span`.
5. Uncovered gaps = complement of merged coverage within the batch;
   `largestUncoveredGapSeconds` = max gap length (0 if none).
6. `qualifiedIdleRatio` = (# screenshots with idle ≥ 60 s) / (total screenshots).
7. `idleSampleAvailabilityRatio` = (# idle samples) / (total screenshots).
8. Pass iff coverage ≥ 0.95 AND qualifiedIdleRatio ≥ 0.90 AND availability ≥ 0.90 AND
   largest gap ≤ 30 s. Also compute min/median/mean/max idle values for metadata.

If passed, `handleIdleBatch`:

1. **Merge candidate**: fetch the last timeline card ending before the batch start. Merge
   iff `0 ≤ (batchStart − card.endTs) < 300 s`, the card is in the same logical day (4 AM
   boundary, §3.8), and its category and title both normalize (trim+lowercase) to
   `"idle"`. If merging, the new card's start = the previous card's start (the previous
   card is replaced).
2. Build the idle card:
   - `startTimestamp`/`endTimestamp`: local-time strings, format **`h:mm a`**
     (POSIX/invariant locale, local time zone), e.g. `"3:07 PM"`.
   - category `"Idle"`, subcategory `""`, title `"Idle"`.
   - summary `"You were idle during this period."`
   - detailedSummary `"Idle period. Dayflow skipped activity summarization for this block."`
   - `idleMetadata`: classifier version, coverage ratio, covered seconds, span, largest
     gap, screenshot counts, avg/max idle seconds, merged flag, merge gap, `skippedLLM: true`.
3. Atomically replace all timeline cards in `[replacementStart, batchEnd]` with this card
   (bound to the batch id); delete replaced cards' timelapse video files from disk.
4. Batch status → `analyzed` with reason `idle_shortcut_applied`; passive WAL checkpoint;
   analytics event with the full assessment.
5. If the replace inserted nothing (failure), fall through to **normal LLM processing**
   (with an analytics `analysis_batch_idle_shortcut_persist_failed`).

### 3.5 Observations → timeline cards flow (LLMService.processBatch contract)

Even though provider internals are out of scope, the pipeline contract the port must keep:

1. Look up batch (`batch_start_ts`, `batch_end_ts`); missing batch → error.
2. Status → `processing`.
3. Load the batch's screenshots (join via `batch_screenshots`, `is_deleted = 0`,
   ordered by `captured_at`); zero screenshots → error.
4. **Transcribe**: send screenshots to the provider → list of `Observation`s
   (per-interval descriptions of what the user did). Persist them:
   `saveObservations(batchId, observations)` (table `observations`, keyed by `batch_id`,
   with time ranges — reprocessing deletes by `batch_id`).
5. If zero observations: batch → `analyzed`, succeed with 0 cards (no card mutation).
6. **Sliding-window card generation**:
   - `currentTime = batch_end_ts`; `windowStart = currentTime − 45 min` (`cardLookbackDuration`).
   - Fetch ALL observations in `[windowStart, currentTime]` (not just this batch's) and all
     existing timeline cards overlapping that window.
   - Ask the provider to generate a fresh set of activity cards for the window, given
     (batch observations, existing cards as context, current time, user's category
     definitions).
   - Card time fields are **strings** `"h:mm a"` (e.g. `"3:07 PM"`) — see §3.9.
7. **Atomic replacement**: `replaceTimelineCardsInRange(windowStart, currentTime, newCards,
   batchId)` — deletes any card overlapping the window and inserts the new ones in a single
   transaction, returning (insertedCardIds, deletedVideoPaths). Old cards therefore stay
   visible until the new ones land. Delete the returned timelapse files from disk.
   Cards store: start/end strings, derived `startTs`/`endTs` + logical `day` (4 AM rule),
   category, subcategory, title, summary, detailedSummary, distractions (JSON), appSites,
   optional video summary URL, `batchId` (for retry), optional `isBackupGenerated` flag
   (set when a backup provider or local fallback produced the cards).
8. Batch → `analyzed`; passive WAL checkpoint; success callback with (cards, cardIds).
9. **On any error**: batch → `failed` (reason = error text); emit a failure toast event;
   build an **error card** spanning `[batch_start, batch_end]`:
   - category `"System"`, subcategory `"Error"`, title `"Processing failed"`,
   - summary: `"Failed to process <N> minutes of recording from <start> to <end>. <human-readable cause> Your recording is safe and can be reprocessed."`
   - detailedSummary includes the raw error and note that the batch can be reprocessed
     from Settings;
   - atomically replace cards in the batch range with this error card; delete replaced
     timelapse files; then report failure to the caller.

AnalysisManager's completion handler then:
- success → status `completed`; if the "save all timelapses to disk" preference is on,
  asynchronously generate a timelapse per inserted card: fetch screenshots in
  `[card.startTs, card.endTs]`, composite at **fps 2, compressed timeline** (§5) to
  `Application Support/Dayflow/timelapses/yyyy-MM-dd/<cardId>_timelapse.mp4`, then store the
  path on the card.
- failure → `markBatchFailed` again with the reason (idempotent double-write with §step 9).

### 3.6 Timing rules summary (what triggers what, exactly)

- Screenshot every 10 s (configurable).
- Analysis pass every 60 s.
- A batch is created when ≥ 15 min of screenshots (max internal gap 2 min) have
  accumulated beyond the last batched screenshot — so cards trail real time by ~15–16 min —
  or earlier when a > 2 min gap seals a bucket (which is then processed immediately, and
  skipped as `skipped_short` if < 5 min).
- Batches < 5 min → `skipped_short` (no LLM, no card).
- Batches ≥ 12 min that are ~fully idle → direct Idle card (no LLM).
- Card generation reconsiders a 45-min lookback window each batch, so each new batch can
  rewrite/merge the previous ~3 batches' cards.
- 24 h max lookback for unbatched screenshots.

### 3.7 Reprocessing APIs

All run on the serial analysis queue; progress is reported via callback strings/steps.

**`reprocessDay(day)`** (day = `"yyyy-MM-dd"` logical day):
1. Delete all timeline cards for the day (returns their timelapse paths) and delete those
   video files.
2. Collect the day's batch ids (day window = 4 AM local → next 4 AM, batches with
   `batch_start_ts >= start AND batch_end_ts <= end`). None → succeed early.
3. `DELETE FROM observations WHERE batch_id IN (…)`.
4. Reset statuses: batches in the day window with status IN
   (`completed`,`failed`,`processing`,`analyzed`) → `pending`, clearing `reason` and
   `llm_metadata`. (Note: `failed_empty`/`skipped_short` are NOT reset.)
5. For each batch id sequentially: queue LLM processing, then **poll every 2 s** until
   status is terminal (`completed|analyzed|failed|failed_empty|skipped_short`).
6. Emit a timing summary (per-batch durations, average, total).

**`reprocessSpecificBatches(batchIds)`**: same shape, but: filter ids to existing batches;
do NOT pre-delete timeline cards (the atomic range replacement keeps the old card visible
until new ones are ready); delete observations for the ids; reset those ids (any status)
to `pending`; process only the ids that actually reset; sequential + 2 s polling; summary.

**`reprocessBatch(batchId, stepHandler)`**: single-batch variant that passes the LLM
step-progress handler through (steps: transcribing → generating cards) and completes with
the batch result; delete observations + reset status first; error if the reset touched
nothing.

### 3.8 Logical day: the 4 AM boundary

`getDayInfoFor4AMBoundary()` — used for card `day` fields, recaps, journal, reprocessing:

- Compute 4:00:00 AM local of the timestamp's calendar date.
- If the timestamp is **before** 4 AM, the logical day started at 4 AM the **previous**
  date; else at 4 AM the same date. End = start + 1 day.
- `dayString` = `yyyy-MM-dd` of the logical start date (local time).
- Fallback (only if 4 AM computation fails): standard midnight day.

### 3.9 TimeParsing — exact formats

Timeline cards' start/end times are stored/exchanged as human strings. The single parsing
helper, `parseTimeHMMA(timeString) -> minutes since midnight (0–1439) | nil`:

- Input is trimmed and **uppercased** first (so `am`/`pm`/`Am` all work).
- Tried in order with the invariant (`en_US_POSIX`) locale:
  1. `h:mma`  — `9:30AM`, `09:30AM` (no space)
  2. `hh:mma` — `09:30AM`
  3. `h:mm a` — `9:30 AM`, `09:30 AM` (space)
  4. `hh:mm a`— `09:30 AM`
- First format that parses wins; result = `hour*60 + minute` (24 h hour extracted from the
  parsed date). Returns nil if none match.
- Generated timestamps (idle card, error card, LLM cards) use format **`h:mm a`** with
  POSIX locale and the **local** time zone, e.g. `3:07 PM`.
- Implied contract: these strings are date-less; the logical day (§3.8) disambiguates.
  Windows/TS port: a small regex `^\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*$` after
  trim+uppercase reproduces all four formats.

---

## 4. App lifecycle

### 4.1 Single instance / single window

- One main window (id `"main"`), min size **900×508**, default **1195×675** (a later
  modifier also sets 1200×800 — use ~1200×675–800), hidden title bar, resizable to
  content-min. "New Window" command removed — single-window app.
- **Soft quit**: attempts to quit (Cmd+Q / dock / menu) are cancelled unless an
  `allowTermination` flag is set; instead the app hides all windows and drops to
  tray/menu-bar-only mode, keeping the status item and all background tasks (recorder,
  analysis) running. `allowTermination` is set true on OS power-off/logout notification
  and by the "Reset Onboarding" flow before programmatic termination.
- Electron port: `window.on('close')` → `preventDefault` + hide to tray;
  `before-quit`/`session-end` sets the allow flag; use `app.requestSingleInstanceLock()`
  for single-instancing (macOS gets this for free; Windows must do it explicitly — a
  second launch should focus the existing instance and forward its deep-link argv).

### 4.2 Startup sequence (order matters)

1. Migrate legacy settings; block termination; apply dock icon preference
   (`showDockIcon`, default true → taskbar visibility on Windows).
2. Init crash reporting + analytics (opt-in gated); `app_opened {cold_start: true}`.
3. Start hourly heartbeat (§4.7), screenshot-shortcut tracker, CPU monitor (only if
   analytics opted in — toggled live when the preference changes).
4. App-updated check: compare build number to stored `lastRunBuild`; emit `app_updated`
   and store new build.
5. Create status bar (tray) controller; kick off async launch-at-login status refresh
   (§4.4); create the deep-link router — URLs that arrived before the router exists are
   queued and flushed later.
6. Seed the recording flag **false**, then construct the ScreenRecorder (so the first
   false→true transition reliably starts capture).
7. If onboarding is complete (or past the screen-permission step):
   - enable preference persistence (§4.6);
   - verify capture permission; on success restore saved preference (**default ON** if no
     saved value) with analytics reason `auto`; on failure force recording off without
     persisting and post the permission notice (only if fully onboarded).
   - flush queued deep links after this resolves.
   Else (early onboarding): keep recording off, don't persist, flush deep links.
8. **+2 s**: start the analysis job (§3.1); emit `analysis_job_started {provider}`.
9. Start InactivityMonitor, notification service (journal reminders), daily recap
   scheduler (checks **every 5 min**).
10. Subscribe to recording-flag changes for analytics (`recording_toggled
    {enabled, reason}`; reason `auto` is suppressed) and referral-usage accounting.
11. Register power-off observer (sets allowTermination) and foreground-session tracking
    (`app_foreground_session {duration_seconds}` on focus loss).

### 4.3 Termination

On real termination: SQLite WAL checkpoint with **truncate**; stop heartbeat timer, CPU
monitor, shortcut tracker, recap scheduler; remove observers; flush referral usage; if
onboarding incomplete emit `onboarding_abandoned {last_step}`; `app_terminated`; flush
analytics.

### 4.4 Launch at login

- Backed by the OS service (macOS `SMAppService.mainApp`); state is a published
  `isEnabled` bool.
- Status queries can block for 5+ s, so both the constructor and the launch-time
  bootstrap refresh **asynchronously** off the main thread; a synchronous `refreshStatus()`
  exists for after user actions (also used to re-sync if the user toggles it in system
  settings externally).
- `setEnabled(bool)`: no-op if unchanged; register/unregister; update state only on
  success; log failures (no throw to UI).
- There is **no default-on**: `bootstrapDefaultPreference()` only warms the cached status.
- Windows port: `app.setLoginItemSettings({openAtLogin})` /
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, with `getLoginItemSettings` as the
  external-change re-sync.

### 4.5 Deep links (`dayflow://`)

Router accepts any URL with scheme `dayflow` (case-insensitive). Action resolution:

1. Build a candidate list: URL **host** (if non-empty), then each **path component**.
2. If that list is empty, fall back to the `?action=` query parameter.
3. The **first** candidate is matched (case-insensitive) against:

| Action | Accepted identifiers | Behavior |
|---|---|---|
| Start recording | `start-recording`, `start`, `resume` | Ignored if mode is already `active`. Else `RecordingControl.start(reason: "deeplink")` — permission preflight, clears any pause, recording on |
| Stop recording | `stop-recording`, `stop`, `pause` | Ignored if mode is already `stopped`. Else `RecordingControl.stop(reason: "deeplink")` — clears pause state, recording off (note: `dayflow://pause` is a full stop, not a timed pause) |
| Referral | `referral`, `claim`, `r` | Code from query `?code=` or `?ref=`, else the first path component with length ≥ 6; store as pending referral code. Missing code → log and drop |

Unmatched URLs → logged, return false. Examples: `dayflow://start-recording`,
`dayflow://stop`, `dayflow://referral?code=ABC123`, `dayflow://r/SOMECODE1`.
URLs received before initialization completes are queued and replayed (§4.2 steps 5/7).
Windows: register the `dayflow` protocol (`app.setAsDefaultProtocolClient`) and handle
both `second-instance` argv and `open-url`.

### 4.6 AppState (recording flag semantics)

- Single source of truth `isRecording` (observable). The recorder reacts to changes;
  everything else (pause manager, deep links, tray, UI toggles) goes through
  `setRecording(enabled, analyticsReason:, persistPreference: = true)`.
- Persistence to settings key `"isRecording"` happens only when (a) persistence has been
  enabled (post-onboarding) and (b) the specific set didn't opt out
  (`persistPreference: false` — used for timed pauses, permission failures, auto flows).
- `analyticsReason` is stashed and consumed exactly once by the analytics observer
  (`consumePendingRecordingAnalyticsReason`, default `"unknown"`).
- Also tracks current UI tab / timeline mode for heartbeat enrichment.

### 4.7 Heartbeat & CPU monitor (telemetry parity, optional)

- Heartbeat: every **1 h** (+ once at launch): `app_heartbeat {session_hours (0.1
  precision), cpu buckets (current/avg/peak), cpu_sample_count, cpu_sampler_interval_s,
  current_tab, timeline_mode}`; also flushes referral usage (only counted when ≥ 60 s of
  recording accumulated; idempotency key `mac-<reason>-<startTs>-<seconds>`).
- ProcessCPUMonitor: samples **every 30 s** (sum of per-thread CPU% excluding idle
  threads); keeps rolling total/peak/count reset at each heartbeat snapshot; a sample
  ≥ **150%** emits `app_cpu_spike`, throttled to at most one per **15 min**. Runs only
  while analytics is opted in. Windows: `Process.GetCurrentProcess` CPU deltas or
  `pidusage`.

---

## 5. VideoProcessingService (timelapse compositing)

Composites stored screenshots into an MP4. Used for (a) per-card saved timelapses
(fps 2), (b) Gemini provider input (video required), (c) legacy URL-based paths (fps 10).
Windows port: ffmpeg (`-framerate`, `image2pipe` or concat demuxer + `-vf scale/pad`).

### 5.1 Encoding defaults (`VideoEncodingOptions.default`)

| Option | Default |
|---|---|
| Container | MP4 |
| Codec | **H.264** (High profile, auto level); HEVC supported as an option |
| Average bitrate | **2,000,000 bps** (clamped to ≥ 100,000) |
| Keyframe interval | **10 s** → max keyframe interval = `fps × 10` frames |
| `maxOutputHeight` | nil (no downscale) — when set, downscale keeping aspect if source is taller |
| `frameStride` | 1 (take every screenshot; `n` takes every n-th, starting at index 0) |
| Pixel format | 32-bit ARGB intermediate |

### 5.2 Timeline modes

`generateVideoFromScreenshots(screenshots, outputURL, fps = 1, useCompressedTimeline = true, options)`:

- **Compressed** (default): frame *i* is presented at `i / fps` seconds; e.g. fps 2 ⇒ one
  screenshot every 0.5 s of video. Saved card timelapses use **fps 2, compressed**.
- **Real timeline**: frame presented at `capturedAt − firstCapturedAt` seconds (real
  spacing; 10 s between frames by default capture cadence).
- Presentation timescale 600.

### 5.3 Compositing rules

- Canvas size = first decodable screenshot's dimensions (both forced even, min 2),
  optionally downscaled to `maxOutputHeight`.
- Every frame is drawn **aspect-fit, centered** on a **black** canvas
  (letterbox/pillarbox) — mixed-resolution screenshots (display switches!) never distort.
- Undecodable images are skipped (counted, logged), not fatal.
- Output directory is created if needed; an existing file at the output path is deleted
  first. Empty input (or all frames skipped before sizing) → error.

### 5.4 Output locations

- Persistent timelapses: `Application Support/Dayflow/timelapses/<yyyy-MM-dd>/<name>_timelapse.mp4`
  (date directory from the card's start date; on directory-creation failure falls back to
  the root with the same filename). `<name>` = timeline card id for saved card timelapses.
- URL-based overload (legacy): recovers timestamps from `yyyyMMdd_HHmmssSSS` filenames,
  else assumes 10 s spacing counting back from now; defaults to fps 10.

---

## 6. Storage quick reference (tables touched by this pipeline)

| Table | Columns used here |
|---|---|
| `screenshots` | `id`, `captured_at` (unix s), `file_path`, `file_size`, `idle_seconds_at_capture` (nullable), `is_deleted` |
| `analysis_batches` | `id`, `batch_start_ts`, `batch_end_ts`, `status` (default `pending`), `reason`, `llm_metadata` (JSON) |
| `batch_screenshots` | `batch_id`, `screenshot_id` |
| `observations` | at least `batch_id` + time range + text (deleted by `batch_id` on reprocess; queried by time range for the 45-min window) |
| `timeline_cards` | start/end display strings (`h:mm a`), `startTs`/`endTs`, `day` (`yyyy-MM-dd`, 4 AM rule), category, subcategory, title, summary, detailedSummary, distractions, appSites, video summary path, `batchId`, `isBackupGenerated`, idle metadata |
| legacy | `batch_chunks` + chunk tables exist but are dead code for the current pipeline |

DB behaviors to replicate: WAL journal mode; passive checkpoint after each batch
completes; truncate checkpoint at app exit; status/failure writes on a background write
queue (non-blocking, slightly deferred).

---

## 7. Constants master list

| Constant | Value | Where |
|---|---|---|
| Screenshot interval | 10 s (key `screenshotIntervalSeconds`) | recorder |
| Screenshot target height | 1080 px (even), width even | recorder |
| JPEG quality | 0.85 | recorder + privacy placeholder |
| Screenshot filename | `yyyyMMdd_HHmmssSSS.jpg` | storage |
| Setup retries (no display) | 4 attempts, delay = attempt# seconds | recorder |
| Wake resume delay | 5 s | recorder |
| Unlock / screensaver-stop resume delay | 0.5 s | recorder |
| Display poll rate | 0.1 Hz (10 s) with 10% leeway | display tracker |
| Display debounce | 400 ms | display tracker |
| Display hysteresis inset | 10 px | display tracker |
| Pause durations | 900 s / 1800 s / 3600 s / indefinite | pause manager |
| Pause countdown tick | 1 s | pause manager |
| Idle-reset threshold | 900 s (keys `idleResetSecondsOverride`, legacy `idleResetMinutes`) | inactivity monitor |
| Idle-reset check interval | clamp(threshold/2, 5 s, 60 s) | inactivity monitor |
| Analysis check interval | 60 s | analysis manager |
| Analysis job start delay | 2 s after launch | app delegate |
| Analysis lookback | 24 h | analysis manager |
| Batch target duration | 900 s | batching config |
| Batch max gap | 120 s | batching config |
| Card lookback window | 2700 s (45 min) | LLM card generation |
| Minimum batch for LLM | 300 s (else `skipped_short`) | analysis manager |
| Idle batch min span | 720 s | idle rules |
| Idle coverage ratio | ≥ 0.95 | idle rules |
| Idle qualified ratio | ≥ 0.90 (idle ≥ 60 s each) | idle rules |
| Idle sample availability | ≥ 0.90 | idle rules |
| Idle max uncovered gap | 30 s | idle rules |
| Idle merge gap | < 300 s | idle rules |
| Reprocess poll interval | 2 s | analysis manager |
| Card time format | `h:mm a` POSIX, local tz; parse also accepts `h:mma`, `hh:mma`, `hh:mm a` | time parsing |
| Logical day boundary | 4:00 AM local | date helpers |
| Timelapse fps (saved cards) | 2, compressed timeline | analysis manager |
| Timelapse default bitrate | 2 Mbps (min clamp 100 kbps) | video service |
| Timelapse keyframe interval | 10 s | video service |
| Legacy URL-timelapse fps | 10 | video service |
| Heartbeat interval | 3600 s | app delegate |
| Recap scheduler check | 300 s | app delegate |
| CPU sample interval | 30 s | CPU monitor |
| CPU spike threshold / throttle | 150% / 900 s | CPU monitor |
| Referral usage min report | 60 s | app delegate |
| Main window min / default | 900×508 / 1195×675 | app scene |
| Default secret-app names | see §1.7 list | privacy prefs |
| Settings keys | `screenshotIntervalSeconds`, `isRecording`, `showDockIcon`, `didOnboard`, `lastRunBuild`, `idleResetSecondsOverride`, `idleResetMinutes`, `recordingPrivacyBlockedApplicationIdentifiers`, `recordingPrivacyDidSeedDefaultSecretApps` | various |
