// Weekly analytics view (spec §2). Page shell, gates, week navigation and the
// five dashboard sections.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import {
  addDays,
  dayStart,
  logicalDayString,
  weekDays,
  weekStartOf,
  MONTHS,
  WEEKDAYS
} from '../../lib/time'
import leftArrow from '../../assets/images/LeftArrow.png'
import rightArrow from '../../assets/images/RightArrow.png'
import type { TimelineCard } from '../../../../shared/types'
import {
  prepareWeek,
  buildDonut,
  buildContextCharts,
  buildWorkflow,
  buildHeatmap,
  buildTreemap,
  buildSankey
} from './builders'
import DonutCard from './DonutCard'
import ContextCard from './ContextCard'
import WorkflowSection from './WorkflowSection'
import HeatmapSection from './HeatmapSection'
import TreemapSection from './TreemapSection'
import SankeySection from './SankeySection'
import { AccessLock, DataGate } from './Gates'
import './WeeklyView.css'

const UNLOCK_BATCHES = 120 // 120 × 15min batches = 30 recorded hours
const WEEK_MIN_MINUTES = 900 // 15h per-week data gate

function weekRange(ws: string): [number, number] {
  const start = dayStart(ws)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 7)
  return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)]
}

function headerTitle(weekStart: string): string {
  const start = dayStart(weekStart)
  const end = dayStart(addDays(weekStart, 6))
  const fmt = (d: Date): string => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${fmt(start)} - ${fmt(end)}`
}

export default function WeeklyView(): React.JSX.Element {
  const categories = useStore((s) => s.categories)
  const rootRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const [batchCount, setBatchCount] = useState<number | null>(null)
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [weekCards, setWeekCards] = useState<TimelineCard[]>([])
  const [prevCards, setPrevCards] = useState<TimelineCard[]>([])
  const [weekMinutes, setWeekMinutes] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setPanelWidth(e.contentRect.width)
    })
    ro.observe(el)
    setPanelWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const refreshBatchCount = useCallback(async (): Promise<void> => {
    const count = await api.batches.completedCount()
    setBatchCount(count)
  }, [])

  useEffect(() => {
    void refreshBatchCount()
  }, [refreshBatchCount])

  const unlocked = batchCount !== null && batchCount >= UNLOCK_BATCHES

  // Default week on entry: walk back up to 52 weeks for the first week with
  // ≥15h recorded; else the first with >0 minutes; else the current week.
  useEffect(() => {
    if (!unlocked || weekStart !== null) return
    let cancelled = false
    void (async () => {
      const current = weekStartOf(logicalDayString())
      let chosen: string | null = null
      let firstNonZero: string | null = null
      let ws = current
      for (let i = 0; i < 52; i++) {
        const [a, b] = weekRange(ws)
        const minutes = await api.timeline.minutesTracked(a, b)
        if (cancelled) return
        if (minutes >= WEEK_MIN_MINUTES) {
          chosen = ws
          break
        }
        if (minutes > 0 && firstNonZero === null) firstNonZero = ws
        ws = addDays(ws, -7)
      }
      if (!cancelled) setWeekStart(chosen ?? firstNonZero ?? current)
    })()
    return () => {
      cancelled = true
    }
  }, [unlocked, weekStart])

  // Load the selected week (+ previous week for treemap deltas + gate minutes).
  useEffect(() => {
    if (!weekStart) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const [a, b] = weekRange(weekStart)
      const [pa, pb] = weekRange(addDays(weekStart, -7))
      const [cards, prev, minutes] = await Promise.all([
        api.timeline.cardsByRange(a, b),
        api.timeline.cardsByRange(pa, pb),
        api.timeline.minutesTracked(a, b)
      ])
      if (cancelled) return
      setWeekCards(cards)
      setPrevCards(prev)
      setWeekMinutes(minutes)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [weekStart, reloadTick])

  // Reload on timeline changes and app foregrounding.
  useEffect(() => {
    const bump = (): void => {
      void refreshBatchCount()
      setReloadTick((t) => t + 1)
    }
    const off = api.on('timeline:changed', bump)
    window.addEventListener('focus', bump)
    return () => {
      off()
      window.removeEventListener('focus', bump)
    }
  }, [refreshBatchCount])

  const days = useMemo(() => (weekStart ? weekDays(weekStart) : []), [weekStart])
  const prevDays = useMemo(
    () => (weekStart ? weekDays(addDays(weekStart, -7)) : []),
    [weekStart]
  )
  const ctx = useMemo(() => prepareWeek(weekCards, categories, days), [weekCards, categories, days])
  const prevCtx = useMemo(
    () => prepareWeek(prevCards, categories, prevDays),
    [prevCards, categories, prevDays]
  )
  const donut = useMemo(() => buildDonut(weekCards, categories, days), [weekCards, categories, days])
  const context = useMemo(() => buildContextCharts(ctx), [ctx])
  const workflow = useMemo(() => buildWorkflow(ctx), [ctx])
  const heatmap = useMemo(() => buildHeatmap(ctx), [ctx])
  const treemap = useMemo(() => buildTreemap(ctx, prevCtx), [ctx, prevCtx])
  const sankey = useMemo(
    () => (weekStart ? buildSankey(ctx, weekStart) : null),
    [ctx, weekStart]
  )

  const effectiveWidth = panelWidth || 1100
  const hpad = Math.min(56, Math.max(24, effectiveWidth * 0.03))
  const rawContentWidth = effectiveWidth - 2 * hpad
  const contentWidth = Math.max(320, Math.min(1500, rawContentWidth))
  const twoCol = rawContentWidth >= 958
  const donutW = twoCol
    ? Math.min(620, Math.max(461, Math.floor((contentWidth - 27) * 0.44)))
    : contentWidth
  const contextW = twoCol ? contentWidth - 27 - donutW : contentWidth

  const currentWeekStart = weekStartOf(logicalDayString())
  const canForward = weekStart !== null && weekStart < currentWeekStart

  const navigate = (delta: number): void => {
    if (!weekStart) return
    const next = addDays(weekStart, delta * 7)
    if (delta > 0 && next > currentWeekStart) return
    setWeekStart(next)
  }

  if (batchCount === null) {
    return <div className="wk-root" ref={rootRef} />
  }

  if (!unlocked) {
    return (
      <div className="wk-root" ref={rootRef}>
        <AccessLock
          minutes={batchCount * 15}
          panelWidth={panelWidth}
          onViewWeekly={() => void refreshBatchCount()}
        />
      </div>
    )
  }

  return (
    <div className="wk-root" ref={rootRef}>
      {weekStart === null ? (
        <div className="wk-page-loading">
          <div className="wk-spinner" />
        </div>
      ) : (
        <div className="wk-scroll">
          <div
            className="wk-page"
            style={{ paddingLeft: hpad, paddingRight: hpad, paddingTop: 28, paddingBottom: 48 }}
          >
            <div className="wk-content" style={{ width: contentWidth }}>
              <div className="wk-header">
                <button
                  className="wk-nav-arrow"
                  onClick={() => navigate(-1)}
                  aria-label="Previous week"
                >
                  <img src={leftArrow} alt="" width={24} height={24} />
                </button>
                <span className="wk-header-title">{headerTitle(weekStart)}</span>
                <button
                  className="wk-nav-arrow"
                  disabled={!canForward}
                  style={{ opacity: canForward ? 1 : 0.35 }}
                  onClick={() => navigate(1)}
                  aria-label="Next week"
                >
                  <img src={rightArrow} alt="" width={24} height={24} />
                </button>
              </div>
              {weekMinutes !== null && weekMinutes < WEEK_MIN_MINUTES ? (
                <DataGate recordedMinutes={weekMinutes} />
              ) : (
                <div className="wk-sections">
                  <div className={twoCol ? 'wk-toprow' : 'wk-toprow stacked'}>
                    <DonutCard snapshot={donut} width={donutW} loading={loading} />
                    <ContextCard snapshot={context} width={contextW} />
                  </div>
                  <WorkflowSection snapshot={workflow} width={contentWidth} />
                  <HeatmapSection snapshot={heatmap} width={contentWidth} />
                  <TreemapSection snapshot={treemap} width={contentWidth} />
                  {sankey && <SankeySection snapshot={sankey} width={contentWidth} />}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
