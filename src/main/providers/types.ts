import type { Observation, TimelineCategory } from '../../shared/types'

export interface ActivityCardData {
  startTime: string // "h:mm a"
  endTime: string
  category: string
  subcategory: string
  title: string
  summary: string
  detailedSummary: string
  distractions?: CardDistraction[] | null
  appSites?: { primary?: string | null; secondary?: string | null } | null
}

export interface CardDistraction {
  startTime: string
  endTime: string
  title: string
  summary: string
}

export interface ActivityGenerationContext {
  batchObservations: Observation[]
  existingCards: ActivityCardData[]
  currentTime: Date // batch end time
  categories: TimelineCategory[]
}

export interface ObservationInput {
  startTs: number
  endTs: number
  observation: string
  metadata: string | null
  llmModel: string | null
}

export interface BatchProvider {
  /** Phase 1: screenshots → observations. */
  transcribeScreenshots(
    screenshotPaths: { filePath: string; capturedAt: number }[],
    batchStartTs: number,
    batchId: number
  ): Promise<ObservationInput[]>
  /** Phase 2: observations (45-min window) + context → fresh card set for the window. */
  generateActivityCards(
    windowObservations: Observation[],
    context: ActivityGenerationContext,
    batchId: number
  ): Promise<ActivityCardData[]>
  generateText(prompt: string, maxTokens?: number): Promise<string>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly domain: string,
    public readonly code: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function normalizeCategory(raw: string, categories: TimelineCategory[]): string {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  const match = categories.find((c) => c.name.trim().toLowerCase() === lower)
  if (match) return match.name
  if (lower === 'idle' || lower === 'idle time') {
    const idle = categories.find((c) => c.isIdle)
    if (idle) return idle.name
  }
  return categories[0]?.name ?? trimmed
}

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof ProviderError) {
    if ((err.domain === 'GeminiError' || err.domain === 'GeminiProvider') && (err.code === 429 || err.code === 403))
      return true
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded') ||
    msg.includes('quota') ||
    msg.includes("you've hit your limit")
  )
}
