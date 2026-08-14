import { readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { getDb } from './index'
import { settings } from '../lib/settings'
import { recordingsDir, timelapsesDir } from '../lib/paths'

// Retention: recordings + timelapses quotas (default 10 GB each; null = unlimited).

const DEFAULT_LIMIT = 10_000_000_000

export function recordingsLimit(): number | null {
  const v = settings.get<number | null>('storageLimitRecordingsBytes', DEFAULT_LIMIT)
  return v === null ? null : v
}

export function timelapsesLimit(): number | null {
  const v = settings.get<number | null>('storageLimitTimelapsesBytes', DEFAULT_LIMIT)
  return v === null ? null : v
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      try {
        if (entry.isDirectory()) total += dirSize(p)
        else total += statSync(p).size
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return total
}

/** Delete every file in recordings/ not referenced by an active screenshot row. */
export function cleanupRecordingStragglers(): void {
  try {
    const active = new Set(
      (
        getDb().prepare('SELECT file_path FROM screenshots WHERE is_deleted = 0').all() as {
          file_path: string
        }[]
      ).map((r) => r.file_path.toLowerCase())
    )
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (!active.has(p.toLowerCase())) {
          try {
            rmSync(p, { force: true })
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(recordingsDir())
  } catch (err) {
    console.error('[maintenance] straggler cleanup failed', err)
  }
}

export function purgeRecordingsIfNeeded(): void {
  const limit = recordingsLimit()
  if (limit === null) return
  cleanupRecordingStragglers()
  let currentSize = dirSize(recordingsDir())
  let freed = 0
  const db = getDb()
  for (let pass = 0; pass < 200 && currentSize - freed > limit; pass++) {
    const oldest = db
      .prepare(
        'SELECT id, file_path, file_size FROM screenshots WHERE is_deleted = 0 ORDER BY captured_at ASC LIMIT 500'
      )
      .all() as { id: number; file_path: string; file_size: number | null }[]
    if (oldest.length === 0) break
    const tx = db.transaction(() => {
      for (const row of oldest) {
        db.prepare('UPDATE screenshots SET is_deleted = 1 WHERE id = ?').run(row.id)
        let size = row.file_size
        try {
          if (size == null) size = statSync(row.file_path).size
        } catch {
          size = 0
        }
        try {
          rmSync(row.file_path, { force: true })
        } catch {
          /* ignore */
        }
        freed += size ?? 0
      }
    })
    tx()
  }
  cleanupRecordingStragglers()
}

export function purgeTimelapsesIfNeeded(): void {
  const limit = timelapsesLimit()
  if (limit === null) return
  const root = timelapsesDir()
  let usage = dirSize(root)
  if (usage <= limit) return
  try {
    const entries = readdirSync(root)
      .map((name) => {
        const p = join(root, name)
        let mtime = 0
        try {
          mtime = statSync(p).mtimeMs
        } catch {
          /* keep 0 */
        }
        return { path: p, mtime }
      })
      .sort((a, b) => a.mtime - b.mtime)
    for (const entry of entries) {
      if (usage <= limit) break
      const size = dirSize(entry.path)
      try {
        rmSync(entry.path, { recursive: true, force: true })
        usage -= size
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export function startRetentionTimers(): void {
  purgeRecordingsIfNeeded()
  purgeTimelapsesIfNeeded()
  setInterval(
    () => {
      purgeRecordingsIfNeeded()
      purgeTimelapsesIfNeeded()
    },
    60 * 60 * 1000
  )
}

export function currentUsage(): { recordingsBytes: number; timelapsesBytes: number } {
  return {
    recordingsBytes: dirSize(recordingsDir()),
    timelapsesBytes: dirSize(timelapsesDir())
  }
}
