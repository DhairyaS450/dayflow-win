// Workflow activity grid (GitHub-style heatmap) — spec §2.4.

import { useRef, useState } from 'react'
import {
  axisHourLabel,
  daysAgo,
  formatDurationValue,
  totalsTitle,
  workflowHeading,
  type DailyWorkflow
} from './dailyModel'
import './WorkflowSection.css'

const CELL = 19.8
const GAP = 2.2

interface TooltipState {
  accent: string
  duration: number
  title: string
  x: number // center x, relative to the card container
  y: number // top y, relative to the card container
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function WorkflowSection({
  day,
  workflow
}: {
  day: string
  workflow: DailyWorkflow
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const gridWidth = workflow.slotCount * (CELL + GAP) - GAP
  const windowMinutes = workflow.windowEnd - workflow.windowStart

  const showTooltip = (el: HTMLElement, accent: string, duration: number, title: string): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    const card = cardRef.current
    if (!card) return
    const cardRect = card.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    setTooltip({
      accent,
      duration,
      title,
      x: rect.left + rect.width / 2 - cardRect.left,
      y: rect.top - cardRect.top
    })
  }

  const scheduleHide = (): void => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setTooltip(null), 80)
  }

  const totals = workflow.totals
  const isToday = daysAgo(day) === 0
  const emptyTotalsText = isToday
    ? `${totalsTitle(day)}  No captured activity yet.`
    : `${totalsTitle(day)}  No captured activity during 9am-9pm`

  const tooltipX = Math.min(Math.max(tooltip?.x ?? 0, 114), Math.max(114, (cardRef.current?.clientWidth ?? 9999) - 114))

  return (
    <section className="wf-section">
      <h2 className="wf-heading">{workflowHeading(day)}</h2>
      <div className="wf-card" ref={cardRef}>
        <div className="wf-grid-area">
          <div className="wf-labels">
            {workflow.rows.map((row) => (
              <div key={row.key} className="wf-label">
                {row.name}
              </div>
            ))}
            {workflow.showDistractionStrip && (
              <div className="wf-label wf-label-strip">Distractions</div>
            )}
          </div>
          <div className="wf-scroll">
            <div className="wf-grid" style={{ width: gridWidth }}>
              {workflow.rows.map((row, ri) => (
                <div key={row.key} className="wf-row">
                  {row.cells.map((cell, si) => {
                    const fill =
                      cell.occupancy > 0
                        ? hexToRgba(row.colorHex, 0.3 + 0.7 * cell.occupancy)
                        : '#F2EDEB'
                    const hasCard = cell.title !== null
                    return (
                      <div
                        key={`${ri}-${si}`}
                        className="wf-cell"
                        style={{ background: fill }}
                        onMouseEnter={
                          hasCard
                            ? (e) =>
                                showTooltip(
                                  e.currentTarget,
                                  '#D77A43',
                                  cell.durationMinutes,
                                  cell.title ?? ''
                                )
                            : undefined
                        }
                        onMouseLeave={hasCard ? scheduleHide : undefined}
                      />
                    )
                  })}
                </div>
              ))}
              {workflow.showDistractionStrip && (
                <div className="wf-strip" style={{ width: gridWidth }}>
                  {workflow.markers.map((m, i) => {
                    const left = ((m.startMinute - workflow.windowStart) / windowMinutes) * gridWidth
                    const width = Math.max(
                      3.3,
                      ((m.endMinute - m.startMinute) / windowMinutes) * gridWidth
                    )
                    return (
                      <div
                        key={i}
                        className="wf-marker"
                        style={{ left, width }}
                        onMouseEnter={(e) =>
                          showTooltip(
                            e.currentTarget,
                            '#FF5950',
                            m.endMinute - m.startMinute,
                            m.title
                          )
                        }
                        onMouseLeave={scheduleHide}
                      />
                    )
                  })}
                </div>
              )}
              <div className="wf-axis" style={{ width: gridWidth }}>
                <div className="wf-axis-rule" />
                <div className="wf-axis-labels">
                  {workflow.hourTicks.map((h, i) => {
                    const isLast = i === workflow.hourTicks.length - 1
                    const x = ((h * 60 - workflow.windowStart) / windowMinutes) * gridWidth
                    return (
                      <span
                        key={h}
                        className="wf-axis-label"
                        style={
                          isLast && workflow.hourTicks.length > 1
                            ? { right: 0, textAlign: 'right' }
                            : { left: Math.max(0, Math.min(x, gridWidth - 37.4)) }
                        }
                      >
                        {axisHourLabel(h)}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="wf-divider" />
        <div className="wf-totals">
          {totals.length === 0 ? (
            <span className="wf-totals-empty">{emptyTotalsText}</span>
          ) : (
            <>
              <span className="wf-totals-title">{totalsTitle(day)}</span>
              {totals.map((t) => (
                <span key={t.name} className="wf-total-pair">
                  <span className="wf-total-name">{t.name}</span>
                  <span className="wf-total-value" style={{ color: t.colorHex }}>
                    {formatDurationValue(t.minutes)}
                  </span>
                </span>
              ))}
            </>
          )}
        </div>
        {tooltip && (
          <div
            className="wf-tooltip"
            style={{ left: tooltipX, top: Math.max(0, tooltip.y - 4.4) }}
          >
            <div className="wf-tooltip-duration" style={{ color: tooltip.accent }}>
              {formatDurationValue(tooltip.duration)}
            </div>
            <div className="wf-tooltip-title">{tooltip.title}</div>
          </div>
        )}
      </div>
    </section>
  )
}
