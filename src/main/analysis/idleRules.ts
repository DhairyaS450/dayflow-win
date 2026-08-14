import type { Screenshot, IdleCardMetadata } from '../../shared/types'

// Idle-batch classifier (idle_v1) — decides whether a batch was pure idle time
// so the LLM call can be skipped.

export const IDLE_RULES = {
  classifierVersion: 'idle_v1',
  minBatchSpanSeconds: 720,
  minCoverageRatio: 0.95,
  minQualifiedIdleRatio: 0.9,
  minSampleAvailabilityRatio: 0.9,
  qualifyingIdleSeconds: 60,
  maxUncoveredGapSeconds: 30,
  mergeGapSeconds: 300
} as const

export interface IdleAssessment {
  coverageRatio: number
  coveredSeconds: number
  batchDurationSeconds: number
  largestUncoveredGapSeconds: number
  screenshotCount: number
  sampledIdleScreenshotCount: number
  averageIdleSecondsAtCapture: number
  maxIdleSecondsAtCapture: number
}

export function assessIdleBatch(screenshots: Screenshot[]): IdleAssessment | null {
  if (screenshots.length === 0) return null
  const sorted = screenshots.slice().sort((a, b) => a.capturedAt - b.capturedAt)
  const batchStart = sorted[0].capturedAt
  const batchEnd = sorted[sorted.length - 1].capturedAt
  const span = batchEnd - batchStart
  if (span < IDLE_RULES.minBatchSpanSeconds) return null

  const idleSamples = sorted.filter(
    (s) => s.idleSecondsAtCapture !== null && s.idleSecondsAtCapture > 0
  )
  if (idleSamples.length === 0) return null

  // Coverage segments: [capturedAt - idleSeconds, capturedAt] clipped to batch.
  const segments = idleSamples
    .map((s) => ({
      start: Math.max(batchStart, s.capturedAt - (s.idleSecondsAtCapture as number)),
      end: Math.min(batchEnd, s.capturedAt)
    }))
    .filter((seg) => seg.end > seg.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const merged: { start: number; end: number }[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end) last.end = Math.max(last.end, seg.end)
    else merged.push({ ...seg })
  }

  const coveredSeconds = merged.reduce((sum, s) => sum + (s.end - s.start), 0)
  const coverageRatio = span > 0 ? coveredSeconds / span : 0

  let largestGap = 0
  let cursor = batchStart
  for (const seg of merged) {
    if (seg.start > cursor) largestGap = Math.max(largestGap, seg.start - cursor)
    cursor = Math.max(cursor, seg.end)
  }
  if (batchEnd > cursor) largestGap = Math.max(largestGap, batchEnd - cursor)

  const qualified = sorted.filter(
    (s) => (s.idleSecondsAtCapture ?? 0) >= IDLE_RULES.qualifyingIdleSeconds
  ).length
  const qualifiedRatio = qualified / sorted.length
  const availabilityRatio = idleSamples.length / sorted.length

  if (
    coverageRatio < IDLE_RULES.minCoverageRatio ||
    qualifiedRatio < IDLE_RULES.minQualifiedIdleRatio ||
    availabilityRatio < IDLE_RULES.minSampleAvailabilityRatio ||
    largestGap > IDLE_RULES.maxUncoveredGapSeconds
  ) {
    return null
  }

  const idleValues = idleSamples.map((s) => s.idleSecondsAtCapture as number)
  return {
    coverageRatio,
    coveredSeconds,
    batchDurationSeconds: span,
    largestUncoveredGapSeconds: largestGap,
    screenshotCount: sorted.length,
    sampledIdleScreenshotCount: idleSamples.length,
    averageIdleSecondsAtCapture: idleValues.reduce((a, b) => a + b, 0) / idleValues.length,
    maxIdleSecondsAtCapture: Math.max(...idleValues)
  }
}

export function buildIdleMetadata(
  assessment: IdleAssessment,
  merged: boolean,
  mergeGapSeconds: number | null
): IdleCardMetadata {
  return {
    classifierVersion: IDLE_RULES.classifierVersion,
    inputCoverageRatio: assessment.coverageRatio,
    coveredSeconds: assessment.coveredSeconds,
    batchDurationSeconds: assessment.batchDurationSeconds,
    largestUncoveredGapSeconds: assessment.largestUncoveredGapSeconds,
    screenshotCount: assessment.screenshotCount,
    sampledIdleScreenshotCount: assessment.sampledIdleScreenshotCount,
    averageIdleSecondsAtCapture: assessment.averageIdleSecondsAtCapture,
    maxIdleSecondsAtCapture: assessment.maxIdleSecondsAtCapture,
    mergedWithPreviousIdle: merged,
    mergeGapSeconds,
    skippedLLM: true
  }
}
