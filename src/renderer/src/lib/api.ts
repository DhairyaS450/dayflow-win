// Typed wrapper over the preload IPC bridge.

import type {
  TimelineCard,
  TimelineCategory,
  DayGoalPlan,
  JournalEntry,
  DailyStandupEntry,
  Screenshot,
  TimelineReviewRatingSegment,
  Observation
} from '../../../shared/types'

declare global {
  interface Window {
    dayflow: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    }
  }
}

const inv = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  window.dayflow.invoke(channel, ...args) as Promise<T>

export const api = {
  timeline: {
    cardsForDay: (day: string) => inv<TimelineCard[]>('timeline:cardsForDay', day),
    cardsByRange: (fromTs: number, toTs: number) =>
      inv<TimelineCard[]>('timeline:cardsByRange', fromTs, toTs),
    updateCardCategory: (cardId: number, category: string) =>
      inv<void>('timeline:updateCardCategory', cardId, category),
    deleteCard: (cardId: number) => inv<string | null>('timeline:deleteCard', cardId),
    screenshotsInRange: (startTs: number, endTs: number) =>
      inv<Screenshot[]>('timeline:screenshotsInRange', startTs, endTs),
    reviewSegments: (startTs: number, endTs: number) =>
      inv<TimelineReviewRatingSegment[]>('timeline:reviewSegments', startTs, endTs),
    applyReviewRating: (startTs: number, endTs: number, rating: string) =>
      inv<void>('timeline:applyReviewRating', startTs, endTs, rating),
    unreviewedCount: (day: string) => inv<number>('timeline:unreviewedCount', day),
    minutesTracked: (fromTs: number, toTs: number) =>
      inv<number>('timeline:minutesTracked', fromTs, toTs),
    copyToClipboard: (text: string) => inv<void>('timeline:copyToClipboard', text)
  },
  batches: {
    forDay: (day: string) =>
      inv<{ id: number; startTs: number; endTs: number; status: string }[]>('batches:forDay', day),
    reprocessDay: (day: string) => inv<void>('batches:reprocessDay', day),
    reprocessBatch: (batchId: number) => inv<boolean>('batches:reprocessBatch', batchId),
    completedCount: () => inv<number>('batches:completedCount'),
    recentDebug: (limit: number) => inv<unknown[]>('batches:recentDebug', limit),
    llmCallsDebug: (limit: number) => inv<unknown[]>('batches:llmCallsDebug', limit)
  },
  recording: {
    status: () =>
      inv<{ mode: string; isRecording: boolean; countdown: string | null }>('recording:status'),
    start: () => inv<void>('recording:start'),
    stop: () => inv<void>('recording:stop'),
    pause: (duration: '15_mins' | '30_mins' | '1_hour' | 'indefinite') =>
      inv<void>('recording:pause', duration),
    resume: () => inv<void>('recording:resume')
  },
  categories: {
    load: () => inv<TimelineCategory[]>('categories:load'),
    save: (cats: TimelineCategory[]) => inv<void>('categories:save', cats)
  },
  settings: {
    get: <T>(key: string, fallback: T) => inv<T>('settings:get', key, fallback),
    set: (key: string, value: unknown) => inv<void>('settings:set', key, value),
    all: () => inv<Record<string, unknown>>('settings:all')
  },
  secrets: {
    store: (provider: string, value: string) => inv<boolean>('secrets:store', provider, value),
    exists: (provider: string) => inv<boolean>('secrets:exists', provider),
    delete: (provider: string) => inv<void>('secrets:delete', provider)
  },
  providers: {
    current: () => inv<string>('providers:current'),
    testGemini: (apiKey: string) =>
      inv<{ ok: boolean; message: string }>('providers:testGemini', apiKey),
    testLocal: () => inv<{ ok: boolean; message: string }>('providers:testLocal'),
    testClaudeCli: () => inv<{ ok: boolean; message: string }>('providers:testClaudeCli'),
    claudeCliInstalled: () => inv<boolean>('providers:claudeCliInstalled'),
    generateText: (prompt: string, maxTokens?: number) =>
      inv<string>('providers:generateText', prompt, maxTokens)
  },
  journal: {
    entry: (day: string) => inv<JournalEntry | null>('journal:entry', day),
    saveIntentions: (
      day: string,
      intentions: string | null,
      notes: string | null,
      goals: string | null
    ) => inv<void>('journal:saveIntentions', day, intentions, notes, goals),
    saveReflections: (day: string, reflections: string | null) =>
      inv<void>('journal:saveReflections', day, reflections),
    saveSummary: (day: string, summary: string) => inv<void>('journal:saveSummary', day, summary),
    recentSummary: (withinDays: number) =>
      inv<{ day: string; summary: string } | null>('journal:recentSummary', withinDays),
    recentSummaries: (count: number, excludingDay: string | null) =>
      inv<{ day: string; summary: string }[]>('journal:recentSummaries', count, excludingDay),
    mostRecentGoals: () => inv<string | null>('journal:mostRecentGoals'),
    hasMinimumActivity: (day: string, minMinutes?: number) =>
      inv<boolean>('journal:hasMinimumActivity', day, minMinutes),
    days: (limit?: number) => inv<string[]>('journal:days', limit)
  },
  standup: {
    fetch: (day: string) => inv<DailyStandupEntry | null>('standup:fetch', day),
    save: (day: string, payloadJSON: string) => inv<void>('standup:save', day, payloadJSON),
    recent: (limit: number, excludingDay: string | null) =>
      inv<DailyStandupEntry[]>('standup:recent', limit, excludingDay)
  },
  goals: {
    fetch: (day: string) => inv<DayGoalPlan | null>('goals:fetch', day),
    fetchMostRecent: (beforeOrOn: string) =>
      inv<DayGoalPlan | null>('goals:fetchMostRecent', beforeOrOn),
    save: (plan: DayGoalPlan) => inv<void>('goals:save', plan)
  },
  observations: {
    byRange: (fromTs: number, toTs: number) =>
      inv<Observation[]>('observations:byRange', fromTs, toTs)
  },
  storage: {
    usage: () => inv<{ recordingsBytes: number; timelapsesBytes: number }>('storage:usage'),
    purgeNow: () => inv<void>('storage:purgeNow')
  },
  app: {
    version: () => inv<string>('app:version'),
    openExternal: (url: string) => inv<void>('app:openExternal', url),
    openDataFolder: () => inv<void>('app:openDataFolder'),
    setLaunchAtLogin: (enabled: boolean) => inv<void>('app:setLaunchAtLogin', enabled),
    getLaunchAtLogin: () => inv<boolean>('app:getLaunchAtLogin')
  },
  onboarding: {
    createCard: (categoryName: string, summary: string) =>
      inv<void>('onboarding:createCard', categoryName, summary)
  },
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) =>
    window.dayflow.on(channel, listener)
}

/** Convert a native file path to the dayflow-media:// URL the renderer can load. */
export function mediaURL(filePath: string): string {
  return `dayflow-media://${encodeURIComponent(filePath).replace(/%3A/gi, ':').replace(/%5C/gi, '/').replace(/%2F/gi, '/')}`
}
