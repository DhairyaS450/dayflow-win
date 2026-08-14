// StorageManager port — same API surface + semantics as upstream.
// Contract: methods never throw; reads fall back to empty/null, writes no-op on error.

import { randomUUID } from 'crypto'
import { join } from 'path'
import { statSync, rmSync } from 'fs'
import { getDb } from './index'
import { decodeMetadata, encodeMetadata } from './metadata'
import { recordingsDir } from '../lib/paths'
import {
  dayWindow,
  dayInfoFor,
  formatHMMA,
  parseTimeHMMA,
  screenshotFilename,
  ymd
} from '../lib/time'
import type {
  Screenshot,
  Observation,
  TimelineCard,
  TimelineCardShell,
  TimelineCardWithTimestamps,
  LLMCall,
  LLMCallDBRecord,
  JournalEntry,
  DailyStandupEntry,
  DayGoalPlan,
  DayGoalCategorySnapshot,
  TimelineReviewRatingSegment,
  AnalysisBatchDebugEntry
} from '../../shared/types'

const now = (): number => Math.floor(Date.now() / 1000)

function safe<T>(fallback: T, fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    console.error('[storage]', err)
    return fallback
  }
}

// ---------- Screenshots ----------

export function nextScreenshotPath(): string {
  return join(recordingsDir(), screenshotFilename(new Date()))
}

export function saveScreenshot(
  filePath: string,
  capturedAt: number,
  idleSecondsAtCapture: number | null
): number | null {
  return safe(null, () => {
    let fileSize: number | null = null
    try {
      fileSize = statSync(filePath).size
    } catch {
      fileSize = null
    }
    const res = getDb()
      .prepare(
        'INSERT INTO screenshots(captured_at, file_path, file_size, idle_seconds_at_capture) VALUES (?,?,?,?)'
      )
      .run(capturedAt, filePath, fileSize, idleSecondsAtCapture)
    return Number(res.lastInsertRowid)
  })
}

function rowToScreenshot(r: Record<string, unknown>): Screenshot {
  return {
    id: r.id as number,
    capturedAt: r.captured_at as number,
    filePath: r.file_path as string,
    fileSize: (r.file_size as number) ?? null,
    idleSecondsAtCapture: (r.idle_seconds_at_capture as number) ?? null,
    isDeleted: (r.is_deleted as number) !== 0
  }
}

export function fetchUnprocessedScreenshots(since: number): Screenshot[] {
  return safe([], () =>
    (
      getDb()
        .prepare(
          `SELECT * FROM screenshots
           WHERE captured_at >= ? AND is_deleted = 0
             AND id NOT IN (SELECT screenshot_id FROM batch_screenshots)
           ORDER BY captured_at ASC`
        )
        .all(since) as Record<string, unknown>[]
    ).map(rowToScreenshot)
  )
}

export function screenshotsForBatch(batchId: number): Screenshot[] {
  return safe([], () =>
    (
      getDb()
        .prepare(
          `SELECT s.* FROM batch_screenshots bs
           JOIN screenshots s ON s.id = bs.screenshot_id
           WHERE bs.batch_id = ? AND s.is_deleted = 0
           ORDER BY s.captured_at ASC`
        )
        .all(batchId) as Record<string, unknown>[]
    ).map(rowToScreenshot)
  )
}

export function fetchScreenshotsInTimeRange(startTs: number, endTs: number): Screenshot[] {
  return safe([], () =>
    (
      getDb()
        .prepare(
          `SELECT * FROM screenshots
           WHERE captured_at >= ? AND captured_at <= ? AND is_deleted = 0
           ORDER BY captured_at ASC`
        )
        .all(startTs, endTs) as Record<string, unknown>[]
    ).map(rowToScreenshot)
  )
}

// ---------- Analysis batches ----------

export function saveBatchWithScreenshots(
  startTs: number,
  endTs: number,
  screenshotIds: number[]
): number | null {
  if (screenshotIds.length === 0) return null
  return safe(null, () => {
    const db = getDb()
    const tx = db.transaction(() => {
      const res = db
        .prepare('INSERT INTO analysis_batches(batch_start_ts, batch_end_ts) VALUES (?,?)')
        .run(startTs, endTs)
      const batchId = Number(res.lastInsertRowid)
      const ins = db.prepare('INSERT INTO batch_screenshots(batch_id, screenshot_id) VALUES (?,?)')
      for (const sid of screenshotIds) ins.run(batchId, sid)
      return batchId
    })
    return tx()
  })
}

export function updateBatchStatus(batchId: number, status: string, reason?: string | null): void {
  safe(undefined, () => {
    if (reason !== undefined) {
      getDb()
        .prepare('UPDATE analysis_batches SET status = ?, reason = ? WHERE id = ?')
        .run(status, reason, batchId)
    } else {
      getDb().prepare('UPDATE analysis_batches SET status = ? WHERE id = ?').run(status, batchId)
    }
  })
}

export function markBatchFailed(batchId: number, reason: string): void {
  safe(undefined, () => {
    getDb()
      .prepare("UPDATE analysis_batches SET status = 'failed', reason = ? WHERE id = ?")
      .run(reason, batchId)
  })
}

export function updateBatchLLMMetadata(batchId: number, calls: LLMCall[]): void {
  safe(undefined, () => {
    getDb()
      .prepare('UPDATE analysis_batches SET llm_metadata = ? WHERE id = ?')
      .run(JSON.stringify(calls), batchId)
  })
}

export function fetchBatchLLMMetadata(batchId: number): LLMCall[] {
  return safe([], () => {
    const row = getDb()
      .prepare('SELECT llm_metadata FROM analysis_batches WHERE id = ?')
      .get(batchId) as { llm_metadata: string | null } | undefined
    if (!row?.llm_metadata) return []
    return JSON.parse(row.llm_metadata) as LLMCall[]
  })
}

export function getBatchStartTimestamp(batchId: number): number | null {
  return safe(null, () => {
    const row = getDb()
      .prepare('SELECT batch_start_ts FROM analysis_batches WHERE id = ?')
      .get(batchId) as { batch_start_ts: number } | undefined
    return row?.batch_start_ts ?? null
  })
}

export function getBatch(
  batchId: number
): { id: number; startTs: number; endTs: number; status: string } | null {
  return safe(null, () => {
    const row = getDb()
      .prepare('SELECT id, batch_start_ts, batch_end_ts, status FROM analysis_batches WHERE id = ?')
      .get(batchId) as
      | { id: number; batch_start_ts: number; batch_end_ts: number; status: string }
      | undefined
    return row
      ? { id: row.id, startTs: row.batch_start_ts, endTs: row.batch_end_ts, status: row.status }
      : null
  })
}

export function fetchBatchesForDay(
  day: string
): { id: number; startTs: number; endTs: number; status: string }[] {
  return safe([], () => {
    const { startTs, endTs } = dayWindow(day)
    return (
      getDb()
        .prepare(
          `SELECT id, batch_start_ts, batch_end_ts, status FROM analysis_batches
           WHERE batch_start_ts >= ? AND batch_end_ts <= ? ORDER BY batch_start_ts ASC`
        )
        .all(startTs, endTs) as {
        id: number
        batch_start_ts: number
        batch_end_ts: number
        status: string
      }[]
    ).map((r) => ({ id: r.id, startTs: r.batch_start_ts, endTs: r.batch_end_ts, status: r.status }))
  })
}

export function fetchRecentAnalysisBatchesForDebug(limit: number): AnalysisBatchDebugEntry[] {
  if (limit <= 0) return []
  return safe([], () =>
    (
      getDb()
        .prepare(
          'SELECT id, batch_start_ts, batch_end_ts, status, reason, created_at FROM analysis_batches ORDER BY id DESC LIMIT ?'
        )
        .all(limit) as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      status: r.status as string,
      startTs: r.batch_start_ts as number,
      endTs: r.batch_end_ts as number,
      createdAt: (r.created_at as string) ?? null,
      reason: (r.reason as string) ?? null
    }))
  )
}

export function countCompletedAnalysisBatches(): number {
  return safe(0, () => {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM analysis_batches WHERE status IN ('completed','analyzed')")
      .get() as { c: number }
    return row.c
  })
}

// ---------- Observations ----------

export function saveObservations(
  batchId: number,
  observations: Omit<Observation, 'id' | 'batchId' | 'createdAt'>[]
): void {
  if (observations.length === 0) return
  safe(undefined, () => {
    const db = getDb()
    const ins = db.prepare(
      'INSERT INTO observations(batch_id, start_ts, end_ts, observation, metadata, llm_model) VALUES (?,?,?,?,?,?)'
    )
    const tx = db.transaction(() => {
      for (const o of observations) {
        ins.run(batchId, o.startTs, o.endTs, o.observation, o.metadata, o.llmModel)
      }
    })
    tx()
  })
}

function rowToObservation(r: Record<string, unknown>): Observation {
  return {
    id: r.id as number,
    batchId: r.batch_id as number,
    startTs: r.start_ts as number,
    endTs: r.end_ts as number,
    observation: r.observation as string,
    metadata: (r.metadata as string) ?? null,
    llmModel: (r.llm_model as string) ?? null,
    createdAt: (r.created_at as string) ?? null
  }
}

export function fetchObservationsForBatch(batchId: number): Observation[] {
  return safe([], () =>
    (
      getDb()
        .prepare('SELECT * FROM observations WHERE batch_id = ? ORDER BY start_ts ASC')
        .all(batchId) as Record<string, unknown>[]
    ).map(rowToObservation)
  )
}

/** Overlap query (fetchObservationsByTimeRange upstream). */
export function fetchObservationsByTimeRange(fromTs: number, toTs: number): Observation[] {
  return safe([], () =>
    (
      getDb()
        .prepare(
          `SELECT * FROM observations
           WHERE (start_ts < ? AND end_ts > ?) OR (start_ts >= ? AND start_ts < ?)
           ORDER BY start_ts ASC`
        )
        .all(toTs, fromTs, fromTs, toTs) as Record<string, unknown>[]
    ).map(rowToObservation)
  )
}

export function deleteObservations(batchIds: number[]): void {
  if (batchIds.length === 0) return
  safe(undefined, () => {
    const placeholders = batchIds.map(() => '?').join(',')
    getDb().prepare(`DELETE FROM observations WHERE batch_id IN (${placeholders})`).run(...batchIds)
  })
}

export function insertLLMCall(rec: LLMCallDBRecord): void {
  safe(undefined, () => {
    getDb()
      .prepare(
        `INSERT INTO llm_calls(batch_id, call_group_id, attempt, provider, model, operation, status,
          latency_ms, http_status, request_method, request_url, request_headers, request_body,
          response_headers, response_body, error_domain, error_code, error_message)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        rec.batchId ?? null,
        rec.callGroupId ?? null,
        rec.attempt,
        rec.provider,
        rec.model ?? null,
        rec.operation,
        rec.status,
        rec.latencyMs ?? null,
        rec.httpStatus ?? null,
        rec.requestMethod ?? null,
        rec.requestURL ?? null,
        rec.requestHeadersJSON ?? null,
        rec.requestBody ?? null,
        rec.responseHeadersJSON ?? null,
        rec.responseBody ?? null,
        rec.errorDomain ?? null,
        rec.errorCode ?? null,
        rec.errorMessage ?? null
      )
  })
}

// ---------- Timeline cards: timestamp resolution ----------

function setClock(base: Date, minutes: number): Date {
  const d = new Date(base.getTime())
  d.setHours(0, 0, 0, 0)
  d.setMinutes(minutes)
  return d
}

/** saveTimelineCardShell — anchor clock strings to the batch start. */
export function saveTimelineCardShell(batchId: number, card: TimelineCardShell): number | null {
  return safe(null, () => {
    const batchStartTs = getBatchStartTimestamp(batchId)
    if (batchStartTs === null) return null
    const baseDate = new Date(batchStartTs * 1000)
    const startMin = parseTimeHMMA(card.startTimestamp)
    const endMin = parseTimeHMMA(card.endTimestamp)
    if (startMin === null || endMin === null) return null

    let startDate = setClock(baseDate, startMin)
    if (startMin < 4 * 60 && startDate.getTime() < baseDate.getTime()) {
      const nextDay = new Date(startDate.getTime() + 86400_000)
      if (
        Math.abs(nextDay.getTime() - baseDate.getTime()) <
        Math.abs(startDate.getTime() - baseDate.getTime())
      ) {
        startDate = nextDay
      }
    }
    let endDate = setClock(baseDate, endMin)
    if (endMin < 4 * 60 && endDate.getTime() < baseDate.getTime()) {
      const nextDay = new Date(endDate.getTime() + 86400_000)
      if (
        Math.abs(nextDay.getTime() - baseDate.getTime()) <
        Math.abs(endDate.getTime() - baseDate.getTime())
      ) {
        endDate = nextDay
      }
    }
    if (endDate.getTime() < startDate.getTime()) endDate = new Date(endDate.getTime() + 86400_000)

    const day = dayInfoFor(startDate).dayString
    const metadata = encodeMetadata({
      distractions: card.distractions ?? undefined,
      appSites: card.appSites ?? undefined,
      isBackupGenerated: card.isBackupGenerated ?? undefined,
      idle: card.idleMetadata ?? undefined
    })
    const res = getDb()
      .prepare(
        `INSERT INTO timeline_cards(batch_id, start, end, start_ts, end_ts, day, title, summary,
          category, subcategory, detailed_summary, metadata)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        batchId,
        card.startTimestamp,
        card.endTimestamp,
        Math.floor(startDate.getTime() / 1000),
        Math.floor(endDate.getTime() / 1000),
        day,
        card.title,
        card.summary,
        card.category,
        card.subcategory,
        card.detailedSummary,
        metadata
      )
    return Number(res.lastInsertRowid)
  })
}

const OVERLAP = `((start_ts < ? AND end_ts > ?) OR (start_ts >= ? AND start_ts < ?))`

/** replaceTimelineCardsInRange — anchor to window midpoint; atomic. */
export function replaceTimelineCardsInRange(
  fromTs: number,
  toTs: number,
  newCards: TimelineCardShell[],
  batchId: number | null
): { insertedIds: number[]; deletedVideoPaths: string[] } {
  return safe({ insertedIds: [], deletedVideoPaths: [] }, () => {
    const db = getDb()
    const tx = db.transaction(() => {
      const overlapping = db
        .prepare(
          `SELECT id, video_summary_url FROM timeline_cards
           WHERE ${OVERLAP} AND is_deleted = 0 AND (category != 'System' OR batch_id = ?)`
        )
        .all(toTs, fromTs, fromTs, toTs, batchId) as {
        id: number
        video_summary_url: string | null
      }[]
      const deletedVideoPaths = overlapping
        .map((r) => r.video_summary_url)
        .filter((p): p is string => !!p)
      if (overlapping.length > 0) {
        const ids = overlapping.map((r) => r.id)
        db.prepare(
          `UPDATE timeline_cards SET is_deleted = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
        ).run(...ids)
      }

      const anchor = new Date((fromTs + (toTs - fromTs) / 2) * 1000)
      const resolveClock = (minutes: number): Date => {
        const sameDay = setClock(anchor, minutes)
        const prevDay = new Date(sameDay.getTime() - 86400_000)
        const nextDay = new Date(sameDay.getTime() + 86400_000)
        let best = sameDay
        for (const cand of [prevDay, nextDay]) {
          if (Math.abs(cand.getTime() - anchor.getTime()) < Math.abs(best.getTime() - anchor.getTime()))
            best = cand
        }
        return best
      }

      const insertedIds: number[] = []
      const ins = db.prepare(
        `INSERT INTO timeline_cards(batch_id, start, end, start_ts, end_ts, day, title, summary,
          category, subcategory, detailed_summary, metadata)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      for (const card of newCards) {
        const startMin = parseTimeHMMA(card.startTimestamp)
        const endMin = parseTimeHMMA(card.endTimestamp)
        if (startMin === null || endMin === null) continue
        const startDate = resolveClock(startMin)
        let endDate = resolveClock(endMin)
        if (endDate.getTime() < startDate.getTime()) endDate = new Date(endDate.getTime() + 86400_000)
        const day = dayInfoFor(startDate).dayString
        const metadata = encodeMetadata({
          distractions: card.distractions ?? undefined,
          appSites: card.appSites ?? undefined,
          isBackupGenerated: card.isBackupGenerated ?? undefined,
          idle: card.idleMetadata ?? undefined
        })
        const res = ins.run(
          batchId,
          card.startTimestamp,
          card.endTimestamp,
          Math.floor(startDate.getTime() / 1000),
          Math.floor(endDate.getTime() / 1000),
          day,
          card.title,
          card.summary,
          card.category,
          card.subcategory,
          card.detailedSummary,
          metadata
        )
        insertedIds.push(Number(res.lastInsertRowid))
      }
      return { insertedIds, deletedVideoPaths }
    })
    return tx()
  })
}

// ---------- Timeline cards: reads ----------

function rowToCard(r: Record<string, unknown>): TimelineCard {
  const meta = decodeMetadata((r.metadata as string) ?? null)
  return {
    id: randomUUID(),
    recordId: r.id as number,
    batchId: (r.batch_id as number) ?? null,
    startTimestamp: r.start as string,
    endTimestamp: r.end as string,
    category: r.category as string,
    subcategory: (r.subcategory as string) ?? '',
    title: r.title as string,
    summary: (r.summary as string) ?? '',
    detailedSummary: (r.detailed_summary as string) ?? '',
    day: r.day as string,
    startTs: (r.start_ts as number) ?? null,
    endTs: (r.end_ts as number) ?? null,
    distractions: meta.distractions ?? null,
    videoSummaryURL: (r.video_summary_url as string) ?? null,
    otherVideoSummaryURLs: null,
    appSites: meta.appSites ?? null,
    isBackupGenerated: meta.isBackupGenerated ?? null
  }
}

export function fetchTimelineCardsForDay(day: string): TimelineCard[] {
  return safe([], () => {
    const { startTs, endTs } = dayWindow(day)
    return (
      getDb()
        .prepare(
          `SELECT * FROM timeline_cards
           WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0
           ORDER BY start_ts ASC, start ASC`
        )
        .all(startTs, endTs) as Record<string, unknown>[]
    ).map(rowToCard)
  })
}

export function fetchTimelineCardsForBatch(batchId: number): TimelineCard[] {
  return safe([], () =>
    (
      getDb()
        .prepare(
          // Upstream quirk preserved: lexicographic sort on the clock string column.
          `SELECT * FROM timeline_cards WHERE batch_id = ? AND is_deleted = 0 ORDER BY start ASC`
        )
        .all(batchId) as Record<string, unknown>[]
    ).map(rowToCard)
  )
}

export function fetchTimelineCardsByTimeRange(fromTs: number, toTs: number): TimelineCard[] {
  return safe([], () =>
    (
      getDb()
        .prepare(
          `SELECT * FROM timeline_cards WHERE ${OVERLAP} AND is_deleted = 0 ORDER BY start_ts ASC`
        )
        .all(toTs, fromTs, fromTs, toTs) as Record<string, unknown>[]
    ).map(rowToCard)
  )
}

export function fetchTimelineCardById(id: number): TimelineCardWithTimestamps | null {
  return safe(null, () => {
    const r = getDb()
      .prepare('SELECT * FROM timeline_cards WHERE id = ? AND is_deleted = 0')
      .get(id) as Record<string, unknown> | undefined
    if (!r) return null
    const meta = decodeMetadata((r.metadata as string) ?? null)
    return {
      id: r.id as number,
      startTimestamp: r.start as string,
      endTimestamp: r.end as string,
      startTs: (r.start_ts as number) ?? 0,
      endTs: (r.end_ts as number) ?? 0,
      category: r.category as string,
      subcategory: (r.subcategory as string) ?? '',
      title: r.title as string,
      summary: (r.summary as string) ?? '',
      detailedSummary: (r.detailed_summary as string) ?? '',
      day: r.day as string,
      distractions: meta.distractions ?? null,
      videoSummaryURL: (r.video_summary_url as string) ?? null
    }
  })
}

export function fetchLastTimelineCard(endingBeforeTs: number): TimelineCardWithTimestamps | null {
  return safe(null, () => {
    const r = getDb()
      .prepare(
        `SELECT * FROM timeline_cards WHERE end_ts <= ? AND is_deleted = 0
         ORDER BY end_ts DESC, id DESC LIMIT 1`
      )
      .get(endingBeforeTs) as Record<string, unknown> | undefined
    if (!r) return null
    const meta = decodeMetadata((r.metadata as string) ?? null)
    return {
      id: r.id as number,
      startTimestamp: r.start as string,
      endTimestamp: r.end as string,
      startTs: (r.start_ts as number) ?? 0,
      endTs: (r.end_ts as number) ?? 0,
      category: r.category as string,
      subcategory: (r.subcategory as string) ?? '',
      title: r.title as string,
      summary: (r.summary as string) ?? '',
      detailedSummary: (r.detailed_summary as string) ?? '',
      day: r.day as string,
      distractions: meta.distractions ?? null,
      videoSummaryURL: (r.video_summary_url as string) ?? null
    }
  })
}

export function fetchTotalMinutesTracked(fromTs: number, toTs: number): number {
  return safe(0, () => {
    const row = getDb()
      .prepare(
        `SELECT COALESCE(SUM(end_ts - start_ts), 0) AS total FROM timeline_cards
         WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0 AND category != 'System'`
      )
      .get(fromTs, toTs) as { total: number }
    return row.total / 60
  })
}

/** Week window: Monday 4 AM → next Monday 4 AM. */
export function weekWindow(containing: Date): { startTs: number; endTs: number } {
  const d = new Date(containing.getTime())
  const dayOfWeek = (d.getDay() + 6) % 7 // Monday=0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek, 4, 0, 0, 0)
  if (containing.getTime() < monday.getTime()) monday.setDate(monday.getDate() - 7)
  const end = new Date(monday.getTime())
  end.setDate(end.getDate() + 7)
  return { startTs: Math.floor(monday.getTime() / 1000), endTs: Math.floor(end.getTime() / 1000) }
}

export function fetchTotalMinutesTrackedForWeek(containing: Date): number {
  const { startTs, endTs } = weekWindow(containing)
  return fetchTotalMinutesTracked(startTs, endTs)
}

// ---------- Timeline cards: writes ----------

export function updateTimelineCardVideoURL(cardId: number, videoSummaryURL: string): void {
  safe(undefined, () => {
    getDb()
      .prepare('UPDATE timeline_cards SET video_summary_url = ? WHERE id = ?')
      .run(videoSummaryURL, cardId)
  })
}

export function updateTimelineCardCategory(cardId: number, category: string): void {
  const trimmed = category.trim()
  if (!trimmed) return
  safe(undefined, () => {
    getDb().prepare('UPDATE timeline_cards SET category = ? WHERE id = ?').run(trimmed, cardId)
  })
}

export function deleteTimelineCard(recordId: number): string | null {
  return safe(null, () => {
    const db = getDb()
    const tx = db.transaction(() => {
      const row = db
        .prepare(
          'SELECT video_summary_url, start_ts, end_ts, batch_id FROM timeline_cards WHERE id = ? AND is_deleted = 0'
        )
        .get(recordId) as
        | {
            video_summary_url: string | null
            start_ts: number | null
            end_ts: number | null
            batch_id: number | null
          }
        | undefined
      if (!row) return null
      db.prepare('UPDATE timeline_cards SET is_deleted = 1 WHERE id = ? AND is_deleted = 0').run(
        recordId
      )
      const s = row.start_ts
      const e = row.end_ts
      if (s != null && e != null && e > s) {
        if (row.batch_id != null) {
          db.prepare(
            `DELETE FROM observations WHERE batch_id = ? AND
             ((start_ts < ? AND end_ts > ?) OR (start_ts >= ? AND start_ts < ?))`
          ).run(row.batch_id, e, s, s, e)
        } else {
          db.prepare(
            `DELETE FROM observations WHERE
             (start_ts < ? AND end_ts > ?) OR (start_ts >= ? AND start_ts < ?)`
          ).run(e, s, s, e)
        }
      }
      return row.video_summary_url
    })
    return tx()
  })
}

export function createOnboardingCard(firstCategoryName: string, summary: string): void {
  safe(undefined, () => {
    const nowDate = new Date()
    const startDate = new Date(nowDate.getTime() - 13 * 60 * 1000)
    const day = dayInfoFor(startDate).dayString
    getDb()
      .prepare(
        `INSERT INTO timeline_cards(batch_id, start, end, start_ts, end_ts, day, title, summary,
          category, subcategory, detailed_summary, metadata)
         VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        formatHMMA(Math.floor(startDate.getTime() / 1000)),
        formatHMMA(Math.floor(nowDate.getTime() / 1000)),
        Math.floor(startDate.getTime() / 1000),
        Math.floor(nowDate.getTime() / 1000),
        day,
        'Installed Dayflow!',
        summary,
        firstCategoryName,
        'Setup',
        '',
        JSON.stringify({ appSites: { primary: 'dayflow.so' } })
      )
  })
}

// ---------- Reprocessing ----------

export function deleteTimelineCardsForDay(day: string): string[] {
  return safe([], () => {
    const { startTs, endTs } = dayWindow(day)
    const db = getDb()
    const tx = db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT video_summary_url FROM timeline_cards
           WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0 AND video_summary_url IS NOT NULL`
        )
        .all(startTs, endTs) as { video_summary_url: string }[]
      db.prepare(
        'UPDATE timeline_cards SET is_deleted = 1 WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0'
      ).run(startTs, endTs)
      return rows.map((r) => r.video_summary_url)
    })
    return tx()
  })
}

export function deleteTimelineCardsForBatchIds(batchIds: number[]): string[] {
  if (batchIds.length === 0) return []
  return safe([], () => {
    const db = getDb()
    const ph = batchIds.map(() => '?').join(',')
    const tx = db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT video_summary_url FROM timeline_cards
           WHERE batch_id IN (${ph}) AND is_deleted = 0 AND video_summary_url IS NOT NULL`
        )
        .all(...batchIds) as { video_summary_url: string }[]
      db.prepare(
        `UPDATE timeline_cards SET is_deleted = 1 WHERE batch_id IN (${ph}) AND is_deleted = 0`
      ).run(...batchIds)
      return rows.map((r) => r.video_summary_url)
    })
    return tx()
  })
}

export function resetBatchStatusesForDay(day: string): number[] {
  return safe([], () => {
    const { startTs, endTs } = dayWindow(day)
    const db = getDb()
    const ids = (
      db
        .prepare(
          `SELECT id FROM analysis_batches
           WHERE batch_start_ts >= ? AND batch_end_ts <= ?
             AND status IN ('completed','failed','processing','analyzed')`
        )
        .all(startTs, endTs) as { id: number }[]
    ).map((r) => r.id)
    if (ids.length > 0) {
      db.prepare(
        `UPDATE analysis_batches SET status = 'pending', reason = NULL, llm_metadata = NULL
         WHERE id IN (${ids.map(() => '?').join(',')})`
      ).run(...ids)
    }
    return ids
  })
}

export function resetBatchStatusesForIds(batchIds: number[]): number[] {
  if (batchIds.length === 0) return []
  return safe([], () => {
    const db = getDb()
    const ph = batchIds.map(() => '?').join(',')
    const existing = (
      db.prepare(`SELECT id FROM analysis_batches WHERE id IN (${ph})`).all(...batchIds) as {
        id: number
      }[]
    ).map((r) => r.id)
    if (existing.length > 0) {
      db.prepare(
        `UPDATE analysis_batches SET status = 'pending', reason = NULL, llm_metadata = NULL
         WHERE id IN (${existing.map(() => '?').join(',')})`
      ).run(...existing)
    }
    return existing
  })
}

// ---------- Review ratings ----------

export function fetchReviewRatingSegments(
  startTs: number,
  endTs: number
): TimelineReviewRatingSegment[] {
  if (endTs <= startTs) return []
  return safe([], () =>
    (
      getDb()
        .prepare(
          `SELECT * FROM timeline_review_ratings
           WHERE NOT (end_ts <= ? OR start_ts >= ?) ORDER BY start_ts ASC`
        )
        .all(startTs, endTs) as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      startTs: r.start_ts as number,
      endTs: r.end_ts as number,
      rating: r.rating as string
    }))
  )
}

export function applyReviewRating(startTs: number, endTs: number, rating: string): void {
  if (endTs <= startTs) return
  safe(undefined, () => {
    const db = getDb()
    const tx = db.transaction(() => {
      const overlapping = db
        .prepare(
          `SELECT * FROM timeline_review_ratings
           WHERE NOT (end_ts <= ? OR start_ts >= ?) ORDER BY start_ts ASC`
        )
        .all(startTs, endTs) as { id: number; start_ts: number; end_ts: number; rating: string }[]
      const fragments: { start: number; end: number; rating: string }[] = []
      for (const seg of overlapping) {
        if (seg.start_ts < startTs) {
          const fragEnd = Math.min(startTs, seg.end_ts)
          if (fragEnd > seg.start_ts) fragments.push({ start: seg.start_ts, end: fragEnd, rating: seg.rating })
        }
        if (seg.end_ts > endTs) {
          const fragStart = Math.max(endTs, seg.start_ts)
          if (seg.end_ts > fragStart) fragments.push({ start: fragStart, end: seg.end_ts, rating: seg.rating })
        }
      }
      if (overlapping.length > 0) {
        db.prepare(
          `DELETE FROM timeline_review_ratings WHERE id IN (${overlapping.map(() => '?').join(',')})`
        ).run(...overlapping.map((s) => s.id))
      }
      const ins = db.prepare(
        'INSERT INTO timeline_review_ratings(start_ts, end_ts, rating) VALUES (?,?,?)'
      )
      for (const f of fragments) ins.run(f.start, f.end, f.rating)
      ins.run(startTs, endTs, rating)
    })
    tx()
  })
}

export function hasAnyTimelineReviewRating(): boolean {
  return safe(false, () => {
    return getDb().prepare('SELECT 1 FROM timeline_review_ratings LIMIT 1').get() !== undefined
  })
}

export function hasReviewRatingInRecentDays(days = 7): boolean {
  if (days <= 0) return false
  return safe(false, () => {
    const end = now()
    const start = end - days * 86400
    return (
      getDb()
        .prepare('SELECT 1 FROM timeline_review_ratings WHERE end_ts > ? AND start_ts < ? LIMIT 1')
        .get(start, end) !== undefined
    )
  })
}

export function fetchUnreviewedTimelineCardCount(day: string, coverageThreshold = 0.8): number {
  return safe(0, () => {
    const { startTs, endTs } = dayWindow(day)
    const cards = (
      getDb()
        .prepare(
          `SELECT start_ts, end_ts, category FROM timeline_cards
           WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0`
        )
        .all(startTs, endTs) as { start_ts: number | null; end_ts: number | null; category: string }[]
    ).filter((c) => c.category.trim().toLowerCase() !== 'system')

    const segments = fetchReviewRatingSegments(startTs, endTs)
      .map((s) => ({ start: Math.max(s.startTs, startTs), end: Math.min(s.endTs, endTs) }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start)
    // Merge overlapping/touching
    const merged: { start: number; end: number }[] = []
    for (const s of segments) {
      const last = merged[merged.length - 1]
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
      else merged.push({ ...s })
    }

    const sortedCards = cards
      .slice()
      .sort((a, b) => (a.start_ts ?? 0) - (b.start_ts ?? 0))
    let idx = 0
    let unreviewed = 0
    for (const card of sortedCards) {
      const s = card.start_ts
      const e = card.end_ts
      if (s == null || e == null || e <= s) {
        unreviewed++
        continue
      }
      while (idx < merged.length && merged[idx].end <= s) idx++
      let covered = 0
      let j = idx
      while (j < merged.length && merged[j].start < e) {
        covered += Math.min(merged[j].end, e) - Math.max(merged[j].start, s)
        if (merged[j].end > e) break
        j++
      }
      if (covered / (e - s) < coverageThreshold) unreviewed++
    }
    return unreviewed
  })
}

// ---------- Journal ----------

function rowToJournal(r: Record<string, unknown>): JournalEntry {
  return {
    id: r.id as number,
    day: r.day as string,
    intentions: (r.intentions as string) ?? null,
    notes: (r.notes as string) ?? null,
    goals: (r.goals as string) ?? null,
    reflections: (r.reflections as string) ?? null,
    summary: (r.summary as string) ?? null,
    status: ((r.status as string) ?? 'draft') as JournalEntry['status'],
    createdAt: (r.created_at as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null
  }
}

export function fetchJournalEntry(day: string): JournalEntry | null {
  return safe(null, () => {
    const r = getDb().prepare('SELECT * FROM journal_entries WHERE day = ?').get(day) as
      | Record<string, unknown>
      | undefined
    return r ? rowToJournal(r) : null
  })
}

export function updateJournalIntentions(
  day: string,
  intentions: string | null,
  notes: string | null,
  goals: string | null
): void {
  safe(undefined, () => {
    const db = getDb()
    const exists = db.prepare('SELECT 1 FROM journal_entries WHERE day = ?').get(day)
    if (exists) {
      db.prepare(
        `UPDATE journal_entries SET intentions = ?, notes = ?, goals = ?, status = 'intentions_set',
         updated_at = CURRENT_TIMESTAMP WHERE day = ?`
      ).run(intentions, notes, goals, day)
    } else {
      db.prepare(
        `INSERT INTO journal_entries(day, intentions, notes, goals, status) VALUES (?,?,?,?,'intentions_set')`
      ).run(day, intentions, notes, goals)
    }
  })
}

export function updateJournalReflections(day: string, reflections: string | null): void {
  safe(undefined, () => {
    const db = getDb()
    const exists = db.prepare('SELECT 1 FROM journal_entries WHERE day = ?').get(day)
    if (exists) {
      db.prepare(
        'UPDATE journal_entries SET reflections = ?, updated_at = CURRENT_TIMESTAMP WHERE day = ?'
      ).run(reflections, day)
    } else {
      db.prepare(`INSERT INTO journal_entries(day, reflections, status) VALUES (?,?,'draft')`).run(
        day,
        reflections
      )
    }
  })
}

export function updateJournalSummary(day: string, summary: string): void {
  safe(undefined, () => {
    const db = getDb()
    const exists = db.prepare('SELECT 1 FROM journal_entries WHERE day = ?').get(day)
    if (exists) {
      db.prepare(
        `UPDATE journal_entries SET summary = ?, status = 'complete', updated_at = CURRENT_TIMESTAMP WHERE day = ?`
      ).run(summary, day)
    } else {
      db.prepare(`INSERT INTO journal_entries(day, summary, status) VALUES (?,?,'complete')`).run(
        day,
        summary
      )
    }
  })
}

export function fetchRecentJournalSummary(withinDays: number): { day: string; summary: string } | null {
  return safe(null, () => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - withinDays)
    const cutoffDay = ymd(cutoff)
    const r = getDb()
      .prepare(
        `SELECT day, summary FROM journal_entries
         WHERE summary IS NOT NULL AND summary != '' AND day >= ? ORDER BY day DESC LIMIT 1`
      )
      .get(cutoffDay) as { day: string; summary: string } | undefined
    return r ?? null
  })
}

export function fetchRecentJournalSummaries(
  count: number,
  excludingDay: string | null = null
): { day: string; summary: string }[] {
  return safe([], () => {
    if (excludingDay) {
      return getDb()
        .prepare(
          `SELECT day, summary FROM journal_entries
           WHERE summary IS NOT NULL AND summary != '' AND day != ? ORDER BY day DESC LIMIT ?`
        )
        .all(excludingDay, count) as { day: string; summary: string }[]
    }
    return getDb()
      .prepare(
        `SELECT day, summary FROM journal_entries
         WHERE summary IS NOT NULL AND summary != '' ORDER BY day DESC LIMIT ?`
      )
      .all(count) as { day: string; summary: string }[]
  })
}

export function hasIntentionsForDay(day: string): boolean {
  return safe(false, () => {
    const r = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM journal_entries WHERE day = ? AND status IN ('intentions_set','complete')`
      )
      .get(day) as { c: number }
    return r.c > 0
  })
}

export function fetchMostRecentGoals(): string | null {
  return safe(null, () => {
    const r = getDb()
      .prepare(
        `SELECT goals FROM journal_entries WHERE goals IS NOT NULL AND goals != '' ORDER BY day DESC LIMIT 1`
      )
      .get() as { goals: string } | undefined
    return r?.goals ?? null
  })
}

export function hasMinimumTimelineActivity(day: string, minimumMinutes = 60): boolean {
  return safe(false, () => {
    const { startTs, endTs } = dayWindow(day)
    const r = getDb()
      .prepare(
        `SELECT COALESCE(SUM(end_ts - start_ts), 0) / 60 AS mins FROM timeline_cards
         WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0`
      )
      .get(startTs, endTs) as { mins: number }
    return r.mins >= minimumMinutes
  })
}

export function fetchJournalDays(limit = 30): string[] {
  return safe([], () =>
    (
      getDb().prepare('SELECT day FROM journal_entries ORDER BY day DESC LIMIT ?').all(limit) as {
        day: string
      }[]
    ).map((r) => r.day)
  )
}

// ---------- Daily standup ----------

/** Plain calendar day (NOT 4 AM) — deliberate upstream behavior. */
export function dailyStandupDayKey(date = new Date()): string {
  return ymd(date)
}

export function fetchDailyStandup(standupDay: string): DailyStandupEntry | null {
  return safe(null, () => {
    const r = getDb()
      .prepare('SELECT * FROM daily_standup_entries WHERE standup_day = ?')
      .get(standupDay) as Record<string, unknown> | undefined
    if (!r) return null
    return {
      standupDay: r.standup_day as string,
      payloadJSON: r.payload_json as string,
      createdAt: (r.created_at as string) ?? null,
      updatedAt: (r.updated_at as string) ?? null
    }
  })
}

export function fetchLatestDailyStandupDay(): string | null {
  return safe(null, () => {
    const r = getDb()
      .prepare('SELECT standup_day FROM daily_standup_entries ORDER BY standup_day DESC LIMIT 1')
      .get() as { standup_day: string } | undefined
    return r?.standup_day ?? null
  })
}

export function fetchRecentDailyStandups(
  limit: number,
  excludingDay: string | null = null
): DailyStandupEntry[] {
  if (limit <= 0) return []
  return safe([], () => {
    const rows = excludingDay
      ? (getDb()
          .prepare(
            'SELECT * FROM daily_standup_entries WHERE standup_day != ? ORDER BY updated_at DESC LIMIT ?'
          )
          .all(excludingDay, limit) as Record<string, unknown>[])
      : (getDb()
          .prepare('SELECT * FROM daily_standup_entries ORDER BY updated_at DESC LIMIT ?')
          .all(limit) as Record<string, unknown>[])
    return rows.map((r) => ({
      standupDay: r.standup_day as string,
      payloadJSON: r.payload_json as string,
      createdAt: (r.created_at as string) ?? null,
      updatedAt: (r.updated_at as string) ?? null
    }))
  })
}

export function saveDailyStandup(standupDay: string, payloadJSON: string): void {
  safe(undefined, () => {
    getDb()
      .prepare(
        `INSERT INTO daily_standup_entries(standup_day, payload_json, updated_at)
         VALUES (?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(standup_day) DO UPDATE SET payload_json = excluded.payload_json,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(standupDay, payloadJSON)
  })
}

// ---------- Day goals ----------

export function fetchDayGoalPlan(day: string): DayGoalPlan | null {
  return safe(null, () => {
    const r = getDb().prepare('SELECT * FROM day_goals WHERE day = ?').get(day) as
      | Record<string, unknown>
      | undefined
    if (!r) return null
    return hydrateGoalPlan(r)
  })
}

export function fetchMostRecentDayGoalPlan(beforeOrOn: string): DayGoalPlan | null {
  return safe(null, () => {
    const r = getDb()
      .prepare('SELECT * FROM day_goals WHERE day <= ? ORDER BY day DESC LIMIT 1')
      .get(beforeOrOn) as Record<string, unknown> | undefined
    if (!r) return null
    return hydrateGoalPlan(r)
  })
}

function hydrateGoalPlan(r: Record<string, unknown>): DayGoalPlan {
  const day = r.day as string
  const cats = getDb()
    .prepare('SELECT * FROM day_goal_categories WHERE day = ? ORDER BY kind, sort_order')
    .all(day) as Record<string, unknown>[]
  const focus: DayGoalCategorySnapshot[] = []
  const distraction: DayGoalCategorySnapshot[] = []
  for (const c of cats) {
    const snap: DayGoalCategorySnapshot = {
      categoryID: c.category_id as string,
      name: c.category_name as string,
      colorHex: c.category_color_hex as string,
      sortOrder: c.sort_order as number
    }
    if (c.kind === 'focus') focus.push(snap)
    else if (c.kind === 'distraction') distraction.push(snap)
  }
  return {
    day,
    focusTargetMinutes: r.focus_target_minutes as number,
    distractionLimitMinutes: r.distraction_limit_minutes as number,
    focusCategories: focus,
    distractionCategories: distraction,
    isSkipped: (r.is_skipped as number) !== 0,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number
  }
}

export function saveDayGoalPlan(plan: DayGoalPlan): void {
  safe(undefined, () => {
    const db = getDb()
    const tx = db.transaction(() => {
      const createdAt = plan.createdAt > 0 ? plan.createdAt : now()
      db.prepare(
        `INSERT INTO day_goals(day, focus_target_minutes, distraction_limit_minutes, is_skipped, created_at, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(day) DO UPDATE SET
           focus_target_minutes = excluded.focus_target_minutes,
           distraction_limit_minutes = excluded.distraction_limit_minutes,
           is_skipped = excluded.is_skipped,
           updated_at = excluded.updated_at`
      ).run(
        plan.day,
        plan.focusTargetMinutes,
        plan.distractionLimitMinutes,
        plan.isSkipped ? 1 : 0,
        createdAt,
        now()
      )
      db.prepare('DELETE FROM day_goal_categories WHERE day = ?').run(plan.day)
      const ins = db.prepare(
        `INSERT INTO day_goal_categories(day, kind, category_id, category_name, category_color_hex, sort_order)
         VALUES (?,?,?,?,?,?)`
      )
      plan.focusCategories.forEach((c, i) =>
        ins.run(plan.day, 'focus', c.categoryID, c.name, c.colorHex, i)
      )
      plan.distractionCategories.forEach((c, i) =>
        ins.run(plan.day, 'distraction', c.categoryID, c.name, c.colorHex, i)
      )
    })
    tx()
  })
}

// ---------- LLM call debug readers ----------

export function fetchRecentLLMCallsForDebug(limit: number): Record<string, unknown>[] {
  if (limit <= 0) return []
  return safe([], () =>
    getDb()
      .prepare(
        `SELECT created_at, batch_id, call_group_id, attempt, provider, model, operation, status,
           latency_ms, http_status, request_method, request_url, request_body, response_body, error_message
         FROM llm_calls ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[]
  )
}
