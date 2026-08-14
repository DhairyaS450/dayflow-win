// "Your workflow this week" grid (spec §2.8).

import { minuteLabel, hexToRgba, durationTextDash } from './weeklyData'
import type { WorkflowSnapshot } from './builders'

interface Props {
  snapshot: WorkflowSnapshot
  width: number
}

const CELL = 13
const GAP = 2
const EMPTY_FILL = '#F2EDEB' // rgb(0.95, 0.93, 0.92)

export default function WorkflowSection({ snapshot, width }: Props): React.JSX.Element {
  const { window: win, slotCount, rows, totals, hourLabels } = snapshot
  const gridWidth = slotCount * (CELL + GAP) - GAP

  const labelLeft = (minute: number, index: number): number => {
    const progress = (minute - win.start) / Math.max(1, win.end - win.start)
    let x = progress * gridWidth - 17
    x = Math.max(0, Math.min(gridWidth - 34, x))
    if (index === 0) x = 0
    if (index === hourLabels.length - 1) x = gridWidth - 34
    return x
  }

  return (
    <section className="wk-card wk-workflow" style={{ width, height: 292 }}>
      <h2 className="wk-title" style={{ position: 'absolute', left: 79, top: 16 }}>
        Your workflow this week
      </h2>
      <div className="wk-wf-grid-area">
        <div className="wk-wf-daycol">
          {rows.map((r) => (
            <div className="wk-wf-daylabel" key={r.label}>
              {r.label}
            </div>
          ))}
        </div>
        <div className="wk-wf-scroll">
          <div className="wk-wf-grid" style={{ width: gridWidth }}>
            {rows.map((r) => (
              <div className="wk-wf-row" key={r.label}>
                {r.cells.map((cell, ci) => {
                  const slotStart = win.start + ci * 15
                  const slotEnd = slotStart + 15
                  const tooltip = cell.name
                    ? `${r.label} ${minuteLabel(slotStart)}-${minuteLabel(slotEnd)}: ${cell.name}, ${durationTextDash(cell.minutes)}`
                    : `${r.label} ${minuteLabel(slotStart)}-${minuteLabel(slotEnd)}: No activity`
                  return (
                    <div
                      className="wk-wf-cell"
                      key={ci}
                      title={tooltip}
                      style={{
                        background: cell.colorHex
                          ? hexToRgba(cell.colorHex, 0.3 + cell.occupancy * 0.7)
                          : EMPTY_FILL
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <div className="wk-wf-hairline" style={{ width: gridWidth }} />
          <div className="wk-wf-hours" style={{ width: gridWidth }}>
            {hourLabels.map((h, i) => (
              <span
                key={h.minute}
                className="wk-wf-hourlabel"
                style={{
                  left: labelLeft(h.minute, i),
                  textAlign: i === 0 ? 'left' : i === hourLabels.length - 1 ? 'right' : 'center'
                }}
              >
                {h.text}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="wk-wf-divider" />
      <div className="wk-wf-footer">
        <span className="wk-wf-footer-title">Week total</span>
        {totals.length === 0 ? (
          <span className="wk-wf-footer-empty">
            {' '}No captured activity during {minuteLabel(win.start)}-{minuteLabel(win.end)}
          </span>
        ) : (
          totals.map((t) => (
            <span className="wk-wf-total" key={t.id}>
              <span className="wk-wf-total-name">{t.name}</span>
              <span className="wk-wf-total-value" style={{ color: `#${t.colorHex}` }}>
                {t.text}
              </span>
            </span>
          ))
        )}
      </div>
    </section>
  )
}
