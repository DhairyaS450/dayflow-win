// Inline chart blocks in assistant replies (spec §3.9).
// Fenced ```chart type=X blocks are parsed to JSON specs; invalid payloads fall
// back to literal text. Rendered as self-contained SVG (no libraries).

import type { ReactNode } from 'react'

const CHART_RE = /```chart\s+type\s*=\s*([A-Za-z_]+)\s*\n?([\s\S]*?)\n?```/g

export type ContentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'chart'; type: string; payload: Record<string, unknown>; raw: string }

/** Split assistant text into text and chart segments. Invalid JSON stays literal text. */
export function splitChartSegments(text: string): ContentSegment[] {
  const segs: ContentSegment[] = []
  let last = 0
  CHART_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CHART_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index)
    let payload: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(m[2])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>
      }
    } catch {
      /* invalid — falls through as literal text */
    }
    if (payload) {
      if (before.trim()) segs.push({ kind: 'text', text: before })
      segs.push({ kind: 'chart', type: m[1].toLowerCase(), payload, raw: m[0] })
    } else {
      segs.push({ kind: 'text', text: before + m[0] })
    }
    last = m.index + m[0].length
  }
  const rest = text.slice(last)
  if (rest.trim()) segs.push({ kind: 'text', text: rest })
  return segs
}

// ---------- Payload helpers ----------

const PALETTE = ['#F96E00', '#1F6FEB', '#2E7D32', '#8E24AA', '#00897B']

function cleanColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const hex = v.replace('#', '')
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex}`
  return null
}

function asStrings(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v.map((x) => String(x))
}

function asNumbers(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null
  return v as number[]
}

// ---------- SVG geometry ----------

const W = 460
const H = 180
const ML = 38 // left margin (y labels)
const MR = 10
const MT = 10
const MB = 22

function niceMax(maxVal: number): number {
  if (maxVal <= 0) return 1
  const raw = maxVal / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  return step * 4
}

function fmtTick(v: number): string {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}k`
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function Axes(props: { yMax: number; xLabels?: string[] }): React.JSX.Element {
  const plotW = W - ML - MR
  const plotH = H - MT - MB
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <g>
      {ticks.map((t) => {
        const y = MT + plotH - t * plotH
        return (
          <g key={t}>
            <line x1={ML} y1={y} x2={W - MR} y2={y} stroke="#EDE5DC" strokeWidth={1} />
            <text x={ML - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#999999">
              {fmtTick(props.yMax * t)}
            </text>
          </g>
        )
      })}
      {props.xLabels &&
        props.xLabels.map((label, idx) => {
          const n = props.xLabels?.length ?? 1
          const x = ML + ((idx + 0.5) / n) * plotW
          return (
            <text key={idx} x={x} y={H - 6} textAnchor="middle" fontSize={10} fill="#666666">
              {label}
            </text>
          )
        })}
    </g>
  )
}

// ---------- Chart renderers ----------

function BarChart(props: { x: string[]; y: number[]; color: string }): React.JSX.Element {
  const yMax = niceMax(Math.max(...props.y, 0))
  const plotW = W - ML - MR
  const plotH = H - MT - MB
  const n = props.x.length
  const slot = plotW / n
  const barW = Math.min(slot * 0.62, 48)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      <Axes yMax={yMax} xLabels={props.x} />
      {props.y.map((v, idx) => {
        const h = Math.max((Math.max(v, 0) / yMax) * plotH, 0)
        const x = ML + idx * slot + (slot - barW) / 2
        return (
          <rect
            key={idx}
            x={x}
            y={MT + plotH - h}
            width={barW}
            height={h}
            rx={3}
            fill={props.color}
          />
        )
      })}
    </svg>
  )
}

function LineChart(props: { x: string[]; y: number[]; color: string }): React.JSX.Element {
  const yMax = niceMax(Math.max(...props.y, 0))
  const plotW = W - ML - MR
  const plotH = H - MT - MB
  const n = props.x.length
  const pt = (idx: number, v: number): [number, number] => [
    ML + ((idx + 0.5) / n) * plotW,
    MT + plotH - (Math.max(v, 0) / yMax) * plotH
  ]
  const points = props.y.map((v, idx) => pt(idx, v))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      <Axes yMax={yMax} xLabels={props.x} />
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={props.color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map(([x, y], idx) => (
        <circle key={idx} cx={x} cy={y} r={3.2} fill={props.color} />
      ))}
    </svg>
  )
}

interface Series {
  name: string
  values: number[]
  color: string
}

function StackedBarChart(props: { x: string[]; series: Series[] }): React.JSX.Element {
  const totals = props.x.map((_, idx) =>
    props.series.reduce((sum, s) => sum + Math.max(s.values[idx], 0), 0)
  )
  const yMax = niceMax(Math.max(...totals, 0))
  const plotW = W - ML - MR
  const plotH = H - MT - MB
  const n = props.x.length
  const slot = plotW / n
  const barW = Math.min(slot * 0.62, 48)
  return (
    <div className="chart-with-legend">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
        <Axes yMax={yMax} xLabels={props.x} />
        {props.x.map((_, idx) => {
          let acc = 0
          const x = ML + idx * slot + (slot - barW) / 2
          return (
            <g key={idx}>
              {props.series.map((s, si) => {
                const v = Math.max(s.values[idx], 0)
                const h = (v / yMax) * plotH
                const y = MT + plotH - acc - h
                acc += h
                return h > 0 ? (
                  <rect key={si} x={x} y={y} width={barW} height={h} fill={s.color} />
                ) : null
              })}
            </g>
          )
        })}
      </svg>
      <div className="chart-legend">
        {props.series.map((s, si) => (
          <span key={si} className="chart-legend-item">
            <span className="chart-swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function arcPath(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const p = (r: number, a: number): [number, number] => [
    cx + r * Math.cos(a - Math.PI / 2),
    cy + r * Math.sin(a - Math.PI / 2)
  ]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = p(rO, a0)
  const [x1, y1] = p(rO, a1)
  const [x2, y2] = p(rI, a1)
  const [x3, y3] = p(rI, a0)
  return [
    `M ${x0} ${y0}`,
    `A ${rO} ${rO} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rI} ${rI} 0 ${large} 0 ${x3} ${y3}`,
    'Z'
  ].join(' ')
}

function DonutChart(props: {
  labels: string[]
  values: number[]
  colors: string[]
}): React.JSX.Element {
  const total = props.values.reduce((a, b) => a + Math.max(b, 0), 0)
  const cx = H / 2
  const cy = H / 2
  const rO = H / 2 - 8
  const rI = rO * 0.6
  let angle = 0
  const gap = 0.018 // ~1 degree angular inset
  return (
    <div className="chart-with-legend">
      <svg viewBox={`0 0 ${H} ${H}`} className="chart-svg chart-svg-square" role="img">
        {props.values.map((v, idx) => {
          const frac = total > 0 ? Math.max(v, 0) / total : 0
          if (frac <= 0) return null
          const a0 = angle + gap / 2
          const a1 = angle + Math.max(frac * Math.PI * 2 - gap / 2, gap)
          angle += frac * Math.PI * 2
          return (
            <path
              key={idx}
              d={arcPath(cx, cy, rO, rI, a0, Math.min(a1, angle))}
              fill={props.colors[idx % props.colors.length]}
            />
          )
        })}
      </svg>
      <div className="chart-legend chart-legend-col">
        {props.labels.map((label, idx) => {
          const pct = total > 0 ? Math.round((Math.max(props.values[idx], 0) / total) * 100) : 0
          return (
            <span key={idx} className="chart-legend-item">
              <span
                className="chart-swatch"
                style={{ background: props.colors[idx % props.colors.length] }}
              />
              {label} ({pct}%)
            </span>
          )
        })}
      </div>
    </div>
  )
}

function HeatmapChart(props: {
  x: string[]
  y: string[]
  values: number[][]
  color: string
}): React.JSX.Element {
  const flat = props.values.flat()
  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const span = max - min || 1
  const left = 64
  const plotW = W - left - MR
  const plotH = H - MT - MB
  const cw = plotW / props.x.length
  const ch = plotH / props.y.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      {props.y.map((rowLabel, ri) => (
        <text
          key={`y-${ri}`}
          x={left - 6}
          y={MT + ri * ch + ch / 2 + 3}
          textAnchor="end"
          fontSize={9}
          fill="#666666"
        >
          {rowLabel}
        </text>
      ))}
      {props.x.map((colLabel, ci) => (
        <text
          key={`x-${ci}`}
          x={left + ci * cw + cw / 2}
          y={H - 6}
          textAnchor="middle"
          fontSize={9}
          fill="#666666"
        >
          {colLabel}
        </text>
      ))}
      {props.values.map((row, ri) =>
        row.map((v, ci) => {
          const t = (v - min) / span
          return (
            <rect
              key={`${ri}-${ci}`}
              x={left + ci * cw + cw * 0.05}
              y={MT + ri * ch + ch * 0.05}
              width={cw * 0.9}
              height={ch * 0.9}
              rx={2}
              fill={props.color}
              opacity={0.2 + 0.8 * t}
            />
          )
        })
      )}
    </svg>
  )
}

interface GanttItem {
  label: string
  start: number
  end: number
  color: string
}

function GanttChart(props: { items: GanttItem[] }): React.JSX.Element {
  const min = Math.min(...props.items.map((it) => it.start))
  const max = Math.max(...props.items.map((it) => it.end))
  const span = max - min || 1
  const left = 86
  const plotW = W - left - MR
  const plotH = H - MT - MB
  const rowH = plotH / props.items.length
  const barH = Math.min(rowH * 0.56, 18)
  const tickCount = 6
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      {Array.from({ length: tickCount + 1 }, (_, i) => {
        const v = min + (span * i) / tickCount
        const x = left + (plotW * i) / tickCount
        return (
          <g key={i}>
            <line x1={x} y1={MT} x2={x} y2={MT + plotH} stroke="#EDE5DC" strokeWidth={1} />
            <text x={x} y={H - 6} textAnchor="middle" fontSize={9} fill="#666666">
              {(Math.round(v * 10) / 10).toFixed(1)}
            </text>
          </g>
        )
      })}
      {props.items.map((it, idx) => {
        const y = MT + idx * rowH + (rowH - barH) / 2
        const x0 = left + ((it.start - min) / span) * plotW
        const x1 = left + ((it.end - min) / span) * plotW
        return (
          <g key={idx}>
            <text
              x={left - 6}
              y={y + barH / 2 + 3}
              textAnchor="end"
              fontSize={9}
              fill="#666666"
            >
              {it.label.length > 14 ? `${it.label.slice(0, 13)}…` : it.label}
            </text>
            <rect x={x0} y={y} width={Math.max(x1 - x0, 2)} height={barH} rx={4} fill={it.color} />
          </g>
        )
      })}
    </svg>
  )
}

// ---------- Dispatcher ----------

function renderChart(type: string, payload: Record<string, unknown>): ReactNode | null {
  if (type === 'bar' || type === 'line') {
    const x = asStrings(payload.x)
    const y = asNumbers(payload.y)
    if (!x || !y || x.length !== y.length) return null
    const color = cleanColor(payload.color) ?? PALETTE[0]
    return type === 'bar' ? (
      <BarChart x={x} y={y} color={color} />
    ) : (
      <LineChart x={x} y={y} color={color} />
    )
  }
  if (type === 'stacked_bar') {
    const x = asStrings(payload.x)
    if (!x) return null
    const rawSeries = Array.isArray(payload.series) ? payload.series : []
    const series: Series[] = []
    rawSeries.forEach((s: unknown, idx: number) => {
      if (!s || typeof s !== 'object') return
      const obj = s as Record<string, unknown>
      const values = asNumbers(obj.values)
      if (!values || values.length !== x.length) return // mismatched series dropped
      series.push({
        name: typeof obj.name === 'string' ? obj.name : `Series ${idx + 1}`,
        values,
        color: cleanColor(obj.color) ?? PALETTE[idx % PALETTE.length]
      })
    })
    if (series.length === 0) return null
    return <StackedBarChart x={x} series={series} />
  }
  if (type === 'donut' || type === 'pie') {
    const labels = asStrings(payload.labels)
    const values = asNumbers(payload.values)
    if (!labels || !values || labels.length !== values.length) return null
    let colors: string[] = PALETTE
    if (Array.isArray(payload.colors) && payload.colors.length === labels.length) {
      const cleaned = payload.colors.map(cleanColor)
      if (cleaned.every((c): c is string => c !== null)) colors = cleaned
    }
    return <DonutChart labels={labels} values={values} colors={colors} />
  }
  if (type === 'heatmap') {
    const x = asStrings(payload.x)
    const y = asStrings(payload.y)
    if (!x || !y || !Array.isArray(payload.values)) return null
    const rows: number[][] = []
    for (const row of payload.values) {
      const nums = asNumbers(row)
      if (!nums || nums.length !== x.length) return null
      rows.push(nums)
    }
    if (rows.length !== y.length) return null
    return <HeatmapChart x={x} y={y} values={rows} color={cleanColor(payload.color) ?? PALETTE[0]} />
  }
  if (type === 'gantt') {
    if (!Array.isArray(payload.items)) return null
    const items: GanttItem[] = []
    payload.items.forEach((raw: unknown, idx: number) => {
      if (!raw || typeof raw !== 'object') return
      const obj = raw as Record<string, unknown>
      const start = typeof obj.start === 'number' ? obj.start : NaN
      const end = typeof obj.end === 'number' ? obj.end : NaN
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return // dropped
      items.push({
        label: typeof obj.label === 'string' ? obj.label : `Item ${idx + 1}`,
        start,
        end,
        color: cleanColor(obj.color) ?? PALETTE[idx % PALETTE.length]
      })
    })
    if (items.length === 0) return null
    return <GanttChart items={items} />
  }
  return null
}

export default function ChartBlock(props: {
  type: string
  payload: Record<string, unknown>
  raw: string
}): React.JSX.Element {
  const title = typeof props.payload.title === 'string' ? props.payload.title : null
  const chart = renderChart(props.type, props.payload)
  if (!chart) {
    // Structurally invalid spec — render as literal text per spec.
    return (
      <div className="md-code">
        <pre>
          <code>{props.raw}</code>
        </pre>
      </div>
    )
  }
  return (
    <div className="chart-block">
      {title && <div className="chart-title">{title}</div>}
      <div className="chart-body">{chart}</div>
    </div>
  )
}
