// Synthetic preview data for the Weekly access-lock background (spec §2.2).
// Replaces the upstream hard-coded Figma preview snapshot with generated cards
// that run through the same builders.

import type { TimelineCard, TimelineCategory } from '../../../../shared/types'

export const PREVIEW_CATEGORIES: TimelineCategory[] = [
  cat('Work', '#93BCFF', 0),
  cat('Meetings', '#DE9DFC', 1),
  cat('Learning', '#6CDACD', 2),
  cat('Personal', '#FFA189', 3),
  cat('Distraction', '#FFC6B7', 4)
]

function cat(name: string, colorHex: string, order: number): TimelineCategory {
  return {
    id: `preview-${order}`,
    name,
    colorHex,
    details: '',
    order,
    isSystem: false,
    isIdle: false,
    isNew: false,
    createdAt: '',
    updatedAt: ''
  }
}

interface Block {
  start: string
  end: string
  category: string
  title: string
  app: string
}

const DAY_PLANS: Block[][] = [
  [
    { start: '9:00 AM', end: '10:30 AM', category: 'Work', title: 'Sprint planning doc', app: 'Notion' },
    { start: '10:30 AM', end: '11:00 AM', category: 'Meetings', title: 'Standup', app: 'Zoom' },
    { start: '11:00 AM', end: '1:00 PM', category: 'Work', title: 'Feature work', app: 'Cursor' },
    { start: '2:00 PM', end: '3:30 PM', category: 'Work', title: 'Code review', app: 'GitHub' },
    { start: '3:30 PM', end: '4:00 PM', category: 'Distraction', title: 'Scrolling Reddit', app: 'Reddit' },
    { start: '4:00 PM', end: '6:00 PM', category: 'Work', title: 'Bug fixes', app: 'Cursor' }
  ],
  [
    { start: '9:30 AM', end: '11:30 AM', category: 'Work', title: 'API design', app: 'Figma' },
    { start: '11:30 AM', end: '12:00 PM', category: 'Meetings', title: '1:1', app: 'Meet' },
    { start: '1:00 PM', end: '3:00 PM', category: 'Work', title: 'Implementation', app: 'Cursor' },
    { start: '3:00 PM', end: '3:45 PM', category: 'Distraction', title: 'YouTube break', app: 'YouTube' },
    { start: '3:45 PM', end: '5:30 PM', category: 'Learning', title: 'Course videos', app: 'YouTube' }
  ],
  [
    { start: '9:00 AM', end: '11:00 AM', category: 'Work', title: 'Deep work', app: 'Cursor' },
    { start: '11:00 AM', end: '12:30 PM', category: 'Meetings', title: 'Design review', app: 'Zoom' },
    { start: '1:30 PM', end: '4:00 PM', category: 'Work', title: 'Refactor', app: 'Cursor' },
    { start: '4:00 PM', end: '5:00 PM', category: 'Personal', title: 'Errands planning', app: 'Maps' },
    { start: '5:00 PM', end: '6:30 PM', category: 'Work', title: 'Docs pass', app: 'Notion' }
  ],
  [
    { start: '10:00 AM', end: '12:00 PM', category: 'Work', title: 'Prototype', app: 'Figma' },
    { start: '12:00 PM', end: '12:30 PM', category: 'Distraction', title: 'Twitter scroll', app: 'X' },
    { start: '1:00 PM', end: '3:30 PM', category: 'Work', title: 'Feature work', app: 'Cursor' },
    { start: '3:30 PM', end: '4:30 PM', category: 'Meetings', title: 'Team sync', app: 'Slack' },
    { start: '4:30 PM', end: '6:00 PM', category: 'Learning', title: 'Reading', app: 'Safari' }
  ],
  [
    { start: '9:00 AM', end: '10:00 AM', category: 'Meetings', title: 'Planning', app: 'Zoom' },
    { start: '10:00 AM', end: '1:00 PM', category: 'Work', title: 'Ship feature', app: 'Cursor' },
    { start: '2:00 PM', end: '4:00 PM', category: 'Work', title: 'Release prep', app: 'GitHub' },
    { start: '4:00 PM', end: '5:00 PM', category: 'Personal', title: 'Messages', app: 'Messages' }
  ],
  [
    { start: '11:00 AM', end: '12:30 PM', category: 'Personal', title: 'Photos cleanup', app: 'Photos' },
    { start: '1:00 PM', end: '2:30 PM', category: 'Learning', title: 'Tutorial', app: 'YouTube' },
    { start: '2:30 PM', end: '3:30 PM', category: 'Distraction', title: 'Reddit', app: 'Reddit' }
  ],
  [
    { start: '12:00 PM', end: '1:30 PM', category: 'Personal', title: 'Planning the week', app: 'Notion' },
    { start: '2:00 PM', end: '4:00 PM', category: 'Learning', title: 'Side project', app: 'Cursor' },
    { start: '4:00 PM', end: '4:45 PM', category: 'Distraction', title: 'YouTube', app: 'YouTube' }
  ]
]

export function buildPreviewCards(days: string[]): TimelineCard[] {
  const cards: TimelineCard[] = []
  days.forEach((day, di) => {
    const plan = DAY_PLANS[di % DAY_PLANS.length]
    plan.forEach((b, bi) => {
      cards.push({
        id: `preview-${di}-${bi}`,
        recordId: null,
        batchId: null,
        startTimestamp: b.start,
        endTimestamp: b.end,
        category: b.category,
        subcategory: '',
        title: b.title,
        summary: b.title,
        detailedSummary: b.title,
        day,
        startTs: null,
        endTs: null,
        distractions: null,
        videoSummaryURL: null,
        otherVideoSummaryURLs: null,
        appSites: { primary: b.app, secondary: null },
        isBackupGenerated: null
      })
    })
  })
  return cards
}
