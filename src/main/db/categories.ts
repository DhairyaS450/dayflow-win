import { randomUUID } from 'crypto'
import { settings } from '../lib/settings'
import type { TimelineCategory } from '../../shared/types'

// Categories persist in the settings store under `colorCategories` (parity with
// upstream UserDefaults). An Idle system category is force-inserted if absent.

const KEY = 'colorCategories'

const DEFAULT_DETAILS: Record<string, string> = {
  Work: 'Professional tasks like coding, meetings, email, documents, and project management',
  Personal: 'Personal activities like browsing, shopping, entertainment, social media, and hobbies',
  Distraction: 'Time-wasting activities, procrastination, or unproductive browsing',
  Idle: 'Time when you were away from your computer'
}

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function makeCategory(
  name: string,
  colorHex: string,
  order: number,
  opts: Partial<TimelineCategory> = {}
): TimelineCategory {
  return {
    id: randomUUID().toUpperCase(),
    name,
    colorHex,
    details: DEFAULT_DETAILS[name] ?? '',
    order,
    isSystem: false,
    isIdle: false,
    isNew: false,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    ...opts
  }
}

export function defaultCategories(): TimelineCategory[] {
  return [
    makeCategory('Work', '#B984FF', 0),
    makeCategory('Personal', '#6AADFF', 1),
    makeCategory('Distraction', '#FF5950', 2),
    makeCategory('Idle', '#A0AEC0', 3, { isSystem: true, isIdle: true })
  ]
}

export function loadCategories(): TimelineCategory[] {
  const raw = settings.getOptional<unknown>(KEY)
  let cats: TimelineCategory[] | null = null
  if (Array.isArray(raw)) {
    try {
      cats = raw as TimelineCategory[]
    } catch {
      cats = null
    }
  } else if (typeof raw === 'string') {
    try {
      cats = JSON.parse(raw) as TimelineCategory[]
    } catch {
      cats = null
    }
  }
  if (!cats || cats.length === 0) {
    cats = defaultCategories()
    settings.set(KEY, cats)
    return cats
  }
  // Force-insert Idle if absent
  if (!cats.some((c) => c.isIdle)) {
    const maxOrder = Math.max(...cats.map((c) => c.order), -1)
    cats.push(
      makeCategory('Idle', '#A0AEC0', maxOrder + 1, { isSystem: true, isIdle: true })
    )
    settings.set(KEY, cats)
  }
  return cats.slice().sort((a, b) => a.order - b.order)
}

export function saveCategories(cats: TimelineCategory[]): void {
  settings.set(KEY, cats)
}

export function firstNonIdleCategoryName(): string {
  const cats = loadCategories()
  return cats.find((c) => !c.isIdle)?.name ?? 'Work'
}
