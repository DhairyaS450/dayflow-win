# Dayflow → Windows Port: Daily & Journal UI Spec

Source: Dayflow macOS app (MIT), `Dayflow/Dayflow/Views/` — extracted verbatim from Swift source at
`C:\Coding\Dayflow\Dayflow\Dayflow\Views\` (UI/Daily*, UI/Journal*, Components/Day*, Components/*Card*,
Components/ConfettiBurstView, Models/DayGoalPlan, Core/Recording/JournalDayManager, Core/AI/DailyRecapModels,
Core/Access/FeatureAccessRequirements). The implementer does NOT need the Swift source; everything required is here.

Conventions used in this doc:
- All colors are given as hex (`#RRGGBB`) with opacity noted separately when < 1. Colors given in the source as
  `Color(red: r, green: g, blue: b)` have been converted to hex (rounded); the original rgb triple is shown where
  precision matters.
- "×s" means multiplied by the Daily view layout scale `s = 1.1` (a global constant — see §2.3). All Daily
  dimensions in the source are written `N * scale`; here shown as `N×s` with the resolved px in parentheses.
- SwiftUI `Capsule` = fully-rounded pill (border-radius: 9999px). `RoundedRectangle(cornerRadius: N, style: .continuous)`
  ≈ CSS `border-radius: Npx` (continuous/squircle corners; plain `border-radius` is an acceptable approximation).
- SF Symbols used (`checkmark`, `arrow.clockwise`, `gearshape.fill`, `plus`, `xmark`, `info.circle`, `lightbulb`,
  `circle`, `checkmark.circle.fill`, `exclamationmark.circle`, `arrow.left`, `chevron.left/right`, `sun.max.fill`)
  need equivalent icons (e.g., Lucide) on Windows.
- Bundled image assets referenced: `JournalPreview` (full-bleed background screenshot of the Daily UI, used behind
  lock screens), `JournalLock` (lock-card artwork w/ gradient + padlock baked in), `Copy`, `LeftArrow`, `RightArrow`,
  `JournalArrow`, `JournalReminderIcon`, `DayGoalFocus`, `DayGoalDistraction`, `DistractionSummaryIcon`. These must
  be copied from the repo's asset catalog or redrawn.

---

## 1. Shared foundations

### 1.1 Fonts

| Family | Usage |
|---|---|
| **InstrumentSerif-Regular** | All serif headings ("Your workflow…", section titles, date titles, big numbers) |
| **InstrumentSerif-Italic** | "Dayflow Daily" / "Dayflow Journal" lock-screen wordmarks |
| **Figtree** Regular / Medium / SemiBold / Bold | All body text, buttons, labels, chips |
| **Nunito** Bold | Only: goal-header metric value when past target/budget (`GoalMetricSummaryText` prominent mode) |
| `FigtreeSans-Regular` / `FigtreeSans-SemiBold` | Donut-chart legend only (in practice identical to Figtree; safe to substitute Figtree) |

Note: source sometimes writes `Figtree` + `.weight(.medium/.semibold/.bold)` and sometimes `Figtree-Medium` etc. —
same result. Wheel-picker digits use `monospacedDigit`. Whole app surface forces **light color scheme**
(`.environment(\.colorScheme, .light)`) — do not theme dark.

### 1.2 Global button interaction styles

- **DailyCopyPressButtonStyle**: on press, scale to **0.97**, `easeOut 0.14s`.
- **DayflowPressScaleButtonStyle(pressedScale: 0.97)**: same idea, used by nav arrows, goal buttons.
- **hoverScaleEffect(scale: 1.02)**: scale 1.02 on hover.
- **pointingHandCursor**: cursor: pointer on hover (disabled when button disabled).
- **JournalPillButtonStyle** (Journal CTA pills): font Figtree-SemiBold 16 (overridable), text `#2E1C0F`
  (rgb 0.18,0.11,0.06) @ 80% opacity, padding 18h/9v (overridable), background `#FFF5EB` (rgb 1,0.96,0.92) @ 60%,
  border-radius 100, 1px stroke `#F2DBD6` (rgb 0.95,0.86,0.84) inset 0.5, press scale 0.96 spring(0.3, 0.6).
- **DayflowSurfaceButton** (lock screens): content colored `foreground @ 0.85`; padding configurable; hover:
  scale 1.02, translateY(-1px), brightness +0.02, shadow black 10%/8px y4 + black 6%/2px y1; press scale 0.985
  (spring 0.26/0.75, fires action after 80 ms); primary variant `showOverlayStroke`: inner stroke white 17% 1.5px
  inset 0.75; secondary variant (`isSecondaryStyle`): inner stroke `#402B00` (rgb 0.25,0.17,0) 1.5px + hard shadows
  (black 25% 0.25/y0.5, black 16% 0.5/y1, black 30% 6/y2).

### 1.3 Date/time semantics (critical — used everywhere)

- **4 AM day boundary**: a "timeline day" runs 04:00 → 04:00 next day. `getDayInfoFor4AMBoundary()`:
  if wall-clock < 4 AM, the day belongs to the *previous* calendar date. `dayString` = `yyyy-MM-dd` of the start.
- `normalizedTimelineDate(date)` = date at 12:00 noon (avoids DST/boundary arithmetic bugs).
- `timelineDisplayDate(from: date)` = noon-normalized date, **minus one day if current wall-clock hour < 4 and
  date is "today"** (so at 2 AM the app still shows "yesterday" as the current day).
- `canNavigateForward(from date)` = `(date + 1 day) <= timelineToday` (day granularity). Forward nav is capped at
  timeline-today.
- **Card timestamps** are stored as `"h:mm a"` strings (e.g., `"9:05 AM"`). `parseTimeHMMA` → minutes since midnight
  (0–1439). Daily grid normalization: any minute **< 240 (i.e., 12:00–3:59 AM) gets +1440** (belongs to the end of
  the timeline day); if end ≤ start after that, end += 1440.
- Date formatters:
  - Daily title (today): `'Today,' MMMM d` → "Today, August 13"
  - Daily title (other): `EEEE, MMMM d` → "Wednesday, September 30"
  - Workflow section day: `EEE, MMM d` → "Wed, Sep 30"
  - Standup weekday: `EEEE` → "Wednesday"
  - Journal headline today: `"Today, " + MMMM d`; other days `EEEE, MMMM d`
  - Time labels: `h:mm a` (focus card, review card)

### 1.4 Duration formatting helpers (used repeatedly — match exactly)

- `formatDurationValue(minutes)` → `"1h 5m"` / `"2h"` / `"45m"` (rounded to whole minutes, min 0).
- `formatCount(n)` → `"1 time"` / `"3 times"`.
- Goal-flow long format → `"4 hours 30 minutes"` / `"1 hour"` / `"5 hours"` / `"45 minutes"`.
- DaySummary title-case → `"2 Hours 15 minutes"` / `"2 Hours"` / `"15 minutes"` / `"0 minutes"` (yes, only "Hours"
  is capitalized).
- DaySummary lowercase → `"2 hours 15 minutes"` / `"0 minutes"`.
- Goal header compact hours: whole hours → `"4"`, else 1-decimal `"4.5"`.
- Goal header used-duration: `<60m` → `"25 mins"`; whole hours → `"1 hour"`/`"3 hours"`; else `"1h 20m"`.
- Axis hour label: `9am`, `12pm`, `5pm` (lowercase am/pm, 12-hour, hour mod 24).

---

## 2. DAILY VIEW

Top-level component `DailyView(selectedDate: Binding<Date>)`. Two mutually exclusive surfaces:

```
if (hasDailyMinimumAccess && isUnlocked)  → unlockedContent (fade in)
else                                      → lockScreen (fade + slide from bottom)
```

- `isUnlocked` persists in app storage key **`isDailyUnlocked`** (bool).
- `hasDailyMinimumAccess` = completed analysis batches ≥ **20** (5 required hours × 60 / 15-minute batches).
  Refreshed on appear and every **30 s** (timer), also on app-activate.
- On appear: load persisted provider, refresh provider availability, check notification permission.
- If `isUnlocked` flips false, reset access flow to step `.intro`.

### 2.1 Access gating model (`FeatureAccessRequirements`)

- Batch duration: **15 minutes**. Daily requires **5 hours** → 20 batches. (Chat requires 10 h — not this spec.)
- `completedBatchCount()` = DB count of completed analysis batches (`countCompletedAnalysisBatchesForWeeklyAccess()`).
- Progress text (appended to the lock copy): capped at requirement;
  `0h / 5h` · `45m / 5h` · `3h / 5h` · `3h 15m / 5h`.

### 2.2 Lock screen (3-step flow)

Background: full-bleed `JournalPreview` image, `scaledToFill`, clipped, non-interactive. Content is centered,
padded 24 h / 28 v. Step transitions: spring(response 0.42, damping 0.88); intro exits toward leading edge,
later steps enter from trailing. Confetti overlay (§2.10) plays above everything (zIndex 10).

**Shared header (`DailyAccessHeaderView`)** — HStack(top, spacing 4):
- "Dayflow Daily" — InstrumentSerif-Italic 38, color `#59381F` (rgb 0.35,0.22,0.12).
- "BETA" badge — Figtree-Bold 11, white, padding 8h/4v, background `#FA8C33` (rgb 0.98,0.55,0.20) radius 6,
  **rotated −12°**, offset (−4, −4).

#### Step 1 — Intro (`DailyAccessIntroView`), VStack spacing 18
1. Header (above).
2. Beta notice — Figtree-Regular 15, `#59381F` @ 80%, centered, max-width 480, h-padding 24:
   > "Daily is a new way to visualize your day and turn it into a standup update fast."
3. Progress line — Figtree-SemiBold 13, `#59381F` @ 76%, centered, max-width 460:
   > "Daily unlocks after 5 hours of analyzed timeline data. {progressText}"
4. **Unlock button** (`DailyAnimatedRequestAccessButton`):
   - Label idle: "Unlock Daily" — Figtree SemiBold 15, white. Padding 26h/13v. Radius 10.
   - Fill: enabled idle `#402B00` (rgb 0.25,0.17,0); granted `#573D0D` (rgb 0.34,0.24,0.05); disabled
     `#AD9E8F` (rgb 0.68,0.62,0.56). Inner stroke white 16% 1.5px. Shadows black 8%/4 y2 + black 12%/8 y4.
   - Success ring: capsule stroke white 24% 1.5px around button; idle scale 0.96 opacity 0.65 → on success
     scale 1.08, opacity 0 (easeOut 0.24s).
   - On click (only if enough hours): state → granted (easeInOut 0.26s): label crossfades/slides (±5px y) to
     `✓ checkmark.circle.fill` + "Daily Unlocked", button scales to 1.015, confetti fires, then after **1.12 s**
     advances to next step. Disabled while granted.
   - If notification permission is already authorized, skips straight to Step 3 (provider); otherwise Step 2.

#### Step 2 — Notifications (`DailyNotificationOnboardingView`)
Header + a glassy panel (`DailyNotificationPermissionPanelView`), VStack spacing 16:
- Panel chrome: radius **28**, fill = linear-gradient topLeading→bottomTrailing [white @ 72% → `#FFEDE3`
  (rgb 1,0.93,0.89) @ 58%], stroke white @ 58% 1px, shadow black 8% blur 18 y8. Max width 560, padding 34h/30v.
- Title — InstrumentSerif-Regular 30, `#D9733F` (rgb 0.85,0.45,0.25), centered:
  > "Turn on notifications to unlock Daily"
- Body — Figtree-SemiBold 16, `#40261A` (rgb 0.25,0.15,0.10), centered, max 420:
  > "Dayflow uses notifications to tell you when your recap is ready."
- Status message — Figtree-Regular 14, `#59381F` @ 80%, centered, max 430. Exact strings by permission state:
  - denied: "Notifications are currently off for Dayflow. Enable them in System Settings to finish unlocking Daily."
  - authorized: "Notifications are already enabled. We'll open Daily automatically."
  - not determined (default): "Turn them on to continue. If you come back from System Settings, we'll check automatically."
- Primary button (DayflowSurfaceButton, bg `#402B00`, white, radius 10, pad 24h/12v, overlay stroke). Title by state:
  - checking/requesting: "Checking..." (disabled)
  - authorized: "Opening Daily..."
  - denied: "Open System Settings" (opens OS notification settings for the app)
  - otherwise: "Turn on notifications" (triggers OS permission prompt)
- Secondary button: "Recheck permissions" — Figtree SemiBold 14, secondary style: bg white @ 90%, text `#402B00`,
  border `#402B00` @ 16%, radius 10, pad 20h/11v.
- Auto-advance: when permission becomes authorized (poll on app activate / recheck), go to Step 3.

#### Step 3 — Provider (`DailyProviderOnboardingView`)
Header + panel (radius **24**, same gradient/stroke/shadow family: white 72% → `#FFEDE3` 58%, stroke white 58%,
shadow black 8%/14 y6; max width 460, padding 28h/24v), VStack spacing 12:
- Title — InstrumentSerif-Regular 24, `#59381F`, centered: **"Pick your Daily provider"**
- Sub — Figtree-Regular 13, `#59381F` @ 80%, centered, max 420:
  > "Choose how Daily generates your recap, or turn generation off. You can change this later."
- Small spinner (tint `#B46531`) while availability is refreshing.
- Provider option rows (spacing 6) — see §2.9 for the row spec and provider copy (this onboarding variant uses
  fonts 13/11 and unscaled paddings; otherwise identical to the in-app picker).
- Continue button: **"Continue to Daily"** — Figtree SemiBold 14, DayflowSurfaceButton bg `#402B00`, white,
  radius 10, pad 20h/10v. Disabled unless the selected provider is available (and availability has loaded).
- On continue: select today, reset standup state, unlock (spring 0.6/0.8), and if provider can generate,
  immediately kick off a standup regeneration (§2.8).

### 2.3 Unlocked layout

```
ScrollView (vertical, no indicators)
 └─ VStack(leading, spacing 20×s = 22)
     ├─ topControls          (date navigation row)
     ├─ workflowSection      (heading + grid card)
     ├─ actionRow            (copy / regenerate / provider buttons, right-aligned)
     └─ highlightsAndTasksSection ("Standup for …" + two joined cards)
```

- **Scale `s` = 1.1** (fixed). Max layout width **1320**; content width = `min(viewportWidth, 1320) − 2×16×s`
  (min 320), centered. Top inset `max(22, 20×s)=22`, bottom `16×s=17.6`, horizontal `16×s=17.6`.
- Two-column standup cards always (single-column flag exists but is hard-coded false).
- On date change: reload workflow + standup data; if the timeline day actually changed, cancel any in-flight
  regeneration. Listens for a `timelineDataUpdated` event carrying `dayString`; refreshes if it matches the
  selected day **or any of the 3 prior days** (source-day window).

#### 2.3.1 topControls — date navigation
Centered HStack(spacing 8×s):
- Left arrow button (`LeftArrow` asset), date title, right arrow (`RightArrow` asset; disabled when at today).
- Title: `dailyDateTitle` — "Today, August 13" or "Wednesday, September 30" — InstrumentSerif-Regular 26×s (28.6),
  color `#1E1B18`, 1 line, min-scale 0.75, **fixed width** = width of "Wednesday, September 30" at
  InstrumentSerif 26 + 6 (measured), ×s, centered (prevents arrows shifting).
- `DailyNavigationButton`: 30×s (33) circular hit area; arrow image 24×s (26.4); hover shows circle fill
  `#FFEBD3` @ 79% (easeOut 0.12s); disabled arrow opacity 0.35; press scale 0.97.
- Arrows shift `selectedDate` ±1 day (normalized to noon).

### 2.4 Workflow section (GitHub-style activity grid)

Heading (InstrumentSerif-Regular 24×s = 26.4, color `#B46531`), text depends on selected day:
- Today: **"Today so far. Come back tomorrow for the full day view."**
- Yesterday: **"Your workflow yesterday"**
- Else: **"Your workflow on {EEE, MMM d}"** (e.g., "Your workflow on Wed, Sep 30")

Card container (grid + divider + totals row):
- Fill white @ 78%, radius 4 (continuous), stroke `#E8E1DA` 1×s (min 0.7). Divider between grid and totals:
  1px line `#E5DFD9`. Totals row padding: 16×s h, 14×s top, 12×s bottom.
- Tooltips overlay anchored to hovered cell/marker (see §2.4.5).

#### 2.4.1 Timeline window & slots
- Defaults (no data): **09:00–21:00** (minutes 540–1260), slot = **15 min** → 48 columns.
- With data: `start = floor(firstUsedMinute/60)*60`; `end = max(start + 720, ceil(lastUsedMinute/60)*60)`
  (window ≥ 12 h, hour-aligned, extends to cover latest activity; early-morning minutes < 240 already +1440).
- Hour ticks: every hour from `floor(start/60)` to `ceil(end/60)` (min 2 ticks).
- `slotCount = round((end − start)/15)`, min 1.

#### 2.4.2 Rows
- One row per user category (ordered by category `order`), **excluding** the "System" category; plus any
  "unknown" categories present in the day's cards appended (sorted alphabetically by key). Category key =
  trimmed lowercased name. Cards with blank category → "Uncategorized".
- When the user has a category literally named "Distraction"/"Distractions", that category's **row is hidden**
  from the grid and replaced by the dedicated red distraction strip (§2.4.4).
- **Empty state (no rows at all)**: 4 placeholder rows named `Work, Personal, Distraction, Idle` with palette
  `#B984FF, #6AADFF, #FF5950, #A0AEC0` and zero occupancy (all cells appear as empty).
- Row color: category `colorHex` (strip `#`); unknown categories get a deterministic fallback via djb2 hash:
  `hash = 5381; for each utf8 byte: hash = hash*33 + byte; color = palette[abs(hash) % 4]` with palette
  `["B984FF","6AADFF","FF5950","A0AEC0"]`.

#### 2.4.3 Grid geometry & cells
| Metric | Value |
|---|---|
| Cell size | 18×s = **19.8 px** square |
| Cell gap (both axes) | 2×s = **2.2 px** |
| Cell corner radius | max(1.2, 2.5×s) = **2.75 px** |
| Left inset (before labels) | 36×s = 39.6 |
| Label column width | measured max row-name width at Figtree-Regular 12×s, +1, right-aligned |
| Label→grid spacing | 13×s = 14.3 |
| Right inset | 52×s = 57.2 |
| Top inset above grid | 25×s = 27.5 |
| Category label | Figtree-Regular 12×s, black @ 90%, right-aligned, height = cell size |
| Empty-cell color | rgb(0.95, 0.93, 0.92) ≈ `#F2EDEB` |
| Axis rule | 1 px line (0.9×s, min 0.7) color `#E0D9D5`, 10×s above it, 5×s gap to labels |
| Axis labels | Figtree-Regular 10×s, kerning −0.08×s, black @ 78% |

- Grid width = `cell×slots + gap×(slots−1)`; if wider than the viewport area it scrolls **horizontally**
  (no indicator). Axis width equals grid width.
- Axis label placement: label width clamp `22×s…34×s` (target `intervalWidth × 1.4`). Every tick's label is
  left-aligned at the tick's x (clamped into the axis), **except the last tick, right-aligned at axis end**.
  If only one tick, single left-aligned label.
- **Cell fill (occupancy heatmap)**: for each row×slot, occupancy = clamp01(sum of that category's card-overlap
  minutes in the slot / slot minutes). Fill = category color at **alpha `0.3 + 0.7 × occupancy`**; occupancy 0 →
  empty-cell color. (So even a sliver of activity reads ≥ 30% opacity; full slot = solid.)
- Each occupied slot remembers the "best" card (largest overlap) for its tooltip: card title + full card duration.

#### 2.4.4 Distractions strip (only if a Distraction category exists)
- Extra row under the category rows: label "Distractions" (same label styling), track height 10×s (11),
  top spacing 6×s, radius max(1, 2×s)=2.2, track fill `#F2EDEB`.
- Markers: red `#FF5950`, opacity 0.85 (1.0 when hovered), min width 3×s, positioned/scaled linearly across the
  window (`(minute − windowStart)/windowMinutes × gridWidth`).
- Marker sources (both clipped to window):
  1. Whole cards categorized "Distraction"/"Distractions" (marker title = card title).
  2. **Mini-distractions** embedded in any card (`card.distractions[]` with own `startTime`/`endTime` "h:mm a").
     Each mini range is re-anchored to its parent card's minute range (try raw, +1440, −1440; pick closest to the
     parent range); if still invalid, collapse to a 1-minute sliver clamped inside the parent.
- **Merging**: after sorting by start, markers overlapping or within **2 minutes** of each other merge into one
  block; merged title = unique titles joined with ", ". Tooltip duration = merged block length.

#### 2.4.5 Tooltips (custom, not native)
- Trigger: hover a grid cell that has a card, or a distraction marker. Exit delay 80 ms (moving between targets
  doesn't flicker); appear/disappear animate easeOut 0.12s. Hovering a cell clears marker hover and vice versa.
- Placement: horizontally centered on the hovered rect, bottom edge 4×s above the rect's top (rendered above
  the card container, non-interactive).
- Box: width 200×s (220), padding 8×s, white fill, radius 4, stroke `#EDE0CE` 1px, shadow rgb(1,0.63,0.54) @ 25%
  blur 2 y2.
- Content: line 1 = duration `formatDurationValue` — Figtree-SemiBold 12×s, accent color (`#D77A43` for cells,
  `#FF5950` for distraction markers); line 2 = title — Figtree-Regular 12×s black, wraps.
- Note: hover keys are `"{rowIndex}-{slotIndex}"` computed against the **filtered** row list (distraction category
  row removed) — keep index spaces consistent.

#### 2.4.6 Totals row (below divider)
- Title: `"Today's total so far"` / `"Yesterday's total"` / `"Total for {EEE, MMM d}"` — InstrumentSerif-Regular
  14×s, `#777777`.
- Then per category with > 0 minutes (category order): `{name}` Figtree-Regular 12×s `#1F1B18` + `{duration}`
  Figtree-SemiBold 12×s in the category color, pairs spaced 8×s, name/value gap 2×s. Single line, min-scale 0.7.
- Empty: single Figtree-Regular 12×s `#7F7062` text — today: `"{title}  No captured activity yet."`;
  other days: `"{title}  No captured activity during 9am-9pm"` (note: two spaces after title, and no period on
  the second variant).

#### 2.4.7 Stat chips (computed, **not currently rendered**)
`computeDailyWorkflow` also produces 5 chips whose component (`DailyStatChip`) exists but isn't placed in the
current layout. Port the computation + component for parity:
- Chips: `Context switched {N times}` · `Interrupted {N times}` · `Focused for {Xh Ym}` · `Distracted for {…}` ·
  `Transitioning time {…}`.
- Formulas (over the day's clipped segments sorted by start, ties by end):
  - contextSwitches: count of consecutive segments whose category differs from the previous segment's.
  - interruptions: count of segments whose card has ≥ 1 embedded distraction.
  - focusedMinutes: Σ durations of segments in **non-idle** categories; distractedMinutes: Σ durations in
    categories flagged `isIdle`.
  - transitionMinutes: Σ positive gaps between a segment's start and the running max end of prior segments.
- Chip visual: capsule, fill `#F7F3F0`, stroke `#DDD6CF` 0.8×s (min 0.6), padding 12×s/6×s; title
  Figtree-Regular 10×s `#5D5651`, value Figtree-SemiBold 10×s `#D77A43`, gap 4.
- Also unused but present: `DailyModeToggle` (Highlights/Details segmented control; active fill `#FFA767` white
  text, inactive `#FFFAF7` @ 60% text `#837870`, radius 8, border `#C7C2C0` 1×s, item padding 12h/8v,
  min height 33×s). Not rendered anywhere — optional.

### 2.5 Action row
Right-aligned HStack(spacing 10×s):
1. **Copy button** — only rendered when a persisted standup entry exists for the day (`hasPersistedStandupEntry`).
2. **Regenerate button** — always.
3. **Provider gear button** — always.

**Copy standup button**
- Pill: gradient `#FF986F → #BDAAFF` (topLeading→bottomTrailing), capsule, stroke `#F2D7C3` 1.5×s (min 1.2),
  padding 12×s h / 10×s v; white content.
- Icon slot 16×16×s: `Copy` asset (template, white) → on copied state, `checkmark` (12×s semibold); transition
  opacity+scale(0.5), easeInOut 0.22s.
- Label slot (min width 136×s, leading): "Copy standup update" ⇄ "Copied" (crossfade). Font Figtree-Medium 14×s.
- Behavior: writes clipboard text (§2.8.5), shows Copied for **2 s**, then reverts.

**Regenerate button**
- Same pill but gradient `#FFB58A → #ED9BC0`; label min width 108×s; Figtree-Medium 14×s white.
- States (icon 16×16×s slot / label):
  - idle: `arrow.clockwise` / "Regenerate"
  - regenerating: white circular spinner (scaled 0.6×s) / "Regenerating" + trailing dots cycling `.`→`..`→`...`
    every **0.45 s**
  - regenerated: `checkmark` / "Regenerated" — resets to idle after 2 s
  - noData: `exclamationmark.circle` / "No data" — resets after 2 s
- Disabled when: provider is `none`, or selected provider unavailable, or already regenerating. Tooltip/help text:
  provider none → the no-provider message (§2.8.4); unavailable → provider availability detail; else
  "Regenerate standup highlights".

**Provider gear button** — see §2.9.

### 2.6 Standup section
Heading: **"Standup for {dailyDateTitle}"** — InstrumentSerif-Regular 24×s, `#B46531`. Below it two cards joined
into one visual slab (negative spacing −1×s so borders overlap; each card width = (contentWidth + 1×s)/2):
- Left card style `.highlights` with `seamMode .joinedLeading` (rounded 12×s only on left corners);
- Right card style `.tasks` with `.joinedTrailing` (rounded only right corners).

#### 2.6.1 DailyBulletCard chrome (both cards)
- Min height max(180, 394×s) = **433.4**. Fill: linear gradient white 60% → white 100% → white 60% at stops
  0.0119 / 0.5104 / 0.9809, axis from UnitPoint(1, 0.45) → (0, 0.55) (i.e., nearly horizontal right→left sheen).
- Stroke `#EBE6E3` 1×s (min 0.7); shadow black 10%, blur 12×s, y 0.
- Inner padding: 26×s on leading/trailing/top. Title→list spacing 18×s.
- Card title (dynamic, §2.8.2) — InstrumentSerif-Regular 24×s, `#B46531`.

#### 2.6.2 Bullet list editor
- Scrollable list viewport: highlights max-height 230×s / min 154×s; tasks max 142×s / min 92×s. Scrollbar shown
  only when > 5 items. Row spacing 10×s, rows min-height 22×s.
- Each row: drag handle (18×18×s hit area, 12×12×s icon of 6 dots — 2×3 grid of 2.5×s circles, gap 2×s, color
  `#A5A5A5`) + multiline text field (Figtree-Regular 14×s, black, 1–6 lines, grows vertically).
- Interactions:
  - Drag handle → HTML5-style drag & drop reorder within the list (move animation easeInOut 0.14s); dropping on
    empty space below moves item to end.
  - Enter inside an item → insert new empty item **after** it, focus it, scroll to it (easeOut 0.15s).
  - Backspace (no modifiers) in an item whose text is empty/whitespace → delete that item.
  - "＋ Add item" button under the list (plus 18×s `#999999` + "Add item" Figtree-Regular 13×s `#999999`,
    v-padding 6×s; leading padding 16×s on highlights card, 26×s on tasks card; bottom padding 20×s highlights /
    24×s tasks) → append empty item, focus, scroll.
- Any draft edit schedules a debounced save (§2.8.3).

#### 2.6.3 Blockers sub-section (tasks card only, full-width footer)
- Background `#F7F6F5`, top divider `#EBE6E3` 1×s, padding 26×s h / 14×s top, min height 94×s.
- Title text field (editable! placeholder "Blockers") — Figtree-Medium 14×s, `#BD9479`.
- Body row: drag-handle icon (static decoration) + multiline field placeholder
  **"Fill in any blockers you may have"** — Figtree-Regular 14×s, `#929292`, 1–4 lines.

### 2.7 Data & metrics for the workflow grid

Input: `fetchTimelineCards(forDay: dayString)` → `TimelineCard { startTimestamp: "h:mm a", endTimestamp,
category: String, title, summary, distractions: [{title, summary, startTime, endTime}]?, recordId }` plus the
category store `TimelineCategory { id: UUID, name, colorHex, order, isSystem, isIdle }`. Full computation
pipeline (`computeDailyWorkflow`) is described in §2.4.1–2.4.7; it is pure and run off the main thread.

### 2.8 Standup data model & generation

#### 2.8.1 Draft model (persisted as JSON per day)
```jsonc
DailyStandupDraft {
  highlightsTitle: string, highlights: [{id: uuid, text: string}],
  tasksTitle: string,      tasks:      [{id, text}],
  blockersTitle: string,   blockersBody: string,      // newline-separated bullets
  generation?: { provider, runtime, modelOrTool?, sourceDay?, generatedAt? }
}
```
Stored via `saveDailyStandup(forDay:payloadJSON:)` in table keyed by `standupDay` (`yyyy-MM-dd`), read via
`fetchDailyStandup(forDay:)`; also `fetchAllDailyStandups(excludingDay:)`, `fetchRecentDailyStandups(limit:excludingDay:)`.
Legacy entries without `generation` get `generation = legacyDayflow` on decode.

**Placeholder drafts & messages (verbatim):**
- `notGeneratedMessage`: "Daily data has not been generated yet. If this is unexpected, please report a bug."
- `todayNotGeneratedMessage`: "Today's daily recap will be generated tomorrow morning."
- `insufficientHistoryMessage`: "Not enough captured activity in the previous 3 days to generate a standup."
- `noProviderSelectedMessage`: "No Daily provider is selected. Click the gear button above, then choose a provider to turn recap generation back on."
- `.default` draft: titles "Yesterday's highlights" / "Today's tasks" / "Blockers", all items/body =
  notGeneratedMessage.
- `.insufficientHistory`: titles "Recent highlights" / "Tasks" / "Blockers", content = insufficientHistoryMessage.
- `.noProviderSelected`: titles "Yesterday's highlights" / "Today's tasks" / "Blockers", content =
  noProviderSelectedMessage.
- (`.todayPlaceholder` exists in the model but is unused by this view.)

#### 2.8.2 Dynamic section titles
Let target day = selected timeline day; source day = resolved standup source day (§2.8.4).
`standupDayLabelText(date)`: "Today" / "Yesterday" / "Last {Weekday}" (2–6 days ago) / "{EEEE, MMMM d}".
- Highlights title: no source day → "Recent highlights"; label Today/Yesterday/Last… → "{label}'s highlights";
  else "Highlights from {label}".
- Tasks title: label Today/Yesterday → "{label}'s tasks"; else "Tasks for {label}".
- Blockers title default: "Blockers" (user-editable per entry).

#### 2.8.3 Draft loading & persistence rules
On day change / data refresh (`refreshStandupDraftIfNeeded`):
- Fetch entry for the target day. `hasPersistedStandupEntry = entry != nil` (controls Copy button visibility).
- If provider == none and no entry → show `.noProviderSelected` draft.
- If an entry exists → decode it (once per day). Decode failure → placeholder draft.
- If no entry → placeholder draft: provider none → `.noProviderSelected`; no source day → `.insufficientHistory`;
  else `.default`.
Saving: every draft change debounced **250 ms** on background; skipped when draft == `.noProviderSelected`, or when
there's no existing entry and the draft is still exactly `.default`/`.insufficientHistory` (don't persist pristine
placeholders). Successful save sets `hasPersistedStandupEntry = true`.

#### 2.8.4 Source-day resolution (what "yesterday" means)
`resolveStandupSourceDay(targetDay)`:
- Look back **1–3 days** before the target day's 4 AM start. Pick the first day that (a) is not already consumed
  as `generation.sourceDay` by any *other* saved standup, and (b) has ≥ **120 minutes** of timeline activity
  (`hasMinimumTimelineActivity(forDay:minimumMinutes: 120)`). None found → nil (→ insufficient-history placeholder,
  and Regenerate reports "No data").

#### 2.8.5 Clipboard text format
```
{highlightsTitle}
- item        (or "- None right now" if empty)
…
                       ← blank line
{tasksTitle}
- item / - None right now
                       ← blank line
{blockersTitle}
- blocker line (blockersBody split on newlines) / - None right now
```
Items are trimmed; items exactly equal (case-insensitive) to any of the four placeholder messages are dropped.

#### 2.8.6 Regeneration flow
1. Guard: not already regenerating; provider must `canGenerate` (i.e., ≠ none — else draft = `.noProviderSelected`).
2. Resolve source day; none → state `noData` (2 s), abort.
3. Fetch source-day timeline cards; empty → `noData`.
4. Build inputs: cards text always; **only for the `dayflow` provider** also: observations for the source-day
   range, up to **3** prior standup entries (excluding source day), and a preferences text with the current three
   section titles. Other providers get cards-only.
5. Call generator → new `DailyStandupDraft`; encode → save under the **target** day; schedule a "recap ready"
   OS notification for that day; if the user is still viewing that day, swap the draft in, set
   `hasPersistedStandupEntry`, state `regenerated` (2 s → idle). API error → back to idle (no error UI beyond logs).
6. Switching provider resets regenerate state and forces the draft to reload.

### 2.9 Provider selection UI + gating

**Providers** (enum `DailyRecapProvider`, display order: dayflow, claude, chatgpt, gemini, local, none). Persisted
under key `dailyRecapProvider_v1`.

| case | displayName | pickerSubtitle (default detail) | selectionLabel |
|---|---|---|---|
| dayflow | Dayflow backend | "Uses Dayflow's hosted service for best performance." | Dayflow backend |
| claude | Claude | "Claude Opus" | Claude Opus |
| chatgpt | ChatGPT | "GPT-5.4" | GPT-5.4 |
| gemini | Gemini | "Gemini 3.5 Flash" | Gemini 3.5 Flash |
| local | Local | "Uses Ollama, LM Studio, or another local-compatible server on this Mac." | Local |
| none | No provider | "Turns off Daily recap generation until you pick another provider." | No provider selected (Daily off) |

- `canGenerate` = provider ≠ none. `usesDayflowInputs` = provider == dayflow.
- Availability: an async snapshot maps each provider → `{isAvailable: Bool, detail: String}` (e.g., "needs API key",
  CLI missing, etc. — produced by the generator service). Missing entry ⇒ treated as available with pickerSubtitle
  as detail. Unavailable rows are disabled and their detail text turns `#B07A74`.

**Gear button**: circle 38×s; fill `#F7F3F1`; stroke `#E4D7D0` 1.3×s (min 1.1); icon `gearshape.fill` 13×s
semibold `#B46531`; shadow black 3% blur 5 y2; disabled while regenerating. Tooltip: "Daily recap provider:
{selectionLabel}". Opens a popover (width 312, padding 16, light scheme, anchored below).

**Picker popover** (`dailyProviderPicker`):
- Header: "Daily recap provider" — InstrumentSerif-Regular 22×s, `#2E221B`; sub "Choose how Daily generates this
  recap, or turn generation off." — Figtree-Regular 12×s, `#8B6B59`; small spinner (tint `#B46531`) top-right
  while refreshing.
- Rows (spacing 8×s): radius 14×s continuous; padding 12×s h / 10×s v.
  - Fill: selected `#FFF4EC` else `#FAF8F7`. Stroke: selected `#EBC4AB` else `#E8E1DC`, 1.2×s (min 1).
  - Name: Figtree-SemiBold 13×s — selected `#8F522C`, else `#2F241D`.
  - Detail: Figtree-Regular 12×s — available `#8B6B59`, unavailable `#B07A74`.
  - Trailing radio: `checkmark.circle.fill` `#C96F3A` when selected, else `circle` `#D3C6BE` (14×s semibold).
- Selecting: persists provider, closes popover, resets regenerate state, reloads standup/workflow data.

### 2.10 Confetti (`ConfettiBurstView`)
- 60 pieces, each a 6×10 rounded-rect (radius 2), colors cycling through
  `#FF6B6B #FFD93D #6BCB77 #4D96FF #9B5DE5 #FF8FAB #00C2FF #FFA41B #F72585 #7AE582`.
- Trigger = incrementing counter. Per piece on trigger: start at (random x −60…60, y −6), opacity 1, rotation 0;
  **burst** spring(0.4, 0.65) → (x −220…220, y −30…50, spin −120…120°); **fall** easeInOut 1.6 s delay 0.3 →
  (x −340…340, y 200…360, spin += −240…240°); fade out easeOut 0.4 s delay 1.6. Non-interactive overlay.
- Used on the Daily lock screen when "Unlock Daily" is clicked (zIndex above content).

---

## 3. JOURNAL VIEW

Top-level `JournalView`. Gate → onboarding → day view. Persisted flags: `isJournalUnlocked`,
`hasCompletedJournalOnboarding`. A shared `JournalCoordinator` publishes `showOnboardingVideo` and
`showRemindersAfterOnboarding` (after onboarding video finishes, the reminders sheet opens automatically).

### 3.1 Lock screen (access code)
Background: `JournalPreview` full-bleed image. VStack(spacing 24), centered:
1. Wordmark: "Dayflow Journal" — InstrumentSerif-Italic 38, `#59381F` + the same rotated "BETA" badge as Daily
   (Figtree-Bold 11 white on `#FA8C33`, radius 6, −12°, offset (−4,−4)).
2. Beta notice — Figtree-Regular 15, `#59381F` @ 80%, centered, max 480:
   > "We're slowly letting people into the beta as we iterate and improve the experience. If you choose to
   > participate in the beta, you acknowledge that you may encounter bugs and agree to provide feedback."
3. Spacer 20.
4. **Access code card** (width 380, shadow black 8% blur 16 y6): background = `JournalLock` image (aspect-fit;
   the warm gradient + padlock illustration are baked into the asset). Content overlaid, anchored to bottom
   (bottom padding 28), VStack(spacing 16):
   - "Enter access code" — Figtree-SemiBold 20, `#D9733F`.
   - Text field: plain, centered text, Figtree-Medium 15, `#40261A`; white fill radius 8; padding 14h/12v;
     80px side insets within the card; submit-on-Enter.
   - "Get early access" button — Figtree-SemiBold 15, `#59381F`; capsule gradient top→bottom
     `#FFEBD1` (1,0.92,0.82) → `#FFD9B3` (1,0.85,0.70); stroke `#E6BF8C` (0.90,0.75,0.55) 1px; padding 28h/10v.
   - Validation: lowercase(input) → SHA-256 hex must equal
     `909ca0096d519dcf94aba6069fa664842bdf9de264725a6c543c4926abe6bdfa`. Success → unlock (spring 0.6/0.8).
     Failure → clear field + horizontal **shake** (translateX = 10·sin(attempts·π·3)).

### 3.2 Journal onboarding
If unlocked but onboarding incomplete — full-screen intro (`JournalOnboardingView`):
- "Set your intentions today" — InstrumentSerif-Regular 42, `#D97326` (0.85,0.45,0.15), centered.
- Body — Figtree-Regular 16, `#40261A` @ 80%, centered, max 640:
  > "Dayflow helps you track your daily and longer term goals, gives you the space to reflect, and generates a
  > summary of each day."
- "Start onboarding" — Figtree-SemiBold 16, `#59381F`, capsule gradient `#FFF5EB` (1,0.96,0.92) →
  `#FFE6D1` (1,0.90,0.82), stroke `#EBD9C7` (0.92,0.85,0.78), padding 32h/12v.
- Click → plays `JournalOnboardingVideo.mp4` full-screen: muted, non-interactive (all input swallowed),
  auto-resumes if paused, completes ~0.3 s before the end; on completion, onboarding is marked done and the
  **Set reminders sheet** opens (via coordinator).

### 3.3 JournalDayView (main journal surface)
Container: max width 980 centered, h-padding 12 (outer) + 20 (inner), top/bottom padding 10; VStack(spacing 10):
toolbar → headline → flow content. Bottom-trailing ZStack alignment (reserved).

**Toolbar** (single row; nav cluster centered, reminders pill pinned right, trailing pad 20):
- Circle nav buttons 26×26: fill `#FEF9F3` (0.996,0.976,0.953), stroke white 1px, shadow black 4% blur 2;
  arrow = `JournalArrow` asset 9×9 tinted `#FFBD59` (1,0.74,0.35) (right arrow mirrored). Disabled: arrow opacity
  0.35, whole button 0.55. Right button disabled when at today.
- Segmented **Day | Week**: items 64 wide, Figtree-Regular 12, tracking −0.12, padding 14h/4v, radius 200;
  active fill `#FFB859` (1,0.72,0.35) white text; inactive fill `#F2F0EE` (0.95,0.94,0.93) text
  `#CCC7C4` (0.80,0.78,0.77). Container: capsule fill `#FFF9F3` (1,0.976,0.953), inner padding 2, stroke white
  60% inset 0.5, shadow black 10% blur 2 y1. (**Note:** selection state exists but is not wired to content —
  the Week surface, §3.6, is a standalone exploration.)
- "Set reminders" pill: `JournalReminderIcon` 16×16 (template) + text, both `#59330D` (0.35,0.20,0.05),
  Figtree-SemiBold 12, JournalPillButtonStyle overridden to padding 12h/6v. Opens the reminders sheet (§3.7).

**Headline**: `manager.headline` — InstrumentSerif-Regular 36, `#2E1708` (0.18,0.09,0.03), never animated.
"Today, November 24" or "Monday, November 24".

**Page transitions**: prev/next day triggers a 3-D **book flip** (rotate ±90° about the y-axis, anchors
leading/trailing, perspective 0.5, content hidden past 89°, plus up to 15% black shade proportional to the angle),
0.6 s easeInOut; the whole content subtree is re-identified per flip.

**Journal tokens** (used below):
| token | value |
|---|---|
| primaryText | `#2E1708` |
| bodyText | `#2E1C0F` (0.18,0.11,0.06) |
| sectionHeader | `#D9700A` (0.85,0.44,0.04) |
| bullet | `#F5923D` (0.96,0.57,0.24) |
| divider | `#E6D9CC` (0.90,0.85,0.80) |
| reminderText | `#59330D` |
| selection highlight (text fields) | bg `#FFEDD1` (1.0,0.93,0.82) |

#### 3.3.1 Flow state machine (`JournalFlowState`, driven by `JournalDayManager`)
States: `intro, summary, intentionsEdit, reflectionPrompt, reflectionEdit, reflectionSaved, boardComplete`.

`JournalEntry` DB row: `{ day, intentions?, notes?, goals?, reflections?, summary?, status: "draft" |
"intentions_set" | "complete", createdAt?, updatedAt? }`.

Initial state on load of a day:
- No entry: today + a recent summary exists (any summary within past 3 days) → `summary`; else `intro`
  (past days: read-only `intro`).
- Entry status "complete" → `boardComplete`.
- Entry status "intentions_set": if today and hour ≥ **16** → `reflectionSaved` if reflections non-empty else
  `reflectionPrompt`; otherwise → `reflectionPrompt` (board shown; reflect button only enabled if today).
- Other/draft: same as no-entry.

Other rules:
- Navigation: prev unrestricted; next capped at today; blocked while a summary is generating.
- `isToday` gates all editing. Long-term goals are pre-filled from the most recent entry that had goals.
- `canSummarize` = day has ≥ **60 minutes** of timeline activity.
- Saving intentions: lines are trimmed and blank lines dropped (both intentions and goals; notes just trimmed);
  after save the flow goes to `reflectionPrompt`.
- Skip reflections → clears reflections, state `reflectionSaved`.
- Generate summary (async): builds prompt (§3.5), calls LLM, extracts `<summary>…</summary>` (tolerates a
  malformed/missing closing tag; falls back to trimmed raw), saves to the originally-viewed day, state
  `boardComplete` (if still on that day). Error → inline error message
  `"Failed to generate summary: {localized error}"` with Dismiss / Try again.

#### 3.3.2 Screens per state (copy verbatim)

**intro (`IntroView`)** — centered VStack(spacing 20):
- "Set daily intentions and track your progress" — InstrumentSerif-Regular 34, sectionHeader.
- "Dayflow helps you track your daily and longer term pursuits, gives you the space to reflect, and generates a
  summary of each day." — Figtree-Regular 16, bodyText, centered, max 540. (Note "pursuits" here vs "goals" on the
  onboarding screen.)
- If today: CTA pill (JournalPillButtonStyle 28h/10v, Figtree-SemiBold 17) with title `ctaTitle` =
  "Edit intentions" when status is intentions_set/complete else "Set today's intentions".
- If a past day: "No journal entry for this day" — Figtree-Regular 14, bodyText @ 50%.

**summary (`SummaryView`)** — shown on a fresh today when yesterday(±3d) had a summary:
- "Summary from yesterday" — InstrumentSerif-Regular 30, sectionHeader.
- The summary text rendered with **WetInkText** (typewriter, §3.3.4), Figtree-Regular 17, max width 640,
  scroll capped 300 high.
- "Set today's intentions" pill (Figtree-SemiBold 17, padding 28h/10v).

**intentionsEdit (`IntentionsEditForm`)** — VStack(spacing 10):
- Back button: `arrow.left` 14 medium, bodyText @ 50%, 32×32 white @ 60% circle.
- Edit card: max width 520 centered; scrollable; padding 20h/24v; fill = linear gradient white 30% → 80% → 30%
  at stops 0/0.5/1 from UnitPoint(1,0.14)→(0,0.78); radius 8; stroke white 1px inset 0.5; shadow black 10% blur 6.
  Shares a matched-geometry "card_bg" morph with the board's left card (animate frame between edit ↔ board).
- Three sections, each: serif title (InstrumentSerif-Regular 22, sectionHeader, 5px leading pad) + auto-growing
  plain text editor (Figtree-Regular 15, text `#2E1C0F`, min 3 lines, placeholder @ 45% bodyText):
  1. "Today's intentions" — placeholder randomly one of: "What does a good day look like?" /
     "If today goes well, what will you have done?" — auto-focused.
  2. "Notes for today" — placeholder "What mindset do you want to carry today?"
  3. "Long term goals" — placeholder "What are you working towards?"
- "Save" pill (22h/9v) beneath.

**Board layout** (states reflectionPrompt / reflectionEdit / reflectionSaved / boardComplete) — two side-by-side
cards (HStack spacing 0, top-aligned, fill height):
- **Left card** (read-only recap; clicking it = edit intentions when today): scrollable, padding 22,
  sections spacing 18: "Today's intentions" (serif 20, sectionHeader) + bullet list; "Notes for the day" + notes
  text (or "—" @ 40% when empty); divider; "Long term goals" + bullet list. Bullets: 6px dot (bullet color)
  + Figtree-Regular 15 bodyText, row gap 8. Card chrome: gradient white 30→80→30% (stops 0/0.51/1, axis
  (1,0.14)→(0,0.78)), radius 12, stroke white inset 0.5, shadow black 10% blur 6. Hover (when clickable):
  scale 1.01 + shadow black 12% blur 12 y4 (spring 0.3/0.7).
- **Right card**: white @ 92%, radius 12, stroke white @ 80%, same shadow, padding 22, spacing 18. On the first
  transition into `reflectionPrompt` after saving intentions, the right card **unfolds**: starts rotated −90°
  (y-axis, leading anchor, perspective 0.5) & transparent, springs to flat (0.7/0.7) after 0.6 s delay.

Right-card contents by state:
- **reflectionPrompt (`ReflectionPromptCard`)**: "Today's reflections" (serif 22, sectionHeader @ 40%);
  body Figtree-Regular 15 bodyText @ 65%:
  > "Return near the end of your day to reflect on your intentions. Let Dayflow generate a narrative summary
  > based on the activities on your Timeline."
  If today: bottom-right pill "Reflect on your day" (20h/10v).
- **reflectionEdit (`ReflectionEditorCard`)**: "Your reflections" (serif 22, sectionHeader); editor min 6 lines,
  placeholder "How was your day? What did you do? How do you feel?"; bottom-right: "Save" pill (18h/8v; disabled
  + 55% opacity when text blank) and plain-text "Skip" (bodyText @ 60%).
- **reflectionSaved (`ReflectionSavedCard`)**: "Your reflections" + saved text (Figtree-Regular 15 bodyText,
  scrollable) or, if empty, "Return near the end of your day to reflect on your intentions." @ 65%.
  Bottom-right, one of:
  - loading: small spinner + "Generating summary..." (Figtree-Regular 14, bodyText @ 70%)
  - error: red 80% Figtree-Regular 13 message, then "Dismiss" (plain, bodyText @ 60%) + "Try again" pill (18h/8v)
  - canSummarize: **"Summarize with Dayflow"** pill (24h/11v)
  - else: "Need at least 1 hour of timeline activity to summarize" — Figtree-Regular 13, bodyText @ 50%.
- **boardComplete (`SummaryCard`)** — VStack(spacing 22):
  - "Dayflow summary" (serif 22, sectionHeader) + summary in WetInkText Figtree-Regular 17; while absent:
    "Summarizing your day recorded on your timeline…" @ 65%.
  - "Your reflections" + reflections (Figtree-Regular 15) or the "Return near the end…" placeholder @ 65%.
  - "Regenerate summary" — plain text button, Figtree-Regular 13, sectionHeader color.

#### 3.3.4 WetInkText (typewriter effect)
Types the string character-by-character: per-char delay random 0.01–0.03 s, +0.15 s after `.`/`,`/newline.
While typing: color @ 80% + 0.2px blur; on completion animate to full opacity/sharp (easeOut 0.5 s). Re-runs
when the text changes. Line spacing 5.

### 3.4 Journal data dependencies
- `fetchJournalEntry(forDay:)`, `updateJournalIntentions(day:intentions:notes:goals:)` (sets status
  "intentions_set"), `updateJournalReflections(day:reflections:)`, `updateJournalSummary(day:summary:)`
  (sets status "complete"), `fetchRecentJournalSummary(withinDays: 3)` → `(day, summary)?`,
  `fetchRecentJournalSummaries(count: 3, excludingDay:)`, `fetchMostRecentGoals()`,
  `hasMinimumTimelineActivity(forDay:minimumMinutes:)` (60 for journal, 120 for standup source),
  `fetchTimelineCards(forDay:)`.

### 3.5 Journal summary LLM prompt (verbatim; needed to reproduce generation)
Timeline text = each card as `"{start}-{end}: {title} - {summary}"` joined by newlines. Recent summaries block =
`"[{day}]\n{summary}"` joined by blank lines, or "(No recent summaries)".

```
You are writing a personal daily summary for a productivity app. Write in first person from the user's perspective.

FORMAT:
**Wins:** 2-3 key accomplishments from the day, one line
[Narrative paragraph: 3-5 sentences covering the arc of the day—morning, afternoon, evening—as relevant. Keep it warm and reflective, not robotic. Use varied sentence lengths. Be specific about what happened but don't over-explain.]
**To improve:** 1 honest observation about what could've gone better, one line

STYLE GUIDELINES:
- Warm and reflective, like you're journaling for yourself
- Punchy and scannable—no walls of text
- Judicious bolding: 1-3 bolded phrases max in the narrative paragraph, only for key activities or focus areas that anchor the day. Don't bold generic words or overdo it.
- Avoid corporate/productivity jargon ("deep work", "optimized", "leveraged")
- Vary your sentence openers—don't start every sentence with "I"
- Do NOT infer emotions or feelings—only reference how the user felt if they explicitly stated it in their intentions or reflections

EXAMPLE:
<summary>
**Wins:** Shipped the journal feature I set out to finish. Made real progress on video animations and started rethinking how timeline cards should feel.

The morning didn't have much direction—some scrolling, flight searches, a League video. Things clicked mid-afternoon when I got into **Swift animation work**, dialing in spring curves and reverse logic. Evening was a mix: Japan trip planning with friends, Duke interview prep, then back to **timeline card specs**. Ended the night playing with Opus 4.5.

**To improve:** Morning had too much drift. Would've felt better to batch distractions and start focused.
</summary>

IMPORTANT: Below are the user's recent summaries. Do NOT reuse the same phrases, sentence structures, or openers. Keep the format consistent but make the language feel fresh.

RECENT SUMMARIES:
{recentSummariesText}

TODAY'S DATA:

TIMELINE ACTIVITY:
{timelineText | "No activity recorded"}

MORNING INTENTIONS:
{intentions | "None set"}

NOTES FOR THE DAY:
{notes | "None"}

LONG-TERM GOALS:
{goals | "None set"}

EVENING REFLECTIONS:
{reflections | "None provided"}

Write the summary now, wrapped in <summary> tags:
```
Response parsing: regex `<summary>([\s\S]*?)(?:</summary>|<summary|$)` → group 1 trimmed; no match → trimmed raw.
The rendered summary text may contain `**bold**` markdown-style markers (render bold).

### 3.6 JournalHeroView & JournalWeeklyView (static Figma explorations — currently placeholder-driven)
Both compile with hard-coded preview data and are **not wired to live data or navigation** (the Day/Week toggle
doesn't switch to them). Port for completeness/future use:

**JournalHeroView** — warm hero page:
- Background: linear gradient topLeading→bottomTrailing `#FF9B3A → #FFB764 → #FFE6C5 → #FFF6EB`; plus radial
  white 90%→clear from bottomLeading (r 90→520, screen blend) and radial `#FFAE5E` 45%→clear from topLeading
  (r 140→520).
- Badge pill: headline text ("Daily Journal") Figtree-SemiBold 30 kerning −0.4, filled with gradient
  `#ED6B0C → #F4C11C` (text mask); pill radius 32; bg gradient white 96% → `#FFF2DB` top→bottom; stroke white 65%;
  extra inner highlight stroke white 32% 0.6px blurred 0.8; shadow `#D88931` 38% blur 18 y12; padding 30h/14v.
- Entry card: radius 20; fill white 36%; stroke white 62%; shadow `#C86E1A` 14% blur 30 y18; text padding 26h/24v,
  line-spacing 8, kerning −0.2; bottom fade overlay clear → `#FFF6EB` 94% (center→bottom). Entry is rich text in
  InstrumentSerif: primary 30 `#7A4116`, emphasis 32 `#5B2A06`, secondary 28 `#9C5A26` @ 86%.
- CTA pill "Reflect with Dayflow": Figtree-SemiBold 15, JournalPillButtonStyle-like (24h/10v, press 0.98).
- Content column max 920, padding 28h/36v, spacing 32.

**JournalWeeklyView** — week-in-review canvas (all placeholder copy included so the mock renders identically):
- Panel: padding 38h/34v, background = thick blur material + white 35% overlay, radius 28, stroke white 35%.
- Header toolbar: circle buttons 34×34 white with shadow black 8%/8 y4, chevron 13 semibold `#2F1607`
  (disabled 40% + muted); segmented Day/Week (18h/6v, Figtree-SemiBold 13, active capsule `#FFB859` white text,
  inactive `#F5EEE6` text `#6B4D3A`, container white 80% capsule, padding 4); right pill "Set reminders":
  24 circle `#FFAA5F` w/ white `sun.max.fill` 12 + text Figtree-SemiBold 13 `#5A320E`, bg gradient
  `#FFE5C5 → #FFD29D` top→bottom, capsule, stroke `#FFC689` 70%.
- Titles: "Week in review" InstrumentSerif 32 kerning −0.5 `#2F1607`; date range "October 19 – 25"
  InstrumentSerif 22 @ 85%; description Figtree-Regular 14 `#6B4D3A` centered max 520:
  > "Made progress on the redesign project, shared updates with the leads by the end of the week. Looked at
  > design references and shopped for groceries and necessities."
- Timeline (height 320): a fixed S-curve path stroked 3px round-cap with gradient `#FFB859 → #FF8F4A`
  (leading→trailing), shadow `#F7B47C` 35% blur 14 y12. Curve = 3 cubic Béziers in a 1013.84×63.33 reference box
  (P0(4,17.378) C(155.747,17.378)(178.595,64.3301) → (341.819,64.3301); C(493.566,64.3301)(510.312,1) →
  (660.784,1); C(821.458,1)(885.217,32.9104) → (1017.84,32.9104)), normalized to a rect inset 32px horizontally,
  height = min(50% of area, 160), vertical amplitude halved about the midline for node placement.
- Day nodes: 28×28 circles on the curve at progress 0.02/0.18/0.34/0.5/0.66/0.82/0.98, labels S M T W T F S
  Figtree-SemiBold 13; active fill `#FFB859` white text; muted fill `#F2E4D4` text `#6B4D3A`.
- Entry cards (width 215): white, radius 18, shadow black 8% blur 14 y10, padding 18h/16v; summary
  Figtree-Regular 14 `#2F1607`; icon chips 26×26 radius 6 (icon 12 semibold). Connector: 2px `#FFB859` @ 40%
  vertical line; cards ±140px above/below their node (line length |±112|−34).
- Placeholder entries/icons (verbatim): Sun "Worked on design directions with the team. Watched a new episode of
  Curb Your Enthusiasm." (below; palette icon on `#FFB859`, tv on `#FFB2A6`/`#4A1D12`); Mon "Refined design
  directions. Shopped for groceries." (above; palette, cart on `#553000`/`#F9E2C9`); Tue "Prepared presentation
  and troubleshooted with Jason. Shopped for home necessities on Amazon." (below; slides `#FFD082`/`#4A2606`,
  cart); Wed "Updated mockups and presentation based on new feedback. Spent some time watching YouTube videos."
  (above; palette, play `#F06543`); Thu "Refined design directions and shared with them with the leads." (below;
  palette); Fri "Read some articles on Substack and jotting down notes. Spent most of the day away from the
  computer." (above; book `#5B3A2E`/`#F9E2C9`, moon `#2D1E2F`); Sat muted, no entry.

### 3.7 Set reminders sheet (`JournalRemindersView`)
Modal sheet (preview canvas ~480×376). Outer: radius 6, fill `#FAF7F3`, stroke white 1px, padding 28h/24v,
forced light. VStack(spacing 24):
1. Header: "Set reminders" — InstrumentSerif-Regular 22 kerning −0.22, `#333333`; sub — Figtree-Regular 12
   kerning −0.12 @ 90%, centered:
   > "Set recurring notifications to remind yourself to set your intentions and reflect."
2. White form card: padding 24h/28v, radius 6, stroke `#F2F2F2`; rows spacing 20:
   - Row "Set intentions at" · Row "Write reflections at": label Figtree-Regular 14 kerning −0.14 `#333333`,
     fixed label column 146; then `[HH] : [MM] [AM/PM]` (spacing 8; colon Figtree 14 `#333333`, baseline −1).
     - Digit fields: numeric-only filter, centered, Figtree-Medium 14; field chrome: height 26 content, padding
       14h/6v, fill `#F9F3EC`, radius 10, stroke — focused `#FF9B4C` 1.5px; hovered `#FF9B4D` (rgb 1,0.61,0.3)
       1px; else none.
     - AM/PM: button showing "AM"/"PM" (Figtree-Medium 14 `#333333`, same field chrome) that **toggles** on click.
   - Row "Repeat on": 7 day chips 32×32 circles labeled S M T W T F S — Figtree-Regular 12 kerning −0.12;
     selected: fill `#FFB859`, white text, no stroke; idle: fill `#FBF7F1`, text `#B9A595`, stroke `#F6E1CA` 1px.
     Multi-toggle.
   - All interactive bits scale 1.05 on hover (easeInOut 0.12).
3. Footer buttons (Figtree-SemiBold 14, radius 8, padding 16h/6v, press 0.97):
   - Left: "Test" — fill `#F9F3EC`, text `#333333`, stroke `#E1D7CC`. Fires a test notification in 3 s:
     title "Test: Set your intentions", body "This is a test notification from Dayflow."
   - Right: "Cancel" — fill `#F1ECE7`, text `#9F8D80`, stroke `#E1D7CC`; "Save" — fill `#553000`, white text.
- Defaults: intentions **9:00 AM**, reflections **5:00 PM**, days **Mon–Fri**. Saved values reload from
  preferences when reminders were previously enabled (24 h ↔ 12 h conversion; weekday enum 0=Sun ↔ calendar
  1=Sun). Save requires ≥ 1 selected day; converts to 24-h, persists
  `NotificationPreferences.{intentionHour,intentionMinute,reflectionHour,reflectionMinute,weekdays}`, requests
  notification permission, schedules the recurring notifications, closes.

---

## 4. GOAL FLOW, GOAL HEADER & DAY-SUMMARY RIGHT RAIL

These live on the Timeline screen's right rail but were requested as part of this spec.

### 4.1 `DayGoalPlan` model & defaults
```
DayGoalPlan { day: "yyyy-MM-dd", focusTargetMinutes, distractionLimitMinutes,
              focusCategories: [snapshot], distractionCategories: [snapshot],
              isSkipped, createdAt (unix), updatedAt }
DayGoalCategorySnapshot { categoryID (uuid string), name, colorHex, sortOrder }
```
- **Default plan**: focus target **270 min (4.5 h)**, distraction limit **120 min (2 h)**; focus categories = all
  non-system, non-idle categories except any named "distraction(s)"; distraction categories = those named
  "distraction(s)".
- `carriedForward(to:day)`: reuse the most recent saved plan ≤ day (`fetchMostRecentDayGoalPlan(beforeOrOn:)`);
  when the day differs, clear `isSkipped/createdAt/updatedAt`; snapshots re-resolve to current category id/name/
  color (by ID first, then case-insensitive name).
- Preference: `showDailyGoalPopups` (default true) gates the automatic morning goal prompt.
- Storage: `fetchDayGoalPlan(forDay:)`, `saveDayGoalPlan(_)`. UserDefaults key
  `dayGoalReviewShownTimelineDay` remembers that yesterday's review was already shown today.

### 4.2 Goal flow overlay (`DayGoalFlowOverlay` / `DayGoalFlowView`)
- Full-screen overlay scrim: `#DB420B` @ 10%.
- Fixed design canvas **1200×680**, uniformly scaled down to fit (24px margins), centered. All positions below are
  canvas coordinates (element centers, as SwiftUI `.position`).
- Palette: orange `#FF8046`; muted orange `#FFEDE4`; muted border `#B1A8A1`; text `#333333`;
  focus accent `#628CFF`; distraction accent `#FA8282`.
- Buttons: primary — 120×36, radius 6, fill `#FF8046`, white Figtree Medium 13; secondary — same but fill
  `#FFEDE4`, text+stroke `#B1A8A1`. Hover 1.02, press 0.97.

#### Screen A — "Yesterday's review" (initial when yesterday had a non-skipped explicit plan and the review
hasn't been shown today)
- Title "Yesterday's review" — Instrument Serif 36, tracking −1.08, `#333333`, centered at (592.4, 125)
  (346×44 box). *(Curly apostrophe in source: "Yesterday's review".)*
- **Focus review card** 388×236 at center (600, 297); **Distraction review card** 388×123 at (600, 491.5).
- `GoalReviewCard` chrome: white @ 80%, radius 8, stroke 1px — focus `#CEDBFF` / distraction `#FFCDCD`; glow
  shadow blur 10 — focus `#8BAAFF` @ 75% / distraction `#FA8282` @ 75%; padding 24h/18v.
- Card copy (long-format durations, §1.4): title "Focus target: {4 hours 30 minutes}", subtitle
  "Time spent: {…}" / title "Distraction limit: {…}", subtitle "Time spent distracted: {…}" — Figtree 15 black.
- Result badge (top-right, rotated **+7.5°**): "NAILED IT" (focus: actual ≥ target; distraction: actual ≤ limit)
  — Figtree Heavy 10 `#4AB43F` on `#F1FFE3`; else "MISSED" — `#FA8282` on `#FFF0F0`; capsule h-padding 15,
  height 30, white 0.5px stroke.
- Progress bar row (height 14): grey track radius 4 `#E4E4E4`; fill radius 6 height 8 in accent color, width =
  `clamp01(actual/target) × trackWidth`; focus bar anchors **left** with a 36×36 icon bubble on the left;
  distraction bar anchors **right** with the bubble on the right. Icon bubble: circle `#E4E4E4` with 1px accent
  stroke (`#8BAAFF`/`#FA8282`), asset `DayGoalFocus`/`DayGoalDistraction` 24×24.
- Focus card extra: category breakdown box (height 92, fill `#F4F4F4` radius 4, padding 12): up to 4 rows —
  name Figtree 12 `#333333` (74 wide) + rounded bar (height 6, radius 6, category color, width =
  `max(18, duration/maxDuration × 86)`) + duration Figtree 8 black. Empty: "No focus categories tracked"
  Figtree 12 `#777777` centered.
- Bottom: primary button "Set today's goals" at (597.35, 615) → flips to Screen B (spring 0.28/0.86).

#### Screen B — goal setup
- Title "Where do you want to spend your time today?" — Instrument Serif 24 black, centered at (602, 64).
- **Category pool** 804×87 at (601.86, 171.5): caption "Drag and drop to set the categories you want to track"
  — Figtree 12 `#5E5E5E`; wrapping flow of chips (spacing 8, row 6); container `#FCFCFC` @ 76%, radius 6, stroke
  `#E7DFDF`; padding 16h/14v. Pool shows only categories not yet assigned to either panel.
  - Chip (`GoalCategoryChip`): drag-handle glyph (4 dots in category color) + name Figtree 12 `#333333`
    (+ tiny `xmark` 7 semibold `#777777` when removable inside panels); padding 4, radius 6; fill = category color
    @ 16% (distraction-assigned chips use `#FFEDED`); stroke = category color (opacity 0.75 for untracked, 1
    when assigned) 0.5px.
  - Interactions: chips draggable into panels; clicking a pool chip **cycles** untracked → Focus → Distraction →
    untracked. Tooltip: "Drag into a goal panel, or click to cycle between Focus, Distraction, and untracked".
- **Focus panel** 396×321 at (397.86, 384.5); **Distraction panel** 400.28×323 at (804, 385.5)
  (`GoalSetupPanel`): radius 6, stroke `#E7DFDF`; 30px header bar in accent color with 16×16 icon + title white
  Figtree 14 ("Focus goal" / "Distraction limit"); body (white @ 80%, padding 24h, 21 top, 23 bottom):
  - Category box 140×187: label "Categories" Figtree 12 `#7A7A7A`; assigned chips stacked (click chip = remove);
    fill `#F8F6F5`, radius 4, stroke `#E6DDD5`, padding 11; accepts chip drops.
  - **Duration wheel picker** 192×187 (`GoalDurationPicker`): container `#F1F1F1` radius 4 stroke `#E6DDD5`,
    padding (7,9,10,11); two columns (spacing 6) "Hours" (0–12 step 1) and "Mins" (00–55 step 5, zero-padded).
    Column: 83×170, vertical gradient `#E9E4E2 → #FFFDFC → #FFFDFC → #E9E4E2`, radius 6, stroke `#E6DDD9`;
    5 stacked values (offsets −2…+2) Figtree sizes 21/23/25/23/21, colors `#AAA6A3`/`#8A8582`/black/`#8A8582`/
    `#AAA6A3`, monospaced digits, 6px gaps; label Figtree 14 black positioned near bottom. Interactions: click
    top half = −step, bottom half = +step; vertical drag with 29px row stride snapping + rubber-band (×0.35) at
    bounds; scroll wheel (discrete ±step; precise trackpad accumulates 22px per step); wheel nudges ±29px then
    springs back (0.22s). Total clamped 0…720 min.
  - Footer 59 high (`#FCFCFC` @ 70%): two stats — focus: "Yesterday's focus" / "Last week's Focus average";
    distraction: "Yesterday's Distractions" / "Last week's Distraction average". Each: title Figtree 12 black
    (min-scale 0.82) over [accent rounded bar (h 6, radius 20, width = max(12, 86 × minutes/scaleMax); 0 if
    minutes 0) + value Figtree 12 black — "8 hours" (whole) / "7h 25m" / "45m"]. scaleMax = max(yesterday,
    weekAvg) for that panel's current categories.
- Bottom (607.45, 617): secondary "Skip today" + primary "Confirm" (spacing 10).
  - Confirm: clears `isSkipped`, stamps timestamps, saves plan.
  - Skip: marks plan `isSkipped` (goal header shows disabled state).
- Reference stats source: per-category duration maps for yesterday and each of the last 7 timeline days
  (§4.4 category-duration formula); week average = Σ/7 (by category ID with name fallback), summed over the
  panel's selected categories.

### 4.3 `DayGoalHeader` (top of right rail, fixed 360×213 content, centered horizontally)
Design tokens: panel bg `#FFFDFB`; disabled bg `#FCF9F6`; bottom border `#EDE5E1` (disabled `#D8D8D8`);
title `#333333`; subtitle `#707070`; label `#787878`; distraction accent `#FA8282`; focus text `#628CFF`;
distraction text `#FC675F`; inactive tail `#D9D9D9` @ 72%; inactive icon `#AAAAAA`.

**Active state** (absolute offsets from the centered 360-wide frame):
- Title "Today's targets" — Instrument Serif 24, `#333333` at (17, 18.96).
- **"Set goals" button** at (270.75, 12): capsule height 30, h-padding 12, Figtree Medium 12 white; vertical
  gradient `#FFB18D` 60% → `#FFB18D` → `#FFA46F` → `#FFB18D`; stroke `#F2D2BD` 1.25; twin white glows (50%,
  blur 4, x ∓3). Opens the goal flow.
- Status line — Figtree 11 `#707070` at (17, 55.68):
  - recording active: "Tracking progress from your focus and distraction categories."
  - paused: "Dayflow is paused. Resume to continue tracking your progress."
  - stopped: "Start Dayflow to continue tracking your progress."
- Focus row: label "Focus" (Figtree 11 `#787878`) at (49, 90.5); metric at (222.15, 88):
  `"{X} / {Y} hr fulfilled"` where X = compact hours of focus time, Y = compact hours of target — value Figtree 11
  `#628CFF`, suffix Figtree 11 `#787878`; **past target** → value becomes Nunito Bold 16 filled with gradient
  `#5B87FF → #003EE9` (suffix Nunito 11). Numeric-text content transitions.
- **Focus progress bar** 269×14 at (39, 106.04): track radius 2 fill `#E7E7E7`; when fulfilled (actual ≥ target):
  track `#ECECEC` + glow `#628CFF` 50% blur 3 + stroke `#91AEFF` 90% 0.5px. Inside (3px leading inset, 3px
  trailing gap, vertical padding 3): one **capsule segment per focus category with time > 0**, spacing 2.55,
  height 8, widths proportional to `duration / max(target, Σsegments)`; segment fill = horizontal gradient of the
  category color (fulfilled: 0.82/1.0/0.72 alphas + color-tinted glow 26% blur 4; else solid).
- Focus legend at (38, 120): a slanted "tail" ribbon (trapezoid: full top edge; bottom edge inset 6 left and
  ~12% right, i.e., slant `min(width×0.12, 28)`) 232.277×14 filled `#D9D9D9` @ 72%; on top, category legend items
  (4px color dot + name Figtree Medium 8 `#333333`, item gap 6, leading pad 13.06) — only as many items as fit
  in 211.94px.
- Focus icon bubble 36×36 at (11, 102): circle `#E7E7E7`, stroke `#FCF9F6` 2px, `DayGoalFocus` asset 25×26.
- **Distraction row** at (0, 158) (360×56):
  - Labels at x 57.08: metric (left) + "Distraction budget" (right, Figtree 11 `#787878`), row width 236.
    Metric: remaining = `max(0, limit − used)` formatted `formatUsedDuration`, suffix `"/ {limit}"`; **over
    budget** → value = used, suffix `"/ {limit} used"`, prominent Nunito gradient `#FF8C85 → #FC675F`.
  - **Distraction bar** 259×14 at (57.25, 19.04): track `#E7E7E7` radius 2; fill is **right-anchored** — a
    `#FA8282` bar (height 6, radius 6) covering from `usedRatio × width` to the right edge (i.e., budget drains
    left→right, remaining shown red on the right).
  - Loss animation: when used time increases > 1 s, the newly-lost span flashes as a capsule gradient
    `#FFBE71` 96% → `#FF8469` 74% with `#FF8857` 42% glow, then shrinks toward its trailing edge & fades
    (0.64 s curve, 0.09 s delay) while the whole row **shakes** horizontally (±1.5px, 3 oscillations, 0.42 s) and
    the track flashes `#FF6857` @ 20% → 0 (0.36 s).
  - Distraction icon bubble 36×36 at (305.25, 3.08) (right side).
- Progress-value changes animate with custom ease (0.16,1,0.3,1 / 0.18 s); focus category segments animate in
  sequence (first after 80 ms, subsequent every 260 ms, each 0.82 s with ease (0.18,0.88,0.2,1)); animations only
  run while the app is frontmost; reduce-motion sets values instantly.

**Disabled/skipped state** (`showsDisabledState` = plan.isSkipped):
- Title "Set today's goals" at (17, 18.96); "Set goals" button at (268, 18.96).
- Subtitle "Set your goals for today to activate the progress bars below." — Figtree 11 at (17, 61.98).
- Grey mock bars: track 269×12 at (39, 98.04) with `#F6F6F6` capsule 260.089×6 at (0,3); tail ribbon at
  (34.06, 112); focus bubble (grey icon tint `#AAAAAA`) at (11, 94); second track 259×14 at (57.25, 141.65) with
  capsule 245.979×6 at (8.71, 4); mirrored tail at (80.04, 157.62); distraction bubble at (305.25, 137.65).
- Bottom 1px border in `#D8D8D8`.

### 4.4 `DaySummaryView` right rail (content column 322 wide, side padding 18, top 18, bottom 48, section gap 26,
divider 1px `#E7E5E3`)
Order top→bottom: **DayGoalHeader** (fixed 213 high, §4.3) → scrollable: "Your day so far" → divider →
"Your review" → divider → "Your focus" → divider → "Distractions so far".

Data pipeline (all computed off-main-thread on load / day change / `timelineDataUpdated` / category change):
1. `precomputeCardDurations`: per card, minutes-of-timeline-day = parse "h:mm a" → shift so 4 AM = 0
   (`m ≥ 240 ? m − 240 : m + 1200`); end < start → +1440; clip to [0, 1440]; duration = (end − start) min.
2. `removeOverlaps`: sort by start (ties: longer first, then recordId); walk keeping `coveredUntil`; trim each
   card's interval to start ≥ coveredUntil (each minute counted once).
3. Exclude system cards (category named "system" or flagged `isSystem`) → the **normalized** set used everywhere.
4. **categoryDurations**: Σ per normalized category key; displayed sorted by minutes desc, then category order,
   then name; unknown categories keep card-name and get color `#E5E7EB`.
5. **totalCapturedTime** = Σ normalized durations. **totalFocusTime** = Σ over cards whose category matches the
   plan's focus snapshots (match by current category ID first, then case-insensitive name; system never counts).
   **totalDistractedTime** = same with distraction snapshots. **distractedRatio** = distracted / captured
   (clamped 0–1; 0 if captured = 0).
6. **focusBlocks**: intervals of focus cards; sort by start; merge any gap < **5 min**; convert to dates from the
   4 AM day start.
7. **Review summary**: `fetchReviewRatingSegments(overlapping:endTs:)` → segments `{startTs, endTs, rating}` with
   rating ∈ distracted|neutral|focused; clip to day range; sum durations per rating; ratios = share of total;
   `lastReviewedAt` = max clipped end. No data → placeholder (⅓/⅓/⅓, "No reviews yet").
8. Yesterday's goal review snapshot + goal setup reference stats (§4.2) also computed here.
9. Morning **goal prompt**: when the app requests it for today (`goalPromptDay`), auto-open the goal flow —
   initial screen `review` if yesterday's explicit non-skipped plan exists and the review wasn't shown yet today,
   else `setup` (also the rule for the "Set goals" button).

#### "Your day so far"
- Title — InstrumentSerif-Regular 24, `#333333`. Then (spacing 20):
- **CategoryDonutChart** (size 205, centered): grey base circle `#F2F0F0` (0.95,0.94,0.94) with shadow
  rgb(0.39,0.28,0.22) @ 35% blur 5; pie ring inset 4px (chart size 197), inner radius ratio 0.62, angular gap 1.5°,
  segment corner radius 6, colored by category; radial white sheen 35%→0 from the inner radius outward; white
  center disc (diameter = chart×0.62 − 8); center: "TOTAL" Figtree Bold 8 `#A5A5A5` + "{H} hours" / "{M} minutes"
  on two lines, InstrumentSerif 16 `#333333`.
- Legend grid: 3 columns × fixed 84.667 width, gaps 14; item = [swatch 10.667×8 radius 3, fill color @ 40%,
  stroke color 1.25] + name FigtreeSans 10 `#636363` (70 wide, truncate) then duration FigtreeSans-SemiBold 12
  `#333333` indented 14.
- Loading: spinner in a 205×205 box. Empty: 140×140 circle stroked 20px grey 20% + "No activity data yet"
  Figtree 12 grey 60%.

#### "Your review" (`TimelineReviewSummaryCard`)
- Title "Your review" — InstrumentSerif 20 `#333333`.
- Subtitle Figtree 11: has data → "Last reviewed at {h:mm a}." else "No reviews yet."; if there are unreviewed
  cards, append link-colored (`#F96E00`) " Review {N card|N cards}" + " to update your data." — clicking it opens
  the review flow (hover scale 1.02).
- Stacked bar (height 39, gap 4): three rounded-rect segments (radius 4) sized by
  distracted/neutral/focused ratios; fill = diagonal gradient color@50% → color; 1px stroke in the color;
  shadow blur 4 y2 per-metric. Colors: distracted `#FF8772` (shadow rgb(148,87,77) 25%), neutral `#EAE0DB`
  (shadow rgb(225,210,203) 25%), focused `#42D0BB` (shadow rgb(77,156,145) 25%). Placeholder (no data): all
  three segments use the neutral beige.
- Legend row (centered, gap 28): [swatch 10.667×8 radius 3, fill color@40% legend colors — distracted `#FF8772`,
  neutral `#DDDBDA`, focused `#42D0BB`, stroke 1.25] + label Figtree 10 `#707070` ("Distracted", "Neutral",
  "Focused"); when data exists, duration `"Xh Ym"` Figtree SemiBold 12 `#333333` under each, indented 14.

#### "Your focus" (`DayFocusSummarySection`)
- Header: "Your focus" InstrumentSerif 22 `#333333` + `info.circle` 12 `#CFC7BE` + spacer + edit circle button
  (20px `CategoryEditCircleButton` — small pencil-in-circle).
- If no focus categories selected: "Edit categories to calculate focus." Figtree 11 `#707070`, and the cards
  below dim to 45%.
- **Total focus card**: bg `#F7F7F7`, radius 8, white 1px stroke, padding 16h/12v; "Total focus time"
  InstrumentSerif 16 `#333333` + info icon; value (title-case duration, §1.4) InstrumentSerif **34** `#F3854B`.
- **LongestFocusCard** (fixed 322×185, bg `#F7F7F7`, stroke `#ECECEC`, radius 8):
  - "Longest focus duration" InstrumentSerif 16 `#333333` at (14.5, 12.53); value ("3 hours 25 minutes" style)
    InstrumentSerif 24 `#F3854B` at (13.5, 31.53).
  - Timeline viz 301×70.02 at (10.5, 92.5): dotted axis at y 48 — 12 dots 4px `#9A9393` evenly spaced, joined by
    1px dashed line (dash 4, gap 2); focus blocks drawn above the axis as top-rounded bars (top radius 6):
    longest block solid `#F3854B`, height 50, y 0; others `#F3854B` @ 40%, height 27.88, y 22.44, min width 8.
  - Time axis mapping: the visible range is anchored so the longest block occupies x 94.05…182.07 of the 301px
    strip (i.e., range duration = longest × 301/88.02, starting `rangeDuration × (94.05/301)` before the block);
    other blocks positioned linearly and clamped.
  - Labels: start/end of the longest block (`h:mm a`) — Figtree-Bold 10 `#F3854B`, centered at x 94.05 and
    x 184.99, y 56.02(+7).
- Edit mode: overlays a **DayCategorySelectionEditor** (width 358, offset (−18, +28)): frosted panel — fill
  rgb(0.98,0.96,0.95) @ 86% over ultra-thin blur, radius 6, stroke rgb(0.91,0.88,0.87), padding 10, shadow black
  8% blur 18 y10; wrapping rows (gap 4) of `CategoryPill`s (selected = in the plan's focus set); 1px divider
  rgb(0.91,0.89,0.86); helper row `lightbulb` 11 + text Figtree 11 `#6C6761`:
  "Pick the categories that count towards Focus"; floating ✓ done button top-right (8px checkmark in a small
  frosted rounded square, offset (−8, +8)). Tapping outside closes. Toggling a pill immediately updates and saves
  the day-goal plan (focus list add/remove).

#### "Distractions so far" (`DayDistractionSummarySection`)
- Header: "Distractions so far" InstrumentSerif 22 + edit circle button. Empty-selection note:
  "Edit categories to calculate distractions." Same 45% dimming; same editor with helper
  "Pick the categories that count towards Distractions" (toggles the plan's distraction list).
- **DistractionSummaryCard** (content width 293, centered):
  - Left: **area-scaled bubble chart** — outer circle 136px, fill `#F0F0F0` @ 80%, stroke `#DDDDDD` 1px; inner
    circle diameter = `136 × sqrt(distractedRatio)` (area-proportional), tangent to the bottom (4.868px inset),
    horizontally centered; fill = linear gradient `#FFE3DE` → `#FF694B` (second stop at 78.3%), rotated 90°
    (i.e., light at top → deep coral at bottom). Hidden when diameter < 0.5.
  - Right (gap 27; column 130 wide, rows gap 24): two stats — label InstrumentSerif 14 + value InstrumentSerif 20,
    2px gap: "Total time captured" in `#9C9C9C`, "Total time distracted" in `#FF694B` (lowercase long durations).
  - Optional pattern block (currently feature-flagged **off**; `showDistractionPattern = false`): icon
    `DistractionSummaryIcon` 16 + title "Main distraction pattern" Figtree Bold 12 `#333333` + description
    Figtree 12. (Pattern = most frequent embedded-distraction title; description = its longest summary.)

---

## 5. DESIGN TOKEN ROLL-UP

### 5.1 Core palette (hex)
| Token | Hex | Where |
|---|---|---|
| Serif heading accent (Daily) | `#B46531` | Daily section headings, card titles, spinner tints |
| Daily title text | `#1E1B18` | Date title |
| Warm dark brown | `#59381F` (0.35,0.22,0.12) | Lock wordmarks + body copy |
| Deep brown button | `#402B00` (0.25,0.17,0) | Primary lock-screen buttons |
| Orange terracotta | `#D9733F` (0.85,0.45,0.25) | Lock panel titles, journal access title |
| BETA badge orange | `#FA8C33` (0.98,0.55,0.20) | BETA badges |
| Tooltip/stat accent | `#D77A43` | Grid tooltip duration, stat chip values |
| Distraction red | `#FF5950` | Grid markers, fallback palette |
| Empty grid cell | `#F2EDEB` (0.95,0.93,0.92) | Grid + distraction track |
| Grid axis | `#E0D9D5`; card border `#E8E1DA`; totals divider `#E5DFD9` | Workflow card |
| Bullet-card border | `#EBE6E3`; blockers bg `#F7F6F5` | Standup cards |
| Copy gradient | `#FF986F → #BDAAFF`; Regenerate gradient `#FFB58A → #ED9BC0`; pill stroke `#F2D7C3` | Action buttons |
| Provider browns | text `#2E221B` `#2F241D` `#8F522C`; muted `#8B6B59`; error `#B07A74`; fills `#FFF4EC` `#FAF8F7`; strokes `#EBC4AB` `#E8E1DC`; radio `#C96F3A` `#D3C6BE`; gear chrome `#F7F3F1`/`#E4D7D0` | Provider UI |
| Journal orange | header `#D9700A`; bullet `#F5923D`; nav arrow `#FFBD59`; segment active `#FFB859` | Journal |
| Journal text | primary `#2E1708`; body `#2E1C0F`; divider `#E6D9CC` | Journal |
| Reminder tokens | canvas `#FAF7F3`; accent `#FFB859`; save `#553000`; cancel fill `#F1ECE7` text `#9F8D80` border `#E1D7CC`; input `#F9F3EC` stroke `#FF9B4C`; idle day `#FBF7F1`/`#F6E1CA`/`#B9A595`; primary text `#333333` | Reminders |
| Right-rail neutrals | title `#333333`; subtitle `#707070`; label `#787878`; dividers `#E7E5E3`; card bg `#F7F7F7`/`#ECECEC` | Day summary |
| Focus/distraction accents | `#628CFF` / `#FA8282`; texts `#628CFF` / `#FC675F`; gradients `#5B87FF→#003EE9`, `#FF8C85→#FC675F` | Goals |
| Goal flow | scrim `#DB420B` 10%; orange `#FF8046`; muted `#FFEDE4`/`#B1A8A1`; success `#4AB43F`/`#F1FFE3`; fail `#FA8282`/`#FFF0F0`; wheel greys `#E9E4E2 #FFFDFC #AAA6A3 #8A8582 #F1F1F1 #E6DDD5 #E6DDD9 #E7DFDF #F8F6F5 #FCFCFC` | Goal flow |
| Focus stats orange | `#F3854B`; distraction card coral `#FF694B` (+`#FFE3DE`); captured grey `#9C9C9C` | Focus/distraction cards |
| Review bars | `#FF8772` / `#EAE0DB` (`#DDDBDA` legend) / `#42D0BB`; link `#F96E00` | Review card |
| Weekly view | see §3.6 table inline | |
| Hero view | see §3.6 inline | |
| Confetti | `#FF6B6B #FFD93D #6BCB77 #4D96FF #9B5DE5 #FF8FAB #00C2FF #FFA41B #F72585 #7AE582` | Confetti |

### 5.2 Radii
Pills/capsules: 9999. Cards: Daily workflow card 4; standup cards 12×s; provider rows 14(×s); lock panels 24/28;
unlock button 10; journal cards 8 (edit) / 12 (board); reminders 6 (panels) / 8 (buttons) / 10 (fields);
right-rail cards 8; goal flow 6 (buttons/panels) / 8 (review cards) / 4 (inner boxes); grid cells 2.75;
tooltips 4; donut segments 6; review bars 4; legend swatches 3.

### 5.3 Shadows (color / opacity / blur / y)
- Standup card: black 10% / 12×s / 0. Workflow tooltip: rgb(255,161,138) 25% / 2 / 2.
- Lock panels: black 8% / 14–18 / 6–8. Unlock button: black 8%/4/2 + black 12%/8/4.
- Journal cards: black 10% / 6 / 0; hover 12% / 12 / 4. Journal segmented: black 10% / 2 / 1.
- Right rail editor: black 8% / 18 / 10. Donut base: rgb(99,71,56) 35% / 5 / 0.
- Review bars: per-metric 25% / 4 / 2. Goal review cards: accent 75% / 10 / 0.
- Goal header "Set goals": white 50% / 4 / x∓3. Weekly cards: black 8% / 14 / 10.
- Hero badge: `#D88931` 38% / 18 / 12; hero entry `#C86E1A` 14% / 30 / 18.

---

## 6. DATA DEPENDENCIES (per section)

| UI | Reads | Writes |
|---|---|---|
| Daily lock progress | `countCompletedAnalysisBatchesForWeeklyAccess()` (completed 15-min analysis batches) | `isDailyUnlocked` flag |
| Daily workflow grid + totals | `fetchTimelineCards(forDay)` (start/end "h:mm a", category, title, distractions[]), category store (name, colorHex, order, isSystem, isIdle) | — |
| Standup drafts | `fetchDailyStandup(forDay)`, `fetchAllDailyStandups(excludingDay)` (consumed source days), `hasMinimumTimelineActivity(day, 120)` | `saveDailyStandup(forDay, payloadJSON)` |
| Standup generation | source-day `fetchTimelineCards`, `fetchObservations(startTs, endTs)` (dayflow provider only), `fetchRecentDailyStandups(limit: 3, excludingDay)` | standup save + "recap ready" notification |
| Provider picker | persisted `dailyRecapProvider_v1`, availability snapshot | provider selection |
| Journal day | `fetchJournalEntry(forDay)`, `fetchRecentJournalSummary(withinDays: 3)`, `fetchMostRecentGoals()`, `hasMinimumTimelineActivity(day, 60)` | `updateJournalIntentions/Reflections/Summary` |
| Journal summary gen | `fetchTimelineCards(forDay)`, `fetchRecentJournalSummaries(count: 3, excludingDay)` | summary save (status → complete) |
| Reminders | NotificationPreferences (isEnabled, intentionHour/Minute, reflectionHour/Minute, weekdays) | same + scheduled notifications |
| Goal header/flow | `fetchDayGoalPlan(forDay)`, `fetchMostRecentDayGoalPlan(beforeOrOn)`, timeline cards for day/yesterday/last 7 days | `saveDayGoalPlan`, UserDefaults `dayGoalReviewShownTimelineDay`, `showDailyGoalPopups` |
| Review card | `fetchReviewRatingSegments(overlapping:endTs:)` (`{startTs, endTs, rating: "distracted"|"neutral"|"focused"}`), cards-to-review count | — |

**Metric formulas (canonical):**
- Focus % is never shown as a percentage; focus is shown as durations. distractedRatio = distractedTime/capturedTime.
- Overlap removal (right rail): sort by start (ties: longer first, then recordId asc), sweep with coveredUntil.
- Focus blocks: merge gaps < 5 min. Longest focus = max block duration.
- Grid occupancy: per 15-min slot, Σ overlap / slot length, alpha = 0.3 + 0.7×occ.
- Context switches / interruptions / focused / distracted / transition: §2.4.7.
- Standup source day: first of previous 1–3 days with ≥ 120 min activity not already consumed by another standup.
- Journal "recent summary": any summary within past 3 days; canSummarize ≥ 60 min.
- Goal defaults: 270 min focus / 120 min limit; review success: focus actual ≥ target; distraction actual ≤ limit.
- Reference stats: yesterday = that day's per-category durations; week average = Σ over last 7 timeline days / 7.

---

## 7. SURPRISES / GOTCHAS FOR THE IMPLEMENTER

1. **Journal is gated by a secret access code** (SHA-256 `909ca009…bdfa` of the lowercased input) — there is no
   "request access" path; Daily instead gates on 5 analyzed hours + notification permission.
2. **Daily stat chips and the Highlights/Details toggle are dead code** — computed/styled but never rendered.
   Port the math; rendering optional.
3. **JournalHeroView and JournalWeeklyView are unwired Figma explorations** with hard-coded placeholder data; the
   Day/Week segmented control in JournalDayView does not actually switch views.
4. **Standup "yesterday" is not literally yesterday** — it's a resolved *source day* (≥ 2 h activity, 3-day
   lookback, not already consumed by another standup), and section titles adapt ("Last Friday's highlights",
   "Highlights from …").
5. **4 AM day boundary everywhere**, plus the grid's "+1440 for minutes < 240" rule and the right rail's
   different shift (4 AM → minute 0). These two normalizations are *different* — don't unify them.
6. The whole Daily surface is drawn at a **fixed 1.1 scale multiplier**; the goal flow uses a fixed 1200×680
   canvas scaled to fit. Neither is responsive re-flow — they scale.
7. The two standup cards are **joined with −1px spacing** so their borders overlap (Figma seam trick), with
   per-side corner rounding.
8. The distraction budget bar **fills from the right** (remaining budget is the red part), opposite of the focus
   bar, with an elaborate "loss" flash/shake animation when distraction time increases.
9. The distraction summary "donut" is actually an **area-true circle** (`diameter ∝ sqrt(ratio)`) pinned to the
   bottom of the outer circle.
10. LongestFocusCard's x-axis is **anchored to Figma reference geometry** (longest block always occupies
    x 94.05…182.07 and its labels sit at fixed x positions) — not a true time axis.
11. Copy button only appears after a standup entry has been persisted for the selected day; placeholder drafts
    are deliberately never saved.
12. Distraction markers merge when ≤ 2 min apart, and merged tooltips concatenate unique titles with ", ".
13. Grid tooltips are custom-drawn with an 80 ms hover-exit grace period; cell hover keys index the
    distraction-filtered row list.
14. Empty-totals copy differs between today ("No captured activity yet.") and past days ("No captured activity
    during 9am-9pm" — no period), and both have a double space after the title.
15. Provider names include marketing model labels ("GPT-5.4", "Gemini 3.5 Flash", "Claude Opus") that appear in
    both subtitle and tooltip; provider order in pickers is dayflow, claude, chatgpt, gemini, local, none.
16. Journal reflection prompt appears only after **4 PM** local; the reminders sheet auto-opens right after the
    onboarding video completes.
17. The Journal summary renders `**bold**` markers from the LLM and uses a per-character typewriter ("wet ink")
    animation with blur.
