# Dayflow Timeline UI — Porting Spec (macOS SwiftUI → React/CSS on Windows)

Source: `C:\Coding\Dayflow\Dayflow\Dayflow\` (MIT-licensed Dayflow macOS app).
Scope: main app shell, Day timeline, Week timeline grid, activity inspector, category system,
timeline review ("Tinder-swipe") overlay, video/timelapse playback, pause pill, clipboard export.
All values below are extracted verbatim from the Swift source. Points (pt) map 1:1 to CSS px.

> NOTE ON UNITS: SwiftUI "points" == CSS logical px. All fonts/sizes/paddings below are px.
> SwiftUI `Color(red:green:blue:)` values are converted to hex; both forms given where useful.
> SwiftUI `RoundedRectangle(..., style: .continuous)` ≈ CSS `border-radius` (squircle nuance ignorable at these small radii).

---

## 1. DESIGN TOKENS

### 1.1 Fonts

Only these font families appear in the timeline UI source (NO Nunito was found anywhere in the
files in scope — despite expectations, the timeline UI uses only these):

| Family | Weights used | Usage |
|---|---|---|
| **Figtree** (`.custom("Figtree", size:)` + weight modifiers; also literal PostScript names `Figtree-Medium`, `Figtree-SemiBold`, `Figtree-Bold`) | regular(400), medium(500), semibold(600), bold(700), heavy(800 — one place) | ALL body/UI text: card titles, chips, labels, buttons, footers, toasts |
| **Instrument Serif** (`InstrumentSerif-Regular`; also `"Instrument Serif"` at 30/44 in category editor) | regular only | Display text: header date label (26), review card title (24), "All caught up!" (40), feedback modal titles (18), calendar-popover weekday row (12), date pill (18), category editor headings (30/44) |
| System font (SF; on Windows use a neutral sans or Figtree) | 8–26 various | SF Symbols glyph sizing, a few labels: slideshow speed chip (16 semibold), scrubber time chip (12 semibold), "No cards yet" empty state (14 semibold system), pause-pill chip labels (11 medium / 8 semibold) |

Figtree line-height note: week card title math assumes Figtree 10 ≈ 12px line-height; the header
date at InstrumentSerif 26 has ~31px natural line height.

### 1.2 Color palette (every color found)

**Brand oranges**
- `#F96E00` — primary brand orange: selected sidebar icon/label, sidebar badge dot, today circle (week header), review scrubber playhead pill (rgb(249,110,0))
- `#FF6D00` @0.8 — review overlay close ✕; scrubber progress fill rgba(255,109,0,0.65)
- `#FC7103` — calendar popover selected-day circle & selected-week capsule
- `#FF8046` — feedback modal accent (submit button bg, checkbox, close ✕ @0.7)
- `#FF8904` @0.5 — review summary Close button border
- `#FF6600` (`rgb(1,0.4,0)`) — "here" hyperlink in category-picker helper text
- `#FF6B05` (`rgb(1,0.42,0.02)`) — DayflowButton primary background
- `#FF8A2B` (`rgb(1,0.54,0.17)`) — Retry pill background
- `#FF8D40` — progress ring fill + percent text
- `#FA6E00` (`rgb(0.98,0.43,0)`) — "Part 1 of 2 / Part 2 of 2" labels in category editor
- `#F3854B` — pause-pill status text ("Dayflow paused for …")

**Header / pill chrome (cream-orange family)**
- `#FFA777` — calendar pill fill (idle); `#FFB38E` open state
- `#F2D2BD` — border for calendar pill, Day/Week toggle, Today button, category-edit circle button; `#E8BDA1` calendar pill border while open
- `#FFEFE4` — Day/Week toggle container bg, Today button bg, category-edit circle button bg
- `#FFEBD3` @0.79 — nav-arrow hover circle
- Day/Week selected gradient: `#FFB18D`@0.6 → `#FFA46F` → `#FFB18D`, top→bottom; shadow `#E89A6C`@0.18 blur 4 y1
- `#796E64` — Day/Week unselected text + Today text
- `#594838` — hour time labels (both Day & Week)
- `#D6A685` (`rgb(0.84,0.65,0.52)`) — "N hours tracked this week" footer text + Copy-timeline text
- `#FCEDE0` (`rgb(0.99,0.93,0.88)`) — Copy-timeline button bg; stroke `#F7E3CF` (`rgb(0.97,0.89,0.81)`)
- `#FFF8F1` — TabFilterBar overflow fade-out gradient end color

**Cards & neutrals**
- `#FFFBF8` — day timeline card background
- `#FFECE4` — failed card background (day & week)
- `#FF291C` (`rgb(1,0.16,0.11)`) — failed-card dashed border + System-category selection stroke
- `#E8E8E8` — day card border; `#ECECEC` — inspector divider + feedback modal border
- `#333333` (`rgb(0.2,0.2,0.2)`) — dark text (chips, week card titles, week header labels, review text)
- `#666666` (`rgb(0.4,0.4,0.4)`) — time-range pill text, slideshow subtitle
- `#8C8C8C` (`rgb(0.55,…)`) — "SUMMARY"/"DETAILED SUMMARY" section headers
- `#808080` (`rgb(0.5,…)`) — retry status line in inspector
- `#8C7366` (`rgb(0.55,0.45,0.4)`) — failed day-card status line
- `#7A6254` — failed week-card status line (Figtree 9)
- `#F5F0E8` (`rgb(0.96,0.94,0.91)` @0.9) — time-range pill bg + backup "!" badge bg
- `#E5E5E5` (`rgb(0.9,…)`) — time pill border (0.75w); `#E0E0E0` (`rgb(0.88,…)`) — category chip/badge border
- `#FAFAFA` (`rgb(0.98,…)`) — rate-summary footer bg; stroke `#EDEDED` (`rgb(0.93,…)`)
- `#7D7875` (`rgb(0.49,0.47,0.46)`) — "Rate this summary" text (@0.95)
- `#C05C54` — Delete idle text (@0.9); `#DF6055` confirm bg; `#CB4E43` confirm stroke
- `#99664D` (`rgb(0.6,0.4,0.3)`) — sidebar unselected icon/label tint
- `#635953` (`rgb(0.39,0.35,0.33)`) — category-picker helper text
- `#A8A09A` — calendar popover month chevrons; `#C1B5AC` — disabled/out-of-month day numbers; `#E9DAD1` — calendar popover border
- `#D9D9D9` — feedback textarea border; `#AAAAAA` — feedback placeholder
- `#888D95` — paused/stopped status text & icons
- `#FAF5ED` (`rgb(0.98,0.96,0.93)`) @0.4 — cream scrim over window background image
- `#402B00` (`rgb(0.25,0.17,0)`) — dark-brown toast action button bg
- `#C04A00` — failure toast warning triangle; `#C7352D` — screen-recording notice record icon
- `#FFF8F2` — toast bg; `#F3D9C2` — toast border
- `#C22933` (`rgb(0.76,0.16,0.2)`) — slideshow error text

**Status-card gradients (the "current time indicator")**
- Recording/active gradient (leading→trailing): `#5E7FC0`@0.00 → `#D88ECE`@0.35 → `#FFC19E`@0.68 → `#FFEDE0`@1.00, drawn at opacity 0.70 over base `#D9C6BA`; stroke white@0.52 0.75w; shadow black@0.10 blur 4
- Paused/stopped gradient (leading→trailing): `#F7E6D5`@0.13 → `#DADEE4`@1.00, opacity 1.0, base transparent; stroke white 1w; shadow black@0.03 blur 2

**Thinking spinner colors** (3×3 pixel grid, sRGB triples)
- Reference: dim `rgb(0.239,0.102,0.020)`≈`#3D1A05`, mid `rgb(0.878,0.471,0.188)`≈`#E07830`, hot `rgb(1,0.624,0.353)`≈`#FF9F5A`
- Timeline status-card override: dim `#435D97` `(0.263,0.365,0.592)`, mid `#B884BC` `(0.722,0.518,0.737)`, hot `#F6BE74` `(0.965,0.745,0.455)`

**Review overlay rating colors**
| Rating | overlay bg | overlay text | bar gradient (TL→BR) | bar stroke | icon tint |
|---|---|---|---|---|---|
| Distracted | `#975D57`@0.6 | `#F9D8D4` | `#FFBDB1` → `#FF8772` | `#FF8772` | `#FF7B67` |
| Neutral | `#8C8379`@0.55 | `#F4F0ED` | `#FFFEFE` → `#EAE0DB` | `#EAE0DB` | `#C8C8C8` |
| Focused | `#43765E`@0.6 | `#D9F7E4` | `#92F1E3` → `#42D0BB` | `#42D0BB` | `#47D2BD` |
- Rating labels color `#707070`; footer icon plate `#D6AB8A`@0.7; footer label text `#98806D`
- Review overlay backdrop: `#FBE9E0`@0.92; close button border `#DABCA4`

**Cards-to-review badge**
- Gradient `rgb(1,0.6,0.44)`=`#FF9970` @(x0.05,y0) → `rgb(0.74,0.67,1)`=`#BDABFF` @(x0.95,y1)
- Border `#FFD9D4` (`rgb(1,0.85,0.83)`) 1.5w inset 0.75; shadow `#E8C9B3` (`rgb(0.91,0.79,0.7)`) blur 1.5 y2
- Front card count stroke `#F79C82` (`rgb(0.97,0.61,0.51)`), count text `#FA997D` (`rgb(0.98,0.6,0.49)`)

**Pause pill gradients** (all top→bottom unless noted; from React CSS tokens per source comment)
- Idle: `#FFF8F2`@0.6 @0 → `#FFE7D3`@0.6 @0.495 → `#FFCDB0`@0.6 @0.755 → `#FFE7D3`@0.6 @1
- Menu: `#F8C8AC`@0.6 @0 → `#FFE7D5`@0.6 @0.14 → `#FFD0B1`@0.6 @0.688 → `#F8C8AC`@0.6 @1
- Paused: `#FFB69B` @0 → `#FF9147` @0.495 → `#FF8D40` @0.760 → `#FFA482` @1 (fully opaque)
- Chip default (CSS 320° ≈ from (0.91,0.97) to (0.11,0)): white@0.72 @0 → white@0.56 @0.38 → white@0.44 @1
- Chip hover (same axis): `#FFB390`@0.82 → `#FF9F6A`@0.82 @0.42 → `#FF8D40`@0.82 @1
- Border: `#FFE1C9` 1.25w capsule; shine edge glows: idle white@0.5, menu `#F2BFA7`@0.5, paused `#FFE4C2`@0.5 (8px-wide gradient strips inside left/right edges)

**Default category colors** — see §4.

**Progress ring** (`ProgressRingView`, used in day summary): track `#FFC8A0`@0.3, fill/text `#FF8D40`,
particles `#FF8D40 #FFB69B #FFCC66 #FFA060 #FFD4A8`, confetti `#FF6B6B #FFD93D #6BCB77 #4D96FF #FF8D40 #C780FA #FF6B9D #45B7D1`.
Geometry: container 140×140, ring Ø76, stroke 8 round caps, gap fraction 0.035, percent label Figtree-Bold 16.

### 1.3 Shadows (canonical list)

| Where | Shadow |
|---|---|
| Main white panel | black@0.04 blur 4 (0,0) — plus destination-out trick, see §2.3 |
| Day card hover | black@0.08 blur 1 y1 + black@0.06 blur 2 y2; plus 1px inner ring black@0.08 |
| Week card hover | black@0.06 blur 4 y2 + black@0.05 blur 8 y4; ring black@0.10 |
| Status card active | black@0.10 blur 4 (0,0) |
| Status card paused | black@0.03 blur 2 (0,0) |
| Calendar pill (open) | black@0.10 blur 8 y2 |
| Calendar popover | black@0.16 blur 4 y1 |
| Toasts | black@0.12 blur 12 y6 |
| Feedback modal | black@0.07 blur 12 y6 |
| Review card | black@0.18 blur 14 y8 |
| Rate summary footer | **white**@1.0 blur 9 y-4 (light glow upward) |
| Cards-to-review badge | `#E8C9B3` blur 1.5 y2 |
| Video modal | black@0.25 blur 30 y10 |
| Category editor sheet card | black@0.15 blur 20 y8 |

### 1.4 Corner radii
2 (timeline cards day+week, status card week, favicon), 3 (day status card), 3.5 (badge stacked cards),
4 (speed chips, feedback textarea/submit), 5 (delete button), 6 (chips/pills/badges/feedback modal/category picker topTrailing-only), 7 (copy button),
8 (main panel, review card, toast buttons, calendar popover, panel right-edge clip), 12 (toasts, video modal, thumbnails, DayflowButton),
16 (category editor list containers), 20 (badge pill, editor sheet), 200 (retry pill = fully rounded), capsules everywhere else.

### 1.5 Motion tokens (springs given as SwiftUI (response, dampingFraction))
- Standard press scale: 0.97 @ spring(0.24, 0.82). Card press: 0.992 @ spring(0.3, 0.6). Hover scale: 1.02 (cards 1.005/1.01) @ spring(0.24, 0.82)
- Mode switch content: cubic-bezier(0.165, 0.84, 0.44, 1) 240ms (ease-out-quart); Day enters scale .95→1, Week enters 1.05→1, cross-fade
- Toggle highlight slide: spring(0.26, 0.84) (matched geometry — implement as sliding highlight)
- Entrance stagger (day cards): opacity 0→1, translateX 12→0, spring(0.35, 0.8), delay = index × 30ms
- Sidebar/tab change: spring(0.35, 0.9)
- Toast in: spring(0.28, 0.9), out spring(0.25, 0.92), slide from right + fade
- Calendar popover: open easeOut 180ms (fade + y −6→0), close easeOut 120ms (fade + y→−4)
- Week card hover expand: spring(0.28, 0.88); collapse same ×1.4 speed; hover intent delays: enter 120ms, exit 60ms
- Review card: undo re-enter spring(0.35, 0.85) from bottom (+cardHeight+160); swipe exit ease-in 180–280ms scaled by velocity
- Reduce-motion: all replaced by linear 10–100ms

---

## 2. APP SHELL

### 2.1 Window
- Min size **900 × 508**; default size **1195 × 675**; resizable, hidden title bar (frameless, content extends into title area)
- Single window app.

### 2.2 Window background
- Full-bleed image asset **`MainUIBackground`** (scaled to fill), overlaid with solid `#FAF5ED` at 40% opacity. Sits behind everything; not interactive.
- The content stack is padded **15px on top/right/bottom** (left is the 100px sidebar gutter, no left padding).

### 2.3 Two-column layout
```
┌ window ──────────────────────────────────────────────┐
│ [left column w=100]  [right white panel, fills rest] │
└──────────────────────────────────────────────────────┘
```
**Left column (100px wide, transparent, sits on wallpaper):**
- Top: logo `DayflowLogoMainApp` at 48×48 inside a 100px-tall area, centered, translateY +8
- Middle: `SidebarView` vertically centered
- Entrance animation: logo scales 0.8→1 fade-in; sidebar slides translateY −30→0 fade (delay 150ms); timeline header −20→0 (delay 100ms); content fade (delay 200ms). All spring(0.5, 0.8).

**Sidebar** (`SidebarView.swift`) — all metrics are base × **scale 1.1**:
- Item: 61.6 × 61.6 (56×1.1), vertical stack, spacing 5.25
- Each item = icon (17.6×17.6, in a 37.4 container) above label (Figtree 12.1 ≈ `11×1.1`), gap 3
- Selected: image asset `IconBackground` behind icon at 33×33 (30×1.1); icon+label tint `#F96E00`. Unselected tint `#99664D`.
- Notification badge: `#F96E00` circle Ø8.8, offset (+11, −11) from icon center (shown for Daily recap / Journal reminder)
- Hover: scale 1.02; press: 0.97; cursor pointer
- **Items in order** (journal exists but is filtered OUT of the visible list):
  1. Timeline — asset `TimelineIcon`, label "Timeline"
  2. Daily — `DailyIcon`, "Daily"
  3. Weekly — `WeeklyIcon`, "Weekly"
  4. Chat — `ChatIcon`, "Chat"
  5. Bug — SF `exclamationmark.bubble.fill`, label "Report"
  6. Settings — SF `gearshape.fill`, label "Settings"

**Right panel:**
- White rounded rect radius 8. Background trick in source: white fill w/ shadow black@0.04 blur 4, then destination-out, then white@0.22 — the *net visual effect* is a translucent milky-white panel (≈ rgba(255,255,255,0.22) over wallpaper) with a soft outer shadow. In CSS: `background: rgba(255,255,255,0.22); box-shadow: 0 0 4px rgba(0,0,0,0.04); border-radius: 8px;` (frosted-glass feel; the timeline pane content itself supplies more white).
- Contains, depending on tab: Settings (padding 15), Chat, Daily, Weekly, Journal (padding 15), Bug report (padding 15), or the Timeline panel.

### 2.4 Timeline panel structure
```
┌ timelineLeftColumn (flex) ┬ divider 1px #ECECEC ┬ inspector column ┐
│  header (36h)             │                     │ Day: 358px fixed │
│  TabFilterBar             │                     │ Week: 340px or 0 │
│  scrollable timeline      │                     │ bg white@0.7     │
│  footer overlay           │                     │ right corners 8  │
└───────────────────────────┴─────────────────────┴──────────────────┘
```
- Left column padding: top 24 (`TimelineAlignment.topInset`), bottom 15, left 15, right 5. Gap between header and content: 18.
- Inspector: Day mode always 358px wide showing either `ActivityCard` (selection) or `DaySummaryView` (no selection). Week mode: 340px, only when an activity is selected (otherwise width 0 and divider hidden). Inspector bg white@0.7, clipped with rounded right corners (8).
- Week inspector content animates: fade + translateX 10→0, easeOut 180ms.

### 2.5 Timeline header (h=36, horizontal padding 10)
Leading cluster (height 30, offset x −10 `pickerRowOffset`):
1. **Prev/Next arrows** — image assets `LeftArrow` / `RightArrow` 24×24, spacing 2 between them; hover shows circle Ø30 `#FFEBD3`@0.79 behind (fade 120ms); disabled at 35% opacity (next is disabled when at today/current week). Press scale 0.97 (calendar uses 0.985).
2. **Calendar pill** — 36×30 capsule, fill `#FFA777`, border `#F2D2BD` 1px, icon `CalendarIcon` 16×16. Open state: fill `#FFB38E`, border `#E8BDA1`, shadow black@0.10 blur 8 y2. Toggles calendar popover.
3. **Day/Week toggle** — container 104×30 capsule bg `#FFEFE4` border `#F2D2BD`; two 52×30 segments "Day"/"Week", Figtree 12 medium; selected segment has the orange gradient capsule (see tokens) w/ shadow, text white; unselected text `#796E64`. Highlight slides between segments (spring 0.26/0.84).
4. **Today button** — 56×30 capsule, bg `#FFEFE4` border `#F2D2BD`, "Today" Figtree 12 medium `#796E64`. Only shown when NOT viewing today (day) / current week (week). Appears/disappears with fade+scale 0.94.
5. **Inline date label** — InstrumentSerif-Regular 26 black, left margin 10, one line. Day mode: `Today, Apr 16` (format `'Today,' MMM d`) or `Wed, Apr 16` (`E, MMM d`). Week mode: `April 14 - April 20` (`MMMM d - MMMM d`, week end shown inclusive = weekEnd−1day). Clicking it in Day mode opens the graphical date-picker sheet.

Gap between elements: 4 (`calendarGap`).

**Responsive priority ladder** (recompute per width): reserve trailing = max(measured pause-pill width, 120) + 18. Base = chevrons(50) + gap(4) + calendar(36). Then add if fits: Today (+4+56, only if applicable) → Day/Week (+4+104) → inline date (+10 + measured text width; allowed to overflow budget by 55px only while the trailing cluster is compact <100px). Elements drop in reverse order as pause pill expands.

Trailing cluster: **PausePillView** (right-pinned, see §2.7).

### 2.6 Calendar popover (`TimelineCalendarPopover`)
- Anchored under the calendar pill: x centered on pill (clamped 12px from panel edges), y = pill bottom + 55. An invisible full-panel click-catcher closes it.
- Card: content width 282 (7 cols × 30 + 6 gaps × 12), padding 28 h / 20 top / 20 bottom → preferred width **338**
- Background: backdrop-blur (ultraThinMaterial) + white@0.5 tint; radius 8; border `#E9DAD1` 1px; shadow black@0.16 blur 4 y1; ALWAYS light theme
- Month header: `MMMM yyyy` Figtree 14 black, height 20; right side ‹ › chevrons (SF, 16 medium, `#A8A09A`, 20×20 hit)
- Weekday row: **InstrumentSerif-Regular 12**, black, Monday-first single letters (locale veryShort symbols rotated), each cell 30×20; column gap 12
- Day grid: rows height 30, row gap 12; day cell 30×24, Figtree 12; current-month = black; out-of-month or disabled (future) = `#C1B5AC`
- Selected day (day mode): `#FC7103` filled circle Ø24 behind white number
- Selected week (week mode): full-row `#FC7103` capsule 282×30; numbers white (out-of-month/disabled white@0.55); no per-day circle
- Future dates not selectable. Week rows are true Mon–Sun weeks; grid pads with prev/next-month days.

### 2.7 Pause pill (`PausePillView`) — Dynamic-Island-style morphing capsule, height 32
- States: **idle** (73 wide: pause icon + "Pause" `#786655` Figtree-Medium 12) → **menu** (250 wide: same + 4 duration chips) → **paused** (84 wide: play icon + "Resume" white).
- Chips: 42×20 capsules, spacing 2, labels `∞`(system 11 medium) / `1 Hour` / `30 Mins` / `15 Mins` (system 8 semibold), text `#494949` (white on hover), white-gradient fill, hover orange gradient, white@0.6 border, press 0.95.
- Storyboard: Idle→Menu pill 73→250 spring(0.5s, bounce .15), chips cascade right-to-left stagger 50ms (opacity/blur/x-offset in). Menu→Idle chips exit then 250→73 spring(0.45, bounce .2) delayed 120ms. Menu→Paused chips exit, 250→84 spring(0.5, bounce .2), pause content blurs/scales out, Resume enters delayed 280ms, status text cascades in at 350ms. Paused→Idle 84→73 spring(0.4, bounce .35).
- Status text to the LEFT of the pill (gap 10): "Dayflow paused for MM:SS" (monospaced digits, live countdown) or "Dayflow paused indefinitely" (auto-hides after 3s), color `#F3854B`, Figtree-Medium 12, letter-spacing −0.36.
- Pill body: state gradient + edge "shine" strips + `#FFE1C9` 1.25 border; hover scale 1.02 (idle only), press 0.97.
- If recording is stopped (not paused), pill shows Resume state and clicking starts recording.

### 2.8 Toasts (bottom-trailing, padding 24, slide-in from right)
**Timeline failure toast** (LLM failure): 360 wide, padding 14, bg `#FFF8F2`, radius 12, border `#F3D9C2`, shadow black@0.12 blur 12 y6. Row: SF `exclamationmark.triangle.fill` 14 `#C04A00` + message Figtree 13 black@0.82 + ✕ (11 semibold black@0.45, 18×18). Below: button "Open Provider Settings" (gear icon 12 + Figtree 12 semibold white, bg `#402B00`, radius 8, padding 14×8, white@0.17 inner stroke).
**Screen recording notice**: identical chrome; icon SF `record.circle.fill` 15 `#C7352D`; title "Screen recording access needed" Figtree 13 semibold black@0.86; body "Dayflow cannot update your timeline until access is restored." Figtree 12 black@0.62; button "Open System Settings".

### 2.9 Date picker sheet (Day-mode modal; `DatePickerSheet`)
- 420 wide, padding 30; "Select Date" title2 semibold; native graphical calendar 350 wide restricted to ≤ today; buttons: "Cancel" (gray@0.2 bg, radius 8, padding 20×8) and "Select" (accent bg, white text). Both just close; the date binds live.

---

## 3. DAY TIMELINE VIEW (`CanvasTimelineDataView`)

### 3.1 Layout algorithm
- Vertical scrolling canvas covering **4:00 AM → 4:00 AM next day** (start hour 4, end hour 28 → 24 hours).
- `hourHeight = 168px` → **pixelsPerMinute = 2.8**. Total content height = 24 × 168 = **4032px**.
- Left time gutter width **60**; card area fills the rest. No horizontal scrolling.
- Hour rows: for each hour, a 0.75px line of black@0.10 at the top of its 168px slot, indented left 60 (lines span card area only).
- Time labels: `4:00 AM` … `3:00 AM` format `h:00 AM/PM`; Figtree **12**, `#594838`, right-aligned in the 60px gutter, padding-right 5, padding-top 2, each label shifted **up 8px** so it straddles its hour line. Clicking the gutter clears the selection.
- Card vertical position: `y = minutesSince4AM × 2.8 + 1` (1px top gap); `height = max(10, durationMinutes × 2.8 − 2)` (1px gap top & bottom).
- Overlap resolution (display only): iteratively trim the LARGER of any two overlapping cards so the smaller keeps its full range; if a card is fully contained, the larger keeps its longer side; degenerate cards are dropped. Max 8 passes. (Same algorithm in week view.)
- Data refresh: reloads every 60s, on window focus, on date change, on external refresh trigger. Day boundary = 4 AM (before 4 AM you are still on "yesterday").

### 3.2 Auto-scroll behavior
- On mount/today: scroll so that the hour marker **2 hours before now** sits at 25% from the viewport top (`anchor (0, 0.25)`), no animation on first paint; content is hidden (opacity 0) until the first scroll lands, then fades in easeOut 180ms (prevents 4AM→now flash).
- Navigating back to today, idle-reset (inactivity), and 4AM day rollover re-trigger the scroll animated easeInOut 350ms.
- Past days: no auto-scroll; content revealed immediately.

### 3.3 Day activity card anatomy (`CanvasActivityCard`)
- Container: bg `#FFFBF8`, radius 2, border `#E8E8E8` 0.25w (inset 0.25); **left accent bar 6px wide** in the category color, rounded only on left corners (2). Outer horizontal margin 6px each side of the card layer.
- Content row (only rendered when duration ≥ 10 min): `[favicon 18×18] gap 6 [title] …spacer… [backup "!" badge] [time label]`
  - padding: left 16, right 10, vertical 6 (compact cards — duration < 13 min — use 0 vertical padding and center vertically)
  - Title: Figtree 16 regular, black@0.9
  - Time label: `h:mm a - h:mm a` (e.g. `9:15 AM - 9:45 AM`), Figtree 13 (title−3) medium, black@0.7, 1 line tail-truncated
  - Favicon: from primary/secondary app-site domains via favicon service, 18×18 radius 2 (hidden if user pref `showTimelineAppIcons` off, or no sites)
  - Backup indicator: white-ish circle Ø14 (bg `#F5F0E8`@0.9, border `#E5E5E5` 0.75) with "!" Figtree 9 semibold `#666`; tooltip: "This card fell back to a lower-quality Gemini model due to rate limiting, so output quality may be lower."
- Selection: 1.5px stroke in the category accent color (red `#FF291C` for the System category); selected card z above others.
- Hover: ring black@0.08 1px + two soft shadows; scale 1.005; easeOut 180ms; press 0.992.
- Failed cards (`title == "Processing failed"`): bg `#FFECE4`, dashed red border (`#FF291C`, 0.5w, dash [2.5,2.5]), NO accent bar; layout title + time on one row plus a retry status line (Figtree 13, `#8C7366`) beneath.
- Click toggles selection (select → shows in inspector; click again or click empty canvas/gutter → deselect).
- Entrance: staggered fade/slide (see motion tokens) when day changes; silent refreshes (timer/focus) skip animation.

### 3.4 Current-time indicator = "recording projection" status card
There is **no thin now-line**. Instead, when viewing today, a gradient **status card** occupies the projected window of the next timeline card:
- Window = 15-min cycle centered on now (start = now − 7.5min), clamped inside 4AM day and pushed *after* any existing card it intersects; hard cap 40 min.
- Same y/height math as cards (min height 10), radius 3, horizontal margin 6, left inset = 60 gutter.
- Active: animated 3×3 "thinking spinner" (scale 0.5) + text "Generating your next card" Figtree 12 semibold white; hidden if height < 24px (compact).
- Paused: SF `pause.fill` 11 semibold + "Dayflow is paused. Click 'Resume' to generate new activity cards." — Figtree 12 regular `#888D95`; card is clickable → resumes.
- Stopped: SF `play.fill` + "Dayflow isn't recording. Click 'Resume' to generate new activity cards." — clickable → starts recording.

### 3.5 TabFilterBar (category chip row, above timeline)
- Positioned with left padding 10 + 55 (`categoryRowInset` aligns chips with the card area), height 24
- Chips (non-system categories in order, then the Idle chip last): `[dot Ø10 category color] gap 10 [name Figtree 13 medium #333]`, padding 8×5, height 26, bg white@0.76, radius 6, border `#E0E0E0` 0.5w; chip gap 5, row leading pad 2
- Overflow: horizontal scroll (no indicators) + 40px fade-out gradient (transparent → `#FFF8F1`) before the edit button
- Trailing: **category edit circle button** Ø24 — asset `CategoryEditButton` icon at 48% of diameter, bg `#FFEFE4`, border `#F2D2BD`; opens the category editor overlay (§4.3)

### 3.6 Footer (overlaid at bottom of timeline pane; bottom padding 17, h padding 24)
- Left: weekly hours text — bold "**N hours**" + regular " tracked this week" (Day mode) or " of activities tracked this week" (Week mode); Figtree 10, `#D6A685`. Fades out proportionally (12px fade distance) when overlapping an hour label, and hides entirely when a card scrolls under it.
- Right: **Copy timeline** button — 104×23, radius 7, bg `#FCEDE0`, stroke `#F7E3CF` (inset 0.5), text/icon `#D6A685`; content: `Copy` icon 11.5 + "Copy timeline" Figtree 11.5 medium. States: copying = small spinner; copied = ✓ + "Copied" for 2s; transitions slide-up/fade (300ms snappy). Hover 1.02, press 0.97.
- Center (Day mode only, when there are unreviewed cards AND (user has a review rating in last 7 days OR has never rated)): **CardsToReviewButton** — see tokens §1.2; label "N card(s) to review" via stacked-cards icon holding the count; opens review overlay. Copy: `card to review` (1) / `cards to review` (n).

### 3.7 Activity inspector (`ActivityCard`, right column Day mode / Week selection)
Padding 16, vertical stack gap 16:
1. Header: title Figtree 16 semibold black; below it a row: time-range pill (`h:mm a - h:mm a`, Figtree 12, `#666`, padding 6×4, bg `#F5F0E8`@0.9, radius 6, border `#E5E5E5` 0.75w) … category badge (dot Ø8 + name Figtree 12 `#333`, padding 8×4, bg white@0.76, radius 6, border `#E0E0E0` 0.5w) + **category swap button** (asset `CategorySwapButton` 24×24) which toggles the category picker overlay.
2. Failed cards instead show a **Retry** pill right-aligned: white "Retry" Figtree 13 medium + SF `arrow.clockwise`, padding 12×8, bg `#FF8A2B`, fully rounded; while retrying: beige pill bg `#E8D9CC` with spinner + "Processing" `#666`. Status line under header (Figtree 11 `#808080`): `Status: Queued (1 of 3)` / `Status: Reprocessing - Step: 1/2 Transcribing...` (animated 1–3 dots, 600ms) / `2/2 Generating cards` / `Status: Failed - retry stopped` / `Status: Stopped - earlier batch failed`.
3. Media (non-failed): 200px-tall thumbnail, radius 12, image scaled 1.3 and clipped; centered play control = circle Ø64, white@0.9 border 2, fill black@0.35, SF `play.fill` 24 bold white, drop shadow black@0.25 blur 6 y2. While preparing: dim overlay black@0.28 + spinner + "Preparing timelapse..." Figtree 12 semibold white. Placeholder when no thumb: gray@0.3 rounded rect + SF `photo` icon. Click opens timelapse slideshow (or video modal when timelapse-on-disk pref is on and a video exists). Error text below: Figtree 11 `#C22933`.
4. Summary block (scrolls internally): "SUMMARY" Figtree 12 semibold `#8C8C8C`, then summary markdown-inline rendered Figtree 12 black (text selectable). If detailedSummary differs: "DETAILED SUMMARY" header + text; single-paragraph detailed summaries get newlines inserted before each `h:mm AM - h:mm PM` range.
5. Bottom rate footer — see §5.4.

Empty inspector states (centered, padding 16):
- Has cards, none selected: "Select an activity to view details" Figtree 15 gray@0.5
- No cards & recording: "No cards yet" (system 14 semibold gray@0.7) + "Cards are generated about every 15 minutes. If Dayflow is on and no cards show up within 30 minutes, please report a bug." (Figtree 13 gray@0.6, centered)
- No cards & not recording: "Recording is off" + "Dayflow recording is currently turned off, so cards aren't being produced." (note: source uses a typographic apostrophe in "aren’t")

### 3.8 Category picker overlay (`CategoryPickerOverlay`, slides over inspector top)
- Panel: padding 12, bg `rgb(0.98,0.96,0.95)`@0.86 (`#FAF5F2`) + backdrop blur; radius only top-right 6; border `rgb(0.91,0.88,0.87)`≈`#E8E0DE` 1px; transition: slide from top + fade, spring(0.25, 0.85)
- Wrapping flow of category pills (current category moved to front), h-gap 6, v-gap 8: `[dot Ø10] gap 10 [name Figtree 13 medium #333]`, padding 6×5, radius 6
  - Selected: gradient `#FFFDF8`→`#FFE8D3` (leading→trailing), border `#FBBB80` (rgb(0.98,0.73,0.50))
  - Unselected: white@0.76, border `#E0E0E0` 0.5
  - Idle & unselected: dashed border [2,2] 0.75w
- Divider 1px `rgb(0.91,0.89,0.86)`≈`#E8E3DB`
- Helper: Figtree 12: "To help Dayflow organize your activities more accurately, try adding more details to the descriptions in your categories **here**." — body `#635953`, "here" is an `#FF6600` underlined link opening the category editor.

---

## 4. CATEGORY SYSTEM

### 4.1 Model
`TimelineCategory { id: UUID, name, colorHex, details, order, isSystem, isIdle, isNew, createdAt, updatedAt }`
Persisted as JSON in preferences under key `colorCategories`. Idle category always ensured to exist. Max **20** categories. New category default color `#E5E7EB`, default name "New category" (auto-suffixed 2, 3…). Card→category match is by trimmed, case-insensitive name; fallback color `#4F80EB` when a hex fails to parse.

### 4.2 Default categories (fresh install)
| Name | Hex | Flags | Description |
|---|---|---|---|
| Work | `#B984FF` | — | "Career, school, or productivity-focused activities (projects, emails, assignments, video calls, learning skills, etc.)" |
| Personal | `#6AADFF` | — | "Purposeful non-work activities or life tasks (paying bills, fitness tracking, meal planning, personal research, creative hobbies, etc.)" |
| Distraction | `#FF5950` | — | "Passive consumption or aimless browsing (scrolling feeds, watching random videos, clicking through news, mindless games, etc.)" |
| Idle | `#A0AEC0` | system + idle | "For when the user is idle for most of the time." |

Onboarding role presets replace the first three with role-specific sets sharing this palette:
`#6A7EFF` (primary work), `#56CFEE` (secondary), `#C787F7` (research), `#FFAE8C` (Communication), `#FF4721` (Distraction), `#ADE3E3` (Personal). (Roles: Software Engineer, Founder/Executive, Designer, Student, Product Manager, Data Scientist, Other — see `TimelineCategory.swift` for each role's names/descriptions.)

### 4.3 Category editor overlay (`ColorOrganizerRoot`, opened as sheet over the app)
- Scrim black@0.16; card white radius 20, shadow black@0.15 blur 20 y8, padding 28–64 responsive (compact < 960 width)
- Two stages: **Details** and **Colors**
- Details stage: heading "Customize your categories" (Instrument Serif 44); left instructions panel with "Part 1 of 2" (Figtree 14 bold `#FA6E00`) + "Edit title and description" (Instrument Serif 30), two icon rows (`CategoriesOrganize` / `CategoriesTextSelect` 28px) with copy:
  - "Dayflow organizes your activities by the category titles and descriptions you provide."
  - "Try to provide as much details in the descriptions as you can to help Dayflow understand your workflow and habits."
  - "This step is optional. You can customize the categories or create new ones anytime while using Dayflow." (Figtree 12 medium `#7A7A7A`)
- Right: scrollable list (container radius 16 white@0.2 + border `#F0E8DE` 1px, height ≈ 303–370) of category cards: display card = name Figtree 12 bold black + description Figtree 12 medium `#595959` (placeholder "Add a description to help Dayflow understand your workflow." when empty), edit/delete icon buttons (`CategoriesEdit`/`CategoriesDelete` 20px); edit mode = name TextField Figtree 14 bold + description textarea (placeholder "Professional, school, or career-focused tasks (coding, design, meetings).") + `CategoriesCheckmark` save button.
- "Create a new category" button: `+` + Figtree 14 bold `#7D5429`, gradient `#FFF0C9`→`#FFB86E`, border `#F2B58F` 1px, radius 6; disabled at 45% opacity at 20 categories.
- Colors stage: "Part 2 of 2" / "Edit colors"; **HSL color wheel** Ø224 (padding 20) over a fading dot-pattern tile: hue = angle, lightness = 15 + 75×(r/R), S fixed 100; draggable main bullet Ø48 + satellite bullets; wheel image itself hidden (`showColorWheel=false`) so the user drags on the dot pattern. Below: helper text ("Click and drag on the canvas above to change the color palette. Then drag a color onto a category." / while dragging: "Drop on a category →") + 4×2 grid of 60×36 swatches (8 spectrum colors sampled at 45° steps from current angle/lightness). Swatches are DRAG SOURCES (drag hex text onto a category row). First-run tooltip "Drag to category".
- Category rows (drop targets): 18×18 color swatch (radius 6, white 1.5 border, shadow) + name + description; drop-target highlight border `rgb(0.6,0.5,0.4)` 1.5.
- Footer buttons: "Back" (white@0.85, radius 12, border `#E0E0E0`, Figtree 16 semibold `#424242`, 160 wide) and "Next"/"Save" continue button; footnote "This step is optional. You can change the colors anytime while using Dayflow."
- From the timeline, the editor is opened with completion title "Save".

### 4.4 Week-card palette derivation (per category)
- accent = category color; fill = accent blended **88% toward white**; border = accent blended **62% toward white**; title always `#333333`. (Day cards use the raw accent only for the left bar + selection ring.)

---

## 5. TIMELINE REVIEW OVERLAY (`TimelineReviewOverlay` — swipe-to-rate)

Full-panel overlay (fades in) with backdrop `#FBE9E0`@0.92.

### 5.1 Chrome
- Close button top-right (trailing 22, top 16): Ø28 circle white@0.7, border `#DABCA4`, ✕ SF 12 semibold `#FF6D00`@0.8. Esc also closes.
- Loading: small circular spinner.

### 5.2 Card stack
- Base card size **340×440**, scaled uniformly to fit available space (clamp 0.1×–1.4×); current + next card rendered (next behind).
- Card: white, radius 8, shadow black@0.18 blur 14 y8. Contents top-to-bottom:
  1. **Media** height 220: screenshot-sequence player (or AVPlayer for saved timelapses) filling, aspect-fill; fallback gradient black@0.25→black@0.05; 1px white@0.2 border. Click toggles play/pause. While hovering media: bottom-right **speed chip** (Figtree/system 14 semibold white on black@0.8, radius 4, padding 10×6) cycling **20x → 40x → 60x → 120x** (playbackSpeed 1/2/3/6 × 20 label).
  2. **Scrubber** overlaid on media bottom (28 tall interaction zone; 4px line): track rgba(163,151,141,0.5); progress fill rgba(255,109,0,0.65); floating time pill 48×16 radius 4 fill `#F96E00`, white Figtree-SemiBold 8, shows absolute wall-clock time at playhead, clamped to bar; sits 3px above the line. Drag anywhere to scrub (pauses while scrubbing, resumes if was playing).
  3. Text block (padding 20 h / 18 v, gap 12): title InstrumentSerif-Regular 24 black (2-line clamp); row: category pill (dot Ø8 + name Figtree 10 bold `#333`, bg categoryColor@0.10, radius 6, stroke categoryColor 0.75, padding 6×4) … time pill (Figtree 10 bold `#656565`, bg `#F5F0E9`@0.9, border `#E4E4E4` 0.75, radius 6, padding 6×4); scrollable summary Figtree 14 medium `#333` line-spacing 3; bottom-right progress "3/12" Figtree 10 medium `#AFAFAF`.
- **Rating overlay badge** while dragging past soft threshold: full-card tint (rating overlayColor) + centered icon 48 + label Figtree 20 bold in overlayTextColor. Icons: distracted = SF `scribble`, neutral = custom dotted-face, focused = SF `sparkles`.

### 5.3 Interactions
- Drag (mouse) & trackpad two-finger scroll both move the card: offset = translation, rotation = x/18 degrees. Soft thresholds 30px show the overlay badge; commit thresholds: |x| > 140 → Focused (right) / Distracted (left); y < −120 → Neutral (up).
- Keyboard: ← Distracted, → Focused, ↑ Neutral, `Z` undo, Space play/pause, Esc close.
- Commit: card flies out along predicted velocity (distance = 1.6 × max card dim; duration 0.28 − 0.1×velocityNorm; easeIn), rating persisted per time range, next card advances. Undo: previous card drops back in from below (offset +height+160, spring 0.35s/0.85).
- Bottom UI: "Swipe on each card on your Timeline to review your day." Figtree 14 medium `#98806D`; row (gap 44) of buttons — Undo (icon: rounded-rect `#D6AB8A`@0.7 with white "Z"), Distracted / Neutral / Focused (16px `#D6AB8A`@0.7 rounded plates with white triangle rotated 0°/90°/180°), labels Figtree 12 medium `#98806D`.
- Activities offered = today's cards minus System category, minus cards ≥80% covered by existing rating segments; sorted by start time.

### 5.4 Rate-summary footer (inspector bottom bar, `TimelineRateSummaryView`, height 28)
- Full-width bar, padding 12×3, bg `#FAFAFA`, 1px stroke `#EDEDED`, white glow shadow (blur 9, y −4)
- Left: **Delete** button — Figtree 12 medium; idle text `#C05C54`@0.9; click → "Confirm" (white on `#DF6055`, stroke `#CB4E43`, radius 5, padding 9, auto-revert 2s); confirm → spinner (deleting) then card removed.
- Right: "Rate this summary" Figtree 12 medium `#7D7875`@0.95 + thumbs up/down buttons: asset `ThumbsUp` 14×14 (down = flipped both axes) in Ø22 circles; selected = white circle + shadow black@0.08 blur 6 y3.
- Rating opens the **feedback modal** (below), anchored bottom-left of inspector (padding-left 24, slide-up+fade spring 0.35/0.85).

### 5.5 Feedback modal (`TimelineFeedbackModal`, width 286)
- Card padding 24, radius 6, bg vertical gradient bottom `#FFF4E9` → white (white from 15% up), border `#ECECEC`, shadow black@0.07 blur 12 y6; close ✕ Ø22 white@0.9 circle, `#FF8046`@0.7 icon, offset (−8, +6)
- Form mode: title "Thank you!" InstrumentSerif 18 `#333`; subtitle "Tell us more about your feedback" Figtree 13 medium; textarea height 90 white radius 4 border `#D9D9D9`, text Figtree 12 medium `#333`, placeholder (Figtree 12 medium `#AAAAAA`): "I don't have access to your timeline (privacy first!), so your feedback here helps improve the quality of Dayflow for everyone."; checkbox 14×14 radius 2 `#FF8046` (filled + white ✓ when on, default ON) with label Figtree 10 medium black: "I'd like to share this log to the developer to help improve the product."; Submit button full-width h30 radius 4 bg `#FF8046` white Figtree 12 medium "Submit". Auto-focuses textarea after 300ms.
- Thanks mode: "Thank you for your feedback!" InstrumentSerif 18; body Figtree 12 medium: "If you find that your activities are summarized inaccurately, try editing the descriptions of your categories to improve Dayflow's accuracy."; illustration image `CategoryEditUI` height 140, radius 6, white@0.7 0.5 stroke, shadow black@0.08 blur 12 y6.

### 5.6 Review summary state ("All caught up")
Shown when the queue empties (max width 500, gap 30):
- "All caught up!" InstrumentSerif 40 `#333`
- "You've reviewed all your activities so far.\nThe Timeline right panel will be updated with your rating." Figtree 16 medium `#333` centered
- **Summary bars**: one row, height 40; each non-zero rating gets a rounded-rect (radius 4) whose width = its share of total rated duration (8px gaps); fill = rating barGradient, 1px barStroke, shadow stroke@0.25 blur 4 y2. Below (gap 28): per rating — icon 16 + name Figtree 12 `#707070`, duration beneath ("2h 15m"/"45m") Figtree 16 semibold `#333` indented 18.
- "Close" button: capsule gradient `#FFF9F1`@0.9→`#FDE8D1`@0.9 (TL→BR), border `#FF8904`@0.5 1.25, Figtree 14 semibold `#333`, padding 24×10.

Empty state (no cards at all): "Nothing to review yet" InstrumentSerif 28 `#333` + "Come back after a few timeline cards appear." Figtree 14 medium `#707070`.

---

## 6. WEEK TIMELINE GRID (`WeekTimelineGridView`)

### 6.1 Geometry
- Same 4AM→4AM axis; `hourHeight = 111` → **pixelsPerMinute = 1.85**; total height 24×111 = **2664**
- Time gutter width **48**; remaining width / 7 = dayWidth; 7 columns Monday→Sunday
- Header row height 22 (gap 2 to grid): per column, centered `[weekday "Mon" Figtree 12 medium #333] gap 6 [day number]`; today's number is white Figtree 12 semibold in a `#F96E00` circle Ø18; other numbers Figtree 12 medium `#333`
- Grid lines: horizontal 1px black@0.10 at each hour (indent 48); vertical 1px black@0.10 dividers between the 7 columns (none on the far left edge)
- Time labels: Figtree **9** `#594838`, right-aligned in gutter, padding-right 6 top 2, shifted up 7
- Cards: x inset per column: 3 left / 5 right (cardWidth = dayWidth − 8); y = minutesSince4AM × 1.85 + 1; height = max(**16**, raw − 2)
- Background tap clears selection. Refresh timer 60s.

### 6.2 Week card anatomy (`WeekTimelineActivityCard`)
- bg = category fill (accent 88%→white), radius 2, border 0.5px category border color (accent 62%→white); selected: 1px accent stroke; **left accent bar 5px** (left corners 2)
- Content: `[favicon 12] gap 4 [title Figtree 10 semibold #333, wraps]`, padding left 9 / right 6 / vertical 4 (compact = duration < 24 min or height < 40 → vertical 2)
- Resting title line clamp = floor((height − 2×pad − statusH)/12) lines, min 1, tail-truncated
- **Hover-expand**: after 120ms hover intent, card grows downward to its natural text height (measured + 4 buffer), revealing full title; z-index 10; ring black@0.10 + lifted shadows; spring(0.28, 0.88). Collapse 60ms exit delay, 1.4× faster. Card hover also scales 1.01.
- Failed cards: bg `#FFECE4`, dashed `#FF291C` 0.5 [2.5,2.5], no accent bar; retry status line Figtree 9 `#7A6254` (+ mini spinner when retrying)
- Click = select/deselect (opens 340px inspector column with the same `ActivityCard`)

### 6.3 Week status card (projection, today's column only)
Same projection window as Day; width = week card width, radius 2, min height 16.
- Active: spinner (scale 0.4, gap 1, blue/purple/gold palette) + "Next card..." Figtree 10 semibold white (text hidden when height < 24). Same active gradient/base/stroke as Day but radius 2, padding-h 8.
- Paused: `pause.fill` + "Paused" Figtree 10 medium `#888D95`; Stopped: `play.fill` + "Resume" — with the paused gradient.

### 6.4 Auto-scroll & mode-switch
- On first mount of a week only: scroll so relevant content sits near the top — target = (earliest content y of the selected day − 60 min), else if week contains today: (now − 60 min), else earliest content in week; clamped to hour indices. Content hidden until the scroll commits, then fades in 180ms.
- Week→Day switch: week cards are hidden instantly (no animation) before the cross-zoom transition to prevent artifacts; selection cleared on any mode switch.
- Data loads off-main-thread; stale responses (week changed mid-flight) are discarded.

---

## 7. CLIPBOARD / EXPORT FORMATS (`TimelineClipboardFormatter`)

The footer Copy button copies **plain text** (`makeClipboardText`). A markdown variant (`makeMarkdown`) exists for other surfaces. Reproduce EXACTLY (note the em-dash `—`, en-dash `–` in ranges, bullet `•`, 3-space and 6-space indents):

### 7.1 Day, plain text
```
Dayflow timeline · Today, Apr 16

1. 9:15 AM – 9:45 AM — Reviewing pull requests
   Work
   Summary: <summary line>
   Details: <details line>

2. ...
```
- Header: `Dayflow timeline · ` + `Today, MMM d` (if today) else `EEEE, MMM d` (e.g. `Wednesday, Apr 16`)
- Entry bullet: `N. {start} – {end} — {title}` (start/end are the raw stored `h:mm a` strings; if one is empty the dash collapses appropriately)
- Meta line: 3-space indent, category name (parts joined by ` • ` — currently category only)
- Summary/Details blocks: single line → `   Summary: text`; multi-line → `   Summary:` then each line at 6-space indent. Details omitted when identical to summary. Blank lines separate every block/entry (`joined(separator: "\n\n")`).
- Empty day: header + blank line + `No timeline activities were recorded for this day.`

### 7.2 Week, plain text
```
Dayflow timeline · April 14 - April 20

Monday, Apr 14

1. ...

Tuesday, Apr 15

1. ...
```
Header uses the week title (`MMMM d - MMMM d`); then per day with cards: day heading (`Today, MMM d`/`EEEE, MMM d`), blank line, entries (numbering restarts per day, sorted by day then start time then title). Empty week: `No timeline activities were recorded for this week.`

### 7.3 Day, markdown (`makeMarkdown`)
```
## Dayflow timeline · Today, Apr 16

1. **9:15 AM – 9:45 AM — Reviewing pull requests**
   - _Work_
   - Summary: <text>
   - Details: <text>
```
Multi-line summary/details become `   - Summary:` with continuation lines at 6-space indent. Empty: `_No timeline activities were recorded for this day._`

---

## 8. ALL UI COPY (verbatim)

**Header / navigation**: `Day` · `Week` · `Today` · `Select Date` · `Cancel` · `Select`
**Footer**: `{N} hours` + ` tracked this week` / ` of activities tracked this week` · `Copy timeline` · `Copied` · `card to review` / `cards to review`
**Empty/inspector states**: `Select an activity to view details` · `No cards yet` · `Cards are generated about every 15 minutes. If Dayflow is on and no cards show up within 30 minutes, please report a bug.` · `Recording is off` · `Dayflow recording is currently turned off, so cards aren’t being produced.` · `SUMMARY` · `DETAILED SUMMARY`
**Failed/retry**: `Processing failed` (card title sentinel — drives all failed-card styling) · `Retry` · `Processing` · `Status: Queued ({i} of {n})` · `Status: Reprocessing - Step: 1/2 Transcribing…` · `2/2 Generating cards` · `Status: Failed - retry stopped` · `Status: Stopped - earlier batch failed`
**Status cards**: `Generating your next card` · `Next card...` (week) · `Paused` · `Resume` · `Dayflow is paused. Click 'Resume' to generate new activity cards.` · `Dayflow isn't recording. Click 'Resume' to generate new activity cards.`
**Pause pill**: `Pause` · `Resume` · `∞` · `1 Hour` · `30 Mins` · `15 Mins` · `Dayflow paused for {MM:SS}` · `Dayflow paused indefinitely`
**Timelapse/video**: `Preparing timelapse...` · speed chips `20x` `40x` `60x` (+`120x` in review) · errors: `Could not find this activity in storage.` · `No screenshots are available for this activity range.` · `This activity cannot load a slideshow.`
**Backup badge tooltip**: `This card fell back to a lower-quality Gemini model due to rate limiting, so output quality may be lower.`
**Category picker**: `To help Dayflow organize your activities more accurately, try adding more details to the descriptions in your categories here.` ("here" = link)
**Category editor**: `Customize your categories` · `Part 1 of 2` · `Edit title and description` · `Part 2 of 2` · `Edit colors` · `Dayflow organizes your activities by the category titles and descriptions you provide.` · `Try to provide as much details in the descriptions as you can to help Dayflow understand your workflow and habits.` · `This step is optional. You can customize the categories or create new ones anytime while using Dayflow.` · `This step is optional. You can change the colors anytime while using Dayflow.` · `Create a new category` · `New category` · `Add a category to get started.` · `Add a description to help Dayflow understand your workflow.` · `Professional, school, or career-focused tasks (coding, design, meetings).` (placeholder) · `Click and drag on the canvas above to change the color palette. Then drag a color onto a category.` · `Drop on a category →` · `Drag to category` · `Back` · `Next` · `Save`
**Review overlay**: `Swipe on each card on your Timeline to review your day.` · `Undo` · `Distracted` · `Neutral` · `Focused` · `All caught up!` · `You've reviewed all your activities so far.\nThe Timeline right panel will be updated with your rating.` · `Close` · `Nothing to review yet` · `Come back after a few timeline cards appear.`
**Rate/feedback**: `Rate this summary` · `Delete` · `Confirm` · `Thank you!` · `Tell us more about your feedback` · placeholder `I don't have access to your timeline (privacy first!), so your feedback here helps improve the quality of Dayflow for everyone.` · `I'd like to share this log to the developer to help improve the product.` · `Submit` · `Thank you for your feedback!` · `If you find that your activities are summarized inaccurately, try editing the descriptions of your categories to improve Dayflow's accuracy.`
**Toasts**: `Open Provider Settings` · `Screen recording access needed` · `Dayflow cannot update your timeline until access is restored.` · `Open System Settings`
**Sidebar labels**: `Timeline` `Daily` `Weekly` `Chat` `Report` `Settings` (`Journal` exists but hidden)
**Clipboard**: see §7.

---

## 9. VIDEO / TIMELAPSE PLAYBACK COMPONENTS

### 9.1 Video modal (`VideoPlayerModal` / `VideoExpansionOverlay`)
- Opens via hero-expand from the 200px thumbnail (scale-from-thumbnail spring 0.35/0.85) or as a sheet; scrim black@0.7 (staged 0→0.1→0.5→0.7); modal = 90% of window, white, radius 12, shadow black@0.25 blur 30 y10.
- Header (padding 16×10, white, 1px gray@0.25 rule): title (title3 semibold), `9:15 AM to 9:45 AM` caption `#666`; close `xmark.circle.fill` 20 black@0.5.
- Video area: white letterbox, aspect-fit; center play button (Ø64 circle, white@0.9 2px ring, black@0.35 fill, `play.fill` 24 bold) when paused; click anywhere toggles; hover reveals bottom-right speed chip `20x/40x/60x` (system 16 semibold white on black@0.85, radius 4, padding 12×6) cycling rates 1×/2×/3× (labels ×20).
- Space = play/pause, Esc = close (ignored while typing in a text field).

### 9.2 Scrubber (`ScrubberView`, bottom of modal; total height 92)
- Chip row 28 + filmstrip 64. Filmstrip: white bg, square corners, 12-ish tiles of 16:9 thumbnails (tileWidth = 64×16/9 ≈ 113.8), zoomed 1.2 and clipped, count = ceil(stripWidth/tileWidth); empty tiles black@0.06. Side gutters 30 each.
- Playhead: 5px black bar (with shadow) + 3px white bar centered inside, extending 3px above the strip into the chip row; snapped to device pixels.
- Time chip: follows playhead x; `h:mm a` absolute time (falls back to `m:ss`); system 12 semibold white on black@0.85, radius 12, padding 8×4, rendered at 0.8 scale.
- Drag anywhere on the strip to seek (position → % of duration).

### 9.3 Screenshot slideshow modal (`ScreenshotSlideshowModal`)
- min 960×640, white; header like §9.1 (subtitle `X to Y`); stage on black@0.95 with aspect-fit CG-image frames; center play overlay Ø68 when paused; bottom-right speed chip 20x/40x/60x; bottom scrubber = 8-frame screenshot filmstrip variant of §9.2. Space toggles. Playback advances through screenshots in real-capture-time, scaled by speed (20/40/60×), looping.

---

## 10. SURPRISES / GOTCHAS FOR THE IMPLEMENTER

1. **No Nunito anywhere** in the timeline UI source — only Figtree + Instrument Serif (+ system). Don't budget for it.
2. **There is no "current time line"** in either timeline. The "now" affordance is the gradient *recording-projection status card* occupying the predicted next-card window (15-min cycle, pushed below overlapping cards, 40-min cap), and it's a click target when paused/stopped.
3. **Day starts at 4 AM**, not midnight. Everything — y-positioning, "today" logic, day rollover timer (checks every 60s), week ranges (Mon 4:00 → next Mon 4:00) — uses the 4AM boundary. Cards with times before 4 AM belong to the previous calendar day's timeline. Dates are normalized to noon internally to dodge DST.
4. **Failed cards are detected purely by title string** `"Processing failed"` — treat it as a sentinel in both views and the retry system.
5. **Overlap handling trims the LARGER card** (display only) so short cards always win; identical algorithm duplicated for Day and Week.
6. The main panel uses a **destination-out blend** hack; the practical result is a ~22%-opacity white glass panel over the wallpaper, not solid white.
7. Header responsiveness is a **priority ladder driven by the measured pause-pill width** (Today → Day/Week → date drop off as the pill expands to 250px), with a 55px "liberal allowance" for the date only while the pill is compact (<100px).
8. Day timeline hides card *content* below 10-minute duration (bar-only, min height 10px) and switches to compact padding below 13 minutes; Week cards hover-expand instead of ever shrinking text (fixed Figtree 10).
9. Both scroll views are rendered **invisible until the initial auto-scroll lands** (then 180ms fade) to avoid a "4 AM flash".
10. The review overlay supports **trackpad scroll-as-swipe** with horizontal-vs-vertical disambiguation when hovering the summary text (needs wheel-event handling on web), plus keyboard arrows/Z/Space/Esc.
11. `Cards to review` button visibility rule: `count > 0 AND (rated within last 7 timeline days OR never rated at all)` — long-lapsed raters stop seeing the prompt.
12. Copy button copies **plain text**, not markdown; markdown formatter exists but is not wired to this button.
13. Delete is a **two-step inline confirm** (Delete → Confirm within 2s) with no modal.
14. Category matching is name-based (trimmed/lowercased), so renames orphan old cards to the fallback (first category).
15. Week grid columns are computed from `weekRange.days` (Mon-first, locale-independent `firstWeekday = 2`).
16. Timeline review speed chips go up to **120x** (6×20) unlike the video modal's 60x max.
17. Sidebar dimensions are all pre-multiplied by a **1.1 scale factor**.
18. The calendar popover forces **light appearance** even in OS dark mode; the whole app is light-only.
