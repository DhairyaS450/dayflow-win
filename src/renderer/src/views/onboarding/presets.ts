// Role-based category presets + survey options (verbatim from the porting spec).

import type { TimelineCategory } from '../../../../shared/types'

export type RoleName =
  | 'Software Engineer'
  | 'Founder / Executive'
  | 'Designer'
  | 'Student'
  | 'Product Manager'
  | 'Data Scientist'
  | 'Other'

export const ROLES: RoleName[] = [
  'Software Engineer',
  'Founder / Executive',
  'Designer',
  'Student',
  'Product Manager',
  'Data Scientist',
  'Other'
]

interface PresetEntry {
  name: string
  colorHex: string
  details: string
}

const SHARED_TAIL: PresetEntry[] = [
  {
    name: 'Distraction',
    colorHex: '#FF4721',
    details:
      'Unfocused browsing and passive content consumption: social media feeds, random videos, idle scrolling, entertainment with no clear intent, and gaming'
  },
  {
    name: 'Personal',
    colorHex: '#ADE3E3',
    details:
      'Intentional non-work activity with a purpose: messaging friends and family, managing finances, booking travel, errands, life admin, and hobbies'
  }
]

const ROLE_PRESETS: Record<RoleName, PresetEntry[]> = {
  'Software Engineer': [
    {
      name: 'Coding / Debugging',
      colorHex: '#6A7EFF',
      details: 'Writing, refactoring, and fixing code in an IDE or terminal'
    },
    {
      name: 'Code Review',
      colorHex: '#56CFEE',
      details: 'Reviewing PRs, reading diffs, and leaving comments'
    },
    {
      name: 'Research',
      colorHex: '#C787F7',
      details:
        'Reading docs, Stack Overflow, exploring tools and APIs, and writing design docs or technical specs'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Meetings, standups, Slack, email, video calls, messaging, and syncs'
    }
  ],
  'Founder / Executive': [
    {
      name: 'Engineering / Product',
      colorHex: '#6A7EFF',
      details: 'Coding, design work, shipping features, and hands-on building'
    },
    {
      name: 'Research & Strategy',
      colorHex: '#56CFEE',
      details: 'Competitive research, positioning, long-form thinking, and investor prep'
    },
    {
      name: 'Data & Insights',
      colorHex: '#C787F7',
      details: 'Dashboards, retention data, funnels, and financials'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Team syncs, investor calls, user demos, and hiring'
    }
  ],
  Designer: [
    {
      name: 'Design',
      colorHex: '#6A7EFF',
      details: 'Prototyping, UI components, user flows, visual design, and handoff specs'
    },
    {
      name: 'Research',
      colorHex: '#56CFEE',
      details: 'Browsing patterns, competitive audits, user studies, and reviewing metrics'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Design reviews, standups, critique sessions, and presenting concepts'
    }
  ],
  Student: [
    {
      name: 'Studying',
      colorHex: '#6A7EFF',
      details: 'Lectures, reading, reviewing slides, flashcards, and course material'
    },
    {
      name: 'Assignments',
      colorHex: '#56CFEE',
      details: 'Papers, problem sets, coding projects, and lab reports'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Study groups, office hours, group chats, and emailing professors'
    }
  ],
  'Product Manager': [
    {
      name: 'Specs & Planning',
      colorHex: '#6A7EFF',
      details: 'PRDs, roadmaps, backlog grooming, sprint planning, and tickets'
    },
    {
      name: 'Research & Analysis',
      colorHex: '#56CFEE',
      details: 'User research, metrics review, competitive analysis, and A/B tests'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Standups, stakeholder syncs, design reviews, and engineering check-ins'
    }
  ],
  'Data Scientist': [
    {
      name: 'Analysis & Modeling',
      colorHex: '#6A7EFF',
      details: 'Notebooks, statistical analysis, ML training, and data exploration'
    },
    {
      name: 'Data Engineering',
      colorHex: '#56CFEE',
      details: 'SQL queries, pipelines, data cleaning, and ETL scripts'
    },
    {
      name: 'Research',
      colorHex: '#C787F7',
      details: 'Reading papers, docs, and exploring new methods and tools'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Presenting findings, stakeholder syncs, and team discussions'
    }
  ],
  Other: [
    {
      name: 'Work',
      colorHex: '#6A7EFF',
      details:
        'Focused work tasks and professional responsibilities that do not fit a more specific category'
    },
    {
      name: 'Communication',
      colorHex: '#FFAE8C',
      details: 'Meetings, standups, Slack, email, video calls, messaging, and syncs'
    }
  ]
}

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function makeCategory(entry: PresetEntry, order: number, system = false): TimelineCategory {
  const now = nowISO()
  return {
    id: crypto.randomUUID().toUpperCase(),
    name: entry.name,
    colorHex: entry.colorHex,
    details: entry.details,
    order,
    isSystem: system,
    isIdle: system,
    isNew: false,
    createdAt: now,
    updatedAt: now
  }
}

/** Build the full preset category list for a role (role rows + Distraction/Personal + hidden Idle). */
export function buildPresetCategories(role: string): TimelineCategory[] {
  const key: RoleName = ROLES.includes(role as RoleName) ? (role as RoleName) : 'Other'
  const preset = ROLE_PRESETS[key]
  const entries = [...preset, ...SHARED_TAIL]
  const cats = entries.map((e, i) => makeCategory(e, i))
  cats.push(
    makeCategory(
      { name: 'Idle', colorHex: '#A0AEC0', details: 'Time when you were away from your computer' },
      entries.length,
      true
    )
  )
  return cats
}

// ---------- Survey options ----------

export interface SurveyOption {
  label: string
  value: string
  detailPlaceholder?: string
}

export const DOWNLOAD_REASONS: SurveyOption[] = [
  { label: 'To keep an automatic log of what I worked on', value: 'automatic_log' },
  {
    label: 'To have something to show for my work (standups, reviews, clients)',
    value: 'proof_of_work'
  },
  { label: 'To find and cut distractions', value: 'cut_distractions' },
  { label: 'To be more productive or focused', value: 'productive_focused' },
  {
    label: 'I was already tracking this manually and wanted it automated',
    value: 'automated_manual_tracking'
  },
  {
    label: "I wanted a tracker that's open source and keeps my data private",
    value: 'open_source_private'
  }
]

export const REFERRAL_SOURCES: SurveyOption[] = [
  { label: 'Hacker News', value: 'hacker_news' },
  { label: 'X / Twitter', value: 'x' },
  { label: 'Friend or colleague', value: 'friend' },
  { label: 'YouTube', value: 'youtube', detailPlaceholder: 'Which channel?' },
  {
    label: 'Newsletter or blog (which one?)',
    value: 'newsletter_blog',
    detailPlaceholder: 'Which newsletter or blog?'
  },
  { label: 'ChatGPT / Claude / AI', value: 'chatgpt_claude_ai' }
]

export const REFERRAL_OTHER: SurveyOption = {
  label: 'Other (please specify)',
  value: 'other',
  detailPlaceholder: 'Where did you hear about Dayflow?'
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffled<T>(items: T[]): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
