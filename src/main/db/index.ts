import BetterSqlite3 from 'better-sqlite3'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
  statSync
} from 'fs'
import { dataRoot, dbPath, recordingsDir } from '../lib/paths'

let db: BetterSqlite3.Database | null = null

function applyPragmas(d: BetterSqlite3.Database): void {
  d.pragma('journal_mode = WAL')
  d.pragma('synchronous = NORMAL')
  d.pragma('busy_timeout = 5000')
  d.pragma('foreign_keys = ON')
}

function backupsDir(): string {
  const dir = join(dataRoot(), 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

function deleteDbFiles(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath() + suffix, { force: true })
    } catch {
      /* ignore */
    }
  }
}

function newestBackup(): string | null {
  try {
    const files = readdirSync(backupsDir())
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => join(backupsDir(), f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    return files[0] ?? null
  } catch {
    return null
  }
}

/** Recovery ladder: open normally → restore newest backup → fresh DB. */
function openSafely(): BetterSqlite3.Database {
  try {
    const d = new BetterSqlite3(dbPath())
    applyPragmas(d)
    return d
  } catch (err) {
    console.error('[db] primary open failed', err)
  }
  const backup = newestBackup()
  if (backup) {
    try {
      deleteDbFiles()
      copyFileSync(backup, dbPath())
      const d = new BetterSqlite3(dbPath())
      applyPragmas(d)
      console.warn('[db] restored from backup', backup)
      return d
    } catch (err) {
      console.error('[db] backup restore failed', err)
    }
  }
  deleteDbFiles()
  const d = new BetterSqlite3(dbPath())
  applyPragmas(d)
  console.warn('[db] created fresh database')
  return d
}

export function getDb(): BetterSqlite3.Database {
  if (!db) throw new Error('DB not initialized — call initDb() first')
  return db
}

export function initDb(): BetterSqlite3.Database {
  if (db) return db
  // Ensure dirs exist before DB open (parity with upstream startup order).
  recordingsDir()
  backupsDir()
  // Legacy location migration: chunks.sqlite inside recordings/ → base dir.
  const legacy = join(recordingsDir(), 'chunks.sqlite')
  if (existsSync(legacy) && !existsSync(dbPath())) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (existsSync(legacy + suffix)) copyFileSync(legacy + suffix, dbPath() + suffix)
        rmSync(legacy + suffix, { force: true })
      } catch {
        /* ignore */
      }
    }
  }
  db = openSafely()
  try {
    const check = db.pragma('quick_check') as { quick_check: string }[]
    if (check[0]?.quick_check !== 'ok') console.warn('[db] quick_check:', check)
  } catch (err) {
    console.warn('[db] quick_check failed', err)
  }
  // Schema migration
  const { migrate } = require('./schema') as typeof import('./schema')
  migrate(db)
  return db
}

export function checkpointPassive(): void {
  try {
    db?.pragma('wal_checkpoint(PASSIVE)')
  } catch {
    /* ignore */
  }
}

export function checkpointTruncate(): void {
  try {
    db?.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
}

export function createBackup(): void {
  if (!db) return
  try {
    const now = new Date()
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
    const name = `chunks-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.sqlite`
    const dest = join(backupsDir(), name)
    db.backup(dest)
      .then(() => pruneBackups())
      .catch((err: unknown) => console.error('[db] backup failed', err))
  } catch (err) {
    console.error('[db] backup failed', err)
  }
}

function pruneBackups(): void {
  try {
    const files = readdirSync(backupsDir())
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => join(backupsDir(), f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const f of files.slice(3)) rmSync(f, { force: true })
  } catch {
    /* ignore */
  }
}

export function hasAnyBackup(): boolean {
  try {
    return readdirSync(backupsDir()).some((f) => f.endsWith('.sqlite'))
  } catch {
    return false
  }
}

/** Truncate oversized LLM bodies (64 KiB cap), 100 rows/pass, max 50 passes per column. */
export function truncateLLMBodies(): void {
  if (!db) return
  const MAX = 65536
  let updatedAny = false
  for (const col of ['request_body', 'response_body']) {
    for (let pass = 0; pass < 50; pass++) {
      try {
        const res = db
          .prepare(
            `UPDATE llm_calls
             SET ${col} = '<truncated llm body: original_chars=' || length(${col}) ||
                          ', stored_prefix_chars=${MAX}>' || char(10) || substr(${col}, 1, ${MAX})
             WHERE id IN (
               SELECT id FROM llm_calls
               WHERE ${col} IS NOT NULL AND length(${col}) > ${MAX}
                 AND ${col} NOT LIKE '<truncated llm body:%'
               LIMIT 100
             )`
          )
          .run()
        if (res.changes === 0) break
        updatedAny = true
      } catch {
        break
      }
    }
  }
  if (updatedAny) checkpointPassive()
}

export function startDbMaintenance(): void {
  // WAL checkpoint every 5 minutes
  setInterval(checkpointPassive, 5 * 60 * 1000)
  // Daily backup, +1h first; immediate if none exists
  if (!hasAnyBackup()) createBackup()
  setTimeout(() => {
    createBackup()
    setInterval(createBackup, 24 * 60 * 60 * 1000)
  }, 60 * 60 * 1000)
  // LLM body truncation once per launch
  setTimeout(truncateLLMBodies, 5000)
}
