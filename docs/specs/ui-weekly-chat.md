# Dayflow — Weekly Dashboard & Chat UI Porting Spec (macOS SwiftUI → Windows React/CSS)

Source: `Dayflow/Dayflow/Dayflow` (MIT). This document is self-contained: an implementer should NOT need the Swift source.
All coordinates/sizes are in points (treat as CSS px). All colors are 6-digit hex unless noted. The entire app renders in **forced light mode** (`.environment(\.colorScheme, .light)`).

---

## 0. Shared primitives (used by every Weekly builder)

### 0.1 Day / week model
- A "day" runs **4:00 AM → 4:00 AM next calendar day** (not midnight). Day strings are `yyyy-MM-dd`.
- A "week" starts **Monday 4:00 AM** and ends the following Monday 4:00 AM. Calendar: Gregorian, `firstWeekday = 2` (Monday), `minimumDaysInFirstWeek = 4`, timezone = system.
- `WeeklyDateRange.containing(date)`: compute the week start (Monday of the ISO-ish week containing `date`), set time to 04:00. If `date < Monday 04:00`, subtract 7 days (i.e., early-Monday-morning belongs to the previous week). `weekEnd = weekStart + 7 days`.
- `shifted(byWeeks: n)`: add `n*7` days to weekStart; weekEnd = start + 7 days.
- `canNavigateForward` = `weekStart < WeeklyDateRange.containing(now).weekStart`.
- **Header title**: `"{EEEE, MMMM d} - {EEEE, MMMM d}"` where the end date shown is `weekStart + 6 days` (e.g., `Monday, August 10 - Sunday, August 16`). Plain hyphen surrounded by spaces.

### 0.2 Timeline card time parsing
Cards store `startTimestamp`/`endTimestamp` as strings like `"9:20 AM"` (h:mm a). `parseTimeHMMA` parses them to minutes-since-midnight (hour*60+minute); returns null on failure.

`normalizedMinuteRange(start, end)` — maps times into a 4AM→28:00 window:
```
adjustedStart = start < 240 ? start + 1440 : start      // times before 4 AM belong to late night
adjustedEnd   = end   < 240 ? end   + 1440 : end
if adjustedEnd <= adjustedStart: adjustedEnd += 1440    // crossed midnight
```
Duration in minutes = `max(round(adjEnd - adjStart), 0)`; cards with duration ≤ 0 or unparseable times are dropped.

### 0.3 Category key normalization
Two variants exist:
- **Donut/Overview builders**: `trim → fold(caseInsensitive, diacriticInsensitive) → lowercase` (spaces kept).
- **Dashboard builder (`normalizedKey`)**: same folding, then every non-alphanumeric char becomes `-`, then split on `-` and join with `_` (e.g., `"Coding/Debugging"` → `coding_debugging`).

Empty/whitespace category names display as `"Uncategorized"`.

`firstCategoryLookup`: build a dict of normalizedKey → first matching `TimelineCategory` (categories are pre-sorted by their `order`; first wins on key collision).

### 0.4 Fallback color hash (djb2)
When a category/app has no configured color:
```
hash = 5381; for byte in utf8(key): hash = ((hash << 5) &+ hash) &+ byte   // 64-bit wrapping
index = abs(hash) % palette.count
```
Palettes:
- Donut & Overview builders: `["93BCFF", "DE9DFC", "6CDACD", "FFA189", "BFB6AE"]`
- Dashboard builder (treemap/sankey/workflow/heatmap/app-facts): `["93BCFF", "DE9DFC", "6CDACD", "FFA189", "FFC6B7", "BFB6AE"]`
Note: Swift `Int` is 64-bit wrapping; replicate with BigInt-free 64-bit wrap (e.g., `Number` is unsafe; use BigInt64 or emulate 32-bit — to be pixel-faithful on colors you must match 64-bit wrapping semantics).

Color hexes coming from category config have `#` stripped and (dashboard builder) uppercased; empty → `BFB6AE`.

### 0.5 System/Idle filtering
A card is **system** if its category resolves to a `TimelineCategory` with `isSystem == true` OR normalized key equals `"system"`. **Idle** likewise with `isIdle`/`"idle"`. Nearly all Weekly visualizations exclude system+idle facts (details per section below).

### 0.6 Distraction detection (dashboard builder)
`isDistractionCard(card)` = true if `card.distractions` array is non-empty, else if lowercase of `"{categoryName} {subcategory} {title} {summary}"` contains `"distraction"` or `"distracted"`.

### 0.7 App identity (dashboard builder)
Raw app source = first non-empty of `card.appSites.primary`, `card.appSites.secondary`; fallback scans `"{title} {summary}"` for known app names (`ChatGPT, Claude, Codex, Cursor, Xcode, Dayflow, Figma, Slack, Zoom, YouTube, Reddit, Substack, Notion, Linear, GitHub, Safari, Chrome, Calendar, Mail, Messages`), else `"Other"`.

Pretty-name mapping (substring match on lowercase, first hit wins, in this order):
`chatgpt→ChatGPT, claude→Claude, codex→Codex, cursor→Cursor, xcode→Xcode, dayflow→Dayflow, figma→Figma, slack→Slack, zoom→Zoom, meet.google→Meet, google meet→Meet, youtube→YouTube, reddit→Reddit, twitter→X, x.com→X, substack→Substack, notion→Notion, linear→Linear, github→GitHub, safari→Safari, chrome→Chrome, calendar→Calendar, mail→Mail, messages→Messages, maps→Maps, clickup→ClickUp, runway→Runway, flora→Flora`.
If no mapping: take text before first `,;|\n`, strip `https://`, `http://`, `www.`, `com.apple.`; if it looks like a bare domain (contains `.`, no space) use the first domain label Title-Cased; else Title-Case the cleaned string; empty → `Other`.

App accent colors (substring match on lowercase pretty name):
`chatgpt 333333, claude D97757, codex 111111, cursor 111111, xcode 4085FD, dayflow FF7A2F, figma FF7262, slack 36C5F0, zoom 4085FD, meet 34A853, youtube FF0000, reddit FF613C, x 111111, substack FF6E3E, notion 111111, linear 5E6AD2, github 24292F, safari 2E8BFF, chrome 4285F4, calendar A29993, mail 4F8EF7, messages 38D06E, other D9D9D9`; else djb2 fallback (6-color palette).
⚠️ Because this is substring matching, `"x"` matches many names — the list is ordered, so earlier entries win.

App kind classification (`work | personal | distraction`):
- If card is a distraction → `distraction`.
- Else if lowercase `"{appName} {categoryName}"` contains any of `youtube, reddit, x, twitter, tiktok, netflix, game` → `distraction` (note: bare substring `x` matches a lot — faithful port must keep this).
- Else if contains any of `personal, shopping, maps, messages, photos, music` → `personal`.
- Else `work`.
An app aggregate is `distraction` if ANY of its facts is; else `personal` if any is; else `work`.

### 0.8 Duration text helpers
- `durationText(min)`: `"Xh Ym"` / `"Xh"` / `"Zm"` (dashboard builder, workflow tooltips/footer).
- Overview/treemap variant: `"Xhr Ym"` / `"Xhr"` / `"Zm"`.
- Sankey variant: `"Xhr Ymin"` if hours > 0 else `"Ymin"`.

---

## 1. Design tokens

### 1.1 Fonts
| Token | Family | Usage |
|---|---|---|
| Serif titles | `InstrumentSerif-Regular` | Section titles (20px), stat values (16–24px), donut center (16px), week header (20px) |
| Serif italic | `InstrumentSerif-Italic` | Chat beta lock title (38px) |
| Body | `Figtree` (Regular/Medium/SemiBold/Bold) | Everything else (8–16px) |
| Mono numeric | `SpaceMono-Regular` | Treemap delta chips (10–12px) |
| System mono | monospace 10–12px | Debug/tool output, code blocks |
SF Symbols icons used throughout — substitute with equivalent icon set (names given inline below).

### 1.2 Core colors
| Purpose | Hex |
|---|---|
| Weekly page background | `FBF6EF` |
| Card background (most weekly cards) | `white @ 60%` (some 75%/78% — noted per section) |
| Card border | `EBE6E3` (workflow uses `E8E1DA`) |
| Card corner radius | 4 (weekly cards), 6 (context charts / app interactions / hover card) |
| Section title color | `B46531` (serif 20px) |
| Body text | `333333` / `black` |
| Muted text | `777777`, `796E64`, `7F7062`, `717171`, `8A7768` |
| Accent orange (chat) | `F96E00`; secondary `F98D3D`, `FF7A2F` |
| Success green | `34C759` (text alt `2D7D46`) |
| Error red | `FF3B30` / `C62828` |
| Distraction red | `FF5950` (workflow), `FC7645` (heatmap/graph) |
| Focus blue | `4276E9` (heatmap dark), `4779E9` (graph work) |
| Default category palette | `93BCFF` (blue), `DE9DFC` (purple), `6CDACD` (teal), `FFA189` (salmon), `FFC6B7` (pink), `BFB6AE` (gray "Other") |

### 1.3 Chat gradient background
Chat pane background: vertical linear gradient `FFFAF5 → FFF6EC`.

---

## 2. Weekly view

### 2.1 Page composition & scroll
`WeeklyView` fills its panel, background `FBF6EF`, vertical ScrollView (indicators hidden). Content column:
1. `WeeklyHeader` (week nav) — bottom padding 16.
2. Then either the **data-requirement gate** (if selected week < 15h recorded) or the dashboard sections stacked with **24px spacing**:
   1. **Top row**: Weekly distribution (donut card) + Context charts card. Side-by-side when wide, stacked (18px gap) when narrow.
   2. **Your workflow this week** (workflow grid) — height 292.
   3. **Focus and distraction heat map** — height 238.
   4. **Most used per category** (treemap) — height 549.
   5. **Weekly breakdown** (sankey) — height = `contentWidth * 933/1748`.
Page paddings: top 28, bottom 48, horizontal `min(56, max(24, panelWidth*0.03))`.

`WeeklyAdaptiveLayout` constants:
- `designContentWidth = 958`, `maximumContentWidth = 1500`.
- `contentWidth = min(1500, panelWidth - 2*horizontalPadding)`.
- Top row: `topRowSpacing = 27`, `topRowHeight = 300`. Two-column mode when `rawContentWidth >= 958`.
- `donutCardWidth = min(620, max(461, floor((contentWidth - 27) * 0.44)))`; `contextCardWidth = contentWidth - 27 - donutCardWidth`.
- Fixed section heights: workflow 292, heatmap 238, treemap 549, dataGate 360, `designSankeyHeight = 958*933/1748 ≈ 511.3`.

Data loads per week (`fetchTimelineCardsByTimeRange(weekStart, weekEnd)`) + previous week cards + `fetchTotalMinutesTracked` for the gate. Reloads on week change, categories change, and app foregrounding. While loading: donut shows a spinner; other sections render with current (possibly empty) snapshot.

**Default week on entry**: starting from the current week, walk back up to 52 weeks; pick the first week with ≥ 15h (900 min) recorded; else the first week with > 0 minutes; else current week.

### 2.2 Access lock (30h gate)
Weekly unlocks after **120 completed 15-minute analysis batches** (30 recorded hours). While locked, `WeeklyAccessLockedView` shows:
- Background: a blurred (2.2px), 46%-opacity, slowly auto-scrolling (26s linear, autoreverse) preview of the dashboard rendered from hard-coded Figma preview data (donut, overview, treemap, sankey, heatmap, context charts at 958 design width), overlaid by a wash: `FFF8F0 @ 28%` + linear gradient topTrailing→bottomLeading `[white 68%, FDF3EA 42%, FFE2C4 22%]`, clipped to radius 8.
- Centered lock card 485×276, radius 10, fill `FFF7EF`, white 1px border, shadow `80450D @ 20%, blur 12, y 2`; decorative radial-gradient "glow" circles (orange/yellow tones) positioned partly outside the card.
  - Title "Unlock Weekly" — InstrumentSerif-Regular 22, `333333`.
  - Subtitle "Weekly unlocks after 30 hours of recorded timeline data" — Figtree-Regular 14, `796E64`.
  - Countdown pill (166×60 capsule, fill `FFEBD6`, border `FF8904 @ 50%`, shadow `FDE7D1` blur 8 y2) with progress text like `"12h 30m / 30h"` (InstrumentSerif-Regular 20.5, `FF7856`). Text rules: 0 → "0h / 30h"; <1h → "Xm / 30h"; whole hours → "Xh / 30h"; else "Xh Ym / 30h".
  - Progress bar: width 413.35, height 8 capsule track `EAE0DD`; fill = horizontal gradient `C6D9FF → FF9A78`; knob = 24px circle `FF6E00` containing white Dayflow logo (13.5px) that rotates 360° over 22s (disabled with reduce-motion), knob shadow `FF6E00 @ 18% blur 5 y2`.
  - Button 188×36, radius 4, fill `402B00` (62% opacity when disabled), white Figtree-Medium 14 label. Label by state: ready → "View Weekly"; idle → "Notify me when ready"; requesting → "Setting reminder..."; scheduled → "We'll notify you"; denied → "Open notification settings"; failed → "Try again".
- Card scales down to fit small panels (min scale 0.66).

### 2.3 Data-requirement gate (per-week, 15h)
When the selected week has < 900 recorded minutes, instead of sections show a 360px-tall card (max content width 540): radius 10 rect fill `FFF7EF`, white border, shadow `80450D @ 12% blur 12 y2` containing (18px vertical spacing):
- "Keep recording to unlock this week" — InstrumentSerif-Regular 24, `333333`.
- "Weekly insights need at least 15 hours of recorded activity for the selected week." — Figtree-Regular 14, `796E64`, centered, max 2 lines.
- Pill (`"{recorded} / {target}"` e.g. `3h 20m / 15h`) — InstrumentSerif-Regular 22, `FF7856`, capsule fill `FFEBD6`, border `FF8904 @ 50%`, height 58, horiz padding 24, shadow `FDE7D1` blur 8 y2. Duration format here: 0 → "0h"; <1h → "Xm"; whole → "Xh"; else "Xh Ym".
- Progress bar 420×24 (same style as lock card: track `EAE0DD`, gradient fill `C6D9FF→FF9A78`, 24px `FF6E00` logo knob, no rotation).
- `"{remaining} more to unlock this week"` — Figtree-Medium 13, `8A7768`.

### 2.4 Week header
Centered HStack (spacing 14, height 29):
- Left/right arrow buttons: 24px arrow image inside a 30px hover circle (`FFEBD3 @ 79%`, fades in 0.12s ease-out on hover). Disabled (future) arrow at 35% opacity, no hover. Press-scale button style; pointer cursor.
- Title: week range string, InstrumentSerif-Regular 20, black, fixed width 344, centered.

### 2.5 Hover download/export affordance (every section)
Hovering any section fades in (0.12s) a small download button placed next to a hidden copy of the section title (so it sits right of the title text). Button: 24×20, radius 6, fill `FFF5EA`, border `F7E4CE` 0.75px, icon `arrow.down.to.line` 10px `DF8351`. Tooltip: `Download {title} as a full-resolution PNG`. Per-section button origins (x,y from section top-left): workflow (79,16); heatmap (44,34); treemap (40,34); sankey (contentWidth*72/1748, contentWidth*64/1748); donut card (18,16); context charts (24,16).
Export: renders the section at design width (958; sankey at 958×511.3 design box) on `FBF6EF` background, scaled so output is 1080px wide, plus a watermark pill (26px tall capsule, white 94%, border `EBE6E3`, shadow black 5% blur 6 y2, 16px Dayflow logo + "Generated with" Figtree-SemiBold 10 `786A61` + "Dayflow" Figtree-Bold 10 `B46531`), padded 14px from the chosen corner (bottom-trailing for all except sankey = bottom-leading). File name: `dayflow-weekly-{week-title-slug}-{graphic-slug}.png` with slugs `weekly-workflow`, `focus-heatmap`, `focus-breakdown`, `weekly-breakdown`, `weekly-distribution`, `context-charts`.

### 2.6 Weekly distribution (donut)

**Data (`WeeklyDonutBuilder.build`)**
1. Keep cards whose `day` string is one of the 7 week-day strings.
2. Drop system/idle (by key or category flags).
3. Per category key accumulate minutes (per §0.2); capture display name (category config name, else trimmed card category), color (config colorHex minus `#`, else djb2 5-palette), order (config order else Int.max).
4. Drop zero-minute categories. If none → empty snapshot.
5. Sort: minutes desc → order asc → name (case-insensitive asc).
6. If more than **5** items: keep top 4 and collapse rest into `Other` (`BFB6AE`, minutes summed).
7. `totalMinutes` = sum of visible items (i.e., after collapse).

**Layout** — card 461×300 default (adaptive width; height fixed 300): radius 4, fill white 60%, border `EBE6E3`.
- Title "Weekly distribution" InstrumentSerif-Regular 20 `B46531` at (18, 16).
- Content row (top padding 56, horizontal 18, spacing 18): donut then legend.
- Donut size = `min(235, max(176, cardWidth * 0.43))`.
- Donut composition (centered ZStack):
  - White circle (full donut size) with shadow `rgb(0.39,0.28,0.22) @ 35%, blur 5`.
  - Pie/donut chart of `chartSize = size - 8`: each item is a sector sized by minutes with **innerRadius ratio 0.62, angular inset 1.5, corner radius 6**, filled with item color. (Swift Charts SectorMark: sectors start at 12 o'clock, clockwise.)
  - Overlay radial gradient white 35% → transparent from ratio 0.62 to edge (soft inner glow), non-interactive.
  - Inner white circle diameter `chartSize*0.62 - 8`.
  - Center text: "TOTAL" Figtree-Bold 8 `A5A5A5`; then `"{H} hours"` and `"{M} minutes"` each InstrumentSerif-Regular 16 `333333` stacked (singular "hour"/"minute" when 1).
- Empty state: white circle + 20px `E6E0DB` ring + center "TOTAL"/"No activity" (`777777`).
- Loading: centered spinner in donut area.
- Legend: vertical stack (8px gap), one row per item: 12×8 rounded (1.5) color swatch + name (Figtree-Regular 14 black, 1 line) + right-aligned percent (`round(minutes/total*100)` + "%", Figtree-Regular 14 black, min width 32).

### 2.7 Context charts card ("Context shift and distractions comparison")

**Data (`buildContextCharts`)** — per weekday (Mon..Sun labels `Mon,Tue,Wed,Thur,Fri,Sat,Sun` — note **"Thur"**):
- Facts = week facts for that day excluding system/idle, sorted by start.
- `shifts` = count of consecutive fact pairs with different category keys (whole day).
- `distractionTimes` = for each fact: if the card has embedded `distractions`, each distraction's parsed start minute; else if the fact is itself a distraction, its start minute. `distracted` = count of these (whole day).
- Distribution events (NOT rendered — see dead code §6): context-shift events at fact start and distraction starts, only within 10:00–18:00, formatted `HH:mm`, capped at 80.
- Insight: busiest day = max of `(distracted + shifts)`; if that max is 0 → `"No context shift or distraction pattern was detected in this week."` else `"{Day} had the most interruptions, with {shifts} context shifts and {distracted} distractions."`

**Layout** — card `width × 300`; top area = 300-58=242, footer 58. Radius 6, border `EBE6E3`, background white 78% (footer white 58%), 1px separator `EBE6E3` above footer.
- Title "Context shift and distractions comparison" InstrumentSerif-Regular 20 `B46531` (top padding 16, horiz 24).
- Legend row (34px gap): 10px circle + label Figtree-Regular 12 black. Series: "Number of times distracted" `FF8A8A`; "Number of context shifts" `A78CFF`.
- "Count" label Figtree-Regular 12 black above chart.
- Line chart: width = `max(320, width-48)`, height 104. Two catmull-rom smoothed lines, 2px stroke, with point marks (symbol size 42 ≈ 6.5px diameter). X domain `0..days-1`, Y domain `0...max(maxValue+2, 4)`. Axes hidden; instead a custom L-shaped axis line (left edge + bottom edge) stroked `5A534C @ 90%` 1px.
- X labels row: day labels (Figtree-Regular 12 black) spread with spacers (first at left edge, last at right edge).
- Footer: 10px `F5AD41` circle + insight text (Figtree-Regular 14 black, up to 2 lines).

### 2.8 Your workflow this week (grid)

**Data (`buildWorkflow`)**
- Facts exclude system/idle.
- Visible window = `weeklyActivityWindow`: earliest fact start −30 min, latest fact end +30 min, clamped to [240, 1680] (4 AM–4 AM+24h), snapped outward to 15-min multiples (`floor`/`ceil`); if snapped end == 1440 exactly, extend to 1680; fallback window 9:00–22:00 (540–1320) when no facts.
- Slots of **15 min**; `slotCount = max(1, (end-start)/15)`.
- Rows: Mon..Sun (labels `Mon,Tue,Wed,Thur,Fri,Sat,Sun`). Per slot: accumulate per-bucket overlap minutes; bucket = "Distraction" (id `distraction`, color `FF5950`) if category key contains `distraction` or name contains it (case-insensitive), else the category (name + color). Cell = dominant bucket (max minutes; tie → name asc): `categoryName`, `colorHex`, `minutes = round(total overlap of ALL buckets)`, `occupancy = min(1, totalMinutes/15)`. Empty slot → nil color, occupancy 0.
- Time labels: every whole hour from `ceil(start/60)*60` to `floor(end/60)*60`, formatted `9am`, `12pm`, `1:30pm` style (minutes only if nonzero; 12-hour; `am` for hour24 < 12).
- Totals: group ALL visible facts by bucket id; sum durations; drop zero; sort minutes desc then name; take **top 7**. Each total: name, minutes, `durationText` ("Xh Ym"), colorHex.

**Layout** — width = contentWidth, height 292 (fixed frame from parent; internal: grid panel + divider + footer). Radius 4, fill white 78%, border `E8E1DA`.
- Title "Your workflow this week" InstrumentSerif-Regular 20 `B46531`, top 16, left = 36+30+13 = 79.
- Grid panel padding: top 53, leading 36, bottom 6, trailing 52. Day label column width 30 (right-aligned, Figtree-Regular 11, black 90%), 13px gap to grid.
- Cells 13×13, gap 2, corner radius 2.5. Grid horizontally scrollable if overflow (no indicators).
- Cell fill: empty → `rgb(0.95,0.93,0.92)`; else category color at opacity `0.3 + occupancy*0.7`.
- Cell tooltip: `"{Day} {start}-{end}: {Category}, {duration}"` or `"{Day} {start}-{end}: No activity"` (times like `9am`, `9:15am`).
- Under grid: 0.9px hairline `E0D9D5` across grid width (10px above), then absolute-positioned hour labels (Figtree-Regular 10, black 78%, 34px wide each) at `progress*gridWidth - 17`, clamped; first label left-aligned at 0, last right-aligned at gridWidth-34.
- Divider `E5DFD9`, then footer (padding 14/16/12/16, horizontally scrollable): "Week total" InstrumentSerif-Regular 14 `777777`, then for each total: `{name}` Figtree-Regular 12 `1F1B18` + `{duration}` Figtree-SemiBold 12 in the bucket color, 8px between items, 2px inside pair.
- Footer empty state: `"Week total  No captured activity during {start}-{end}"` Figtree-Regular 12 `7F7062` (two spaces after "total").

### 2.9 Focus and distraction heat map

**Data (`buildHeatmap`)**
- Facts exclude system/idle. Window = same `weeklyActivityWindow`. Bucket = **5 min**; `bucketCount = ceil((end-start)/5)`; snapshot `endMinute = start + bucketCount*5`.
- Row order: **Sun first**, then Mon..Sat (offsets `[6,0,1,2,3,4,5]`; labels `Sun, Mon, Tue, Wed, Thur, Fri, Sat`).
- Per day, compute per-bucket values in [-1, 1] (negative = focused, positive = distracted):
  1. Sort facts by start. For each fact, if gap from previous fact ≤ 20 min AND `"{categoryKey}|{appKey}"` signature differs → add 1 "switch pressure" to the bucket containing the fact's start.
  2. **Full-distraction fact** (lowercase `"{categoryName} {subcategory}"` contains "distraction"/"distracted"; OR fact.isDistraction with NO embedded distractions): add its interval to `distractionMinutes` buckets (overlap-weighted).
  3. Otherwise: add interval to `focusMinutes`; then for each embedded distraction interval (aligned into the parent's range ±2 min, choosing the 1440-shifted candidate minimizing `|dStart-pStart| + 0.1*|pEnd-dEnd|`), add to `distractionMinutes` AND subtract from `focusMinutes`.
  4. Scores per bucket:
     ```
     cleanFocus[i]  = focus[i] >= 3 (0.6*bucket) && distraction[i] < 1
     runLen[i]      = length of contiguous cleanFocus run containing i (else 0)
     focusRatio     = clamp(focus[i]/5, 0, 1)
     distRatio      = clamp(dist[i]/5, 0, 1)
     sustainedBoost = min(1, runLen[i]/6)
     focusStrength  = focusRatio * (0.35 + 0.65*sustainedBoost)
     distStrength   = min(1, distRatio * 1.25)
     switchStrength = min(1, switchPressure[i]/2) * 0.22
     raw[i]         = clamp(distStrength + switchStrength - focusStrength, -1, 1)
     ```
  5. Smoothing (focused cells only): for `raw[i] < 0`, take neighbors i−1..i+1 with value < 0; if ≥ 2 such (incl. self), `value = clamp(0.55*v + 0.45*avgNegativeNeighbors, -1, 1)`.

**Rendering color** (`WeeklyFocusHeatmapSection`)
- Constants: `neutralThreshold = 0.045`, `centerBoostStrength = 0.34`, `edgeFadeStrength = 0.65`.
- Per cell, run-aware adjustment: find the contiguous same-sign run (|v| ≥ threshold) containing the cell; if run length ≥ 4:
  ```
  centerProgress = smoothstep of (1 - |pos-center|/center)   // p*p*(3-2p)
  edgeIntensity   = max(0.045, |v| * (1-0.65))
  centerIntensity = min(1, |v| + 0.34)
  intensity = edge + (center-edge)*centerProgress  (signed)
  ```
- If |value| < 0.045 → neutral `F2F2F2`.
- Else `progress = pow(clamp(|v|,0,1), 0.72)`; linear RGBA interpolation: focused (v<0) `E3DBFD → 4276E9`; distracted (v>0) `F8D1CA → FC7645`.

**Layout** — width × 238 card, radius 4, fill white 75%, border `EBE6E3`. Paddings: top 34, leading 44, trailing 46, bottom 42; 25px between header and grid.
- Header: title (serif 20 `B46531`) left; legend right (top-padded 7): gradient bar `focusDark → focusSoft → distractionSoft → distractionDark` (`4276E9, E3DBFD, F8D1CA, FC7645`), width `clamp(282.156, width*0.32, 420)`, height 8, radius 2; below it "Focused work" (left) and "Distracted" (right) Figtree-Regular 10 black.
- Day labels column width 22 (Figtree-Regular 10 black), 6px gap to grid.
- Cells 6 wide × 12 tall, gap 1 (both axes), corner radius 0.5. Grid horizontally scrollable.
- Time axis: 8px below grid, same absolute-positioning rule as workflow (34px labels, centered at progress, clamped; ends aligned).

### 2.10 Most used per category (treemap)

**Data (`buildTreemap`)**
- Current + previous week facts exclude system/idle. Group by category key; within category group by app key.
- Per app: minutes = sum durations; favicon fields from first fact that has any favicon source (else first fact); `change` vs previous week's minutes for `"{categoryKey}|{appKey}"`:
  - previous == 0 → no chip; delta > 0 → `+ {delta}m` green `3AA34C`; delta < 0 → `- {delta}m` red `DE2121`; delta == 0 → `0m` gray `8D8C8A`. (SpaceMono-Regular.)
- Apps sorted duration desc → name asc; take **top 8** per category. Categories sorted by total duration desc → name asc; take **top 5**.
- Category palette derived from the category accent color A:
  - `shellFill = A @ 25%`, `shellBorder = A @ 62%`, `tileFill = blend(A, 86% toward white)`, `tileBorder = blend(A, 36% toward white)`, `headerText = A`.
  - (Blend = linear RGB interpolation toward white by the given fraction.)

**Squarified layout algorithm** (used at both category and app level):
```
place(items, rect, gap):
  drop items with value <= 0; sort by displayOrder (value desc, name asc)
  scale areas: area_i = value_i / totalValue * rect.area
  squarify(items, rect):
    while items remain:
      shortSide = min(availW, availH)
      greedily grow current row while worstAspectRatio does not increase
        worstAspect(areas) = for strip length L = rowArea/shortSide:
          max over items of max(L/span, span/L), span = area/L
      lay the row along the short side:
        if availW >= availH: vertical strip at left, width = stripLength, children stacked top→bottom
        else: horizontal strip at top, height = stripLength, children left→right
      shrink avail rect by stripLength
  each placement frame is inset by gap/2 on all sides; drop degenerate frames
```
- Category-level: rect = content area, gap 6.
- App-level (inside each category card): before layout, run **aggregation**: repeatedly, if any non-aggregate leaf would be < 44 wide, < 28 tall, or < 1600 area, remove the smallest leaf and merge it into an `Other` aggregate tile (id `other`, name "Other", no change chip), re-sort, re-layout; loop until readable or one tile left. Gap 4.

**Layout** — section 958-wide design (width adaptive), height 549. Radius 4, fill white 60%, border `EBE6E3`.
- Title at (40, 34) serif 20 `B46531`.
- Content area at (40, 86), size `(max(797, width-80)) × 400`.
- **Category card**: radius 4, `shellFill` bg, 1px `shellBorder`. Header (padding 10/8/8): name + total duration ("Xhr Ym" style), both Figtree-Regular 12 in `headerText`, min-scale 0.8; layout tries [name … duration] one row, falls back to stacked, then name only. App grid below with horiz padding 8, bottom 8.
- **Leaf tile**: radius 4, `tileFill` bg, 1px `tileBorder`. Typography scale by tile size: large (≥160×110): name 20, detail 12, delta 12, line spacing 4, padding 12; medium (≥90×54): 16/12/12/3/10; compact: 13/10/10/2/6.
- Presentation mode: `full` needs width ≥ 90 and height ≥ (change? (favicon? 92 : 72) : (favicon? 70 : 56)) → name row + duration + delta chip; `compact` (≥58×34) → name row (−2px font) + duration; else `labelOnly` (name row −3px font).
  - Name row: favicon (size `max(12, round(fontSize*1.15))`) + name InstrumentSerif-Regular, black, 1 line, min-scale 0.7. Duration: Figtree-Regular `333333`. Delta: SpaceMono-Regular in change color.
- **Hover card**: when hovering a non-`full` tile, show a floating 176×92 card above the tile (10px gap; falls below if no room; clamped horizontally), radius 6, white 96% + `shellFill @ 85%` overlay, border `shellBorder @ 95%`, shadow black 8% blur 14 y6, padding 12: name (serif 17 black), duration (Figtree 12 `333333`), delta (SpaceMono 12). Animate in/out 0.14s ease-out, scale 0.96→1 + fade.

### 2.11 Weekly breakdown (sankey)

**Virtual canvas**: 1748 × 933 design units, uniformly scaled: `sx = width/1748`, `sy = height/933` (independent axes). Card: width × (width*933/1748), radius 4, fill white 60%, border `EBE6E3`. Title "Weekly breakdown" serif 20 `B46531` at design (72, 64).

**Data (`buildSankey`)**
- Facts exclude system/idle. Empty → empty snapshot (`sourceName` only).
- **Category buckets**: group facts by categoryKey; bucket = {key, name, colorHex, minutes}; sort minutes desc → name asc; if > **6**, keep top 5 + `Other` (`BFB6AE`; if a real `other` key was already visible, merge into the synthetic one).
- **App buckets**: same with appKey/appName/appColorHex, max **10** (top 9 + Other).
- **Links**: for every fact, `minutes[categoryBucket|appBucket] += duration` (non-visible keys map to `other`). Drop zero. Sort by `from` asc then minutes desc. Link id `"{from}-{to}"`.
- `sourceName` = `"{MMM d}-{MMM d}"` of weekStart and weekStart+6 (e.g., `Apr 20-26`). Snapshot id `weekly-sankey-{yyyy-MM-dd of weekStart}`. `seedLabel = "Timeline data"`.

**Geometry (design units)**
Column specs `{x, barWidth, top, bottom, gap, minHeight, labelX, labelTop, labelBottom, labelWidth, labelHeight, labelSpacing}`:
- Source: x 72, w 12, top 273, bottom 706; label x 105, width 220, height 52 (vertically centered on bar).
- Categories: x 760, w 12, top 126, bottom 828, gap 20, minHeight 40; labels x 802, top 64, bottom 874, width 260, height 54, spacing 12.
- Apps: x 1334, w 12, top 54, bottom 928, gap 20, minHeight 28; labels x 1372, top 38, bottom 923, width 330, height 56, spacing 10.

Band allocation (both columns):
```
available = max(count*minHeight, (bottom-top) - gap*(count-1))
flexible  = max(0, available - minHeight*count)
height_i  = minHeight + flexible * minutes_i/totalMinutes   (equal split if total==0)
bars stacked from `top`, separated by `gap`
```
App vertical ordering: by **barycenter** = Σ(categoryBar.midY × linkMinutes)/Σ(linkMinutes) over incoming links (999 if none), ascending; the `other` app is always forced last.

Segments (where ribbons attach):
- Source bar is subdivided proportionally by category minutes (in category order).
- Each category bar's right edge subdivided among its outgoing links, ordered by target app bar minY.
- Each app bar's left edge subdivided among incoming links, ordered by source category bar minY.

Node metadata: `metric` = "Xhr Ymin"/"Ymin"; `percent` = `max(1, round(minutes/total*100))%` (source shows "100%"). Source node: name = date range, bar color `D9CBC0`.

**Label placement** (per column): sort nodes by preferred top (`bar.midY - labelHeight/2`); greedy top-down: `y = max(preferredTop, cursor)`, cursor advances by `labelHeight + labelSpacing`. If the last label overflows `labelBottom`, shift it up, then walk backwards clamping each `y ≤ next.y - labelHeight - spacing`; if the first then sits above `labelTop`, clamp it down and walk forward with `y ≥ prev.y + labelHeight + spacing`.

**Ribbon path** (drawn on Canvas): for flow with `x0,y0Top,y0Bottom,x1,y1Top,y1Bottom`:
```
curve = max(90, (x1-x0)*tension)   // tension: 0.15 for source→category, 0.42 for category→app
cubic from (x0,y0Top) to (x1,y1Top), control1 (x0+curve, y0Top), control2 (x1-curve, y1Top)
line to (x1,y1Bottom); mirrored cubic back to (x0,y0Bottom); close
```
Flow base opacity: source flows `0.14 + 0.08*sqrt(catMinutes/total)`; right flows `0.08 + 0.18*sqrt(linkMinutes/maxLinkMinutes)`.

Ribbon fill = horizontal linear gradient (x0→x1) with `strength = clamp(flow.opacity, 0.08, 0.36)` and tinted colors (tint remap: `000000|333333 → CAC2BA`; `D9D9D9|BFB6AE → CFC8C1`):
- Source flows: `E3D8CF@18% (0) → ECE3DC@16% (0.24) → to@min(.12, .42s) (0.58) → to@min(.2, .72s) (0.82) → to@min(.32, 1.08s) (1)`.
- Right flows: `from@min(.2,.68s) (0) → from@min(.11,.4s) (0.24) → to@min(.05,.2s) (0.54) → to@min(.12,.42s) (0.78) → to@min(.27,.9s) (1)`.

**Column underlays** (drawn first): source→categories: same path shape spanning full column heights, tension 0.15, gradient `E6DBD1@48% → EFE9E3@34% (0.42) → F4EEE9@20% (0.76) → F7F2ED@8% (1)`. categories→apps: tension 0.22, context opacity 0.72, gradient `EFE7E0@8% → F4EEE9@11% (0.46) → EFE7E0@7% (1)`.

**Nodes & labels (SwiftUI layer over canvas)**
- Bars: plain rects at scaled frames, filled with node color.
- Category/source labels: name Figtree-Regular 10 black; second line `metric │ percent` Figtree-Regular 10 `717171` with a 0.5×11 divider `CFC7C1`, 4px gaps.
- App labels: [14×14 icon] + name (Figtree-Regular 10 black) + inline `metric │ percent` (Figtree-Regular 9 `717171`, divider 0.5×10).
- App icon resolution: X/Twitter → asset XFavicon; if favicon sources exist → favicon image (14px, radius 3); else monogram = first letter uppercased on a 3px-radius rect of the app color, Figtree-Bold 8 white.

**Interaction**
- Hovering a ribbon (hit-tested with 8px vertical expansion, topmost first) or a bar/label sets the active node (ribbon hover targets `flow.to`). Click pins/unpins; click empty clears pin. Pinned overrides hover.
- With an active node: unrelated flows dim to 0.12 opacity; related keep full. Nodes: active node and source stay 1.0; nodes connected by a flow to the active node stay 1.0; others dim to 0.25. Hover on source highlights everything.
- Dev-only dataset controls exist but are hidden in production (`showsControls: false`).

### 2.12 Time distribution (WeeklyOverviewSection) — built but only shown in the locked-preview background

**Data (`WeeklyOverviewBuilder.build`)**
- Categories exclude `system` (idle KEPT here for rows, excluded from focus stats).
- Legend/visible keys: per-category summaries sorted by minutes desc (ties → order asc, name asc); if ≤ 5 categories all visible; else top 4 visible + `Other` legend entry (`BFB6AE`).
- Rows: 7 weekdays (labels Mon..Sun 3-letter; note full names Monday..Sunday kept for stats). Row segments: per card → clip to 9:00–18:00 (540–1080) window; skip empty; bucket to `other` when category not visible; sort by start; merge consecutive segments of same bucket when gap ≤ 1 min.
- `contextSwitchTotal`: per day, all (unclipped) non-system segments sorted by start; count category-key changes; sum over days. `contextSwitchAverage = round(total/7)`.
- `totalFocusMinutes` = rounded sum of minutes of non-idle categories.
- `longestFocus`: per day, non-system non-idle ranges sorted by start, merged when gap < 5 min; best merged range across week → `{weekdayName, minutes}`.
- `primaryFocus`: non-idle category with most minutes (tie → name asc) → `{name, minutes, colorHex}`.

**Layout** — width 958, two stacked panels sharing a 4px-radius outline `EBE6E3` (top panel white 60%, footer `FAF7F5`, height 65, divider at x=295).
- Header: "Time distribution" serif 20 `B46531`; right side a static (non-interactive) tab strip: "All" (Figtree-Bold 12) / "Longest focus period" / "Least context shifts" / "Most context shifts" (Figtree-Medium 12, all `333333`) with a 22×1 `F0A54D` underline under "All".
- Chart: day label column (26 wide, Figtree-Regular 12) + rows of 836×18 bars (`F2F2F2` fill, 0.5px `E5E4E3` border, radius 2, 2px row gap). Segments: height 12, radius 1, x = `(start-540)/540 * 836 + 1`, width = `max(2, (dur/540)*836 - 2)`, fill = horizontal gradient of segment color from +22% white blend to +8% black blend.
- Axis labels `9am…6pm` (Figtree-Regular 10) spread across 837.
- Legend centered (25px gaps): name (Figtree-Regular 10) then 12×8 swatch.
- Footer: two groups. "Context switch": metrics Total `"{n} times"`, Average `"{n} times / day"`. "Focus": Total length (compact "Xhr Ym"), Longest duration (`"{dur}, {Weekday}"` or "No focus yet"), Primary focus (`"{Name}, {dur}"` or "No focus yet"). Group title InstrumentSerif-Regular 16 `B46531`; metric label Figtree-Regular 12 `777777`; value InstrumentSerif-Regular 18 `333333`.

### 2.13 Application interactions section — data built, view exists, NOT rendered in shipped WeeklyView

**Data (`buildApplicationInteractions`)**
- Facts exclude system/idle and `other` app key. Empty → subtitle "No recorded app interactions for this week yet." and placeholder rabbit-hole (`No app`, `D9D9D9`, "0m avg").
- App aggregates: minutes sum, visits = fact count, kind per §0.7; sort minutes desc → name asc; take **top 14**.
- Nodes: fixed positions (px in a 565×561 pane) cycling this list: `(256.5,253.3) (106.5,411.3) (134,154.3) (220,136.8) (308.5,167.8) (342.5,108.8) (436.1,142.8) (501.5,255.8) (391.1,310.8) (391.5,415.8) (296,380.3) (62,304.8) (111,233.8) (179.5,343.3)`. Size: index 0 → 76; else `30 + sqrt(minutes/maxMinutes)*28`. `mark` = first letter uppercased. `isPrimary` = index 0; `isMuted` = index > 5.
- Transitions: per day, facts sorted by start, count consecutive pairs (both apps visible) with different app keys → `count[from|to]`. Sort count desc (ties by "from-to" asc).
- Edges: top 18 transitions; weight = count/maxCount; curveOffset cycles `[-42, 24, -55, -22, 52, -14, 30, -30, 18, -62]`; kind = distraction if either endpoint distraction, else personal if either personal, else work.
- Patterns ("Most common work patterns"): transitions where neither endpoint is distraction; `averageCount = max(1, round(count/activeDayCount))`; description `"Moves from {A} to {B} an average of {n} times per active day."`; take 2.
- Rabbit hole: first transition from non-distraction → distraction; targets = up to 4 distraction targets sharing that source; avg = `"{durationText(max(1, round(minutes/visits)))} avg"` computed over targets combined. Fallback: source = top app, targets = up to 4 distraction apps.
- Subtitle: `"About {coverage}% of recorded app time was spent using these applications."` where coverage = visibleMinutes/totalMinutes*100 rounded.

**Layout** — 958×561, radius 6. Left pane 565×561 bg `FBF6F0`: title "Interactions between most used applications" (serif 20 `B46531`) + subtitle (Figtree-Regular 12 black) at (29,28); Canvas quad-curve edges (control = midpoint + curveOffset on y), stroke round-capped, per-kind color/opacity/width: work `A9C3FF`, op `0.24+w*0.24`, width `0.9+w*0.95`; personal `D5D0CA`, `0.18+w*0.2`, `0.8+w*0.75`; distraction `FC7645`, `0.66+w*0.34`, `0.95+w*1.05`. Nodes: circle fill by kind (work `EEF3FF`; personal gradient `FFDCCF→E6E6E6`; distraction gradient `FFDCCF→E6E6E6→EEF3FF`), border 2.5px (3 primary) in kind color (work `4779E9`, personal `B8B8B8`, distraction `FC7645`), mark letter Figtree-Bold 13 (20 primary) colored `4779E9` for work else `8D8C8A`; muted nodes 30% opacity; primary gets a 5px outer ring `EEF3FF @ 98%`. Legend at (158,507): swatches 14×12 radius 2 with 2px borders — "Work" (`4779E9`/`EEF3FF`), "Personal" (`B8B8B8`/`E6E6E6`), "Distraction" (`FF7C5A`/`FFDCCF`), Figtree-Regular 12.
Right pane 393×561 white: "Most common work patterns" (serif 20 `B46531`, top 28 left 24); pattern rows (app chips = 14×14 rounded-2 color rect with white Figtree-Bold 8 initial + name Figtree-Regular 14; average pills = 88×24 (last one flexible) `EEF3FF` bg, `4779E9 @ 36%` 0.75px border, 12px circle icon; flow counter = `— n —` 40×14 with count in white on `4779E9`); description Figtree-Regular 10 black, width 340. Then "Distractions and rabbit holes" title and a 365×84 `F5F5F5` box with the same chip/pill styling in distraction tones (`FF7C5A` / fill `FFECE5`).

### 2.14 Dead/unused Weekly code (do not port unless asked)
- `WeeklyDashboardBuilder.buildHighlights` / `buildSuggestions` exist but are **never called**; `WeeklyHighlightsSection` ("Top Highlights", 470×298) and `WeeklySuggestionsSection` ("1:1 suggestions" / "Top level updates" / "Next steps") render only preview data and are not in the view tree.
- `WeeklyContextDistributionCard` (scatter "Context shift and distractions distribution") and `WeeklyContextComparisonBarCard` (bar version) are private and unreferenced; only the line-chart comparison card ships. The distribution snapshot data (events, "10:00"–"18:00") is still computed.
- `WeeklyContextShiftComparisonSection` (with "Pinpoint" magnifying-glass button) is an older unused variant.
- `WeeklyInteractionGraph*` files (fixtures/glyphs/layout/prototype 660×631 section) are a design prototype, not shipped.
- `WeeklyOverviewSection` appears only in the locked-screen preview collage, not in the unlocked dashboard.
- `WeeklyDonutSnapshot.footerLabel` is always `"Heart"` and never rendered.

---

## 3. Chat view

### 3.1 Gating (beta lock screen)
Chat unlocks when BOTH: `hasChatBetaAccepted` AND ≥ **40 completed batches** (10h; `FeatureAccessRequirements.chatRequiredHours = 10`, batch = 15 min). Progress text format: "0h / 10h", "45m / 10h", "3h / 10h", "3h 45m / 10h".

Lock screen (background `FFFAF5`), centered column:
- "Unlock Beta" InstrumentSerif-Italic 38 `593D2A`, with a "BETA" badge (Figtree-Bold 11 white on `F98D3D`, radius 6, padding 8/4) rotated −12°, offset (−4,−4).
- "Chat lets you ask questions about your Dayflow activity and get summaries, comparisons, and insights." Figtree-Regular 14 `593D2A @ 85%`.
- "Please send feedback if you see any bugs or weird behavior!" Figtree-SemiBold 14 `593D2A`.
- White card (radius 20, shadow black 8% blur 20 y8, max width 420, padding 20):
  - Status icon 32px: `checkmark.circle.fill` green `34C759` when ready, else `bolt.horizontal.circle` `F98D3D`.
  - If hours missing: "10 hours of timeline data required" (SemiBold 15 `593D2A`) + "Chat unlocks after Dayflow has analyzed enough activity. {progress}" (Regular 13 `593D2A @ 80%`).
  - Else if runtime available: "Gemini key or CLI runtime detected" (SemiBold 15 green).
  - Else: "Gemini API key or CLI required" + "Unlock chat by either adding a Gemini API key in Settings or installing Codex/Claude CLI."
  - Capsule button; label: "Keep recording to unlock" / "Configure a runtime to continue" / "Unlock Beta". Enabled style: gradient `FFF4E9→FFE8D4`, border `E8C9A8`, text `593D2A`; disabled: gradient `F0F0F0→E8E8E8`, border `D0D0D0`, text `999999`.
- Privacy note: "Privacy Note" (SemiBold 12 `593D2A @ 60%`) + "During the beta, your questions are logged to help improve the product. Responses are not logged, so your privacy is maintained." (Regular 12 @ 50%).

Runtime availability: Gemini = non-empty API key in keychain; Codex/Claude = CLI binaries detected. If the selected provider becomes unavailable, auto-fallback order: gemini → codex → claude.

### 3.2 Chat layout
Main column (bg vertical gradient `FFFAF5 → FFF6EC`); optional right panels: Memory (360 wide) and Debug (350 wide), both white with a 1px `E0E0E0` left edge.

**Header row** (right-aligned, trailing padding 12, top 8, 8px gaps):
- "Clear" button (only when messages exist): Figtree SemiBold 12 `F96E00`, padding 10/6, radius 8 fill `FFF4E9`, border `F96E00 @ 25%`. Tooltip "Clear chat".
- Debug toggle: ladybug icon (`ladybug.fill` when on) 14px, on `F96E00` / off `999999`. Tooltip "Toggle debug panel".
- Memory toggle: `brain.head.profile(.fill)` same colors. Tooltip "Toggle memory panel".

**Messages area**: vertical scroll, LazyVStack spacing 16, padding 16/16/20. Auto-scrolls to bottom on new message / processing start (0.2s ease-out). Contains: welcome card (when empty) → messages (each `ChatMessageRow`) → WorkStatusCard (inserted at end while `workStatus != nil`) → follow-up suggestions (when idle and suggestions exist) → 1px anchor.

**Provider switch alert**: title "Switch provider?"; destructive "Switch and Reset", cancel "Cancel"; message `Switching to {Gemini|Codex|Claude} will clear this chat's context.` Switching with an empty conversation skips the alert. Switching clears conversation.

### 3.3 Welcome screen (empty conversation)
Card (max width 760, radius 24, fill gradient white 86% → `FFF8EF` 95% topLeading→bottomTrailing, border `F5DFC7`, shadow `E7B98E @ 24% blur 20 y10`; padding 24/22/24). Entrance: fade + scale 0.985→1 + blur 6→0, custom cubic-bezier(0.16,1,0.3,1) 0.42s.
- Icon: 42px circle gradient `FFE5CD→FFCF9D` with `bubble.left.and.bubble.right.fill` 18px `C9670D`.
- "Ask about your Dayflow data" InstrumentSerif-Regular 30 `2F2A24`.
- "Ask questions, analyze your timeline, and generate charts/graphs." Figtree SemiBold 13 `7D6B5B`.
- "I remember your response preferences, so feel free to teach me your style." Figtree Regular 12 `8A7765`.
- "Try one of these" Figtree Bold 12 `8A7765`.
- Suggested prompts (verbatim, with SF-symbol icons), staggered entrance (fade + 8px rise, 0.34s bezier(0.16,1,0.3,1), delay index*0.045):
  1. `doc.text` — **Generate standup notes for yesterday**
  2. `checkmark.seal` — **What did I get done last week?**
  3. `exclamationmark.bubble` — **When was I most focused this week**
  4. `sparkles` — **Compare this week to last week**
- Prompt row style: 24px circle `FFF0E1` with icon 11px bold `C9670D`; text Figtree SemiBold 13 `5C432F`; trailing `arrow.up.right` 9px bold `D58A3D`; container radius 14, fill white 70% (88% on hover), border `EED7BF`; hover: scale 1.01, rise 1px (bezier(0.22,1,0.36,1) 0.18s). Clicking sends the prompt as a message.

### 3.4 Composer
Container: radius 16, fill vertical gradient white → `FFF8F0`, border `E5D8CA` 1px (focused: `F4A867` 1.2px), inner white inset stroke 0.65@0.8px, shadow `D99A5A @ 14% blur 14 y6`, outer margin 16/12. Animates border 0.16s.
- Text field: single-line, height 50, Figtree-Medium 16, text `2F2A24`, placeholder "Ask about your Dayflow data..." in `9B948D`, horizontal inset 14, Enter submits.
- 1px divider `EEE4D8`.
- Toolbar (padding 12/9, min height 48): provider toggle left; right side:
  - While processing: capsule pill (fill `FFF3E6`, border `F0CBA7`) with mini spinner (tint `C18043`) + "Answering" Figtree Bold 11 `9B7753`.
  - Send button: 32px circle; enabled fill gradient `FAA457→F96E00`, white `arrow.up` 12px semibold (spinner while processing), white 55% ring 0.8px, shadow `D37E2D @ 35% blur 8 y3`; disabled gradient `DDDDDD→CECECE`, no shadow. Press scales 0.97.
- Provider toggle: 3 pills "Gemini" / "Codex" / "Claude" inside a container (radius 11, white 84%, border `E4D6C8`, padding 4, gap 6). Pill: Figtree SemiBold 12, padding 10/6, radius 8. Selected: text `F96E00`, fill `FFF4E9`, border `F96E00 @ 25%`. Unselected: text `666666`, white fill, border `E0E0E0`. Disabled: text `B0B0B0`, fill `F2F2F2`, border `E0E0E0`. Tooltip: "Choose chat provider" (or "Configure Gemini key or install Codex/Claude CLI" when selected provider unavailable).
- Submit rule: non-empty trimmed text AND not processing AND selected provider available.

### 3.5 Message bubbles
- **User**: right-aligned (≥60px left spacer). Text Figtree Medium 13 white, selectable, padding 14/10, fill `F98D3D`, radius 16.
- **Assistant**: left-aligned (≥60px right spacer). Container padding 14/10, white fill, radius 16, border `E8E8E8`. Content = parsed blocks (text→markdown view, chart→chart view) stacked with 10px spacing. Context menu: "Copy" (copies raw markdown). Links open externally; only `http/https/mailto` allowed; scheme-less links are normalized to `https://` (must have a host) else blocked.
- **Assistant footer** (below all completed assistant bubbles except the one currently streaming): 10px leading pad; copy icon button (`doc.on.doc` 11px semibold `8F8F8F` in 22px circle; hover = white fill + `E4E4E4` ring, 0.14s) + thumb up/down rating buttons + transient "Thanks" (Figtree SemiBold 11 `9A7C60`, slides in from leading, auto-hides after 1.6s). Thumb-down opens a feedback modal (message + "share logs" toggle → analytics event), pinned bottom-leading with spring(response 0.28, damping 0.88).
- **Tool-call bubble** (`role == toolCall` — used by legacy/simple tool path): pill radius 16, padding 14/10, border 1.5px, shadow blur 6 y3. States:
  - running: icon `circle.dotted` 14px `F96E00` spinning 360°/1s; text = message content, Figtree SemiBold 12 `8B5E3C`; bg gradient `FFF4E9→FFECD8` + moving white shimmer band (soft-light, 1.5s loop); border `F96E00 @ 30%`; shadow `F96E00 @ 10%`.
  - completed(summary): `checkmark.circle.fill` `34C759`; text = summary `2D7D46`; bg gradient `E8F5E9→C8E6C9`; border/shadow green 30%/10%.
  - failed(error): `xmark.circle.fill` `FF3B30`; text = error `C62828`; bg `FFEBEE→FFCDD2`; border/shadow red.
  - Entrance spring scale 0.8→1; status-change bounce to 1.03 and back.

### 3.6 Work status card (streaming progress)
Shown while a reply is being produced (replaces itself; removed when a clean answer lands). Left-aligned card: padding 14/12, radius 16; normal bg `FFF4E9`, border `F96E00 @ 20%`; error bg `FFEBEE`, border `FFCDD2`.
- Header: 12px icon + title Figtree SemiBold 12 `4A4A4A` with **animated ellipsis** (Text of 1→2→3 dots cycling every 0.45s):
  - thinking → `sparkles` `F96E00`, "Thinking…"
  - runningTools → `wrench.and.screwdriver`, "Running tools…"
  - answering → `text.bubble`, "Answering…"
  - error → `exclamationmark.triangle.fill` `C62828`, "Something went wrong" (no ellipsis) + error message Figtree SemiBold 12 `C62828`.
- Tool rows: status icon (spinner `F96E00` / `checkmark.circle.fill` green / `xmark.circle.fill` red 12px) + summary Figtree SemiBold 12 (`4A4A4A`, red `C62828` on failure).
- "Show details"/"Hide details" toggle (Figtree SemiBold 11 `8B5E3C` + chevron 9px) appears when there is thinking text or any tool output. Expanded: per tool the raw command (mono 10 `666666`, 3 lines max) and output (mono 10 `555555`, 6 lines, padding 6, white 60% rounded 8); plus accumulated thinking text (mono 10 `666666`, padding 8, white 60% rounded 8).
- Tool summary heuristic: command containing `sqlite3` → "Database query"; containing `fetchtimeline`/`fetchobservations` → "Data fetch"; else "Tool". Failure → `"{base} failed (exit {code})"`; running (no exit yet, empty output) → `"Running {base lowercased}…"`; empty output done → `"{base} completed"`; Data fetch → the tool's own summary text; else `"{base} returned {N} row(s)"` (N = newline count of trimmed output).

### 3.7 Follow-up suggestions
After a completed answer with suggestions: "Follow up" (Figtree SemiBold 11 `999999`) + wrapping flow layout (8px gaps) of chips: Figtree Medium 12 `F96E00`, padding 14/8, radius 20, fill `FFF4E9`, border `F96E00 @ 30%`; hover scale 1.02 (spring 0.2/0.7). Clicking puts the text into the composer and focuses it (does not auto-send).

### 3.8 Markdown rendering (assistant text)
Custom block parser (line-based, after `\r\n|\r → \n`):
- Blocks: paragraph, heading (`#{1..6} ` + space required), unordered list (`- `, `* `, `+ `), ordered list (`N. `), blockquote (`>`), fenced code ``` with optional language.
- Lists: marker rendered as `•` (unordered) or `N.` (ordered) in an 18px right-aligned column, Figtree Bold 13; item indent level = leadingSpaces/2 × 16px; continuation lines with deeper indent are folded into the item.
- Headings: H1 Figtree Bold 17; H2 Bold 15; H3+ SemiBold 14.
- Paragraph/list text: Figtree Medium 13, color `333333`, line spacing 2. Inline markdown (bold/italic/links/code) via native inline-only parsing — replicate with an inline-md renderer preserving whitespace.
- Quote: 4px rounded bar `E7D7C6` + text in `5A5147`.
- Code block: optional language tag uppercased Figtree Bold 10 `9A7C60`; code mono 12 `333333`; container padding 10, bg `FAF7F2`, radius 12, border `E7DDD2`; horizontal scroll.
- Block spacing 10px; all text selectable.

### 3.9 Inline charts in chat
Assistant text is first split on fenced blocks matching regex:
```
```chart\s+type\s*=\s*([A-Za-z_]+)\s*\n?([\s\S]*?)\n?```
```
Each match parses JSON to a chart spec; invalid → rendered as literal text. Chart block UI: optional title Figtree SemiBold 12 `4A4A4A`, body height 180.

Types & payloads (all values numbers; color optional hex with/without `#`, 6 or 8 digits, else ignored):
- `bar` / `line`: `{ "title", "x": [labels], "y": [numbers], "color" }` — x/y same nonzero length. Line uses catmull-rom + point marks. Y axis leading with gridlines; X labels 10px `666666`.
- `stacked_bar`: `{ "title", "x": [...], "series": [{ "name", "values", "color" }] }` — each series values length == x length (mismatched series dropped; all dropped → invalid).
- `donut` (also accepts type `pie`): `{ "title", "labels", "values", "colors"? }` — inner radius ratio 0.6, angular inset 1, legend bottom-leading. Colors array applies only if length matches labels.
- `heatmap`: `{ "title", "x", "y", "values": [[row per y, len == x]], "color"? }` — rounded rect marks (90% ratio, radius 2); cell opacity `0.2 + 0.8*normalized(value)` of the base color; base = payload color or default palette.
- `gantt`: `{ "title", "items": [{ "label", "start", "end", "color"? }] }` — horizontal bars xStart→xEnd per label, radius 4, x-axis numeric (~6 ticks, 1 decimal); items with end ≤ start dropped.
Default palette (fallback, cycling): `F96E00, 1F6FEB, 2E7D32, 8E24AA, 00897B`.

### 3.10 Debug panel
Width 350, white. Header bar `F5F5F5` (padding 12/8): "Debug Log" Figtree Bold 12 `666666`; copy-all (`doc.on.doc` 11px `999999`, tooltip "Copy all") and clear (`trash`, tooltip "Clear log"). Entries (spacing 8, padding 12): card `FAFAFA`, radius 6, border = type color @30%; header = type label (Figtree Bold 10, type color) + `HH:mm:ss.SSS` timestamp (Figtree 9 `AAAAAA`); content mono 10 `333333`, horizontally scrollable, max height 150.
Entry types/colors: `📝 USER` F96E00 · `📤 PROMPT` 4A90D9 · `📥 RESPONSE` 7B68EE · `🔧 TOOL DETECTED` F96E00 · `📊 TOOL RESULT` 34C759 · `❌ ERROR` FF3B30 · `ℹ️ INFO` 8E8E93.
Copy-all format: entries joined by `\n\n---\n\n`, each as `[{timestamp}] {type}\n{content}`.

### 3.11 Memory panel & store
Width 360. Header `F5F5F5`: "Memory" Figtree Bold 12 `666666` + counter `"{count}/10000"` Figtree 11 `999999`. Body (padding 12):
- Hint: "Auto-updated from assistant replies. You can edit this manually." Figtree 11 `8A8A8A`.
- TextEditor: Figtree 12, padding 8, bg `FFFCF8`, radius 8, border `E7DDD1`; hard-capped at 10,000 chars.
- `"Last updated: {MMM d, h:mm a}"` (or "Not saved yet") Figtree 10 `999999`.
- Buttons Figtree Bold 11: "Save" (`F96E00` when dirty else `999999`, disabled unless dirty), "Reload" (`555555`/`AAAAAA`, disabled unless dirty), right-aligned "Clear" (`C85A4B`, disabled when stored blob empty).

**DashboardChatMemoryStore** (UserDefaults keys `dashboardChatMemoryBlob`, `dashboardChatMemoryUpdatedAt`):
- `load()`: stored string trimmed.
- `save(text)`: normalize (`\r\n|\r→\n`, trim, collapse 3+ newlines to 2, truncate to 10,000); empty → clear.
- Manual save/clear and auto-updates both call `ChatService.didUpdateDashboardMemory(old,new)` which, if changed, resets the CLI session id (forces fresh prompt on next CLI message).
- Panel refresh: on message-count change and on open, reload from store unless the draft is dirty (then only update the stored/updatedAt mirrors).

### 3.12 ChatService orchestration
State: `messages`, `isProcessing`, `streamingText`, `error`, `debugLog`, `workStatus`, `currentSuggestions`, `showDebugPanel`; private `conversationHistory` (user/assistant turns, cleaned), `recentSuggestionHistory` (max 12, case-insensitive de-dupe, most recent last), `currentSessionId` (CLI session resume).

**Send flow**: append user message + history; log; build request:
- Gemini: fresh every time — `systemInstruction = geminiSystemPrompt (+"\n\n## User Memory\n{blob}" if non-empty) (+"\n\n## Recent Suggestions To Avoid\n- …" last ≤9)`; history = full structured turn list; no session.
- Codex/Claude (CLI): first message → one flattened prompt = CLI system prompt + `\n\n` + optional `## User Memory\n{blob}\n\n` + each turn as `User: …` / `Assistant: …` + trailing `Assistant:`. Subsequent messages resume the CLI session (`sessionId`) sending only the latest user content.

**Streaming events** (`ChatStreamEvent`): `sessionStarted(id)`, `thinking(text)` (append to status thinking), `toolStart(command)` (append running ToolRun; stage runningTools), `toolEnd(output, exitCode)` (complete/fail matching run; nonzero exit sets stage error + errorMessage), `textDelta(chunk)` (append to response; stage answering; create/update the assistant message in place; if a tool just ended and both boundary chars are non-whitespace, insert a single space), `complete(text)` (if no deltas seen use full text; log; final), `error(message)`.
After the stream: parse metadata (below); set `currentSuggestions`; save memory blob if present (analytics `chat_memory_auto_updated`); replace the assistant message with cleaned text (remove it if empty); append cleaned text to history; clear `workStatus` on a non-empty answer. On thrown error: assistant message becomes `"I encountered an error: {description}"`, status stage error.

**Metadata parsing** (applied to the full response text):
- Suggestions fenced block regex: `(?ims)(?:^|\n)\s*(?:#{1,6}\s*Suggestions\s*\n+|Suggestions:\s*)?```suggestions\s*\n([\s\S]*?)\n?``` ` — content must parse as a JSON string array.
- Loose fallback: `Suggestions` heading/label followed by a bare JSON array (up to a Memory heading or end).
- Memory fenced block regex: same shape with `memory`; loose fallback requires `Profile:`…`Style:` lines at end of text.
- Memory blob is normalized to at most two lines: `Profile: …` and `Style: …` (other lines discarded; missing both → ignored).
- Residual `Suggestions`/`Memory` headings (markdown or label-style, on their own line) are stripped from the cleaned text.

### 3.13 System prompts — VERBATIM

Dynamic values: `{currentDate}` = `EEEE, MMMM d, yyyy`; `{currentTime}` = `h:mm a`; `{dbPath}` = `~/Library/Application Support/Dayflow/chunks.sqlite` (home-expanded); `{today}` = `yyyy-MM-dd`. On Windows substitute the equivalent data path.

#### 3.13.1 CLI provider (Codex/Claude) system prompt

````text
You are a friendly assistant in Dayflow, a macOS app that tracks computer activity.

Current date: {currentDate}
Current time: {currentTime}
Day boundary: Days start at 4:00 AM (not midnight)

## DATA INTEGRITY (CRITICAL)

You have Bash tool access. You MUST:
1. Actually execute sqlite3 commands to query the database — NEVER fabricate data
2. If a query returns no results, tell the user "No data found for [time period]"
3. If you cannot execute the query (tool error), tell the user what went wrong

DO NOT:
- Pretend to run queries by writing fake code blocks in your response
- Make up activity data based on the schema description
- Guess what the user might have done

If you're unsure whether you executed a real query, you probably didn't. Use the Bash tool to run sqlite3.

## DATABASE

Path: {dbPath}
Query: sqlite3 "{dbPath}" "YOUR SQL"

### Tables

**timeline_cards** - High-level activity summaries (start here)
- day (YYYY-MM-DD), start_ts/end_ts (epoch seconds)
- title, summary, detailed_summary, category, subcategory (detailed_summary is large—only pull if you really need the granularity)
- category values: Work, Personal, Distraction, Idle, System
- is_deleted (0=active, 1=deleted) - ALWAYS filter is_deleted=0
- Ignore "processing failed" cards unless user explicitly asks about them
- Duration in minutes: (end_ts - start_ts)/60

**observations** - Low-level granular snapshots (for deeper analysis)
- Raw activity descriptions captured every few minutes
- Use when user wants more specific information

### Data Fetching

- **Grab what you need** - Don't be shy, fetch enough data to answer thoroughly
- **Grab observations too** - If you need more granular detail, query observations
- **Briefly mention what you grabbed** - Keep it short: "Grabbed today's cards" or "Pulled cards for Jan 11-17"
- **Watch for truncation** - Tool output may get cut off. If that happens, use LIMIT, break into multiple queries, or be selective with columns (e.g., exclude detailed_summary)
- **Prefer human-readable times when needed** - Use SQLite datetime() with localtime for start/end

### Interpretation rules (read raw data)

- This data is LLM-generated and not standardized. Avoid brittle SQL filtering.
- Pull raw rows (titles + summaries) and use your own judgment in the response.
- Titles/summaries may use different terms for the same thing (e.g., X vs Twitter).

Examples:
- "How much did I focus this week?" → pull last week's cards and infer focus from titles + summaries; don't filter by category or total in SQL.
- "How long on Twitter?" → scan titles + summaries for Twitter/X mentions; don't filter only on title.

### Negative examples (don't do this)

1) Context switches (bad: category transitions)
   - Bad approach: Use window functions (LAG) + GROUP BY category/subcategory to count switches.
   - Why it's bad: categories are noisy; you lose the actual activity context and phrasing in titles/summaries.
   - Do instead: Pull raw rows (title + summary) and infer common switches qualitatively (e.g., "coding → browsing threads").

2) Top activities (bad: SUM/GROUP BY title)
   - Bad approach: SUM durations grouped by title for "top activities."
   - Why it's bad: titles vary, summaries carry key context, and aggregation hides nuance.
   - Do instead: Read raw cards and summarize the dominant themes.

3) Work vs play (bad: SUM by category)
   - Bad approach: SUM durations by category to infer productivity.
   - Why it's bad: category labels can be inconsistent; "work" often spans research/browsing/logging.
   - Do instead: Interpret titles/summaries and describe the balance in plain language.

4) Twitter/X time (bad: title-only filtering)
   - Bad approach: WHERE title LIKE '%Twitter%'.
   - Why it's bad: activity might be labeled "X", or only mentioned in summaries.
   - Do instead: Scan titles + summaries for Twitter/X mentions and summarize.

5) Focus time (bad: category-only filtering)
   - Bad approach: WHERE category = 'Work' or a hardcoded "focus" category.
   - Why it's bad: focus is a judgment call and may include deep research or analysis labeled differently.
   - Do instead: Infer focus from the actual content in titles/summaries.

Human-readable timeline template (use when you need readable times):
SELECT
  datetime(start_ts, 'unixepoch', 'localtime') AS start_time,
  datetime(end_ts, 'unixepoch', 'localtime') AS end_time,
  title,
  summary,
  category,
  subcategory
FROM timeline_cards
WHERE day = '{today}' AND is_deleted = 0
ORDER BY start_ts

## INLINE CHARTS (OPTIONAL)

You may include inline charts inside your markdown response. Use fenced chart blocks exactly like this:

```chart type=bar
{ "title": "Time by activity (today)", "x": ["Research", "YouTube"], "y": [45, 20], "color": "#F96E00" }
```

```chart type=line
{ "title": "Focus time by day", "x": ["Mon", "Tue", "Wed"], "y": [2.5, 3.0, 1.8], "color": "#1F6FEB" }
```

```chart type=stacked_bar
{ "title": "Work vs Personal by day", "x": ["Mon", "Tue"], "series": [{ "name": "Work", "values": [2.5, 3.1], "color": "#1F6FEB" }, { "name": "Personal", "values": [1.2, 0.8], "color": "#F96E00" }] }
```

```chart type=donut
{ "title": "Time split (today)", "labels": ["Work", "Personal"], "values": [3.0, 5.7], "colors": ["#1F6FEB", "#F96E00"] }
```

```chart type=heatmap
{ "title": "Focus by daypart", "x": ["Mon", "Tue", "Wed"], "y": ["Morning", "Afternoon", "Evening"], "values": [[1.2, 0.8, 1.5], [2.0, 1.6, 1.1], [0.7, 1.0, 0.9]], "color": "#1F6FEB" }
```

```chart type=gantt
{ "title": "Focus blocks (today)", "items": [{ "label": "Research", "start": 9.0, "end": 10.5, "color": "#1F6FEB" }, { "label": "Break", "start": 10.5, "end": 11.0, "color": "#F96E00" }] }
```

RULES:
- Allowed chart types: bar, line, stacked_bar, donut, heatmap, gantt
- JSON must be valid (double quotes, no trailing commas)
- For donut charts use `type=donut` (not `pie`)
- x and y must be arrays of the same length
- Use numbers only for y values
- Optional: color can be a hex string like "#F96E00" or "F96E00"
- For stacked_bar: provide x categories and a series array; each series needs name + values (values count must match x); color optional per series
- For donut: provide labels + values (same length); optional colors array (same length) for slice colors
- For heatmap: provide x labels, y labels, and values as a 2D array where each row matches y and each row length matches x; optional base color
- For gantt: provide items with label, start, end (numbers, start < end); optional color per item
- Place the chart block where you want it to appear in the response
- If a chart isn't helpful, omit it

{categoryColorsSection}

## RESPONSE STYLE

- **Brief and scannable** - A few key points, not a wall of text. Use bullets if they help organize.
- **Avoid overly granular timestamps.**
- **High-level summaries** - Don't list every activity, summarize the vibe
- **Human-readable durations** - "about an hour", "a couple hours", not "45 minutes" or "4140 seconds"
- **Markdown** - Use **bold** for emphasis where helpful

GOOD example:
"Pulled today's cards.
- **Morning:** research/UX work, then about an hour of personal downtime
- **Midday:** mostly personal—shorts, threads, feed browsing
- **Afternoon/evening:** back to work on code with a couple videos mixed in"

BAD example:
"Morning focus started with a 9:20–10:04 work block researching Dayflow/ChatCLI logging and UX notes, then shifted into about an hour of personal/break time watching League clips, YouTube Shorts..."

NEVER mention: seconds, specific timestamps (9:20-10:04), epoch times, table names, SQL syntax, raw column values

{languageSection}

{metadataSection}
````

`{categoryColorsSection}` (only when categories exist):
```text
## CHART COLORS

When creating charts based on activity categories, use these exact colors:
- {CategoryName}: {colorHex}
…
For other charts (not category-based), choose a warm, pastel, harmonious palette.
```

`{languageSection}` (only when a language override preference exists):
```text
## LANGUAGE

{languageInstruction}
```

`{metadataSection}` (always appended to CLI prompt):
````text
## MEMORY CONTRACT (REQUIRED)

You may receive an existing section called "## User Memory".
This memory is ONLY for durable assistant behavior, not a running life log.
Keep only these two fields:
- Profile: stable user context relevant to this app (very short)
- Style: response format/tone preferences (very short)

DO NOT store:
- Contact names/relationships
- Travel plans or itineraries
- Investment/trading ideas
- One-off tasks, daily events, or temporary interests
- Secrets, passwords, tokens, API keys, or sensitive details

## RESPONSE FORMAT (REQUIRED)

At the END of every response, include exactly these blocks in order:

```suggestions
["Question 1", "Question 2", "Question 3"]
```

```memory
Profile: <short line>
Style: <short line>
```

Rules:
- Include 3-4 suggestions.
- Frame each suggestion as a question the user could ask Dayflow.
- Every suggestion must be answerable using only the user's recorded Dayflow activity/data.
- Do not suggest anything that requires external information, browsing, recommendations, planning help, outreach, document creation, or any other action outside analyzing the existing data.
- Keep suggestion text short (<50 chars).
- Do not add any other metadata blocks.
- Do not mention the memory block in normal prose.
````

#### 3.13.2 Gemini system instruction

````text
You are the AI assistant inside Dayflow, a macOS app that records what people do on their computer and builds a semantic timeline of their day. You have deep visibility into the user's work patterns — what they built, where they got stuck, how they spent their time. Use that context to give answers that feel like a well-informed colleague, not a generic chatbot.

Current date: {currentDate}
Current time: {currentTime}
Day boundary: Days start at 4:00 AM (not midnight). "Yesterday" means the previous 4 AM–4 AM window.

---

## TOOLS & DATA INTEGRITY

You have two read-only tools:

1. **fetchTimeline** — Structured activity cards with titles, categories, and durations. Use this for summaries, standups, time breakdowns, and "what did I do" questions.
2. **fetchObservations** — Raw screen observations. Use this for detailed questions like "what was I reading at 2pm" or "which tabs were open during that meeting."

Rules:
- Always call a tool when the user asks about their activity. Never fabricate or assume data.
- If a tool returns no rows, say so clearly. Don't fill gaps with guesses.
- If a tool fails, explain what happened and suggest a narrower time range.
- For large time windows (full week+), use `includeDetailedSummary=false` to avoid oversized payloads.
- Default to fetchTimeline unless the user needs observation-level detail.

---

## HANDLING USER INTENT

**Format vs. content corrections:**
If the user provides an example of their preferred format (e.g., a standup template), treat it as a *structural template*. Re-fetch or reuse the existing data and apply the new structure to it. Do not echo back the example content as if it were the answer.
If the user is correcting formatting only, reuse previously fetched facts when available and do not import facts from the example.

**Clarifications and retries:**
When the user says things like "no, I meant..." or "try again but...", re-read their original request in light of the correction. Don't start from scratch — adjust your previous response.

**Implicit context:**
- "standup notes" → use Yesterday / Today / Blockers format unless the user has shown a different preference
- "what did I do" → fetchTimeline for the relevant day
- "how much time" → fetchTimeline, aggregate by category
- "was I productive" → compare Work vs Distraction/Idle time
- "show me" or "what was on screen" → fetchObservations

---

## RESPONSE STYLE

- **Brief and scannable.** A few key points, not a wall of text. Bullets are fine when they help.
- **High-level by default.** Summarize the shape of the day — don't list every 15-minute card unless asked.
- **Human-readable durations.** "About an hour," "a couple hours," "most of the afternoon." Not "47 minutes" or "2820 seconds."
- **No internal details.** Never mention raw timestamps, table names, SQL, schema, or tool internals.
- **Adapt to demonstrated preferences.** If the user shows you how they want something formatted, match that structure going forward. Update the Style memory field accordingly.{languageBlock}

---

## MEMORY

You may receive an existing `## User Memory` block. Use it to maintain lightweight, durable context across conversations.

Fields:
- **Profile:** Stable user context relevant to Dayflow (role, work patterns, team).
- **Style:** A set of format preferences **keyed by question type**. When the user demonstrates or requests a specific format, record it against the type of question it applies to — don't overwrite other preferences. Different question types can (and should) have different styles.

Example:
```memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: standup=Yesterday/Today/Blockers, brief bullets | weekly_summary=detailed with metrics | default=brief, scannable
```

When the user shows a preferred format, identify which question type it belongs to and add or update just that key. Preferences for one type (e.g., standups) should never affect another (e.g., weekly summaries).

**Example flow:**

User's current memory:
```memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: default=brief, scannable
```

User provides a standup in Yesterday/Today/Blockers format and says "format it like this instead."

Your response should use that structure for the standup data, and your memory block should become:
```memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: standup=Yesterday/Today/Blockers, brief bullets | default=brief, scannable
```

If the user later says "for weekly summaries, give me more detail with metrics," update to:
```memory
Profile: Solo founder, works on Dayflow (macOS productivity app) with designer Maggie.
Style: standup=Yesterday/Today/Blockers, brief bullets | weekly_summary=detailed with metrics | default=brief, scannable
```

Do NOT store: contact names, travel plans, financial info, one-off tasks, secrets/credentials, or anything that reads like a diary entry.

---

## RESPONSE FORMAT

For substantive responses (data summaries, standups, analysis), end with exactly these two fenced blocks in this order, and nothing after them:

```suggestions
["Question 1?", "Question 2?", "Question 3?"]
```

```memory
Profile: <stable user context>
Style: <key=value pairs as shown above>
```

Rules:
- The `suggestions` block is required for substantive responses.
- The `suggestions` block must be valid JSON: an array of 3-4 strings.
- Always include the `memory` block, even if unchanged.
- Frame each suggestion as a question the user could ask Dayflow.
- Every suggestion must be answerable using only the user's recorded Dayflow activity/data.
- Do not suggest anything that requires external information, browsing, recommendations, planning help, outreach, document creation, or any other action outside analyzing the existing data.
- Keep suggestions specific to the latest answer, not generic dashboard prompts.
- Keep suggestion text short (<50 chars) and varied.
- Include:
- one **deeper** question that digs further into the same topic
- one **adjacent** question that explores a nearby angle
- one **surprising** question that is still grounded in the actual data
- Do not repeat recent suggestions or obvious variants of them.
- Do not write suggestion questions as markdown bullets.
- Do not place suggestion questions in the main response body.
- Do not output any text after the `memory` block.
- For quick clarifications, acknowledgments, or corrections, omit the `suggestions` block and include only the `memory` block.
- Do not add headings like "Suggestions", "Memory", "### Suggestions", or "### Memory".
- Emit only the fenced `suggestions` block and fenced `memory` block after the main answer.
````

`{languageBlock}` = `"\n\n## LANGUAGE\n\n{languageInstruction}"` when a language override exists, else empty. Appended after the instruction body: `"\n\n## User Memory\n{blob}"` (if any) and `"\n\n## Recent Suggestions To Avoid\n- s1\n- s2 …"` (last ≤ 9 suggestions).

### 3.14 Tools — exact semantics

#### 3.14.1 Gemini function calling (the shipped Gemini path)
- Model `gemini-3.1-flash-lite`; endpoint `v1beta/models/{model}:streamGenerateContent` (fallback: retry, then non-streaming `:generateContent`); `generationConfig = { temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "medium" } }` (thinkingConfig dropped on certain errors); `toolConfig.functionCallingConfig.mode = "AUTO"`; max **20** tool rounds per message (exceeding → error "The assistant exceeded the maximum tool-call rounds. Please try a narrower query.").
- Tool declarations (verbatim descriptions):
  - `fetchTimeline` — "Fetch timeline cards for a single day or date range. Returns structured JSON cards including day, time range, title, summary, category, and optional detailed summaries." Params: `date` STRING "Single day in YYYY-MM-DD format."; `startDate` STRING; `endDate` STRING; `includeDetailedSummary` BOOLEAN "When true (default), include detailedSummary. Set false for very large windows."; `limit` NUMBER "Optional row cap. If omitted, returns all matching rows.".
  - `fetchObservations` — "Fetch raw observations for a single day or date range. Returns structured JSON grouped by day, with each day's observations ordered chronologically." Params: `date`, `startDate`, `endDate`, `limit` (same descriptions minus includeDetailedSummary).
- Arg validation: exactly `{date}` XOR `{startDate,endDate}` — violations error "Provide either {date} OR {startDate, endDate}."; bad format → "Invalid date format '{v}'. Use YYYY-MM-DD."; start > end → "startDate must be less than or equal to endDate.". Day bounds = 4:00 AM local → next-day 4:00 AM. Ranges span startDay 4AM → endDay+1 4AM.
- `fetchTimeline` execution: single-day uses per-day card query; range uses time-range query; apply `limit` (positive only) via prefix. Result JSON: `{ request: {mode, date, startDate, endDate, includeDetailedSummary, limit}, summary, itemCount, truncated, items: [{day, startTime, endTime, title, summary, category, subcategory, distractionsCount, appSites?{primary,secondary}, detailedSummary?}] }`. If `includeDetailedSummary` and serialized items exceed **800,000 bytes**, strip all `detailedSummary` and set `truncated: true`. Summary text: `"Fetched N timeline card(s) for {EEE, MMM d | MMM d to MMM d}."` (+ " Detailed summaries were omitted due to payload size." when truncated).
- `fetchObservations` execution: rows grouped chronologically by 4AM-boundary day: `items: [{day, observations: [{startTime, endTime, observation}]}]` with `h:mm a` times; result also has `dayCount`. Summary: `"Fetched N observation(s) for {dates} across D day(s)."`
- UI wiring: each function call emits `toolStart(command: "{name} {argsJSON}")` then `toolEnd(output: summary, exitCode: error?1:0)`.
- Tool errors return `{summary, error: {code: "unknown_tool"|"validation_error", message}}` back to the model.

#### 3.14.2 CLI providers (Codex/Claude)
No app-defined tools — the CLI agent has shell access and runs `sqlite3` against the Dayflow SQLite DB per the CLI system prompt. The stream parser surfaces the CLI's own tool/exec events as `toolStart/toolEnd`, thinking, deltas, `sessionStarted(id)` for resume. Session id is invalidated whenever the memory blob changes.

#### 3.14.3 Legacy `ChatToolExecutor` (present, apparently unused by the shipped flow)
JSON-in-text tool protocol: parse first `{...}` span as `{"tool": "fetchTimeline"|"fetchObservations", "date": "YYYY-MM-DD"}`. Display names "Fetching timeline"/"Fetching observations". Execution: fetchTimeline → per-day cards formatted as an indented text list (`- {start} to {end}: {title}`, `Category: X (sub)`, `Summary:`, `Apps:`, `Distractions: N noted` with sub-list); fetchObservations → 4AM-bounded day, blocks of `[h:mm a - h:mm a]\n{observation}`. Summaries: `"Found N activit(y|ies) for {EEEE, MMM d}"` / `"Found N observation(s) for …"`; empty: `"No activities found for …"` with LLM text "No timeline cards found for {date}. Recording may not have been active on this day.". Its prompt snippet (`toolDescription`) instructs outputting ONLY a JSON object. Keep for parity only if porting the legacy simple-tool renderer (`ToolCallBubble`).

### 3.15 Analytics events (names + key props, for parity)
`chat_question_asked` {question, conversation_id, is_new_conversation, message_index, provider, chat_runtime} · `chat_answer_copied` · `chat_answer_rated` {thumb_direction} · `chat_answer_feedback_submitted` {feedback_message_length, share_logs_enabled, feedback_message?} · `chat_memory_panel_opened` · `chat_memory_manual_saved` {chars} · `chat_memory_cleared` · `chat_memory_auto_updated` {provider, chars}. Shared answer context props: conversation_id, message_id, message_index, assistant_message_length, assistant_has_chart (contains "```chart"), assistant_message_preview (240 chars). `runtimeLabel`: gemini → `gemini_function_calling`; codex/claude → `chat_cli`.

---

## 4. Verbatim UI copy inventory

Weekly: "Unlock Weekly" · "Weekly unlocks after 30 hours of recorded timeline data" · "Notify me when ready" · "Setting reminder..." · "We'll notify you" · "Open notification settings" · "Try again" · "View Weekly" · "Keep recording to unlock this week" · "Weekly insights need at least 15 hours of recorded activity for the selected week." · "{X} more to unlock this week" · "Weekly distribution" · "TOTAL" · "No activity" · "{N} hours" / "{N} minutes" (singular variants) · "Context shift and distractions comparison" · "Number of times distracted" · "Number of context shifts" · "Count" · "{Day} had the most interruptions, with {n} context shifts and {m} distractions." · "No context shift or distraction pattern was detected in this week." · "Your workflow this week" · "Week total" · "No captured activity during {a}-{b}" · "Focus and distraction heat map" · "Focused work" · "Distracted" · "Most used per category" · "Other" · "Weekly breakdown" · "Timeline data" · "Generated with Dayflow" · "Download {title} as a full-resolution PNG" · day labels "Mon Tue Wed Thur Fri Sat Sun" (heatmap row order starts "Sun") · (unused sections: "Time distribution", "All", "Longest focus period", "Least context shifts", "Most context shifts", "Context switch", "Total", "Average", "Focus", "Total length", "Longest duration", "Primary focus", "No focus yet", "{n} times", "{n} times / day", "Interactions between most used applications", "About {n}% of recorded app time was spent using these applications.", "No recorded app interactions for this week yet.", "Most common work patterns", "Distractions and rabbit holes", "Work", "Personal", "Distraction", "Moves from {A} to {B} an average of {n} times per active day.", "Top Highlights", "1:1 suggestions", "Top level updates", "Next steps").

Chat: "Ask about your Dayflow data" · "Ask questions, analyze your timeline, and generate charts/graphs." · "I remember your response preferences, so feel free to teach me your style." · "Try one of these" · the 4 welcome prompts (§3.3) · "Ask about your Dayflow data..." (placeholder) · "Answering" · "Clear" · "Clear chat" · "Toggle debug panel" · "Toggle memory panel" · "Gemini" / "Codex" / "Claude" · "Choose chat provider" · "Configure Gemini key or install Codex/Claude CLI" · "Switch provider?" · "Switch and Reset" · "Cancel" · "Switching to {provider} will clear this chat's context." · "Thinking" · "Running tools" · "Something went wrong" · "Show details" / "Hide details" · "Follow up" · "Thanks" · "Copy" · "Copy answer" · "Debug Log" · "Copy all" · "Clear log" · "Memory" · "Auto-updated from assistant replies. You can edit this manually." · "Last updated: {…}" · "Not saved yet" · "Save" / "Reload" / "Clear" · "Unlock Beta" · "BETA" · beta-lock copy (§3.1) · "I encountered an error: {message}".

---

## 5. Data model reference (minimum fields needed)

`TimelineCard`: `recordId?`, `day` (yyyy-MM-dd, 4AM boundary), `startTimestamp`/`endTimestamp` ("h:mm a" strings), `title`, `summary`, `detailedSummary`, `category`, `subcategory`, `distractions?: [{startTime, endTime, title}]`, `appSites?: {primary?, secondary?}`.
`TimelineCategory`: `name`, `colorHex`, `order`, `isSystem`, `isIdle`.
`Observation`: `startTs`/`endTs` (epoch seconds), `observation` (text).
`ChatMessage`: `{id, role: user|assistant|toolCall, content, timestamp, toolStatus?: running|completed(summary)|failed(error)}`.

---

## 6. Surprises / gotchas for the implementer

1. **Several built sections never render**: overview ("Time distribution"), application interactions, highlights, 1:1 suggestions, context-distribution scatter — all fully implemented with data builders/preview data but absent from the shipped `WeeklyView` tree (see §2.14). The shipped weekly page is exactly: donut + context comparison, workflow, heatmap, treemap, sankey.
2. Day label is **"Thur"**, not "Thu", in dashboard sections (overview placeholder rows use "Thu").
3. Heatmap row order starts with **Sunday**, then Mon–Sat, while every other section starts Monday.
4. The color-hash uses Swift 64-bit wrapping arithmetic — naive JS `Number` math will pick different palette colors for uncategorized items.
5. Weeks start **Monday 4:00 AM**; minutes < 240 are shifted +1440 (belong to the previous day's late night); windows can extend past midnight to 28:00.
6. The sankey is drawn in a 1748×933 virtual coordinate space with independent X/Y scaling (it stretches, not letterboxes).
7. Two different "max visible" collapse rules: donut 5 (4+Other), sankey categories 6 (5+Other), sankey apps 10 (9+Other), treemap top 5 categories × 8 apps, workflow totals 7, app graph 14 nodes/18 edges.
8. App-kind classification checks the bare substring `"x"`, so almost any app containing the letter x can be classified as a distraction — intentional-looking quirk, port as-is.
9. Chat has **three** provider paths: Gemini native function calling (fetchTimeline/fetchObservations, 20-round loop, 800KB payload guard), CLI agents that run raw `sqlite3` (prompt engineering only), and a legacy JSON-tool executor + `ToolCallBubble` that is no longer wired into `ChatService`.
10. Suggestions/memory metadata blocks are parsed with the exact regexes in §3.12 (tolerant of `### Suggestions` headings and loose non-fenced arrays) and are stripped from the visible answer; memory is normalized to just `Profile:`/`Style:` lines, capped at 10,000 chars.
11. Editing or clearing the memory blob invalidates the CLI resume session so the next CLI turn rebuilds the full prompt.
12. The streaming pipeline inserts a single space between a tool event and the next text chunk when both boundary characters are non-whitespace.
13. The assistant bubble is created lazily on the first text delta — tool/thinking activity shows only in the WorkStatusCard until then; an empty final answer removes the bubble entirely.
14. Weekly export renders at 958 design width scaled to 1080px PNG with a watermark; the on-hover download buttons have hard-coded per-section offsets (§2.5).
15. Donut legend percentages are computed against the **visible** total (after "Other" collapse), rounded independently (may not sum to 100).
16. `WeeklyOverviewBuilder` keeps idle cards in the timeline rows but excludes them from focus totals; system is excluded everywhere.
17. Chat gate needs 10h of batches AND an accepted beta AND a configured runtime; Weekly gate needs 30h of batches; the per-week data gate additionally needs 15h **within the selected week**.
