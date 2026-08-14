// Shared data models — parity with upstream Swift models.

export interface Screenshot {
  id: number
  capturedAt: number // epoch seconds
  filePath: string
  fileSize: number | null
  idleSecondsAtCapture: number | null
  isDeleted: boolean
}

export interface Observation {
  id: number | null
  batchId: number
  startTs: number
  endTs: number
  observation: string
  metadata: string | null
  llmModel: string | null
  createdAt: string | null // UTC datetime string
}

export interface Distraction {
  id: string // UUID
  startTime: string // "h:mm a"
  endTime: string
  title: string
  summary: string
  videoSummaryURL?: string | null
}

export interface AppSites {
  primary?: string | null
  secondary?: string | null
}

export interface IdleCardMetadata {
  classifierVersion: string
  inputCoverageRatio: number
  coveredSeconds: number
  batchDurationSeconds: number
  largestUncoveredGapSeconds: number
  screenshotCount: number
  sampledIdleScreenshotCount: number
  averageIdleSecondsAtCapture: number
  maxIdleSecondsAtCapture: number
  mergedWithPreviousIdle: boolean
  mergeGapSeconds: number | null
  skippedLLM: boolean
}

export interface TimelineMetadata {
  distractions?: Distraction[]
  appSites?: AppSites
  isBackupGenerated?: boolean
  idle?: IdleCardMetadata
}

export interface TimelineCard {
  id: string // client-side UUID, not persisted
  recordId: number | null
  batchId: number | null
  startTimestamp: string // "h:mm a"
  endTimestamp: string
  category: string
  subcategory: string
  title: string
  summary: string
  detailedSummary: string
  day: string // yyyy-MM-dd
  startTs: number | null
  endTs: number | null
  distractions: Distraction[] | null
  videoSummaryURL: string | null
  otherVideoSummaryURLs: string[] | null
  appSites: AppSites | null
  isBackupGenerated: boolean | null
}

export interface TimelineCardShell {
  startTimestamp: string
  endTimestamp: string
  category: string
  subcategory: string
  title: string
  summary: string
  detailedSummary: string
  distractions: Distraction[] | null
  appSites: AppSites | null
  isBackupGenerated?: boolean | null
  idleMetadata?: IdleCardMetadata | null
}

export interface TimelineCardWithTimestamps {
  id: number
  startTimestamp: string
  endTimestamp: string
  startTs: number
  endTs: number
  category: string
  subcategory: string
  title: string
  summary: string
  detailedSummary: string
  day: string
  distractions: Distraction[] | null
  videoSummaryURL: string | null
}

export interface LLMCall {
  timestamp: string | null // ISO-8601
  latency: number | null // seconds
  input: string | null
  output: string | null
}

export interface LLMCallDBRecord {
  batchId?: number | null
  callGroupId?: string | null
  attempt: number
  provider: string
  model?: string | null
  operation: string
  status: 'success' | 'failure'
  latencyMs?: number | null
  httpStatus?: number | null
  requestMethod?: string | null
  requestURL?: string | null
  requestHeadersJSON?: string | null
  requestBody?: string | null
  responseHeadersJSON?: string | null
  responseBody?: string | null
  errorDomain?: string | null
  errorCode?: number | null
  errorMessage?: string | null
}

export interface JournalEntry {
  id: number | null
  day: string
  intentions: string | null
  notes: string | null
  goals: string | null
  reflections: string | null
  summary: string | null
  status: 'draft' | 'intentions_set' | 'complete'
  createdAt: string | null
  updatedAt: string | null
}

export interface DailyStandupEntry {
  standupDay: string
  payloadJSON: string
  createdAt: string | null
  updatedAt: string | null
}

export type DayGoalCategoryKind = 'focus' | 'distraction'

export interface DayGoalCategorySnapshot {
  categoryID: string
  name: string
  colorHex: string
  sortOrder: number
}

export interface DayGoalPlan {
  day: string
  focusTargetMinutes: number
  distractionLimitMinutes: number
  focusCategories: DayGoalCategorySnapshot[]
  distractionCategories: DayGoalCategorySnapshot[]
  isSkipped: boolean
  createdAt: number
  updatedAt: number
}

export interface TimelineReviewRatingSegment {
  id: number
  startTs: number
  endTs: number
  rating: string
}

export interface TimelineCategory {
  id: string // UUID
  name: string
  colorHex: string
  details: string
  order: number
  isSystem: boolean
  isIdle: boolean
  isNew: boolean
  createdAt: string // ISO-8601
  updatedAt: string
}

export interface AnalysisBatchDebugEntry {
  id: number
  status: string
  startTs: number
  endTs: number
  createdAt: string | null
  reason: string | null
}

export type BatchStatus =
  | 'pending'
  | 'processing'
  | 'analyzed'
  | 'completed'
  | 'failed'
  | 'failed_empty'
  | 'skipped_short'
