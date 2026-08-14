// Day goal header + day-summary metrics (spec §4.3, §4.4) and the goal flow host.

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../state/store'
import {
  carriedForwardPlan,
  categoryKey,
  categoryMinutesForCards,
  computeDaySummary,
  defaultGoalPlan,
  formatCompactHours,
  formatLowercaseDuration,
  formatTitleCaseDuration,
  formatUsedDuration,
  type CategoryDuration
} from './dailyModel'
import GoalFlow from './GoalFlow'
import focusIcon from '../../assets/images/DayGoalFocus.png'
import distractionIcon from '../../assets/images/DayGoalDistraction.png'
import type { DayGoalPlan, TimelineCard, TimelineCategory } from '../../../../shared/types'
import './GoalSection.css'

interface GoalSectionProps {
  day: string
  cards: TimelineCard[]
  categories: TimelineCategory[]
}

export default function GoalSection({
  day,
  cards,
  categories
}: GoalSectionProps): React.JSX.Element {
  const recording = useStore((s) => s.recording)
  const [plan, setPlan] = useState<DayGoalPlan | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const off = api.on('goals:changed', () => setReloadKey((k) => k + 1))
    return off
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const explicit = await api.goals.fetch(day)
      if (cancelled) return
      if (explicit) {
        setPlan(carriedForwardPlan(explicit, day, categories))
        return
      }
      const recent = await api.goals.fetchMostRecent(day)
      if (cancelled) return
      setPlan(
        recent ? carriedForwardPlan(recent, day, categories) : defaultGoalPlan(day, categories)
      )
    })()
    return () => {
      cancelled = true
    }
  }, [day, categories, reloadKey])

  const summary = useMemo(
    () => computeDaySummary(cards, categories, plan),
    [cards, categories, plan]
  )
  const perKey = useMemo(() => categoryMinutesForCards(cards, categories), [cards, categories])

  const focusSegments = useMemo(() => {
    if (!plan) return []
    const seen = new Set<string>()
    const segs: { name: string; colorHex: string; minutes: number }[] = []
    for (const s of plan.focusCategories) {
      const cat = categories.find((c) => c.id === s.categoryID)
      const key = categoryKey(cat ? cat.name : s.name)
      if (seen.has(key)) continue
      seen.add(key)
      const minutes = perKey.get(key) ?? 0
      if (minutes > 0) {
        segs.push({ name: cat ? cat.name : s.name, colorHex: cat ? cat.colorHex : s.colorHex, minutes })
      }
    }
    return segs
  }, [plan, categories, perKey])

  const statusLine = recording.isRecording
    ? 'Tracking progress from your focus and distraction categories.'
    : recording.mode === 'paused'
      ? 'Dayflow is paused. Resume to continue tracking your progress.'
      : 'Start Dayflow to continue tracking your progress.'

  const disabled = plan?.isSkipped ?? false
  const target = plan?.focusTargetMinutes ?? 270
  const limit = plan?.distractionLimitMinutes ?? 120
  const focusUsed = summary.totalFocus
  const distractionUsed = summary.totalDistracted
  const focusFulfilled = focusUsed >= target && target > 0
  const overBudget = distractionUsed > limit
  const segTotal = focusSegments.reduce((a, s) => a + s.minutes, 0)
  const segDenominator = Math.max(target, segTotal, 1)
  const usedRatio = limit > 0 ? Math.min(1, distractionUsed / limit) : distractionUsed > 0 ? 1 : 0

  return (
    <section className="gs-section">
      <div className="gs-row">
        <div className="gs-header" data-disabled={disabled ? 'yes' : 'no'}>
          <div className="gs-header-top">
            <span className="gs-header-title">
              {disabled ? "Set today's goals" : "Today's targets"}
            </span>
            <button className="gs-setgoals" onClick={() => setFlowOpen(true)}>
              Set goals
            </button>
          </div>
          {disabled ? (
            <>
              <div className="gs-status">
                Set your goals for today to activate the progress bars below.
              </div>
              <div className="gs-metric-row">
                <span className="gs-bubble gs-bubble-disabled">
                  <img src={focusIcon} alt="" width={25} height={26} />
                </span>
                <div className="gs-bar-block">
                  <div className="gs-mock-track">
                    <div className="gs-mock-fill" />
                  </div>
                  <div className="gs-tail" />
                </div>
              </div>
              <div className="gs-metric-row gs-distraction-row">
                <div className="gs-bar-block">
                  <div className="gs-mock-track">
                    <div className="gs-mock-fill" />
                  </div>
                  <div className="gs-tail gs-tail-mirrored" />
                </div>
                <span className="gs-bubble gs-bubble-disabled">
                  <img src={distractionIcon} alt="" width={25} height={26} />
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="gs-status">{statusLine}</div>
              <div className="gs-metric-row">
                <span className="gs-bubble">
                  <img src={focusIcon} alt="" width={25} height={26} />
                </span>
                <div className="gs-bar-block">
                  <div className="gs-row-labels">
                    <span className="gs-row-label">Focus</span>
                    <span className="gs-row-metric">
                      <span
                        className={focusFulfilled ? 'gs-value-prominent-focus' : 'gs-value-focus'}
                      >
                        {formatCompactHours(focusUsed)}
                      </span>
                      <span className="gs-suffix">
                        {' '}
                        / {formatCompactHours(target)} hr fulfilled
                      </span>
                    </span>
                  </div>
                  <div className="gs-focus-track" data-fulfilled={focusFulfilled ? 'yes' : 'no'}>
                    {focusSegments.map((s) => (
                      <div
                        key={s.name}
                        className="gs-focus-segment"
                        style={{
                          width: `${(s.minutes / segDenominator) * 100}%`,
                          background: s.colorHex
                        }}
                        title={`${s.name}: ${formatUsedDuration(s.minutes)}`}
                      />
                    ))}
                  </div>
                  <div className="gs-tail">
                    {focusSegments.slice(0, 4).map((s) => (
                      <span key={s.name} className="gs-legend-item">
                        <span className="gs-legend-dot" style={{ background: s.colorHex }} />
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="gs-metric-row gs-distraction-row">
                <div className="gs-bar-block">
                  <div className="gs-row-labels">
                    <span className="gs-row-metric">
                      <span
                        className={overBudget ? 'gs-value-prominent-distraction' : 'gs-value-distraction'}
                      >
                        {overBudget
                          ? formatUsedDuration(distractionUsed)
                          : formatUsedDuration(Math.max(0, limit - distractionUsed))}
                      </span>
                      <span className="gs-suffix">
                        {' '}
                        / {formatUsedDuration(limit)}
                        {overBudget ? ' used' : ''}
                      </span>
                    </span>
                    <span className="gs-row-label">Distraction budget</span>
                  </div>
                  <div className="gs-distraction-track">
                    <div
                      className="gs-distraction-fill"
                      style={{ left: `${usedRatio * 100}%` }}
                    />
                  </div>
                  <div className="gs-tail gs-tail-mirrored" />
                </div>
                <span className="gs-bubble">
                  <img src={distractionIcon} alt="" width={25} height={26} />
                </span>
              </div>
            </>
          )}
        </div>

        <div className="gs-panel gs-daysofar">
          <h3 className="gs-panel-title">Your day so far</h3>
          <DonutChart data={summary.categoryDurations} total={summary.totalCaptured} />
          {summary.categoryDurations.length > 0 && (
            <div className="gs-legend-grid">
              {summary.categoryDurations.map((c) => (
                <div key={c.key} className="gs-legend-cell">
                  <div className="gs-legend-name-row">
                    <span
                      className="gs-swatch"
                      style={{
                        background: `${c.colorHex}66`,
                        borderColor: c.colorHex
                      }}
                    />
                    <span className="gs-legend-name">{c.name}</span>
                  </div>
                  <span className="gs-legend-duration">
                    {formatUsedDuration(c.minutes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="gs-panel gs-focus-cards">
          <h3 className="gs-panel-title">Your focus</h3>
          {plan && plan.focusCategories.length === 0 && (
            <div className="gs-empty-note">Edit categories to calculate focus.</div>
          )}
          <div
            className="gs-focus-total-card"
            data-dim={plan && plan.focusCategories.length === 0 ? 'yes' : 'no'}
          >
            <span className="gs-focus-total-title">Total focus time</span>
            <span className="gs-focus-total-value">{formatTitleCaseDuration(focusUsed)}</span>
          </div>
          <h3 className="gs-panel-title gs-panel-title-distraction">Distractions so far</h3>
          {plan && plan.distractionCategories.length === 0 && (
            <div className="gs-empty-note">Edit categories to calculate distractions.</div>
          )}
          <div
            className="gs-distraction-card"
            data-dim={plan && plan.distractionCategories.length === 0 ? 'yes' : 'no'}
          >
            <DistractionBubble ratio={summary.distractedRatio} />
            <div className="gs-distraction-stats">
              <div className="gs-distraction-stat gs-stat-captured">
                <span className="gs-stat-label">Total time captured</span>
                <span className="gs-stat-value">
                  {formatLowercaseDuration(summary.totalCaptured)}
                </span>
              </div>
              <div className="gs-distraction-stat gs-stat-distracted">
                <span className="gs-stat-label">Total time distracted</span>
                <span className="gs-stat-value">
                  {formatLowercaseDuration(summary.totalDistracted)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {flowOpen && plan && (
        <GoalFlow
          day={day}
          plan={plan}
          categories={categories}
          onClose={() => setFlowOpen(false)}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

const DONUT_SIZE = 205
const CHART = 197
const OUTER_R = CHART / 2
const INNER_RATIO = 0.62

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function DonutChart({ data, total }: { data: CategoryDuration[]; total: number }): React.JSX.Element {
  const cx = DONUT_SIZE / 2
  const cy = DONUT_SIZE / 2
  const thickness = OUTER_R * (1 - INNER_RATIO)
  const rMid = OUTER_R - thickness / 2
  const discR = (CHART * INNER_RATIO - 8) / 2

  if (total <= 0 || data.length === 0) {
    return (
      <div className="gs-donut-empty">
        <svg width={DONUT_SIZE} height={DONUT_SIZE}>
          <circle
            cx={cx}
            cy={cy}
            r={70}
            fill="none"
            stroke="rgba(128,128,128,0.2)"
            strokeWidth={20}
          />
        </svg>
        <span className="gs-donut-empty-text">No activity data yet</span>
      </div>
    )
  }

  const gap = 1.5
  const sum = data.reduce((a, c) => a + c.minutes, 0)
  let angle = 0
  const segments = data.map((c) => {
    const sweep = (c.minutes / sum) * 360
    const seg = { color: c.colorHex, start: angle + gap / 2, end: angle + sweep - gap / 2 }
    angle += sweep
    return seg
  })

  const bigValue = total >= 60 ? String(Math.round(total / 60)) : String(Math.round(total))
  const unit = total >= 60 ? (Math.round(total / 60) === 1 ? 'hour' : 'hours') : 'minutes'

  return (
    <svg width={DONUT_SIZE} height={DONUT_SIZE} className="gs-donut">
      <circle cx={cx} cy={cy} r={DONUT_SIZE / 2} fill="#F2F0F0" className="gs-donut-base" />
      {segments.map((s, i) => {
        if (s.end - s.start >= 358) {
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={rMid}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
            />
          )
        }
        if (s.end <= s.start) return null
        const p0 = polar(cx, cy, rMid, s.start)
        const p1 = polar(cx, cy, rMid, s.end)
        const large = s.end - s.start > 180 ? 1 : 0
        return (
          <path
            key={i}
            d={`M ${p0.x} ${p0.y} A ${rMid} ${rMid} 0 ${large} 1 ${p1.x} ${p1.y}`}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeLinecap="round"
          />
        )
      })}
      <circle cx={cx} cy={cy} r={discR} fill="#FFFFFF" />
      <text x={cx} y={cy - 18} textAnchor="middle" className="gs-donut-total-label">
        TOTAL
      </text>
      <text x={cx} y={cy + 6} textAnchor="middle" className="gs-donut-value">
        {bigValue}
      </text>
      <text x={cx} y={cy + 26} textAnchor="middle" className="gs-donut-value">
        {unit}
      </text>
    </svg>
  )
}

/** Area-true distraction circle (§4.4) — diameter ∝ sqrt(ratio), bottom-tangent. */
function DistractionBubble({ ratio }: { ratio: number }): React.JSX.Element {
  const outer = 136
  const inset = 4.868
  const inner = outer * Math.sqrt(Math.min(1, Math.max(0, ratio)))
  return (
    <div className="gs-bubble-chart" style={{ width: outer, height: outer }}>
      {inner >= 0.5 && (
        <div
          className="gs-bubble-inner"
          style={{
            width: inner,
            height: inner,
            left: (outer - inner) / 2,
            top: outer - inset - inner
          }}
        />
      )}
    </div>
  )
}
