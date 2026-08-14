// Weekly distribution donut card (spec §2.6).

import type { DonutSnapshot } from './builders'

interface Props {
  snapshot: DonutSnapshot
  width: number
  loading: boolean
}

const DEG = 180 / Math.PI

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function pt(p: [number, number]): string {
  return `${p[0].toFixed(3)} ${p[1].toFixed(3)}`
}

/** Annular sector with rounded corners (quadratic approximation of SectorMark). */
function sectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  cornerRadius: number
): string {
  const span = a1 - a0
  if (span <= 0) return ''
  const cr = Math.min(cornerRadius, (r1 - r0) / 2, ((span / 2) * r0) / DEG)
  if (cr < 0.5) {
    // plain wedge
    const large = span > 180 ? 1 : 0
    return [
      `M ${pt(polar(cx, cy, r1, a0))}`,
      `A ${r1} ${r1} 0 ${large} 1 ${pt(polar(cx, cy, r1, a1))}`,
      `L ${pt(polar(cx, cy, r0, a1))}`,
      `A ${r0} ${r0} 0 ${large} 0 ${pt(polar(cx, cy, r0, a0))}`,
      'Z'
    ].join(' ')
  }
  const e1 = Math.min((cr / r1) * DEG, span / 2)
  const e0 = Math.min((cr / r0) * DEG, span / 2)
  const o1 = polar(cx, cy, r1, a0 + e1)
  const o2 = polar(cx, cy, r1, a1 - e1)
  const i1 = polar(cx, cy, r0, a0 + e0)
  const i2 = polar(cx, cy, r0, a1 - e0)
  const e1a = polar(cx, cy, r1 - cr, a0)
  const e2a = polar(cx, cy, r1 - cr, a1)
  const e1b = polar(cx, cy, r0 + cr, a0)
  const e2b = polar(cx, cy, r0 + cr, a1)
  const k1o = polar(cx, cy, r1, a0)
  const k2o = polar(cx, cy, r1, a1)
  const k1i = polar(cx, cy, r0, a0)
  const k2i = polar(cx, cy, r0, a1)
  const largeOuter = a1 - e1 - (a0 + e1) > 180 ? 1 : 0
  const largeInner = a1 - e0 - (a0 + e0) > 180 ? 1 : 0
  return [
    `M ${pt(e1a)}`,
    `Q ${pt(k1o)} ${pt(o1)}`,
    `A ${r1} ${r1} 0 ${largeOuter} 1 ${pt(o2)}`,
    `Q ${pt(k2o)} ${pt(e2a)}`,
    `L ${pt(e2b)}`,
    `Q ${pt(k2i)} ${pt(i2)}`,
    `A ${r0} ${r0} 0 ${largeInner} 0 ${pt(i1)}`,
    `Q ${pt(k1i)} ${pt(e1b)}`,
    'Z'
  ].join(' ')
}

export default function DonutCard({ snapshot, width, loading }: Props): React.JSX.Element {
  const size = Math.min(235, Math.max(176, width * 0.43))
  const chartSize = size - 8
  const r1 = chartSize / 2
  const r0 = r1 * 0.62
  const holeD = Math.max(0, chartSize * 0.62 - 8)
  const total = snapshot.totalMinutes
  const hours = Math.floor(total / 60)
  const minutes = total % 60

  const sectors: { path: string; color: string; key: string }[] = []
  if (total > 0) {
    const rMid = (r0 + r1) / 2
    const insetDeg = (1.5 / rMid) * DEG
    let acc = 0
    for (const item of snapshot.items) {
      const frac = item.minutes / total
      const rawA0 = acc * 360
      const rawA1 = (acc + frac) * 360
      acc += frac
      let s0 = rawA0 + insetDeg
      let s1 = rawA1 - insetDeg
      if (s1 - s0 < 0.6) {
        const mid = (rawA0 + rawA1) / 2
        s0 = mid - 0.3
        s1 = mid + 0.3
      }
      sectors.push({
        key: item.key,
        color: `#${item.colorHex}`,
        path:
          snapshot.items.length === 1
            ? ''
            : sectorPath(chartSize / 2, chartSize / 2, r0, r1, s0, s1, 6)
      })
    }
  }

  return (
    <section className="wk-card wk-donut-card" style={{ width, height: 300 }}>
      <h2 className="wk-title" style={{ position: 'absolute', left: 18, top: 16 }}>
        Weekly distribution
      </h2>
      <div className="wk-donut-row">
        <div className="wk-donut" style={{ width: size, height: size }}>
          <div className="wk-donut-white" />
          {loading ? (
            <div className="wk-spinner" />
          ) : total > 0 ? (
            <>
              <svg
                className="wk-donut-chart"
                width={chartSize}
                height={chartSize}
                viewBox={`0 0 ${chartSize} ${chartSize}`}
              >
                <defs>
                  <radialGradient id="wk-donut-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                    <stop offset="62%" stopColor="#ffffff" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {snapshot.items.length === 1 ? (
                  <path
                    d={`M ${chartSize / 2} 0 A ${r1} ${r1} 0 1 1 ${chartSize / 2 - 0.01} 0 Z M ${chartSize / 2} ${chartSize / 2 - r0} A ${r0} ${r0} 0 1 0 ${chartSize / 2 - 0.01} ${chartSize / 2 - r0} Z`}
                    fill={sectors[0] ? sectors[0].color : '#BFB6AE'}
                    fillRule="evenodd"
                  />
                ) : (
                  sectors.map((s) => <path key={s.key} d={s.path} fill={s.color} />)
                )}
                <circle
                  cx={chartSize / 2}
                  cy={chartSize / 2}
                  r={r1}
                  fill="url(#wk-donut-glow)"
                  pointerEvents="none"
                />
              </svg>
              <div className="wk-donut-hole" style={{ width: holeD, height: holeD }} />
              <div className="wk-donut-center">
                <span className="wk-donut-total-label">TOTAL</span>
                <span className="wk-donut-value">
                  {hours} {hours === 1 ? 'hour' : 'hours'}
                </span>
                <span className="wk-donut-value">
                  {minutes} {minutes === 1 ? 'minute' : 'minutes'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="wk-donut-empty-ring" />
              <div className="wk-donut-center">
                <span className="wk-donut-total-label">TOTAL</span>
                <span className="wk-donut-empty-text">No activity</span>
              </div>
            </>
          )}
        </div>
        <div className="wk-donut-legend">
          {snapshot.items.map((item) => (
            <div className="wk-donut-legend-row" key={item.key}>
              <span className="wk-donut-swatch" style={{ background: `#${item.colorHex}` }} />
              <span className="wk-donut-legend-name">{item.name}</span>
              <span className="wk-donut-legend-pct">
                {total > 0 ? Math.round((item.minutes / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
