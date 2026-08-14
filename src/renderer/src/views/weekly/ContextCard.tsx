// Context shift and distractions comparison card (spec §2.7).

import type { ContextSnapshot } from './builders'

interface Props {
  snapshot: ContextSnapshot
  width: number
}

const CHART_HEIGHT = 104
const DISTRACTED_COLOR = '#FF8A8A'
const SHIFTS_COLOR = '#A78CFF'

function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return ''
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

export default function ContextCard({ snapshot, width }: Props): React.JSX.Element {
  const chartW = Math.max(320, width - 48)
  const days = snapshot.days
  const maxValue = days.reduce((m, d) => Math.max(m, d.shifts, d.distracted), 0)
  const yMax = Math.max(maxValue + 2, 4)

  const toPoints = (values: number[]): [number, number][] =>
    values.map((v, i) => [
      days.length > 1 ? (i / (days.length - 1)) * chartW : chartW / 2,
      CHART_HEIGHT - (v / yMax) * CHART_HEIGHT
    ])

  const distractedPts = toPoints(days.map((d) => d.distracted))
  const shiftPts = toPoints(days.map((d) => d.shifts))

  return (
    <section className="wk-card wk-context-card" style={{ width, height: 300 }}>
      <div className="wk-ctx-top">
        <h2 className="wk-title">Context shift and distractions comparison</h2>
        <div className="wk-ctx-legend">
          <span className="wk-ctx-legend-item">
            <span className="wk-ctx-dot" style={{ background: DISTRACTED_COLOR }} />
            Number of times distracted
          </span>
          <span className="wk-ctx-legend-item">
            <span className="wk-ctx-dot" style={{ background: SHIFTS_COLOR }} />
            Number of context shifts
          </span>
        </div>
        <div className="wk-ctx-count">Count</div>
        <div className="wk-ctx-chart-wrap">
          <svg
            width={chartW}
            height={CHART_HEIGHT + 2}
            viewBox={`0 0 ${chartW} ${CHART_HEIGHT + 2}`}
            className="wk-ctx-chart"
          >
            {/* L-shaped axis: left edge + bottom edge */}
            <path
              d={`M 0.5 0 L 0.5 ${CHART_HEIGHT + 0.5} L ${chartW} ${CHART_HEIGHT + 0.5}`}
              fill="none"
              stroke="rgba(90, 83, 76, 0.9)"
              strokeWidth={1}
            />
            <path d={smoothPath(distractedPts)} fill="none" stroke={DISTRACTED_COLOR} strokeWidth={2} />
            <path d={smoothPath(shiftPts)} fill="none" stroke={SHIFTS_COLOR} strokeWidth={2} />
            {distractedPts.map((p, i) => (
              <circle key={`d${i}`} cx={p[0]} cy={p[1]} r={3.25} fill={DISTRACTED_COLOR} />
            ))}
            {shiftPts.map((p, i) => (
              <circle key={`s${i}`} cx={p[0]} cy={p[1]} r={3.25} fill={SHIFTS_COLOR} />
            ))}
          </svg>
          <div className="wk-ctx-days" style={{ width: chartW }}>
            {days.map((d) => (
              <span key={d.label}>{d.label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="wk-ctx-footer">
        <span className="wk-ctx-insight-dot" />
        <span className="wk-ctx-insight">{snapshot.insight}</span>
      </div>
    </section>
  )
}
