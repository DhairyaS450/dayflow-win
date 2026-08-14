# Dayflow Storage Layer — Windows/TypeScript Porting Spec

Source: Dayflow macOS app (MIT), `Dayflow/Core/Recording/Storage*.swift`, `TimelapseStorageManager.swift`, `JournalDayManager.swift`, `TimelapsePreferences.swift`, and `Dayflow/Models/*.swift` (commit state as of 2026-08). This document is self-contained: an implementer should not need the Swift source.

The macOS app uses GRDB (SQLite) with a `DatabasePool` (WAL mode, 1 writer + up to 5 concurrent readers). All persistence goes through a singleton `StorageManager`. Timelapse video files are managed by a second, DB-less singleton `TimelapseStorageManager` (pure filesystem quota enforcement).

---

## 1. On-disk layout

macOS base directory: `~/Library/Application Support/Dayflow/`.
Windows recommendation: `%APPDATA%\Dayflow\` (or Electron `app.getPath("userData")`) — keep the same relative structure:

```
<base>/
├── chunks.sqlite            ← the one and only SQLite database (+ chunks.sqlite-wal, chunks.sqlite-shm)
├── recordings/              ← FLAT directory of capture files (no subdirectories)
│   ├── 20250115_093245123.jpg    ← screenshots (current capture pipeline)
│   └── 20250115_093245123.mp4    ← legacy 1-minute video chunks (older pipeline)
├── timelapses/
│   └── 2025-01-15/               ← one subdir per day, "yyyy-MM-dd"
│       └── <originalFileName>_timelapse.mp4
└── backups/
    └── chunks-2025-01-15_093000.sqlite   ← DB backups, "chunks-yyyy-MM-dd_HHmmss.sqlite"
```

Naming rules:
- **Capture files** (`nextFileURL()` / `nextScreenshotURL()`): filename is `yyyyMMdd_HHmmssSSS` of the *current local time* at allocation, extension `.mp4` for video chunks, `.jpg` for screenshots. E.g. `20250115_142530987.jpg`. Both live directly in `recordings/`.
- **Timelapses**: `timelapses/<yyyy-MM-dd>/<originalFileName>_timelapse.mp4`. The date directory is the local date the timelapse relates to. If the date directory can't be created, the file falls back to `timelapses/<originalFileName>_timelapse.mp4` (root of timelapses).
- **Backups**: `chunks-<yyyy-MM-dd_HHmmss>.sqlite` (local time), in `backups/`.

**The database stores ABSOLUTE file paths** in `chunks.file_url`, `screenshots.file_path`, and `timeline_cards.video_summary_url`. If the base directory ever moves, paths in the DB must be rewritten (the macOS app does exactly this in its legacy-path migrations — see §9). On Windows these will be Windows absolute paths (`C:\Users\...\Dayflow\recordings\...`).

All three subdirectories plus the base dir are created (recursively, ignore-if-exists) at startup **before** the database is opened.

---

## 2. SQLite configuration

Applied on every connection:

```sql
PRAGMA journal_mode = WAL;      -- writer connections only
PRAGMA synchronous = NORMAL;    -- writer connections only
PRAGMA busy_timeout = 5000;     -- all connections (ms)
```

- Pool: 1 serialized writer, max 5 readers. All writes funnel through a single dedicated background queue (`com.dayflow.storage.writes`, utility QoS). Port note: with `better-sqlite3` (synchronous, single connection) a single serialized connection satisfies all semantics; the reader pool is a perf optimization only.
- A WAL **checkpoint (PASSIVE)** runs every **5 minutes** (first at +5 min after launch).
- On launch, `PRAGMA quick_check` is run; a non-`ok` result is logged as a warning but does NOT block startup.
- Slow-query instrumentation: any read/write whose wait or exec time exceeds **100 ms** is logged (plus Sentry breadcrumbs on macOS). Optional for the port; not functional behavior.
- **Error policy: every storage method swallows errors.** Reads return empty arrays / `null` / `false` / `0` on failure; writes silently no-op. Nothing throws to callers. Replicate this (log internally).

### Startup sequence (constructor of StorageManager)

1. Run UserDefaults migration (macOS sandbox → non-sandbox; N/A on Windows).
2. Run storage-path migration (macOS sandbox container → `~/Library/Application Support`; N/A on Windows).
3. Create base, `recordings/`, `backups/` directories.
4. Migrate DB location if a legacy `chunks.sqlite`(-wal/-shm) exists inside `recordings/` — move those files up into the base dir (overwrite destination if present). (Historical: the DB used to live inside `recordings/`.)
5. Open database **safely** (see §8.2 recovery ladder).
6. Run `PRAGMA quick_check`.
7. Run `migrate()` (idempotent schema creation, §3).
8. Rewrite legacy absolute file-path prefixes in `chunks.file_url` and `timeline_cards.video_summary_url` if they point at the old sandbox location (§9).
9. Kick off async LLM-body truncation task (§8.5).
10. Run recordings purge once, run timelapse purge once, then schedule the hourly purge timer (§8.6/§8.7).
11. Schedule the 5-minute checkpoint timer.
12. Schedule daily backups (§8.4); if no backup exists at all, create one immediately.

---

## 3. Complete SQLite schema (final state)

The macOS app has no schema-version table. `migrate()` executes the following idempotently on every launch (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), then applies three conditional `ALTER TABLE`s by inspecting the live column list. **For a fresh port, just create the final schema below** (the ALTERs' columns are already included). If you must open an old imported DB, replicate the column-presence checks.

```sql
-- Video recording segments (legacy capture pipeline; still read/written by chunk APIs)
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,                 -- unix epoch seconds
    end_ts INTEGER NOT NULL,                   -- unix epoch seconds
    file_url TEXT NOT NULL,                    -- ABSOLUTE path to .mp4
    status TEXT NOT NULL DEFAULT 'recording',  -- 'recording' | 'completed'
    is_deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
CREATE INDEX IF NOT EXISTS idx_chunks_start_ts ON chunks(start_ts);
CREATE INDEX IF NOT EXISTS idx_chunks_status_start_ts ON chunks(status, start_ts);

-- Groups of chunks/screenshots submitted to the LLM as one analysis unit
CREATE TABLE IF NOT EXISTS analysis_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_start_ts INTEGER NOT NULL,           -- unix epoch seconds
    batch_end_ts INTEGER NOT NULL,             -- unix epoch seconds
    status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'processing' | 'completed' | 'analyzed' | 'failed'
    reason TEXT,                               -- failure reason when status='failed'
    llm_metadata TEXT,                         -- JSON array of LLMCall objects (§5.6)
    detailed_transcription TEXT,               -- legacy, unused by current code
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analysis_batches_status ON analysis_batches(status);

-- Junction: batch → chunks
CREATE TABLE IF NOT EXISTS batch_chunks (
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE RESTRICT,
    PRIMARY KEY (batch_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_chunks_chunk ON batch_chunks(chunk_id);

-- Activity summary cards shown on the timeline
CREATE TABLE IF NOT EXISTS timeline_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES analysis_batches(id) ON DELETE CASCADE,  -- NULL for onboarding card
    start TEXT NOT NULL,        -- clock time string "h:mm a" e.g. "2:30 PM" (en-US, no leading zero hour)
    end TEXT NOT NULL,          -- clock time string "h:mm a"
    start_ts INTEGER,           -- unix epoch seconds (resolved, see §6)
    end_ts INTEGER,             -- unix epoch seconds
    day DATE NOT NULL,          -- logical-day string "yyyy-MM-dd" (4 AM boundary, §4)
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,     -- user category name; 'System' = error/system cards
    subcategory TEXT,
    detailed_summary TEXT,
    metadata TEXT,              -- JSON TimelineMetadata object (or LEGACY: bare JSON array of Distraction)
    video_summary_url TEXT,     -- ABSOLUTE path to timelapse .mp4, set after generation
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER NOT NULL DEFAULT 0      -- soft delete flag (added by migration)
);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_day ON timeline_cards(day);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_start_ts ON timeline_cards(start_ts);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_time_range ON timeline_cards(start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_active_start_ts ON timeline_cards(start_ts) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_timeline_cards_active_batch ON timeline_cards(batch_id) WHERE is_deleted = 0;

-- Time-range review ratings painted over the timeline (non-overlapping after writes, §7.8)
CREATE TABLE IF NOT EXISTS timeline_review_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    rating TEXT NOT NULL        -- opaque rating string
);
CREATE INDEX IF NOT EXISTS idx_review_ratings_time ON timeline_review_ratings(start_ts, end_ts);

-- LLM transcription outputs ("what happened between t1 and t2")
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    observation TEXT NOT NULL,
    metadata TEXT,
    llm_model TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_observations_batch_id ON observations(batch_id);
CREATE INDEX IF NOT EXISTS idx_observations_start_ts ON observations(start_ts);
CREATE INDEX IF NOT EXISTS idx_observations_time_range ON observations(start_ts, end_ts);

-- Periodic screen captures (current capture pipeline; replaces video chunks)
CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at INTEGER NOT NULL,              -- unix epoch seconds of capture instant
    file_path TEXT NOT NULL,                   -- ABSOLUTE path to .jpg
    file_size INTEGER,                         -- bytes at insert time (nullable)
    idle_seconds_at_capture INTEGER,           -- system idle seconds when captured (added by migration)
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at);

-- Junction: batch → screenshots
CREATE TABLE IF NOT EXISTS batch_screenshots (
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE RESTRICT,
    PRIMARY KEY (batch_id, screenshot_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_screenshots_screenshot ON batch_screenshots(screenshot_id);

-- Daily journal (intentions/reflections/AI summary), one row per logical day
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL UNIQUE,                  -- "yyyy-MM-dd" (4 AM boundary)
    intentions TEXT,
    notes TEXT,
    goals TEXT,
    reflections TEXT,
    summary TEXT,                              -- AI-generated
    status TEXT NOT NULL DEFAULT 'draft',      -- 'draft' | 'intentions_set' | 'complete'
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_day ON journal_entries(day);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);

-- Daily standup: one JSON blob per CALENDAR day (NOT 4 AM boundary — see §4)
CREATE TABLE IF NOT EXISTS daily_standup_entries (
    standup_day TEXT NOT NULL PRIMARY KEY,     -- "yyyy-MM-dd" plain calendar day, local tz
    payload_json TEXT NOT NULL,                -- opaque serialized standup payload
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_daily_standup_entries_created_at ON daily_standup_entries(created_at DESC);

-- Per-day focus/distraction goal targets
CREATE TABLE IF NOT EXISTS day_goals (
    day TEXT NOT NULL PRIMARY KEY,             -- "yyyy-MM-dd" (timeline/4 AM day)
    focus_target_minutes INTEGER NOT NULL,
    distraction_limit_minutes INTEGER NOT NULL,
    is_skipped INTEGER NOT NULL DEFAULT 0,     -- (added by migration)
    created_at INTEGER NOT NULL,               -- unix epoch seconds (NOT a DATETIME string!)
    updated_at INTEGER NOT NULL                -- unix epoch seconds
);
CREATE INDEX IF NOT EXISTS idx_day_goals_updated_at ON day_goals(updated_at DESC);

-- Category assignments per day goal (snapshot of category at save time)
CREATE TABLE IF NOT EXISTS day_goal_categories (
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('focus', 'distraction')),
    category_id TEXT NOT NULL,                 -- UUID string of the TimelineCategory
    category_name TEXT NOT NULL,
    category_color_hex TEXT NOT NULL,          -- "#RRGGBB"
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (day, kind, category_id)
);
CREATE INDEX IF NOT EXISTS idx_day_goal_categories_day_kind
    ON day_goal_categories(day, kind, sort_order);

-- Full request/response log of every LLM API call
CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    batch_id INTEGER NULL,                     -- NOT a foreign key (intentionally survives batch deletion)
    call_group_id TEXT NULL,                   -- correlates retries of one logical call
    attempt INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    model TEXT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success','failure')),
    latency_ms INTEGER NULL,
    http_status INTEGER NULL,
    request_method TEXT NULL,
    request_url TEXT NULL,
    request_headers TEXT NULL,                 -- JSON
    request_body TEXT NULL,                    -- possibly truncated, §8.5
    response_headers TEXT NULL,                -- JSON
    response_body TEXT NULL,                   -- possibly truncated, §8.5
    error_domain TEXT NULL,
    error_code INTEGER NULL,
    error_message TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_group ON llm_calls(call_group_id, attempt);
CREATE INDEX IF NOT EXISTS idx_llm_calls_batch ON llm_calls(batch_id);
```

### Migration history semantics (for opening pre-existing DBs)

Run in `migrate()` after the CREATEs, checking `PRAGMA table_info`:

1. If `timeline_cards` lacks `is_deleted`: `ALTER TABLE timeline_cards ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;` then create the two partial indexes `idx_timeline_cards_active_start_ts` and `idx_timeline_cards_active_batch`.
2. If `screenshots` lacks `idle_seconds_at_capture`: `ALTER TABLE screenshots ADD COLUMN idle_seconds_at_capture INTEGER;`
3. If `day_goals` lacks `is_skipped`: `ALTER TABLE day_goals ADD COLUMN is_skipped INTEGER NOT NULL DEFAULT 0;`

Notes:
- `DATETIME DEFAULT CURRENT_TIMESTAMP` columns hold **UTC** strings `"YYYY-MM-DD HH:MM:SS"` (SQLite behavior). All `*_ts` columns and `day_goals.created_at/updated_at` are unix epoch **seconds** as integers. `day` strings are **local-time** logical days. Mixed convention — preserve it.
- Foreign keys are declared but the app never explicitly enables `PRAGMA foreign_keys` in these files (GRDB enables it by default — the port SHOULD enable `PRAGMA foreign_keys = ON` to get the declared CASCADE/RESTRICT behavior; nothing in the code relies on cascades being off).
- Old-DB quirk: on legacy databases `chunks.is_deleted` and `screenshots.is_deleted` may be NULL for existing rows (the columns default 0 but are nullable). Queries therefore use `(is_deleted = 0 OR is_deleted IS NULL)` on `chunks`; screenshots queries use plain `is_deleted = 0`.

---

## 4. The "logical day" concept — 4 AM boundary

**A logical day runs from 04:00:00 local time to 03:59:59 local time the next calendar day.** Activity between midnight and 4 AM belongs to the *previous* day.

### 4.1 Day string from a timestamp: `getDayInfoFor4AMBoundary(date)`

Input: an absolute time. Output: `(dayString, startOfDay, endOfDay)`.

```
fourAMToday = date with hour=4, minute=0, second=0 on the same LOCAL calendar date as input
if input < fourAMToday:  startOfDay = fourAMToday - 1 day
else:                    startOfDay = fourAMToday
endOfDay  = startOfDay + 1 day        (i.e. 4 AM next day)
dayString = format(startOfDay, "yyyy-MM-dd")   // LOCAL timezone
```

Fallback if 4 AM cannot be computed (never in practice): use local midnight-to-midnight and the midnight day string.

DST note: the Swift code does calendar arithmetic (`+1 day`), so on DST transition days a logical day can be 23 or 25 hours. Replicate with calendar-aware date math (e.g. Luxon/Temporal `plus({days:1})`), not `+86400`.

### 4.2 Day window from a day string

Everywhere the code accepts `day: "yyyy-MM-dd"`, the window is computed as:

```
dayDate  = parse "yyyy-MM-dd" as local date
dayStart = dayDate at 04:00:00 local
dayEnd   = (dayDate + 1 day) at 04:00:00 local
startTs  = epochSeconds(dayStart);  endTs = epochSeconds(dayEnd)
```

Queries then use `start_ts >= startTs AND start_ts < endTs` (cards belong to the day their **start** falls in; a card straddling 4 AM is not split).

### 4.3 Formats and variants — IMPORTANT

| Concept | Format | Boundary | Timezone |
|---|---|---|---|
| `timeline_cards.day`, `journal_entries.day`, `day_goals.day` | `yyyy-MM-dd` | **4 AM** | local |
| `daily_standup_entries.standup_day` | `yyyy-MM-dd` | **midnight** (plain calendar day, Gregorian, en-US-POSIX formatting) | local |
| Card `start`/`end` clock strings | `h:mm a` (e.g. `"2:30 PM"`, `en_US_POSIX`: no leading zero on hour, uppercase AM/PM, U+0020 space) | — | local |
| Capture filenames | `yyyyMMdd_HHmmssSSS` | — | local |
| Backup filenames | `chunks-yyyy-MM-dd_HHmmss.sqlite` | — | local |

**The standup day key deliberately does NOT use the 4 AM boundary.** Do not "fix" this.

### 4.4 Week boundary

`fetchTotalMinutesTrackedForWeek(containing date)`: week starts **Monday 04:00 local** and ends the following Monday 04:00. Algorithm: take the start of the ISO week containing `date` (Monday), set it to 04:00; if `date < weekStart`, subtract one week; `weekEnd = weekStart + 1 week`; then delegate to `fetchTotalMinutesTracked(weekStart, weekEnd)`.

### 4.5 "Evening" threshold (journal flow)

`JournalDayManager` treats **local hour >= 16** (4 PM) as evening (prompts reflection instead of intentions). "Today" = the current 4 AM-boundary day string.

---

## 5. Data models and JSON encodings

TypeScript equivalents. Swift's synthesized Codable **omits `null` optionals from JSON output** (`encodeIfPresent`) and tolerates missing keys on decode — mirror that (use `undefined`-skipping serialization).

### 5.1 RecordingChunk
```ts
interface RecordingChunk {
  id: number;            // int64
  startTs: number;       // epoch seconds
  endTs: number;
  fileUrl: string;       // absolute path
  status: string;        // 'recording' | 'completed'
  // derived: duration = endTs - startTs (seconds)
}
```

### 5.2 Screenshot
```ts
interface Screenshot {
  id: number;
  capturedAt: number;              // epoch seconds
  filePath: string;                // absolute path
  fileSize: number | null;
  idleSecondsAtCapture: number | null;
  isDeleted: boolean;              // from is_deleted != 0
}
```

### 5.3 Observation
```ts
interface Observation {
  id: number | null;
  batchId: number;
  startTs: number;
  endTs: number;
  observation: string;
  metadata: string | null;      // opaque
  llmModel: string | null;
  createdAt: Date | null;       // from DATETIME string (UTC)
}
```

### 5.4 TimelineCard (read model) / TimelineCardShell (write model)
```ts
interface TimelineCard {
  id: string;                    // client-side UUID, NOT persisted
  recordId: number | null;       // timeline_cards.id
  batchId: number | null;
  startTimestamp: string;        // "h:mm a" clock string (column `start`)
  endTimestamp: string;          // column `end`
  category: string;
  subcategory: string;           // '' if NULL
  title: string;
  summary: string;
  detailedSummary: string;
  day: string;                   // "yyyy-MM-dd"
  distractions: Distraction[] | null;    // decoded from metadata JSON
  videoSummaryURL: string | null;
  otherVideoSummaryURLs: string[] | null; // always null from storage; used for merged cards in UI
  appSites: AppSites | null;              // decoded from metadata JSON
  isBackupGenerated: boolean | null;      // decoded from metadata JSON
}

interface TimelineCardShell {       // input to saveTimelineCardShell / replaceTimelineCardsInRange
  startTimestamp: string;           // "h:mm a"
  endTimestamp: string;             // "h:mm a"
  category: string;
  subcategory: string;
  title: string;
  summary: string;
  detailedSummary: string;
  distractions: Distraction[] | null;
  appSites: AppSites | null;
  isBackupGenerated: boolean | null;      // default null
  idleMetadata: IdleCardMetadata | null;  // default null
}

interface TimelineCardWithTimestamps {  // fetchTimelineCard(byId)/fetchLastTimelineCard result
  id: number;                            // row id
  startTimestamp: string; endTimestamp: string;
  startTs: number; endTs: number;        // 0 if NULL
  category: string; subcategory: string; title: string;
  summary: string; detailedSummary: string; day: string;
  distractions: Distraction[] | null;
  videoSummaryURL: string | null;
}
```

### 5.5 `timeline_cards.metadata` JSON — TimelineMetadata envelope

Current format (an object; every field optional and omitted when null):
```json
{
  "distractions": [ { "id": "6F9619FF-8B86-D011-B42D-00C04FC964FF",
                      "startTime": "2:30 PM", "endTime": "2:45 PM",
                      "title": "...", "summary": "...",
                      "videoSummaryURL": "/abs/path.mp4" } ],
  "appSites": { "primary": "github.com", "secondary": "docs.google.com" },
  "isBackupGenerated": true,
  "idle": {
    "classifierVersion": "…", "inputCoverageRatio": 0.93,
    "coveredSeconds": 840, "batchDurationSeconds": 900,
    "largestUncoveredGapSeconds": 60, "screenshotCount": 15,
    "sampledIdleScreenshotCount": 12, "averageIdleSecondsAtCapture": 310.5,
    "maxIdleSecondsAtCapture": 600, "mergedWithPreviousIdle": false,
    "mergeGapSeconds": 30, "skippedLLM": true
  }
}
```
- `Distraction.id` is a UUID **string (uppercase hex, hyphenated)**; on decode a missing/invalid `id` is replaced with a freshly generated UUID (never fails). `videoSummaryURL` optional.
- `AppSites`: `{ primary?: string|null, secondary?: string|null }`.
- **LEGACY format**: the column may contain a bare JSON **array** of Distraction objects. Decode strategy everywhere: try `TimelineMetadata` object first; if that fails, try `[Distraction]` and treat it as `{distractions: legacyArray}` (appSites/isBackupGenerated/idle = null). Any parse failure ⇒ all metadata fields null. Writes always produce the object form.

### 5.6 `analysis_batches.llm_metadata` JSON — LLMCall[]
```ts
interface LLMCall {
  timestamp: string | null;   // ISO-8601 (Swift .iso8601: "2025-01-15T14:30:00Z", seconds precision)
  latency: number | null;     // seconds (floating point)
  input: string | null;
  output: string | null;
}
```
Stored as a JSON array. Encode dates ISO-8601; decode ISO-8601.

### 5.7 LLMCallDBRecord (insert model for llm_calls) — maps 1:1 to columns
`{ batchId?, callGroupId?, attempt, provider, model?, operation, status ('success'|'failure'), latencyMs?, httpStatus?, requestMethod?, requestURL?, requestHeadersJSON?, requestBody?, responseHeadersJSON?, responseBody?, errorDomain?, errorCode?, errorMessage? }`

### 5.8 JournalEntry
```ts
interface JournalEntry {
  id: number | null;
  day: string;                   // "yyyy-MM-dd" (4 AM boundary)
  intentions: string | null;     // newline-separated list
  notes: string | null;
  goals: string | null;          // newline-separated list
  reflections: string | null;
  summary: string | null;        // AI-generated markdown-ish text
  status: string;                // 'draft' | 'intentions_set' | 'complete' (default 'draft')
  createdAt: Date | null;
  updatedAt: Date | null;
}
```

### 5.9 DailyStandupEntry
```ts
interface DailyStandupEntry {
  standupDay: string;      // "yyyy-MM-dd" calendar day
  payloadJSON: string;     // opaque JSON blob (storage does not parse it)
  createdAt: Date | null;
  updatedAt: Date | null;
}
```

### 5.10 DayGoalPlan
```ts
type DayGoalCategoryKind = 'focus' | 'distraction';

interface DayGoalCategorySnapshot {
  categoryID: string;      // UUID string of TimelineCategory
  name: string;
  colorHex: string;        // "#RRGGBB"
  sortOrder: number;
}

interface DayGoalPlan {
  day: string;                     // "yyyy-MM-dd"
  focusTargetMinutes: number;      // default plan: 270
  distractionLimitMinutes: number; // default plan: 120
  focusCategories: DayGoalCategorySnapshot[];
  distractionCategories: DayGoalCategorySnapshot[];
  isSkipped: boolean;
  createdAt: number;               // epoch seconds; 0 = "unset, stamp on save"
  updatedAt: number;               // epoch seconds
}
```
Default plan (`DayGoalPlan.defaultPlan`): 270 focus min, 120 distraction min; distraction categories = user categories named "distraction"/"distractions" (case/whitespace-insensitive); focus categories = all other non-system, non-idle categories in `order`; system/idle categories are never selectable.

### 5.11 TimelineReviewRatingSegment
```ts
interface TimelineReviewRatingSegment { id: number; startTs: number; endTs: number; rating: string; }
```

### 5.12 Debug entry models
```ts
interface AnalysisBatchDebugEntry { id: number; status: string; startTs: number; endTs: number; createdAt: Date | null; reason: string | null; }
interface TimelineCardDebugEntry { createdAt: Date | null; batchId: number | null; day: string; startTime: string; endTime: string; category: string; subcategory: string | null; title: string; summary: string | null; detailedSummary: string | null; }
interface LLMCallDebugEntry { createdAt: Date | null; batchId: number | null; callGroupId: string | null; attempt: number; provider: string; model: string | null; operation: string; status: string; latencyMs: number | null; httpStatus: number | null; requestMethod: string | null; requestURL: string | null; requestBody: string | null; responseBody: string | null; errorMessage: string | null; }
```

### 5.13 TimelineCategory (stored in preferences, NOT the DB)
```ts
interface TimelineCategory {
  id: string;          // UUID
  name: string;
  colorHex: string;    // "#RRGGBB"
  details: string;     // description fed to the LLM
  order: number;
  isSystem: boolean;
  isIdle: boolean;
  isNew: boolean;
  createdAt: string;   // ISO-8601 (encoder/decoder use .iso8601)
  updatedAt: string;   // ISO-8601
}
```
Persisted as a JSON array under preferences key `colorCategories` (as raw bytes/`Data` on macOS; a JSON string is fine on Windows). Legacy decode fallback: array of `{id: int64, name, color?, details, isNew?}` → converted to new shape with fresh UUIDs, `colorHex = color ?? "#E5E7EB"`, sequential order. An **Idle** category is force-inserted if absent: `name:"Idle", colorHex:"#A0AEC0", isSystem:true, isIdle:true`, order = max+1; category lists are always returned sorted by `order`. Default seed categories (fresh install): Work `#B984FF`, Personal `#6AADFF`, Distraction `#FF5950`, Idle `#A0AEC0` (system+idle) — each with description strings (see TimelineCategory.swift; copy verbatim if the LLM prompts depend on them).

---

## 6. Timeline-card timestamp resolution (the tricky part)

The LLM returns cards with only clock strings (`"2:30 PM"`). Storage resolves these to absolute epoch seconds two different ways:

### 6.1 `saveTimelineCardShell(batchId, card)` — anchor to the batch start

1. `batchStartTs` = `analysis_batches.batch_start_ts` of `batchId`; **fail (return null) if the batch doesn't exist**.
2. `baseDate` = Date(batchStartTs).
3. Parse `card.startTimestamp` and `card.endTimestamp` with format `h:mm a` (en-US-POSIX). Parse failure ⇒ return null.
4. `startDate` = baseDate with its hour/minute set to the parsed clock time (seconds = 0), same local calendar date as baseDate.
5. **Midnight disambiguation (start)**: if parsed hour < 4 AND `startDate < baseDate`: let `nextDay = startDate + 1 day`; choose whichever of {startDate, nextDay} is closer (absolute difference) to `baseDate`. (Handles a batch that began at 11:50 PM producing a card that starts 12:05 AM.)
6. Same procedure for `endDate` (steps 4–5 with end clock).
7. **Midnight crossing**: if `endDate < startDate`, `endDate += 1 day`.
8. `day` = `getDayInfoFor4AMBoundary(startDate).dayString`.
9. Insert row (columns: batch_id, start, end, start_ts, end_ts, day, title, summary, category, subcategory, detailed_summary, metadata; `video_summary_url` omitted/NULL). `metadata` = encoded TimelineMetadata from the shell's distractions/appSites/isBackupGenerated/idleMetadata.
10. Return the inserted row id.

### 6.2 `replaceTimelineCardsInRange(from, to, newCards, batchId)` — anchor to the window midpoint

Used when re-analyzing a time range. One transaction:

1. `fromTs`/`toTs` = epoch seconds of the parameters. Overlap predicate used throughout: `((start_ts < toTs AND end_ts > fromTs) OR (start_ts >= fromTs AND start_ts < toTs))`.
2. Collect `video_summary_url` of overlapping, non-deleted cards **where `(category != 'System' OR batch_id = :batchId)`** — System (error) cards from OTHER batches are preserved. These paths are returned so the caller can delete the timelapse files.
3. Soft-delete (`is_deleted = 1`) the same set.
4. For each new `TimelineCardShell`:
   - `anchor` = `from + (to - from)/2` (window midpoint).
   - `resolveClock(h, m)`: candidates = anchor's calendar date at h:m, that −1 day, that +1 day; pick the candidate closest (absolute) to `anchor`.
   - Parse start/end clocks (`h:mm a`); on parse failure **skip that card** (continue).
   - `startDate = resolveClock(startH, startM)`; `endDate = resolveClock(endH, endM)`; if `endDate < startDate` then `endDate += 1 day`.
   - `day` from `getDayInfoFor4AMBoundary(startDate)`.
   - Insert (same columns as 6.1) and record the new row id.
5. Returns `{ insertedIds: number[], deletedVideoPaths: string[] }`. On any transaction error: `([], [])`.

### 6.3 `createOnboardingCard()`

Inserts a fake 13-minute card ending "now": `batch_id = NULL`, start = now−13min, clock strings via `h:mm a`, `title = "Installed Dayflow!"`, `subcategory = "Setup"`, `detailed_summary = ""` (empty string, NOT null — readers expect non-null), `category` = first non-idle persisted category name (fallback `"Work"`), metadata = `{"appSites":{"primary":"dayflow.so"}}`. `summary` text varies by preference `selectedLLMProvider` (`"gemini"` default; variants for `chatgpt_claude` × `chatCLIPreferredTool` (`claude`|`codex`), `ollama` × `llmLocalEngine` (`ollama`|`lmstudio`), and a generic fallback) — see §10 for keys; exact copy strings are marketing text, adapt freely.

---

## 7. Public API of StorageManager, by domain

General conventions: methods marked **[async-fire-and-forget]** enqueue the write on the serialized write queue and return immediately (caller cannot observe success). Everything else is synchronous (blocking on DB). All failures are swallowed with the stated fallback.

### 7.1 Recording chunks (legacy video pipeline)

| Method | Behavior |
|---|---|
| `nextFileURL(): URL` | `<recordings>/<yyyyMMdd_HHmmssSSS of now>.mp4`. No DB access. |
| `registerChunk(url)` **[async]** | `ts = now(sec)`; `INSERT INTO chunks(start_ts,end_ts,file_url,status) VALUES (ts, ts+60, path, 'recording')` — provisional 60 s duration. |
| `markChunkCompleted(url)` **[async]** | `UPDATE chunks SET end_ts = now, status = 'completed' WHERE file_url = ?`. |
| `markChunkFailed(url)` **[async]** | `DELETE FROM chunks WHERE file_url = ?`, then delete the file from disk (ignore errors). Hard delete. |
| `fetchUnprocessedChunks(olderThan oldestAllowed): RecordingChunk[]` | Despite the name, `oldestAllowed` is a **lower bound**: `SELECT * FROM chunks WHERE start_ts >= ? AND status='completed' AND (is_deleted=0 OR is_deleted IS NULL) AND id NOT IN (SELECT chunk_id FROM batch_chunks) ORDER BY start_ts ASC`. `[]` on error. |
| `fetchChunksInTimeRange(startTs, endTs): RecordingChunk[]` | Completed, active chunks overlapping `[startTs, endTs]`: `(start_ts <= endTs AND end_ts >= startTs) OR (start_ts BETWEEN startTs AND endTs) OR (end_ts BETWEEN startTs AND endTs)`, `ORDER BY start_ts ASC`. |
| `chunksForBatch(batchId): RecordingChunk[]` | `SELECT c.* FROM batch_chunks bc JOIN chunks c ON c.id=bc.chunk_id WHERE bc.batch_id=? AND (c.is_deleted=0 OR c.is_deleted IS NULL) ORDER BY c.start_ts ASC`. |
| `getTimestampsForVideoFiles(paths): Map<path,{startTs,endTs}>` | `SELECT file_url,start_ts,end_ts FROM chunks WHERE file_url IN (…) AND (is_deleted=0 OR is_deleted IS NULL)`. Empty input ⇒ empty map. |

### 7.2 Analysis batches

| Method | Behavior |
|---|---|
| `saveBatch(startTs, endTs, chunkIds): number \| null` | `null` if `chunkIds` empty. One transaction: insert `analysis_batches(batch_start_ts, batch_end_ts)` (status defaults `'pending'`), then a `batch_chunks` row per id. Returns new batch id; `null` on failure. |
| `saveBatchWithScreenshots(startTs, endTs, screenshotIds): number \| null` | Identical but populates `batch_screenshots`. |
| `updateBatchStatus(batchId, status)` **[async]** | `UPDATE analysis_batches SET status=? WHERE id=?`. |
| `markBatchFailed(batchId, reason)` **[async]** | `UPDATE analysis_batches SET status='failed', reason=? WHERE id=?`. |
| `updateBatch(batchId, status, reason=null)` | Synchronous `UPDATE analysis_batches SET status=?, reason=? WHERE id=?` (reason overwritten with NULL when omitted). |
| `updateBatchLLMMetadata(batchId, calls: LLMCall[])` | JSON-encode (ISO-8601 dates) → `UPDATE analysis_batches SET llm_metadata=? WHERE id=?`. Encode failure ⇒ no-op. |
| `fetchBatchLLMMetadata(batchId): LLMCall[]` | Decode `llm_metadata` JSON; `[]` if row/column/parse missing. |
| `getBatchStartTimestamp(batchId): number \| null` | `SELECT batch_start_ts FROM analysis_batches WHERE id=?`. |
| `allBatches(): {id,start,end,status}[]` | `SELECT id,batch_start_ts,batch_end_ts,status FROM analysis_batches ORDER BY id DESC`. |
| `fetchBatches(forDay day): {id,startTs,endTs,status}[]` | 4 AM window for `day`; `WHERE batch_start_ts >= startTs AND batch_end_ts <= endTs` (fully contained) `ORDER BY batch_start_ts ASC`. |
| `fetchRecentAnalysisBatchesForDebug(limit): AnalysisBatchDebugEntry[]` | `[]` if limit ≤ 0. `ORDER BY id DESC LIMIT ?`. |
| `countCompletedAnalysisBatchesForWeeklyAccess(): number` | `SELECT COUNT(*) FROM analysis_batches WHERE status IN ('completed','analyzed')`. |

Batch status lifecycle strings: `'pending'` → `'processing'` → `'completed'` / `'analyzed'` / `'failed'` (reason set). Reprocessing resets to `'pending'` with `reason=NULL, llm_metadata=NULL`.

### 7.3 Screenshots

| Method | Behavior |
|---|---|
| `nextScreenshotURL(): URL` | `<recordings>/<yyyyMMdd_HHmmssSSS of now>.jpg`. |
| `saveScreenshot(url, capturedAt, idleSecondsAtCapture): number \| null` | Stat the file for `file_size` (null if stat fails); `INSERT INTO screenshots(captured_at, file_path, file_size, idle_seconds_at_capture) VALUES (?,?,?,?)`; return row id or null. |
| `fetchUnprocessedScreenshots(since oldestTimestamp): Screenshot[]` | `WHERE captured_at >= ? AND is_deleted = 0 AND id NOT IN (SELECT screenshot_id FROM batch_screenshots) ORDER BY captured_at ASC`. |
| `screenshotsForBatch(batchId): Screenshot[]` | Join via `batch_screenshots`, `s.is_deleted = 0`, `ORDER BY s.captured_at ASC`. |
| `fetchScreenshotsInTimeRange(startTs, endTs): Screenshot[]` | `WHERE captured_at >= ? AND captured_at <= ?` (inclusive both ends) `AND is_deleted = 0 ORDER BY captured_at ASC`. |

### 7.4 Observations

| Method | Behavior |
|---|---|
| `saveObservations(batchId, observations)` | No-op if empty. One transaction; per row `INSERT INTO observations(batch_id,start_ts,end_ts,observation,metadata,llm_model) VALUES (…)`. |
| `fetchObservations(batchId): Observation[]` | `WHERE batch_id=? ORDER BY start_ts ASC`. |
| `fetchObservations(startTs, endTs): Observation[]` | **Containment**: `WHERE start_ts >= ? AND end_ts <= ? ORDER BY start_ts ASC`. |
| `fetchObservationsByTimeRange(from: Date, to: Date): Observation[]` | **Overlap**: `WHERE (start_ts < toTs AND end_ts > fromTs) OR (start_ts >= fromTs AND start_ts < toTs) ORDER BY start_ts ASC`. |
| `deleteObservations(forBatchIds): void` | Hard `DELETE FROM observations WHERE batch_id IN (…)`. No-op if list empty. |
| `insertLLMCall(rec: LLMCallDBRecord)` | Plain insert of all 18 columns (§5.7). |

### 7.5 Timeline cards — writes

| Method | Behavior |
|---|---|
| `saveTimelineCardShell(batchId, card): number \| null` | See §6.1. |
| `replaceTimelineCardsInRange(from, to, newCards, batchId): {insertedIds, deletedVideoPaths}` | See §6.2. |
| `updateTimelineCardVideoURL(cardId, videoSummaryURL)` | `UPDATE timeline_cards SET video_summary_url=? WHERE id=?`. |
| `updateTimelineCardCategory(cardId, category)` | Trim whitespace; no-op if empty; `UPDATE timeline_cards SET category=? WHERE id=?`. |
| `deleteTimelineCard(recordId): string \| null` | One transaction: fetch `video_summary_url, start_ts, end_ts, batch_id` of the ACTIVE card (`is_deleted=0`); if absent return null. Soft-delete it (`SET is_deleted=1 … AND is_deleted=0`). Then, **only if `end_ts > start_ts`**, hard-`DELETE` overlapping observations — scoped `WHERE batch_id = ?` if the card has a batch, otherwise unscoped — overlap predicate `(start_ts < cardEnd AND end_ts > cardStart) OR (start_ts >= cardStart AND start_ts < cardEnd)`. Returns the card's `video_summary_url` (caller deletes the timelapse file). |
| `createOnboardingCard()` | See §6.3. |

### 7.6 Timeline cards — reads

All readers decode `metadata` per §5.5 and filter `is_deleted = 0` unless noted.

| Method | Behavior |
|---|---|
| `fetchTimelineCards(forBatch batchId): TimelineCard[]` | `WHERE batch_id=? AND is_deleted=0 ORDER BY start ASC` — **NOTE: sorts by the clock STRING column lexicographically** (`"1:05 PM" < "11:00 AM" < "9:00 AM"`). This is a source quirk; replicate for fidelity or knowingly sort by `start_ts`. |
| `fetchTimelineCards(forDay day): TimelineCard[]` | 4 AM window (§4.2); `WHERE start_ts >= ? AND start_ts < ? AND is_deleted=0 ORDER BY start_ts ASC, start ASC`. Invalid day string ⇒ `[]`. |
| `fetchTimelineCardsByTimeRange(from, to): TimelineCard[]` | Overlap `(start_ts < toTs AND end_ts > fromTs) OR (start_ts >= fromTs AND start_ts < toTs)`, active only, `ORDER BY start_ts ASC`. Includes `'System'` cards intentionally (week-view parity). |
| `fetchTimelineCard(byId id): TimelineCardWithTimestamps \| null` | `WHERE id=? AND is_deleted=0`. Only decodes `distractions` from metadata. NULL `start_ts`/`end_ts` map to 0. |
| `fetchLastTimelineCard(endingBefore: Date): TimelineCardWithTimestamps \| null` | `WHERE end_ts <= ? AND is_deleted=0 ORDER BY end_ts DESC, id DESC LIMIT 1`. |
| `fetchTotalMinutesTracked(from, to): number` | `SELECT COALESCE(SUM(end_ts - start_ts),0) FROM timeline_cards WHERE start_ts >= ? AND start_ts < ? AND is_deleted=0 AND category != 'System'` ÷ 60 (float minutes). |
| `fetchTotalMinutesTrackedForWeek(containing date): number` | Monday-4AM week window (§4.4) → `fetchTotalMinutesTracked`. |
| `fetchRecentTimelineCardsForDebug(limit): TimelineCardDebugEntry[]` | Active only, `ORDER BY created_at DESC, id DESC LIMIT ?`; `[]` if limit ≤ 0. |

### 7.7 Reprocessing

| Method | Behavior |
|---|---|
| `deleteTimelineCards(forDay day): string[]` | 4 AM window; collect `video_summary_url` of active cards with non-null URL where `start_ts` in window; soft-delete all active cards in window. Returns collected video paths. Invalid day ⇒ `[]`. (No System-card preservation here — everything in the day goes.) |
| `deleteTimelineCards(forBatchIds ids): string[]` | Same pattern keyed on `batch_id IN (…)`. |
| `resetBatchStatuses(forDay day): number[]` | 4 AM window; select ids of batches **fully contained** (`batch_start_ts >= startTs AND batch_end_ts <= endTs`) with `status IN ('completed','failed','processing','analyzed')`; `UPDATE … SET status='pending', reason=NULL, llm_metadata=NULL` for those ids. Returns affected ids. |
| `resetBatchStatuses(forBatchIds ids): number[]` | Verify which of the given ids exist, then same UPDATE (no status filter). Returns existing ids. |

### 7.8 Timeline review ratings

Ratings are stored as **non-overlapping** time segments; `applyReviewRating` maintains that invariant by splitting.

| Method | Behavior |
|---|---|
| `fetchReviewRatingSegments(overlapping startTs, endTs): segment[]` | Guard `endTs > startTs` else `[]`. `WHERE NOT (end_ts <= startTs OR start_ts >= endTs) ORDER BY start_ts ASC`. |
| `applyReviewRating(startTs, endTs, rating)` | Guard `endTs > startTs`. Transaction: (1) fetch overlapping segments; (2) for each, plan its deletion and re-insert the non-overlapped remainders: if `existingStart < startTs`, keep fragment `[existingStart, min(startTs, existingEnd))` (only if non-empty); if `existingEnd > endTs`, keep fragment `[max(endTs, existingStart), existingEnd)` (only if non-empty) — both with the EXISTING rating; (3) `DELETE` all overlapped ids; (4) insert the kept fragments; (5) insert the new `[startTs, endTs, rating]` segment. Net effect: the new rating paints over the range, old ratings are clipped around it. |
| `hasAnyTimelineReviewRating(): boolean` | `SELECT 1 … LIMIT 1` non-null. |
| `hasReviewRatingInRecentTimelineDays(days = 7): boolean` | Guard days > 0. Window = `[now − days (calendar), now]`; `WHERE end_ts > windowStartTs AND start_ts < windowEndTs LIMIT 1`. |
| `fetchUnreviewedTimelineCardCount(forDay day, coverageThreshold = 0.8): number` | See algorithm below. |

**Unreviewed-count algorithm**: 4 AM window for `day`. Fetch active cards' `(start_ts, end_ts, category)` in the window (`start_ts` in-window). Skip cards whose trimmed category equals `"System"` case-insensitively. Cards with NULL/invalid timestamps or `end <= start` count as unreviewed immediately. Fetch rating segments overlapping the window, clip each to the window, drop empties, sort by start, merge overlapping/touching (`segment.start <= last.end`) into a coverage list. Sort cards by start. For each card compute covered seconds against the merged list with a single forward-moving index (segments and cards both sorted; advance the shared index past segments ending before the card start; a segment extending beyond the card end is NOT advanced past). If `covered / duration < coverageThreshold` the card is unreviewed. Return the count.

### 7.9 Journal

| Method | Behavior |
|---|---|
| `fetchJournalEntry(forDay day): JournalEntry \| null` | `SELECT * WHERE day=?`; `status` defaults `'draft'` if NULL. |
| `saveJournalEntry(entry)` | Upsert: `INSERT … VALUES (day, intentions, notes, goals, reflections, summary, status, CURRENT_TIMESTAMP) ON CONFLICT(day) DO UPDATE SET` all six fields `= excluded.*`, `updated_at = CURRENT_TIMESTAMP`. |
| `updateJournalIntentions(day, intentions, notes, goals)` | If a row exists for `day`: `UPDATE … SET intentions=?, notes=?, goals=?, status='intentions_set', updated_at=CURRENT_TIMESTAMP`. Else `INSERT (day,intentions,notes,goals,status) VALUES (…,'intentions_set')`. |
| `updateJournalReflections(day, reflections)` | Exists ⇒ `UPDATE … SET reflections=?, updated_at=CURRENT_TIMESTAMP` (status unchanged). Else `INSERT (day, reflections, status) VALUES (?,?,'draft')`. |
| `updateJournalSummary(day, summary)` | Exists ⇒ `UPDATE … SET summary=?, status='complete', updated_at=CURRENT_TIMESTAMP`. Else `INSERT (day, summary, status) VALUES (?,?,'complete')`. |
| `fetchRecentJournalSummary(withinDays days): {day, summary} \| null` | `cutoffDay` = format(today − days, "yyyy-MM-dd") (plain calendar arithmetic, string compare); `WHERE summary IS NOT NULL AND summary != '' AND day >= cutoff ORDER BY day DESC LIMIT 1`. |
| `fetchRecentJournalSummaries(count, excludingDay = null): {day, summary}[]` | `WHERE summary IS NOT NULL AND summary != ''` (+ `AND day != ?`) `ORDER BY day DESC LIMIT ?`. |
| `hasIntentionsForDay(day): boolean` | `COUNT(*) WHERE day=? AND status IN ('intentions_set','complete')` > 0. |
| `fetchMostRecentGoals(): string \| null` | `SELECT goals WHERE goals IS NOT NULL AND goals != '' ORDER BY day DESC LIMIT 1`. |
| `hasMinimumTimelineActivity(forDay day, minimumMinutes = 60): boolean` | 4 AM window; `SELECT COALESCE(SUM(end_ts - start_ts),0)/60 FROM timeline_cards WHERE start_ts >= ? AND start_ts < ? AND is_deleted=0` (integer division; **includes System cards** — unlike fetchTotalMinutesTracked) ≥ minimumMinutes. |
| `fetchJournalDays(limit = 30): string[]` | `SELECT day ORDER BY day DESC LIMIT ?`. |

### 7.10 Daily standup

| Method | Behavior |
|---|---|
| `dailyStandupDayKey(for date = now, timeZone = system): string` | Plain **calendar** day `yyyy-MM-dd`, Gregorian, en-US-POSIX, given tz. NOT the 4 AM day. |
| `fetchDailyStandup(forDay standupDay): DailyStandupEntry \| null` | `WHERE standup_day = ?`. |
| `fetchLatestDailyStandupDay(): string \| null` | `SELECT standup_day ORDER BY standup_day DESC LIMIT 1` (string ordering, deliberately NOT `updated_at`, so regenerating an old day doesn't move the scheduler anchor). |
| `fetchRecentDailyStandups(limit, excludingDay = null): DailyStandupEntry[]` | Guard limit > 0. Optional `WHERE standup_day != ?` (only when excludingDay non-empty). `ORDER BY updated_at DESC LIMIT ?`. |
| `fetchAllDailyStandups(excludingDay = null): DailyStandupEntry[]` | Same filter; `ORDER BY standup_day DESC` (no limit). |
| `saveDailyStandup(forDay standupDay, payloadJSON)` | Upsert: `INSERT (standup_day, payload_json, updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(standup_day) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`. |

### 7.11 Day goals

| Method | Behavior |
|---|---|
| `fetchDayGoalPlan(forDay day): DayGoalPlan \| null` | Row `WHERE day = ?` + its `day_goal_categories` rows `WHERE day=? ORDER BY kind, sort_order`, split into focus/distraction lists (unknown `kind` values skipped). |
| `fetchMostRecentDayGoalPlan(beforeOrOn day): DayGoalPlan \| null` | Same, but `WHERE day <= ? ORDER BY day DESC LIMIT 1`; the categories query uses the FOUND row's day. |
| `saveDayGoalPlan(plan)` | Transaction: upsert `day_goals` — `created_at` = `plan.createdAt` if `> 0` else now, `updated_at` = now, `ON CONFLICT(day) DO UPDATE SET focus_target_minutes, distraction_limit_minutes, is_skipped, updated_at = excluded.*` (**created_at intentionally NOT updated on conflict**). Then `DELETE FROM day_goal_categories WHERE day=?` and re-insert every snapshot with `sort_order` = its array index (ignoring the snapshot's own sortOrder), kind `'focus'` then `'distraction'`. |

### 7.12 LLM call log — debug readers

| Method | Behavior |
|---|---|
| `fetchRecentLLMCallsForDebug(limit): LLMCallDebugEntry[]` | Guard limit > 0. `ORDER BY created_at DESC, id DESC LIMIT ?` (selects the §5.12 column subset; headers not included). |
| `fetchLLMCallsForBatches(batchIds, limit): LLMCallDebugEntry[]` | Guard non-empty ids and limit > 0. `WHERE batch_id IN (…) ORDER BY created_at DESC, id DESC LIMIT ?`. |

### 7.13 Storage-limit setters

| Method | Behavior |
|---|---|
| `updateStorageLimit(bytes)` (on StorageManager) | Set preference `storageLimitRecordingsBytes`; if new < previous, trigger an immediate recordings purge (async). |
| `TimelapseStorageManager.updateLimit(bytes)` | Set preference `storageLimitTimelapsesBytes`; if new < previous, trigger an immediate timelapse purge with the new limit. |
| `purgeNow(completion?)` (both managers) | Run the respective purge on its background queue, then invoke completion on the main thread. |
| `TimelapseStorageManager.currentUsageBytes(): number` | Recursive allocated size of `timelapses/`. |
| `TimelapseStorageManager.rootURL` | Exposes `<base>/timelapses`. |

---

## 8. Maintenance, retention, backup, recovery

### 8.1 Timers (all start in the constructor)

| Task | First run | Interval |
|---|---|---|
| WAL checkpoint (PASSIVE) | +5 min | 5 min |
| Recordings purge + timelapse purge | immediately (once), then +1 h | 1 h |
| DB backup | +1 h (plus immediate if `backups/` has no `.sqlite`) | 24 h |
| LLM body truncation | immediately (async), once per launch | — |

### 8.2 Safe DB open (recovery ladder)

1. Try opening `chunks.sqlite` normally. Success ⇒ done.
2. On failure: find the newest `*.sqlite` in `backups/` (by file creation date). If found: delete `chunks.sqlite`, `chunks.sqlite-wal`, `chunks.sqlite-shm`; copy the backup into place; try opening. Success ⇒ done.
3. On failure (or no backup): delete the three DB files again and create a **fresh empty database**. If even that fails ⇒ fatal crash.

### 8.3 Integrity check

`PRAGMA quick_check` at launch; log-only.

### 8.4 Backups

- `createBackup()` (async on the write queue): create `backups/chunks-<yyyy-MM-dd_HHmmss>.sqlite` using SQLite's online backup API (`sqlite3_backup_*`; in Node use `db.backup(path)` in better-sqlite3 or `VACUUM INTO`), then prune to the **3 newest** backups (by creation date), deleting the rest.
- Scheduled daily; immediate backup on first-ever launch (no existing backup).

### 8.5 LLM body truncation (DB bloat control)

Constants: max stored body = **65,536 chars** (64 KiB), batch size 100 rows-worth of updates, max 50 batches per launch. For each of `request_body` and `response_body`:

```sql
UPDATE llm_calls
SET <col> = '<truncated llm body: original_chars=' || length(<col>) ||
            ', stored_prefix_chars=65536>' || char(10) || substr(<col>, 1, 65536)
WHERE id IN (
  SELECT id FROM llm_calls
  WHERE <col> IS NOT NULL AND length(<col>) > 65536
    AND <col> NOT LIKE '<truncated llm body:%'
  LIMIT 100
);
```

(The marker literally is `<truncated llm body: original_chars=N, stored_prefix_chars=65536>\n` followed by the first 65,536 chars.) Loop both columns until a full pass updates 0 rows or 50 iterations elapse; if anything was updated, run a passive checkpoint.

### 8.6 Recordings purge (`performPurgeIfNeeded`)

Limit = preference `storageLimitRecordingsBytes` (default 10 GB). Sentinel `Int64.max` (`9223372036854775807`) = **unlimited ⇒ skip purge entirely** (use a nullable or sentinel in the port).

1. `cleanupRecordingStragglers()` (below).
2. Measure recursive allocated size of `recordings/`.
3. While `currentSize − freedSoFar > limit` (max 200 passes):
   - In one write transaction, fetch the **500 oldest active screenshots** (`WHERE is_deleted=0 ORDER BY captured_at ASC LIMIT 500`); for each: set `is_deleted = 1` **first**, then delete the file from disk (using stored `file_size`, else stat, to tally freed bytes; a missing file still counts as processed).
   - If a pass processes 0 screenshots, stop.
4. `cleanupRecordingStragglers()` again.

**`cleanupRecordingStragglers()`**: gather `file_path` of ALL active screenshots (`is_deleted = 0`); recursively walk `recordings/` and delete every file whose path is not in that set. **If the active set is empty, ALL files in `recordings/` are deleted** — including legacy `.mp4` chunks. (Yes: video chunk files not referenced by an active screenshot row are treated as garbage. This is intended behavior in the current app.)

Note: purge only ever considers screenshots; it does not stop at batch membership — screenshots already attached to processed batches get purged oldest-first like any others.

### 8.7 Timelapse purge (`TimelapseStorageManager.performPurge`)

Limit = preference `storageLimitTimelapsesBytes` (default 10 GB); `Int64.max` = unlimited ⇒ skip.
1. `usage` = recursive size of `timelapses/`. If ≤ limit, done.
2. List the **immediate children** of `timelapses/` (the per-day directories and any stray files), sorted oldest-first by creation date (fallback: modification date, fallback: distant past).
3. Delete entire entries (whole day-directories at a time) oldest-first, decrementing `usage` by each entry's recursive size, until `usage <= limit`.

No DB involvement; `timeline_cards.video_summary_url` may become dangling — readers must tolerate missing files.

### 8.8 Timelapse file deletion on card ops

Storage returns video paths from `deleteTimelineCard`, `deleteTimelineCards(...)`, and `replaceTimelineCardsInRange`; the **caller** deletes those files. Port must keep the same contract (or delete inline — but the returned-paths API is relied on by the analysis layer).

---

## 9. Legacy migrations (macOS-specific — port relevance noted)

- **UserDefaultsMigrator** (sandbox prefs → unsandboxed): irrelevant on Windows; keep only the concept of a one-time-flag pattern. Flag key: `didMigrateFromSandboxDefaults`.
- **StoragePathMigrator** (files from `~/Library/Containers/<bundle>/Data/Library/Application Support/Dayflow` → unsandboxed path; keeps bigger file on collision, recurses, deletes source): irrelevant on Windows. Flag key: `didMigrateFromSandbox`.
- **migrateDatabaseLocationIfNeeded**: if `recordings/chunks.sqlite`(-wal/-shm) exist, move them to the base dir (replacing any destination file). **Relevant if you ever import a Mac profile**, otherwise skip.
- **migrateLegacyChunkPathsIfNeeded**: rewrites absolute-path PREFIXES stored in the DB: `chunks.file_url` prefixed by `<legacyBase>/recordings/` → `<newBase>/recordings/`, and `timeline_cards.video_summary_url` prefixed by `<legacyBase>/timelapses/` → `<newBase>/timelapses/`, via `UPDATE t SET col = REPLACE(col, oldPrefix, newPrefix) WHERE col LIKE oldPrefix || '%'` (skipped when prefixes are equal or no rows match). **Adopt this pattern on Windows for any future base-dir move / Mac-DB import** (Windows separators!).

---

## 10. Preferences (UserDefaults → port to a JSON settings store / electron-store)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `storageLimitRecordingsBytes` | int64 | `10_000_000_000` (10 GB) | Recordings dir quota; `9223372036854775807` (Int64.max) = unlimited |
| `storageLimitTimelapsesBytes` | int64 | `10_000_000_000` | Timelapses dir quota; Int64.max = unlimited |
| `saveAllTimelapsesToDisk` | bool | `false` | Generate & keep a timelapse for every card |
| `showDailyGoalPopups` | bool | `true` | Day-goal popup UI toggle |
| `colorCategories` | bytes (JSON `[TimelineCategory]`) | absent ⇒ default categories §5.13 | User category definitions |
| `hasUsedApp` | bool | `false` | Set true on first category add |
| `onboardingSelectedRole` | string | absent | Role chosen at onboarding (e.g. "Software Engineer") |
| `onboardingAppliedCategoryPreset` | string | absent | Which preset enum was applied (`softwareEngineer`, `founderExecutive`, `designer`, `student`, `productManager`, `dataScientist`, `other`) |
| `onboardingCategoriesCustomized` | bool | `false` | User edited categories ⇒ stop re-applying presets |
| `selectedLLMProvider` | string | `"gemini"` (fallback when reading) | `"gemini"` \| `"chatgpt_claude"` \| `"ollama"` |
| `chatCLIPreferredTool` | string | `"claude"` | `"claude"` \| `"codex"` (when provider = chatgpt_claude) |
| `llmLocalEngine` | string | `"ollama"` | `"ollama"` \| `"lmstudio"` (when provider = ollama) |
| `didMigrateFromSandbox` | bool | `false` | One-time file-migration flag (macOS only) |
| `didMigrateFromSandboxDefaults` | bool | `false` | One-time prefs-migration flag (macOS only) |

The "default when absent" semantics matter: the getters use *object-present-else-default*, so an explicitly stored `false`/`0` is respected.

---

## 11. JournalDayManager (UI state machine — storage-relevant behavior)

Not part of StorageManager, but defines how the journal APIs are exercised; port to the renderer/view-model layer.

- `currentDay` initialized to today's 4 AM-boundary day string. `isToday` ⇔ day string equals today's.
- Day navigation parses the day string, sets time to **noon** before ±1 day arithmetic (avoids 4 AM/DST edge cases), then re-derives the day string via the 4 AM rule. Forward navigation capped at today (string compare `nextDayString <= todayString`).
- On load: fetch entry; if today and (no entry or status `'draft'`), fetch `fetchRecentJournalSummary(withinDays: 3)` for the intro screen; prefill `goals` from `fetchMostRecentGoals()`; `canSummarize = hasMinimumTimelineActivity(day, 60)`.
- Saving intentions: lines are split on newlines, trimmed, empties dropped, re-joined with `\n` (both intentions and goals); notes just trimmed; empty strings stored as NULL. Status flow handled by the storage upserts (§7.9).
- Flow-state selection: status `'complete'` ⇒ board-complete; `'intentions_set'` ⇒ reflection prompt (or reflection-saved if reflections already non-empty when local hour ≥ 16); `'draft'`/none ⇒ intro (or summary screen if a recent summary exists and it's today).
- AI summary: prompt assembled from the day's timeline cards (`"{start}-{end}: {title} - {summary}"` lines), the captured form fields, and up to 3 previous summaries (`fetchRecentJournalSummaries(3, excluding today)`); result parsed out of `<summary>…</summary>` tags (regex `<summary>([\s\S]*?)(?:</summary>|<summary|$)`, fallback = whole trimmed response), then `updateJournalSummary(day, cleaned)` — written to the day captured at generation start (race-safe if the user navigated meanwhile).

---

## 12. Porting checklist / gotchas

1. **Paths**: DB stores absolute native paths. Use `path.join`; write the Windows separator. Any prefix-rewrite migration must handle `\`.
2. **Clock strings** `h:mm a`: produce exactly `"9:05 AM"` / `"12:30 PM"` (no leading zero, uppercase, regular space) — `en-US` `Intl.DateTimeFormat` with `hour12: true, hour: "numeric", minute: "2-digit"` yields this, but verify the space is U+0020 (some ICU builds emit U+202F narrow no-break space before AM/PM — normalize it, since these strings are parsed back!). Parsing must accept the same format strictly.
3. **CURRENT_TIMESTAMP columns are UTC strings**; `*_ts` are epoch seconds; `day` is local. Never convert one convention into another.
4. **Two different day keys**: timeline/journal/day-goals = 4 AM boundary; standup = plain calendar day.
5. **Lexicographic sort quirk** in `fetchTimelineCards(forBatch:)` (ORDER BY clock string). Decide: replicate or fix — but fix consistently with UI expectations.
6. **`fetchUnprocessedChunks(olderThan:)`** — the parameter is a lower bound (`start_ts >= value`), not "older than".
7. **Soft vs hard delete**: timeline cards and screenshots are soft-deleted (`is_deleted=1`); chunks (on failure), observations, and review-rating segments are hard-deleted. Purge soft-deletes screenshot rows and hard-deletes their files.
8. **`cleanupRecordingStragglers` deletes every file in `recordings/` not referenced by an active screenshot row** — run it only when the DB is known-good, and mind this when supporting the legacy video-chunk pipeline.
9. **Error swallowing** is the contract: storage APIs never throw; they return neutral fallbacks.
10. **Fire-and-forget writes** (`registerChunk`, `markChunkCompleted`, `markChunkFailed`, `updateBatchStatus`, `markBatchFailed`, backup, truncation): callers don't await them; keep them ordered on a single writer queue so e.g. `registerChunk` → `markChunkCompleted` can't race.
11. **Unlimited-storage sentinel** is Int64.max; JS numbers can't hold it exactly — use a distinct representation (e.g. `null` = unlimited) at the storage-preferences boundary and translate if importing Mac settings.
12. `deleteTimelineCard` also **hard-deletes overlapping observations** (batch-scoped when possible) — easy to miss.
13. `saveDayGoalPlan` **never updates `created_at` on conflict** and **rewrites category rows from array order**, ignoring incoming `sortOrder` values.
14. The metadata JSON column must keep the **legacy bare-array fallback** on decode if importing existing Mac databases.
