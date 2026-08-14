// LLMService port: two-phase batch processing (transcribe → generate cards)
// with the sliding 45-min window, provider selection, and failure handling.

import { rmSync } from 'fs'
import { checkpointPassive } from '../db/index'
import * as storage from '../db/storage'
import { settings } from '../lib/settings'
import { secrets } from '../lib/secrets'
import { loadCategories } from '../db/categories'
import { formatHMMA } from '../lib/time'
import { GeminiDirectProvider } from './gemini'
import { OllamaProvider } from './ollama'
import { analysisManager } from '../analysis/analysisManager'
import {
  isRateLimitError,
  type BatchProvider,
  type ActivityCardData
} from './types'
import type { Observation, TimelineCardShell } from '../../shared/types'

const CARD_LOOKBACK_SECONDS = 45 * 60

export type ProviderId = 'gemini' | 'ollama' | 'dayflow' | 'chatgpt_claude'

export function currentProviderId(): ProviderId {
  return settings.get<ProviderId>('selectedLLMProvider', 'gemini')
}

function makeProvider(id: ProviderId): BatchProvider {
  switch (id) {
    case 'gemini': {
      const key = secrets.retrieve('gemini')
      if (!key) {
        throw new Error('No LLM provider configured. Please configure in settings.')
      }
      return new GeminiDirectProvider(key)
    }
    case 'ollama':
      return new OllamaProvider()
    default:
      throw new Error('No LLM provider configured. Please configure in settings.')
  }
}

function backupProviderId(): ProviderId | null {
  const id = settings.get<string>('llmBackupProviderId', '')
  if (!id || id === currentProviderId()) return null
  return id as ProviderId
}

export interface ProcessResult {
  ok: boolean
  error?: string
  cards?: ActivityCardData[]
}

type StepHandler = (step: string) => void

async function processBatch(batchId: number, onStep?: StepHandler): Promise<ProcessResult> {
  const batch = storage.getBatch(batchId)
  if (!batch) return { ok: false, error: 'Batch not found' }

  let provider: BatchProvider
  try {
    provider = makeProvider(currentProviderId())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    writeFailure(batchId, msg)
    return { ok: false, error: msg }
  }
  let backup: BatchProvider | null = null
  try {
    const backupId = backupProviderId()
    if (backupId) backup = makeProvider(backupId)
  } catch {
    backup = null
  }

  let usedBackup = false
  const withBackup = async <T>(work: (p: BatchProvider) => Promise<T>): Promise<T> => {
    const active = usedBackup && backup ? backup : provider
    try {
      return await work(active)
    } catch (err) {
      if (usedBackup || !backup) throw err
      usedBackup = true
      return await work(backup)
    }
  }

  try {
    const shots = storage.screenshotsForBatch(batchId)
    if (shots.length === 0) return { ok: false, error: 'No screenshots in batch' }

    // Phase 1: transcribe
    onStep?.('transcribing')
    const observations = await withBackup((p) =>
      p.transcribeScreenshots(
        shots.map((s) => ({ filePath: s.filePath, capturedAt: s.capturedAt })),
        batch.startTs,
        batchId
      )
    )
    storage.saveObservations(batchId, observations)
    if (observations.length === 0) {
      storage.updateBatchStatus(batchId, 'analyzed')
      return { ok: true, cards: [] }
    }

    // Phase 2: cards with 45-min sliding window
    onStep?.('generatingCards')
    const currentTime = batch.endTs
    const windowStart = currentTime - CARD_LOOKBACK_SECONDS
    const windowObservations = storage.fetchObservationsByTimeRange(windowStart, currentTime)
    const existingCards = storage
      .fetchTimelineCardsByTimeRange(windowStart, currentTime)
      .map(cardToActivityData)

    const batchObservations: Observation[] = storage.fetchObservationsForBatch(batchId)
    const cards = await withBackup((p) =>
      p.generateActivityCards(
        windowObservations,
        {
          batchObservations,
          existingCards,
          currentTime: new Date(currentTime * 1000),
          categories: loadCategories()
        },
        batchId
      )
    )

    const shells: TimelineCardShell[] = cards.map((c) => ({
      startTimestamp: c.startTime,
      endTimestamp: c.endTime,
      category: c.category,
      subcategory: c.subcategory,
      title: c.title,
      summary: c.summary,
      detailedSummary: c.detailedSummary,
      distractions:
        c.distractions?.map((d) => ({
          id: cryptoRandomUUID(),
          startTime: d.startTime,
          endTime: d.endTime,
          title: d.title,
          summary: d.summary
        })) ?? null,
      appSites: c.appSites ?? null,
      isBackupGenerated: usedBackup ? true : null
    }))

    const { deletedVideoPaths } = storage.replaceTimelineCardsInRange(
      windowStart,
      currentTime,
      shells,
      batchId
    )
    for (const p of deletedVideoPaths) {
      try {
        rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    }
    storage.updateBatchStatus(batchId, 'analyzed')
    checkpointPassive()
    return { ok: true, cards }
  } catch (err) {
    const msg = humanReadableError(err)
    writeFailure(batchId, msg)
    return { ok: false, error: msg }
  }
}

function cryptoRandomUUID(): string {
  return require('crypto').randomUUID().toUpperCase()
}

function cardToActivityData(card: {
  startTimestamp: string
  endTimestamp: string
  category: string
  subcategory: string
  title: string
  summary: string
  detailedSummary: string
  distractions: { startTime: string; endTime: string; title: string; summary: string }[] | null
  appSites: { primary?: string | null; secondary?: string | null } | null
}): ActivityCardData {
  return {
    startTime: card.startTimestamp,
    endTime: card.endTimestamp,
    category: card.category,
    subcategory: card.subcategory,
    title: card.title,
    summary: card.summary,
    detailedSummary: card.detailedSummary,
    distractions: card.distractions,
    appSites: card.appSites
  }
}

function writeFailure(batchId: number, errorText: string): void {
  storage.markBatchFailed(batchId, errorText)
  analysisManager.writeErrorCard(batchId, errorText)
}

function humanReadableError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (isRateLimitError(err)) return 'Rate limited. Too many requests. Please wait a few minutes.'
  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401'))
    return 'Invalid API key. Please check your API key in Settings.'
  if (lower.includes('network') || lower.includes('connection') || lower.includes('fetch failed'))
    return 'Network error connecting to the AI provider.'
  if (lower.includes('timeout')) return 'The AI provider took too long to respond.'
  if (lower.includes('no llm provider') || lower.includes('not configured'))
    return 'No AI provider is configured. Please set one up in Settings.'
  if (lower.includes('failed to upload')) return 'Failed to upload the video to the AI provider.'
  return msg
}

// Text generation for journal summaries, recaps, chat fallback
export async function generateText(prompt: string, maxTokens = 8192): Promise<string> {
  const provider = makeProvider(currentProviderId())
  return provider.generateText(prompt, maxTokens)
}

export function registerLLMService(): void {
  analysisManager.setProcessor(async (batchId, onStep) => {
    const result = await processBatch(batchId, onStep)
    return { ok: result.ok, error: result.error }
  })
}

export { processBatch }

/** Timelapse generation after successful batch (if enabled). */
export async function maybeGenerateTimelapses(cardIds: number[]): Promise<void> {
  if (!settings.get<boolean>('saveAllTimelapsesToDisk', false)) return
  const { generateVideoFromScreenshots } = await import('../analysis/videoProcessing')
  const { timelapsesDir } = await import('../lib/paths')
  const { join } = await import('path')
  for (const cardId of cardIds) {
    const card = storage.fetchTimelineCardById(cardId)
    if (!card || card.endTs <= card.startTs) continue
    const shots = storage.fetchScreenshotsInTimeRange(card.startTs, card.endTs)
    if (shots.length === 0) continue
    try {
      const outPath = join(timelapsesDir(card.day), `${cardId}_timelapse.mp4`)
      await generateVideoFromScreenshots(shots, outPath, { fps: 2 })
      storage.updateTimelineCardVideoURL(cardId, outPath)
    } catch (err) {
      console.error('[timelapse] generation failed', err)
    }
  }
}

export { formatHMMA }
