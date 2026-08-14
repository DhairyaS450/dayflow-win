import { create } from 'zustand'
import { api } from '../lib/api'
import { logicalDayString, weekStartOf } from '../lib/time'
import type { TimelineCard, TimelineCategory } from '../../../shared/types'

export type Tab = 'timeline' | 'daily' | 'weekly' | 'chat' | 'journal' | 'report' | 'settings'
export type TimelineMode = 'day' | 'week'

export interface RecordingStatus {
  mode: string
  isRecording: boolean
  countdown: string | null
}

interface AppStore {
  tab: Tab
  setTab: (tab: Tab) => void

  timelineMode: TimelineMode
  setTimelineMode: (mode: TimelineMode) => void
  selectedDay: string
  setSelectedDay: (day: string) => void
  selectedWeekStart: string
  setSelectedWeekStart: (day: string) => void

  cards: TimelineCard[]
  loadCards: () => Promise<void>
  weekCards: TimelineCard[]
  loadWeekCards: () => Promise<void>

  selectedCardId: string | null
  selectCard: (id: string | null) => void

  categories: TimelineCategory[]
  loadCategories: () => Promise<void>

  recording: RecordingStatus
  refreshRecording: () => Promise<void>

  onboarded: boolean | null
  setOnboarded: (v: boolean) => void
  initOnboarded: () => Promise<void>
}

export const useStore = create<AppStore>((set, get) => ({
  tab: 'timeline',
  setTab: (tab) => set({ tab }),

  timelineMode: 'day',
  setTimelineMode: (mode) => set({ timelineMode: mode, selectedCardId: null }),
  selectedDay: logicalDayString(),
  setSelectedDay: (day) => {
    set({ selectedDay: day, selectedCardId: null })
    void get().loadCards()
  },
  selectedWeekStart: weekStartOf(logicalDayString()),
  setSelectedWeekStart: (day) => {
    set({ selectedWeekStart: day, selectedCardId: null })
    void get().loadWeekCards()
  },

  cards: [],
  loadCards: async () => {
    const cards = await api.timeline.cardsForDay(get().selectedDay)
    set({ cards })
  },
  weekCards: [],
  loadWeekCards: async () => {
    const { selectedWeekStart } = get()
    const [y, m, d] = selectedWeekStart.split('-').map(Number)
    const start = new Date(y, m - 1, d, 4, 0, 0, 0)
    const end = new Date(start.getTime())
    end.setDate(end.getDate() + 7)
    const weekCards = await api.timeline.cardsByRange(
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000)
    )
    set({ weekCards })
  },

  selectedCardId: null,
  selectCard: (id) => set({ selectedCardId: id }),

  categories: [],
  loadCategories: async () => {
    const categories = await api.categories.load()
    set({ categories })
  },

  recording: { mode: 'stopped', isRecording: false, countdown: null },
  refreshRecording: async () => {
    const recording = await api.recording.status()
    set({ recording })
  },

  onboarded: null,
  setOnboarded: (v) => set({ onboarded: v }),
  initOnboarded: async () => {
    const v = await api.settings.get<boolean>('didOnboard', false)
    set({ onboarded: v })
  }
}))

export function categoryColor(
  categories: TimelineCategory[],
  name: string
): string {
  const match = categories.find(
    (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
  )
  return match?.colorHex ?? '#4F80EB'
}

/** Blend a hex color toward white by ratio (0..1). */
export function blendToWhite(hex: string, ratio: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const mix = (c: number): number => Math.round(c + (255 - c) * ratio)
  const to2 = (c: number): string => c.toString(16).padStart(2, '0')
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`
}
