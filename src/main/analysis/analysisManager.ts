import { rmSync } from 'fs'
import { checkpointPassive } from '../db/index'
import * as storage from '../db/storage'
import { assessIdleBatch, buildIdleMetadata, IDLE_RULES } from './idleRules'
import { dayInfoFor, formatHMMA } from '../lib/time'
import type { Screenshot, TimelineCardShell } from '../../shared/types'

// AnalysisManager port: 60 s scheduler, 15-min batch formation, idle shortcut,
// LLM dispatch, reprocessing APIs.

const CHECK_INTERVAL_MS = 60_000
const LOOKBACK_SECONDS = 24 * 3600
const TARGET_DURATION = 900
const MAX_GAP = 120
const MIN_BATCH_SECONDS = 300
const REPROCESS_POLL_MS = 2000

export type ProcessBatchFn = (
  batchId: number,
  onStep?: (step: string) => void
) => Promise<{ ok: boolean; error?: string }>

class AnalysisManager {
  private timer: NodeJS.Timeout | null = null
  private isProcessing = false
  private processBatch: ProcessBatchFn | null = null

  /** LLMService registers its batch processor here. */
  setProcessor(fn: ProcessBatchFn): void {
    this.processBatch = fn
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async triggerAnalysisNow(): Promise<void> {
    await this.tick()
  }

  private async tick(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true
    try {
      const newBatchIds = this.formBatches()
      for (const batchId of newBatchIds) {
        await this.queueLLMRequest(batchId)
      }
    } catch (err) {
      console.error('[analysis] tick failed', err)
    } finally {
      this.isProcessing = false
    }
  }

  /** Batch formation — returns newly persisted batch ids. */
  private formBatches(): number[] {
    const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS
    const shots = storage.fetchUnprocessedScreenshots(since)
    if (shots.length === 0) return []

    const buckets: Screenshot[][] = []
    let bucket: Screenshot[] = []
    for (const shot of shots) {
      if (bucket.length === 0) {
        bucket = [shot]
        continue
      }
      const gap = shot.capturedAt - bucket[bucket.length - 1].capturedAt
      const currentDuration = shot.capturedAt - bucket[0].capturedAt
      if (gap > MAX_GAP || currentDuration > TARGET_DURATION) {
        buckets.push(bucket)
        bucket = [shot]
      } else {
        bucket.push(shot)
      }
    }
    if (bucket.length > 0) buckets.push(bucket)

    // Hold back the newest bucket while it is still accumulating (< 15 min span).
    const last = buckets[buckets.length - 1]
    if (last) {
      const span = last[last.length - 1].capturedAt - last[0].capturedAt
      if (span < TARGET_DURATION) buckets.pop()
    }

    const ids: number[] = []
    for (const b of buckets) {
      const startTs = b[0].capturedAt
      const endTs = b[b.length - 1].capturedAt
      const id = storage.saveBatchWithScreenshots(
        startTs,
        endTs,
        b.map((s) => s.id)
      )
      if (id !== null) ids.push(id)
    }
    return ids
  }

  private async queueLLMRequest(batchId: number): Promise<void> {
    const shots = storage.screenshotsForBatch(batchId)
    if (shots.length === 0) {
      storage.updateBatchStatus(batchId, 'failed_empty')
      return
    }
    const span = shots[shots.length - 1].capturedAt - shots[0].capturedAt
    if (span < MIN_BATCH_SECONDS) {
      storage.updateBatchStatus(batchId, 'skipped_short')
      return
    }

    // Idle shortcut: skip the LLM when the whole batch was idle.
    const assessment = assessIdleBatch(shots)
    if (assessment) {
      const applied = this.handleIdleBatch(batchId, shots, assessment)
      if (applied) {
        storage.updateBatchStatus(batchId, 'analyzed', 'idle_shortcut_applied')
        checkpointPassive()
        return
      }
    }

    if (!this.processBatch) {
      console.warn('[analysis] no LLM processor registered; leaving batch pending')
      return
    }
    storage.updateBatchStatus(batchId, 'processing')
    const result = await this.processBatch(batchId)
    if (result.ok) {
      storage.updateBatchStatus(batchId, 'completed')
    } else {
      storage.markBatchFailed(batchId, result.error ?? 'Unknown error')
    }
    checkpointPassive()
  }

  private handleIdleBatch(
    batchId: number,
    shots: Screenshot[],
    assessment: NonNullable<ReturnType<typeof assessIdleBatch>>
  ): boolean {
    const batchStart = shots[0].capturedAt
    const batchEnd = shots[shots.length - 1].capturedAt

    // Merge candidate: previous card ends < 5 min before batch start, same logical
    // day, category+title both normalize to "idle".
    let replacementStart = batchStart
    let merged = false
    let mergeGap: number | null = null
    const prev = storage.fetchLastTimelineCard(batchStart)
    if (prev) {
      const gap = batchStart - prev.endTs
      const sameDay =
        dayInfoFor(new Date(prev.startTs * 1000)).dayString ===
        dayInfoFor(new Date(batchStart * 1000)).dayString
      const isIdleCard =
        prev.category.trim().toLowerCase() === 'idle' && prev.title.trim().toLowerCase() === 'idle'
      if (gap >= 0 && gap < IDLE_RULES.mergeGapSeconds && sameDay && isIdleCard) {
        replacementStart = prev.startTs
        merged = true
        mergeGap = gap
      }
    }

    const card: TimelineCardShell = {
      startTimestamp: formatHMMA(replacementStart),
      endTimestamp: formatHMMA(batchEnd),
      category: 'Idle',
      subcategory: '',
      title: 'Idle',
      summary: 'You were idle during this period.',
      detailedSummary: 'Idle period. Dayflow skipped activity summarization for this block.',
      distractions: null,
      appSites: null,
      idleMetadata: buildIdleMetadata(assessment, merged, mergeGap)
    }
    const { insertedIds, deletedVideoPaths } = storage.replaceTimelineCardsInRange(
      replacementStart,
      batchEnd,
      [card],
      batchId
    )
    for (const p of deletedVideoPaths) {
      try {
        rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    }
    return insertedIds.length > 0
  }

  /** Build + persist the error card for a failed batch. */
  writeErrorCard(batchId: number, errorText: string): void {
    const batch = storage.getBatch(batchId)
    if (!batch) return
    const minutes = Math.round((batch.endTs - batch.startTs) / 60)
    const startStr = formatHMMA(batch.startTs)
    const endStr = formatHMMA(batch.endTs)
    const card: TimelineCardShell = {
      startTimestamp: startStr,
      endTimestamp: endStr,
      category: 'System',
      subcategory: 'Error',
      title: 'Processing failed',
      summary: `Failed to process ${minutes} minutes of recording from ${startStr} to ${endStr}. ${errorText} Your recording is safe and can be reprocessed.`,
      detailedSummary: `Error: ${errorText}\n\nThis batch can be reprocessed from Settings.`,
      distractions: null,
      appSites: null
    }
    const { deletedVideoPaths } = storage.replaceTimelineCardsInRange(
      batch.startTs,
      batch.endTs,
      [card],
      batchId
    )
    for (const p of deletedVideoPaths) {
      try {
        rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- Reprocessing ----------

  private async waitForTerminal(batchId: number): Promise<void> {
    const terminal = new Set(['completed', 'analyzed', 'failed', 'failed_empty', 'skipped_short'])
    for (;;) {
      const batch = storage.getBatch(batchId)
      if (!batch || terminal.has(batch.status)) return
      await new Promise((r) => setTimeout(r, REPROCESS_POLL_MS))
    }
  }

  async reprocessDay(day: string, onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Deleting timeline cards…')
    const videoPaths = storage.deleteTimelineCardsForDay(day)
    for (const p of videoPaths) {
      try {
        rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    }
    const batches = storage.fetchBatchesForDay(day)
    if (batches.length === 0) return
    storage.deleteObservations(batches.map((b) => b.id))
    const resetIds = storage.resetBatchStatusesForDay(day)
    for (const [i, batchId] of resetIds.entries()) {
      onProgress?.(`Processing batch ${i + 1}/${resetIds.length}…`)
      await this.queueLLMRequest(batchId)
      await this.waitForTerminal(batchId)
    }
  }

  async reprocessSpecificBatches(
    batchIds: number[],
    onProgress?: (msg: string) => void
  ): Promise<void> {
    storage.deleteObservations(batchIds)
    const resetIds = storage.resetBatchStatusesForIds(batchIds)
    for (const [i, batchId] of resetIds.entries()) {
      onProgress?.(`Processing batch ${i + 1}/${resetIds.length}…`)
      await this.queueLLMRequest(batchId)
      await this.waitForTerminal(batchId)
    }
  }

  async reprocessBatch(batchId: number, onStep?: (step: string) => void): Promise<boolean> {
    storage.deleteObservations([batchId])
    const resetIds = storage.resetBatchStatusesForIds([batchId])
    if (resetIds.length === 0) return false
    if (!this.processBatch) return false
    storage.updateBatchStatus(batchId, 'processing')
    const result = await this.processBatch(batchId, onStep)
    if (result.ok) {
      storage.updateBatchStatus(batchId, 'completed')
    } else {
      storage.markBatchFailed(batchId, result.error ?? 'Unknown error')
    }
    return result.ok
  }
}

export const analysisManager = new AnalysisManager()
