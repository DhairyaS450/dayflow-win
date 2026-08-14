// Weekly access lock (30h gate, spec §2.2) and per-week data gate (15h, §2.3).

import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { weekDays, weekStartOf, logicalDayString } from '../../lib/time'
import logo from '../../assets/images/DayflowLogo.png'
import { buildPreviewCards, PREVIEW_CATEGORIES } from './previewData'
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

const LOCK_TARGET_MINUTES = 30 * 60
const WEEK_TARGET_MINUTES = 15 * 60

/** "0h / 30h", "45m / 30h", "12h / 30h", "12h 30m / 30h". */
function lockProgressText(min: number): string {
  if (min <= 0) return '0h / 30h'
  if (min < 60) return `${min}m / 30h`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h / 30h` : `${h}h ${m}m / 30h`
}

/** "0h", "45m", "3h", "3h 20m". */
function gateDuration(min: number): string {
  if (min <= 0) return '0h'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function UnlockBar({
  progress,
  width,
  spin
}: {
  progress: number
  width: number
  spin: boolean
}): React.JSX.Element {
  const p = Math.max(0, Math.min(1, progress))
  return (
    <div className="wk-unlockbar" style={{ width }}>
      <div className="wk-unlockbar-track">
        <div className="wk-unlockbar-fill" style={{ width: `${p * 100}%` }} />
      </div>
      <div className="wk-unlockbar-knob" style={{ left: p * (width - 24) }}>
        <img className={spin ? 'wk-knob-logo spin' : 'wk-knob-logo'} src={logo} alt="" />
      </div>
    </div>
  )
}

/** Blurred auto-scrolling dashboard preview rendered from synthetic data. */
function PreviewDashboard(): React.JSX.Element {
  const snapshots = useMemo(() => {
    const days = weekDays(weekStartOf(logicalDayString()))
    const cards = buildPreviewCards(days)
    const ctx = prepareWeek(cards, PREVIEW_CATEGORIES, days)
    const emptyCtx = prepareWeek([], PREVIEW_CATEGORIES, days)
    return {
      donut: buildDonut(cards, PREVIEW_CATEGORIES, days),
      context: buildContextCharts(ctx),
      workflow: buildWorkflow(ctx),
      heatmap: buildHeatmap(ctx),
      treemap: buildTreemap(ctx, emptyCtx),
      sankey: buildSankey(ctx, days[0])
    }
  }, [])
  const W = 958
  const donutW = Math.min(620, Math.max(461, Math.floor((W - 27) * 0.44)))
  const contextW = W - 27 - donutW
  return (
    <div className="wk-preview-dashboard" style={{ width: W }}>
      <div className="wk-toprow">
        <DonutCard snapshot={snapshots.donut} width={donutW} loading={false} />
        <ContextCard snapshot={snapshots.context} width={contextW} />
      </div>
      <WorkflowSection snapshot={snapshots.workflow} width={W} />
      <HeatmapSection snapshot={snapshots.heatmap} width={W} />
      <TreemapSection snapshot={snapshots.treemap} width={W} />
      <SankeySection snapshot={snapshots.sankey} width={W} />
    </div>
  )
}

type NotifyState = 'idle' | 'requesting' | 'scheduled'

export function AccessLock({
  minutes,
  panelWidth,
  onViewWeekly
}: {
  minutes: number
  panelWidth: number
  onViewWeekly: () => void
}): React.JSX.Element {
  const ready = minutes >= LOCK_TARGET_MINUTES
  const progress = minutes / LOCK_TARGET_MINUTES
  const [notifyState, setNotifyState] = useState<NotifyState>('idle')

  const buttonLabel = ready
    ? 'View Weekly'
    : notifyState === 'requesting'
      ? 'Setting reminder...'
      : notifyState === 'scheduled'
        ? "We'll notify you"
        : 'Notify me when ready'
  const buttonDisabled = !ready && notifyState !== 'idle'

  const onButton = (): void => {
    if (ready) {
      onViewWeekly()
      return
    }
    if (notifyState !== 'idle') return
    setNotifyState('requesting')
    void api.settings
      .set('weeklyUnlockNotifyRequested', true)
      .finally(() => setNotifyState('scheduled'))
  }

  const scale = Math.max(0.66, Math.min(1, panelWidth > 0 ? panelWidth / 540 : 1))

  return (
    <div className="wk-lock-root">
      <div className="wk-lock-preview">
        <div className="wk-lock-preview-scroll">
          <PreviewDashboard />
        </div>
        <div className="wk-lock-wash" />
      </div>
      <div className="wk-lock-center">
        <div className="wk-lock-card" style={{ transform: `scale(${scale})` }}>
          <div className="wk-lock-glow one" />
          <div className="wk-lock-glow two" />
          <h3 className="wk-lock-title">Unlock Weekly</h3>
          <p className="wk-lock-subtitle">
            Weekly unlocks after 30 hours of recorded timeline data
          </p>
          <div className="wk-lock-pill">{lockProgressText(minutes)}</div>
          <UnlockBar progress={progress} width={413.35} spin />
          <button
            className="wk-lock-button"
            style={{ opacity: buttonDisabled ? 0.62 : 1 }}
            disabled={buttonDisabled}
            onClick={onButton}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DataGate({ recordedMinutes }: { recordedMinutes: number }): React.JSX.Element {
  const remaining = Math.max(0, WEEK_TARGET_MINUTES - recordedMinutes)
  return (
    <div className="wk-gate-wrap">
      <div className="wk-gate-card">
        <h3 className="wk-gate-title">Keep recording to unlock this week</h3>
        <p className="wk-gate-subtitle">
          Weekly insights need at least 15 hours of recorded activity for the selected week.
        </p>
        <div className="wk-gate-pill">
          {gateDuration(recordedMinutes)} / {gateDuration(WEEK_TARGET_MINUTES)}
        </div>
        <UnlockBar progress={recordedMinutes / WEEK_TARGET_MINUTES} width={420} spin={false} />
        <span className="wk-gate-remaining">
          {gateDuration(remaining)} more to unlock this week
        </span>
      </div>
    </div>
  )
}
