// Goal flow overlay (spec §4.2, Screen B — goal setup) with duration wheel pickers.

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { addDays } from '../../lib/time'
import {
  categoryKey,
  categoryMinutesForCards,
  formatUsedDuration,
  minutesForSnapshots
} from './dailyModel'
import focusIcon from '../../assets/images/DayGoalFocus.png'
import distractionIcon from '../../assets/images/DayGoalDistraction.png'
import type {
  DayGoalCategorySnapshot,
  DayGoalPlan,
  TimelineCategory
} from '../../../../shared/types'
import './GoalFlow.css'

type Assignment = 'focus' | 'distraction'

interface GoalFlowProps {
  day: string
  plan: DayGoalPlan
  categories: TimelineCategory[]
  onClose: () => void
}

interface RefStats {
  yesterday: Map<string, number>
  weekAvg: Map<string, number>
}

function snapshotOf(c: TimelineCategory): DayGoalCategorySnapshot {
  return { categoryID: c.id, name: c.name, colorHex: c.colorHex, sortOrder: c.order }
}

export default function GoalFlow({
  day,
  plan,
  categories,
  onClose
}: GoalFlowProps): React.JSX.Element {
  const pool = useMemo(
    () => categories.filter((c) => !c.isSystem).slice().sort((a, b) => a.order - b.order),
    [categories]
  )

  const [assignments, setAssignments] = useState<Map<string, Assignment>>(() => {
    const map = new Map<string, Assignment>()
    const resolve = (s: DayGoalCategorySnapshot): TimelineCategory | undefined =>
      categories.find((c) => c.id === s.categoryID) ??
      categories.find((c) => categoryKey(c.name) === categoryKey(s.name))
    for (const s of plan.focusCategories) {
      const cat = resolve(s)
      if (cat) map.set(cat.id, 'focus')
    }
    for (const s of plan.distractionCategories) {
      const cat = resolve(s)
      if (cat) map.set(cat.id, 'distraction')
    }
    return map
  })
  const [focusMinutes, setFocusMinutes] = useState(plan.focusTargetMinutes)
  const [distractionMinutes, setDistractionMinutes] = useState(plan.distractionLimitMinutes)
  const [refStats, setRefStats] = useState<RefStats | null>(null)
  const [scale, setScale] = useState(1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const update = (): void => {
      setScale(
        Math.max(
          0.2,
          Math.min((window.innerWidth - 48) / 1200, (window.innerHeight - 48) / 680, 1)
        )
      )
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const days = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)))
      const maps = await Promise.all(
        days.map(async (d) => categoryMinutesForCards(await api.timeline.cardsForDay(d), categories))
      )
      if (cancelled) return
      const weekAvg = new Map<string, number>()
      for (const m of maps) {
        for (const [k, v] of m) weekAvg.set(k, (weekAvg.get(k) ?? 0) + v)
      }
      for (const [k, v] of weekAvg) weekAvg.set(k, v / 7)
      setRefStats({ yesterday: maps[0], weekAvg })
    })()
    return () => {
      cancelled = true
    }
  }, [day, categories])

  const cycle = (id: string): void => {
    setAssignments((prev) => {
      const next = new Map(prev)
      const cur = next.get(id)
      if (cur === undefined) next.set(id, 'focus')
      else if (cur === 'focus') next.set(id, 'distraction')
      else next.delete(id)
      return next
    })
  }

  const remove = (id: string): void => {
    setAssignments((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  const assigned = (kind: Assignment): TimelineCategory[] =>
    pool.filter((c) => assignments.get(c.id) === kind)
  const unassigned = pool.filter((c) => !assignments.has(c.id))

  const focusSnapshots = assigned('focus').map(snapshotOf)
  const distractionSnapshots = assigned('distraction').map(snapshotOf)

  const save = async (skip: boolean): Promise<void> => {
    if (saving) return
    setSaving(true)
    const now = Math.floor(Date.now() / 1000)
    const next: DayGoalPlan = {
      day,
      focusTargetMinutes: focusMinutes,
      distractionLimitMinutes: distractionMinutes,
      focusCategories: focusSnapshots,
      distractionCategories: distractionSnapshots,
      isSkipped: skip,
      createdAt: plan.createdAt > 0 ? plan.createdAt : now,
      updatedAt: now
    }
    try {
      await api.goals.save(next)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  return (
    <div className="gf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gf-canvas" style={{ transform: `scale(${scale})` }}>
        <h2 className="gf-title">Where do you want to spend your time today?</h2>

        <div className="gf-pool">
          <div className="gf-pool-caption">
            Drag and drop to set the categories you want to track
          </div>
          <div className="gf-pool-chips">
            {unassigned.map((c) => (
              <CategoryChip
                key={c.id}
                category={c}
                removable={false}
                onClick={() => cycle(c.id)}
              />
            ))}
          </div>
        </div>

        <GoalPanel
          className="gf-panel-focus"
          accent="#628CFF"
          icon={focusIcon}
          title="Focus goal"
          chips={assigned('focus')}
          onChipClick={cycle}
          onChipRemove={remove}
          minutes={focusMinutes}
          onMinutesChange={setFocusMinutes}
          statTitles={["Yesterday's focus", "Last week's Focus average"]}
          statValues={
            refStats
              ? [
                  minutesForSnapshots(refStats.yesterday, focusSnapshots, categories),
                  minutesForSnapshots(refStats.weekAvg, focusSnapshots, categories)
                ]
              : null
          }
        />
        <GoalPanel
          className="gf-panel-distraction"
          accent="#FA8282"
          icon={distractionIcon}
          title="Distraction limit"
          chips={assigned('distraction')}
          onChipClick={cycle}
          onChipRemove={remove}
          minutes={distractionMinutes}
          onMinutesChange={setDistractionMinutes}
          statTitles={["Yesterday's Distractions", "Last week's Distraction average"]}
          statValues={
            refStats
              ? [
                  minutesForSnapshots(refStats.yesterday, distractionSnapshots, categories),
                  minutesForSnapshots(refStats.weekAvg, distractionSnapshots, categories)
                ]
              : null
          }
        />

        <div className="gf-buttons">
          <button className="gf-btn-secondary" disabled={saving} onClick={() => void save(true)}>
            Skip today
          </button>
          <button className="gf-btn-primary" disabled={saving} onClick={() => void save(false)}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoryChip({
  category,
  removable,
  isDistraction = false,
  onClick,
  onRemove
}: {
  category: TimelineCategory
  removable: boolean
  isDistraction?: boolean
  onClick: () => void
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <button
      className="gf-chip"
      style={{
        background: isDistraction ? '#FFEDED' : `${category.colorHex}29`,
        borderColor: category.colorHex
      }}
      title="Drag into a goal panel, or click to cycle between Focus, Distraction, and untracked"
      onClick={onClick}
    >
      <span className="gf-chip-dots">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="gf-chip-dot" style={{ background: category.colorHex }} />
        ))}
      </span>
      <span className="gf-chip-name">{category.name}</span>
      {removable && (
        <span
          className="gf-chip-x"
          onClick={(e) => {
            e.stopPropagation()
            onRemove?.()
          }}
        >
          ✕
        </span>
      )}
    </button>
  )
}

interface GoalPanelProps {
  className: string
  accent: string
  icon: string
  title: string
  chips: TimelineCategory[]
  onChipClick: (id: string) => void
  onChipRemove: (id: string) => void
  minutes: number
  onMinutesChange: (m: number) => void
  statTitles: [string, string]
  statValues: [number, number] | null
}

function GoalPanel({
  className,
  accent,
  icon,
  title,
  chips,
  onChipClick,
  onChipRemove,
  minutes,
  onMinutesChange,
  statTitles,
  statValues
}: GoalPanelProps): React.JSX.Element {
  const isDistraction = title === 'Distraction limit'
  const scaleMax = statValues ? Math.max(statValues[0], statValues[1], 1) : 1
  return (
    <div className={`gf-panel ${className}`}>
      <div className="gf-panel-header" style={{ background: accent }}>
        <img src={icon} alt="" width={16} height={16} />
        <span>{title}</span>
      </div>
      <div className="gf-panel-body">
        <div className="gf-category-box">
          <span className="gf-category-box-label">Categories</span>
          <div className="gf-category-box-chips">
            {chips.map((c) => (
              <CategoryChip
                key={c.id}
                category={c}
                removable
                isDistraction={isDistraction}
                onClick={() => onChipClick(c.id)}
                onRemove={() => onChipRemove(c.id)}
              />
            ))}
          </div>
        </div>
        <DurationWheel minutes={minutes} onChange={onMinutesChange} />
      </div>
      <div className="gf-panel-footer">
        {statTitles.map((t, i) => (
          <div key={t} className="gf-stat">
            <span className="gf-stat-title">{t}</span>
            <div className="gf-stat-value-row">
              {statValues && statValues[i] > 0 && (
                <span
                  className="gf-stat-bar"
                  style={{
                    background: accent,
                    width: Math.max(12, (86 * statValues[i]) / scaleMax)
                  }}
                />
              )}
              <span className="gf-stat-value">
                {statValues ? formatUsedDuration(Math.round(statValues[i])) : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Duration wheel picker (§4.2 GoalDurationPicker) — hours 0–12, mins 00–55 (step 5),
// total clamped 0…720. Click top half = −step, bottom half = +step; scroll wheel steps.
// ---------------------------------------------------------------------------

function DurationWheel({
  minutes,
  onChange
}: {
  minutes: number
  onChange: (m: number) => void
}): React.JSX.Element {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  const setTotal = (h: number, m: number): void => {
    let hh = Math.min(12, Math.max(0, h))
    let mm = Math.min(55, Math.max(0, Math.round(m / 5) * 5))
    if (hh === 12) mm = 0
    onChange(Math.min(720, hh * 60 + mm))
  }

  return (
    <div className="gf-wheel">
      <WheelColumn
        label="Hours"
        value={hours}
        step={1}
        min={0}
        max={12}
        format={(v) => String(v)}
        onStep={(dir) => setTotal(hours + dir, mins)}
      />
      <WheelColumn
        label="Mins"
        value={mins}
        step={5}
        min={0}
        max={55}
        format={(v) => String(v).padStart(2, '0')}
        onStep={(dir) => setTotal(hours, mins + dir * 5)}
      />
    </div>
  )
}

const WHEEL_SIZES = [21, 23, 25, 23, 21]
const WHEEL_COLORS = ['#AAA6A3', '#8A8582', '#000000', '#8A8582', '#AAA6A3']

function WheelColumn({
  label,
  value,
  step,
  min,
  max,
  format,
  onStep
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  format: (v: number) => string
  onStep: (dir: 1 | -1) => void
}): React.JSX.Element {
  const values = [-2, -1, 0, 1, 2].map((o) => {
    const v = value + o * step
    return v >= min && v <= max ? v : null
  })
  return (
    <div
      className="gf-wheel-column"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onStep(e.clientY - rect.top < rect.height / 2 ? -1 : 1)
      }}
      onWheel={(e) => {
        onStep(e.deltaY > 0 ? 1 : -1)
      }}
    >
      <div className="gf-wheel-values">
        {values.map((v, i) => (
          <span
            key={i}
            className="gf-wheel-value"
            style={{ fontSize: WHEEL_SIZES[i], color: WHEEL_COLORS[i] }}
          >
            {v === null ? ' ' : format(v)}
          </span>
        ))}
      </div>
      <span className="gf-wheel-label">{label}</span>
    </div>
  )
}
