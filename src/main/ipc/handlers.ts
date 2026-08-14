import { ipcMain, shell, app, clipboard } from 'electron'
import { registerChatHandler } from './chatHandler'
import * as storage from '../db/storage'
import { loadCategories, saveCategories } from '../db/categories'
import { settings } from '../lib/settings'
import { secrets } from '../lib/secrets'
import { analysisManager } from '../analysis/analysisManager'
import { appState } from '../app/appState'
import { pauseManager, type PauseDuration } from '../recording/pauseManager'
import { testGeminiConnection } from '../providers/gemini'
import { testLocalConnection } from '../providers/ollama'
import { testClaudeCli, resolveClaudeCli } from '../providers/claudeCli'
import { currentUsage, purgeRecordingsIfNeeded, purgeTimelapsesIfNeeded } from '../db/maintenance'
import { generateText, currentProviderId } from '../providers/llmService'
import type { TimelineCategory, DayGoalPlan, TimelineCardShell } from '../../shared/types'

// One flat invoke-based API. Renderer calls window.dayflow.invoke(channel, ...).

export function registerIpcHandlers(broadcast: (channel: string, payload?: unknown) => void): void {
  registerChatHandler(broadcast)
  // ----- Timeline -----
  ipcMain.handle('timeline:cardsForDay', (_e, day: string) => storage.fetchTimelineCardsForDay(day))
  ipcMain.handle('timeline:cardsByRange', (_e, fromTs: number, toTs: number) =>
    storage.fetchTimelineCardsByTimeRange(fromTs, toTs)
  )
  ipcMain.handle('timeline:updateCardCategory', (_e, cardId: number, category: string) => {
    storage.updateTimelineCardCategory(cardId, category)
    broadcast('timeline:changed')
  })
  ipcMain.handle('timeline:deleteCard', (_e, cardId: number) => {
    const videoPath = storage.deleteTimelineCard(cardId)
    if (videoPath) {
      try {
        require('fs').rmSync(videoPath, { force: true })
      } catch {
        /* ignore */
      }
    }
    broadcast('timeline:changed')
    return videoPath
  })
  ipcMain.handle('timeline:screenshotsInRange', (_e, startTs: number, endTs: number) =>
    storage.fetchScreenshotsInTimeRange(startTs, endTs)
  )
  ipcMain.handle('timeline:reviewSegments', (_e, startTs: number, endTs: number) =>
    storage.fetchReviewRatingSegments(startTs, endTs)
  )
  ipcMain.handle('timeline:applyReviewRating', (_e, startTs: number, endTs: number, rating: string) => {
    storage.applyReviewRating(startTs, endTs, rating)
    broadcast('timeline:changed')
  })
  ipcMain.handle('timeline:unreviewedCount', (_e, day: string) =>
    storage.fetchUnreviewedTimelineCardCount(day)
  )
  ipcMain.handle('timeline:minutesTracked', (_e, fromTs: number, toTs: number) =>
    storage.fetchTotalMinutesTracked(fromTs, toTs)
  )
  ipcMain.handle('timeline:copyToClipboard', (_e, text: string) => clipboard.writeText(text))

  // ----- Batches / reprocessing -----
  ipcMain.handle('batches:forDay', (_e, day: string) => storage.fetchBatchesForDay(day))
  ipcMain.handle('batches:recentDebug', (_e, limit: number) =>
    storage.fetchRecentAnalysisBatchesForDebug(limit)
  )
  ipcMain.handle('batches:llmCallsDebug', (_e, limit: number) =>
    storage.fetchRecentLLMCallsForDebug(limit)
  )
  ipcMain.handle('batches:reprocessDay', async (_e, day: string) => {
    await analysisManager.reprocessDay(day, (msg) => broadcast('reprocess:progress', msg))
    broadcast('timeline:changed')
  })
  ipcMain.handle('batches:reprocessBatch', async (_e, batchId: number) => {
    const ok = await analysisManager.reprocessBatch(batchId, (step) =>
      broadcast('reprocess:progress', step)
    )
    broadcast('timeline:changed')
    return ok
  })
  ipcMain.handle('batches:completedCount', () => storage.countCompletedAnalysisBatches())

  // ----- Recording control -----
  ipcMain.handle('recording:status', () => ({
    mode: pauseManager.mode(),
    isRecording: appState.isRecording,
    countdown: pauseManager.countdownText()
  }))
  ipcMain.handle('recording:start', () => {
    pauseManager.clearPauseState()
    appState.setRecording(true, { analyticsReason: 'main_app' })
    broadcast('recording:changed')
  })
  ipcMain.handle('recording:stop', () => {
    pauseManager.clearPauseState()
    appState.setRecording(false, { analyticsReason: 'main_app' })
    broadcast('recording:changed')
  })
  ipcMain.handle('recording:pause', (_e, duration: PauseDuration) => {
    pauseManager.pause(duration, 'main_app')
    broadcast('recording:changed')
  })
  ipcMain.handle('recording:resume', () => {
    pauseManager.resume('user_main_app')
    broadcast('recording:changed')
  })

  // ----- Categories -----
  ipcMain.handle('categories:load', () => loadCategories())
  ipcMain.handle('categories:save', (_e, cats: TimelineCategory[]) => {
    saveCategories(cats)
    broadcast('categories:changed')
  })

  // ----- Settings -----
  ipcMain.handle('settings:get', (_e, key: string, fallback: unknown) =>
    settings.get(key, fallback)
  )
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    settings.set(key, value)
    broadcast('settings:changed', key)
  })
  ipcMain.handle('settings:all', () => settings.all())

  // ----- Secrets -----
  ipcMain.handle('secrets:store', (_e, provider: string, value: string) =>
    secrets.store(provider, value)
  )
  ipcMain.handle('secrets:exists', (_e, provider: string) => secrets.exists(provider))
  ipcMain.handle('secrets:delete', (_e, provider: string) => secrets.delete(provider))

  // ----- Providers -----
  ipcMain.handle('providers:current', () => currentProviderId())
  ipcMain.handle('providers:testGemini', (_e, apiKey: string) => testGeminiConnection(apiKey))
  ipcMain.handle('providers:testLocal', () => testLocalConnection())
  ipcMain.handle('providers:testClaudeCli', () => testClaudeCli())
  ipcMain.handle('providers:claudeCliInstalled', async () => (await resolveClaudeCli()) !== null)
  ipcMain.handle('providers:generateText', (_e, prompt: string, maxTokens?: number) =>
    generateText(prompt, maxTokens)
  )

  // ----- Journal -----
  ipcMain.handle('journal:entry', (_e, day: string) => storage.fetchJournalEntry(day))
  ipcMain.handle(
    'journal:saveIntentions',
    (_e, day: string, intentions: string | null, notes: string | null, goals: string | null) =>
      storage.updateJournalIntentions(day, intentions, notes, goals)
  )
  ipcMain.handle('journal:saveReflections', (_e, day: string, reflections: string | null) =>
    storage.updateJournalReflections(day, reflections)
  )
  ipcMain.handle('journal:saveSummary', (_e, day: string, summary: string) =>
    storage.updateJournalSummary(day, summary)
  )
  ipcMain.handle('journal:recentSummary', (_e, withinDays: number) =>
    storage.fetchRecentJournalSummary(withinDays)
  )
  ipcMain.handle('journal:recentSummaries', (_e, count: number, excludingDay: string | null) =>
    storage.fetchRecentJournalSummaries(count, excludingDay)
  )
  ipcMain.handle('journal:mostRecentGoals', () => storage.fetchMostRecentGoals())
  ipcMain.handle('journal:hasMinimumActivity', (_e, day: string, minMinutes?: number) =>
    storage.hasMinimumTimelineActivity(day, minMinutes)
  )
  ipcMain.handle('journal:days', (_e, limit?: number) => storage.fetchJournalDays(limit))

  // ----- Standup -----
  ipcMain.handle('standup:fetch', (_e, day: string) => storage.fetchDailyStandup(day))
  ipcMain.handle('standup:save', (_e, day: string, payloadJSON: string) =>
    storage.saveDailyStandup(day, payloadJSON)
  )
  ipcMain.handle('standup:recent', (_e, limit: number, excludingDay: string | null) =>
    storage.fetchRecentDailyStandups(limit, excludingDay)
  )

  // ----- Day goals -----
  ipcMain.handle('goals:fetch', (_e, day: string) => storage.fetchDayGoalPlan(day))
  ipcMain.handle('goals:fetchMostRecent', (_e, beforeOrOn: string) =>
    storage.fetchMostRecentDayGoalPlan(beforeOrOn)
  )
  ipcMain.handle('goals:save', (_e, plan: DayGoalPlan) => {
    storage.saveDayGoalPlan(plan)
    broadcast('goals:changed')
  })

  // ----- Observations (chat tools) -----
  ipcMain.handle('observations:byRange', (_e, fromTs: number, toTs: number) =>
    storage.fetchObservationsByTimeRange(fromTs, toTs)
  )

  // ----- Storage management -----
  ipcMain.handle('storage:usage', () => currentUsage())
  ipcMain.handle('storage:purgeNow', () => {
    purgeRecordingsIfNeeded()
    purgeTimelapsesIfNeeded()
  })

  // ----- Misc -----
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('app:setLaunchAtLogin', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    settings.set('launchAtLogin', enabled)
  })
  ipcMain.handle('app:getLaunchAtLogin', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('analysis:triggerNow', () => analysisManager.triggerAnalysisNow())

  // Onboarding helpers
  ipcMain.handle('onboarding:createCard', (_e, categoryName: string, summary: string) => {
    storage.createOnboardingCard(categoryName, summary)
    broadcast('timeline:changed')
  })

  // Shell save of a timeline card (manual edits)
  ipcMain.handle('timeline:saveCardShell', (_e, batchId: number, card: TimelineCardShell) =>
    storage.saveTimelineCardShell(batchId, card)
  )
}
