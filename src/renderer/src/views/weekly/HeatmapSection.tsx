// Focus and distraction heat map (spec §2.9).

import { lerpHex } from './weeklyData'
import type { HeatmapSnapshot } from './builders'

interface Props {
  snapshot: HeatmapSnapshot
  width: number
}

const CELL_W = 6
const CELL_H = 12
const GAP = 1

const NEUTRAL_THRESHOLD = 0.045
const CENTER_BOOST = 0.34
const EDGE_FADE = 0.65

const FOCUS_SOFT = '#E3DBFD'
const FOCUS_DARK = '#4276E9'
const DIST_SOFT = '#F8D1CA'
const DIST_DARK = '#FC7645'

function cellColor(v: number): string {
  if (Math.abs(v) < NEUTRAL_THRESHOLD) return '#F2F2F2'
  const progress = Math.pow(Math.min(Math.abs(v), 1), 0.72)
  return v < 0 ? lerpHex(FOCUS_SOFT, FOCUS_DARK, progress) : lerpHex(DIST_SOFT, DIST_DARK, progress)
}

/** Run-aware center-boost / edge-fade adjustment, then color mapping. */
function rowColors(values: number[]): string[] {
  const adjusted = values.slice()
  let i = 0
  while (i < values.length) {
    const v = values[i]
    if (Math.abs(v) < NEUTRAL_THRESHOLD) {
      i++
      continue
    }
    const sign = v > 0 ? 1 : -1
    let j = i
    while (
      j < values.length &&
      Math.abs(values[j]) >= NEUTRAL_THRESHOLD &&
      (values[j] > 0 ? 1 : -1) === sign
    ) {
      j++
    }
    const runLen = j - i
    if (runLen >= 4) {
      const center = (runLen - 1) / 2
      for (let k = i; k < j; k++) {
        const pos = k - i
        const p = center > 0 ? Math.max(0, 1 - Math.abs(pos - center) / center) : 1
        const sp = p * p * (3 - 2 * p)
        const mag = Math.abs(values[k])
        const edge = Math.max(0.045, mag * (1 - EDGE_FADE))
        const centerI = Math.min(1, mag + CENTER_BOOST)
        adjusted[k] = sign * (edge + (centerI - edge) * sp)
      }
    }
    i = j
  }
  return adjusted.map(cellColor)
}

export default function HeatmapSection({ snapshot, width }: Props): React.JSX.Element {
  const { rows, bucketCount, window: win, endMinute, hourLabels } = snapshot
  const gridWidth = bucketCount * (CELL_W + GAP) - GAP
  const legendWidth = Math.max(282.156, Math.min(width * 0.32, 420))

  const labelLeft = (minute: number, index: number): number => {
    const progress = (minute - win.start) / Math.max(1, endMinute - win.start)
    let x = progress * gridWidth - 17
    x = Math.max(0, Math.min(gridWidth - 34, x))
    if (index === 0) x = 0
    if (index === hourLabels.length - 1) x = gridWidth - 34
    return x
  }

  return (
    <section className="wk-card wk-heatmap" style={{ width, height: 238 }}>
      <div className="wk-hm-header">
        <h2 className="wk-title">Focus and distraction heat map</h2>
        <div className="wk-hm-legend" style={{ width: legendWidth }}>
          <div
            className="wk-hm-legend-bar"
            style={{
              background: `linear-gradient(90deg, ${FOCUS_DARK}, ${FOCUS_SOFT}, ${DIST_SOFT}, ${DIST_DARK})`
            }}
          />
          <div className="wk-hm-legend-labels">
            <span>Focused work</span>
            <span>Distracted</span>
          </div>
        </div>
      </div>
      <div className="wk-hm-body">
        <div className="wk-hm-daycol">
          {rows.map((r) => (
            <div className="wk-hm-daylabel" key={r.label}>
              {r.label}
            </div>
          ))}
        </div>
        <div className="wk-hm-scroll">
          <div className="wk-hm-grid" style={{ width: gridWidth }}>
            {rows.map((r) => {
              const colors = rowColors(r.values)
              return (
                <div className="wk-hm-row" key={r.label}>
                  {colors.map((c, ci) => (
                    <div className="wk-hm-cell" key={ci} style={{ background: c }} />
                  ))}
                </div>
              )
            })}
          </div>
          <div className="wk-hm-hours" style={{ width: gridWidth }}>
            {hourLabels.map((h, i) => (
              <span
                key={h.minute}
                className="wk-hm-hourlabel"
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
    </section>
  )
}
