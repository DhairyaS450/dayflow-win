import type Database from 'better-sqlite3'

// Final schema — parity with upstream migrate(). Idempotent.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    file_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recording',
    is_deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
CREATE INDEX IF NOT EXISTS idx_chunks_start_ts ON chunks(start_ts);
CREATE INDEX IF NOT EXISTS idx_chunks_status_start_ts ON chunks(status, start_ts);

CREATE TABLE IF NOT EXISTS analysis_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_start_ts INTEGER NOT NULL,
    batch_end_ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    llm_metadata TEXT,
    detailed_transcription TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analysis_batches_status ON analysis_batches(status);

CREATE TABLE IF NOT EXISTS batch_chunks (
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE RESTRICT,
    PRIMARY KEY (batch_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_chunks_chunk ON batch_chunks(chunk_id);

CREATE TABLE IF NOT EXISTS timeline_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES analysis_batches(id) ON DELETE CASCADE,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    start_ts INTEGER,
    end_ts INTEGER,
    day DATE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    detailed_summary TEXT,
    metadata TEXT,
    video_summary_url TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_day ON timeline_cards(day);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_start_ts ON timeline_cards(start_ts);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_time_range ON timeline_cards(start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_timeline_cards_active_start_ts ON timeline_cards(start_ts) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_timeline_cards_active_batch ON timeline_cards(batch_id) WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS timeline_review_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    rating TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_ratings_time ON timeline_review_ratings(start_ts, end_ts);

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

CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    idle_seconds_at_capture INTEGER,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at);

CREATE TABLE IF NOT EXISTS batch_screenshots (
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE RESTRICT,
    PRIMARY KEY (batch_id, screenshot_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_screenshots_screenshot ON batch_screenshots(screenshot_id);

CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL UNIQUE,
    intentions TEXT,
    notes TEXT,
    goals TEXT,
    reflections TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_day ON journal_entries(day);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);

CREATE TABLE IF NOT EXISTS daily_standup_entries (
    standup_day TEXT NOT NULL PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_daily_standup_entries_created_at ON daily_standup_entries(created_at DESC);

CREATE TABLE IF NOT EXISTS day_goals (
    day TEXT NOT NULL PRIMARY KEY,
    focus_target_minutes INTEGER NOT NULL,
    distraction_limit_minutes INTEGER NOT NULL,
    is_skipped INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_day_goals_updated_at ON day_goals(updated_at DESC);

CREATE TABLE IF NOT EXISTS day_goal_categories (
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('focus', 'distraction')),
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    category_color_hex TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (day, kind, category_id)
);
CREATE INDEX IF NOT EXISTS idx_day_goal_categories_day_kind
    ON day_goal_categories(day, kind, sort_order);

CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    batch_id INTEGER NULL,
    call_group_id TEXT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    model TEXT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success','failure')),
    latency_ms INTEGER NULL,
    http_status INTEGER NULL,
    request_method TEXT NULL,
    request_url TEXT NULL,
    request_headers TEXT NULL,
    request_body TEXT NULL,
    response_headers TEXT NULL,
    response_body TEXT NULL,
    error_domain TEXT NULL,
    error_code INTEGER NULL,
    error_message TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_group ON llm_calls(call_group_id, attempt);
CREATE INDEX IF NOT EXISTS idx_llm_calls_batch ON llm_calls(batch_id);
`

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((r) => r.name === column)
}

export function migrate(db: Database.Database): void {
  db.exec(SCHEMA)
  // Column-presence migrations for imported/older DBs.
  if (!hasColumn(db, 'timeline_cards', 'is_deleted')) {
    db.exec(`ALTER TABLE timeline_cards ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_timeline_cards_active_start_ts ON timeline_cards(start_ts) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_timeline_cards_active_batch ON timeline_cards(batch_id) WHERE is_deleted = 0;`)
  }
  if (!hasColumn(db, 'screenshots', 'idle_seconds_at_capture')) {
    db.exec('ALTER TABLE screenshots ADD COLUMN idle_seconds_at_capture INTEGER;')
  }
  if (!hasColumn(db, 'day_goals', 'is_skipped')) {
    db.exec('ALTER TABLE day_goals ADD COLUMN is_skipped INTEGER NOT NULL DEFAULT 0;')
  }
}
