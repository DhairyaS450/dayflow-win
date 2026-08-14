// Weekly breakdown sankey (spec §2.11). Geometry is computed in the 1748×933
// design space and scaled uniformly to the rendered width.

import { useMemo, useState } from 'react'
import { hexToRgba } from './weeklyData'
import { sankeyMetric, sankeyPercent, type SankeySnapshot } from './builders'
import { appIconFor } from './appIcons'

interface Props {
  snapshot: SankeySnapshot
  width: number
}

const VW = 1748
const VH = 933

const SRC = { x: 72, barWidth: 12, top: 273, bottom: 706, labelX: 105, labelWidth: 220, labelHeight: 52 }
const CATS = {
  x: 760,
  barWidth: 12,
  top: 126,
  bottom: 828,
  gap: 20,
  minHeight: 40,
  labelX: 802,
  labelTop: 64,
  labelBottom: 874,
  labelWidth: 260,
  labelHeight: 54,
  labelSpacing: 12
}
const APPS = {
  x: 1334,
  barWidth: 12,
  top: 54,
  bottom: 928,
  gap: 20,
  minHeight: 28,
  labelX: 1372,
  labelTop: 38,
  labelBottom: 923,
  labelWidth: 330,
  labelHeight: 56,
  labelSpacing: 10
}

interface Band {
  y0: number
  y1: number
}

function allocateBands(
  minutesArr: number[],
  top: number,
  bottom: number,
  gap: number,
  minHeight: number
): Band[] {
  const count = minutesArr.length
  if (count === 0) return []
  const available = Math.max(count * minHeight, bottom - top - gap * (count - 1))
  const flexible = Math.max(0, available - minHeight * count)
  const total = minutesArr.reduce((s, m) => s + m, 0)
  const out: Band[] = []
  let y = top
  for (const m of minutesArr) {
    const h = minHeight + flexible * (total > 0 ? m / total : 1 / count)
    out.push({ y0: y, y1: y + h })
    y += h + gap
  }
  return out
}

function placeLabels(
  mids: number[],
  labelHeight: number,
  spacing: number,
  labelTop: number,
  labelBottom: number
): number[] {
  const order = mids
    .map((m, i) => ({ pref: m - labelHeight / 2, i }))
    .sort((a, b) => a.pref - b.pref)
  const ys: number[] = []
  let cursor = -Infinity
  for (const { pref } of order) {
    const y = Math.max(pref, cursor)
    ys.push(y)
    cursor = y + labelHeight + spacing
  }
  const n = ys.length
  if (n > 0 && ys[n - 1] + labelHeight > labelBottom) {
    ys[n - 1] = labelBottom - labelHeight
    for (let i = n - 2; i >= 0; i--) {
      ys[i] = Math.min(ys[i], ys[i + 1] - labelHeight - spacing)
    }
    if (ys[0] < labelTop) {
      ys[0] = labelTop
      for (let i = 1; i < n; i++) {
        ys[i] = Math.max(ys[i], ys[i - 1] + labelHeight + spacing)
      }
    }
  }
  const result = new Array<number>(mids.length).fill(0)
  order.forEach(({ i }, k) => {
    result[i] = ys[k]
  })
  return result
}

/** Tint remap for gradient colors. */
function tint(hex: string): string {
  const up = hex.toUpperCase()
  if (up === '000000' || up === '333333') return 'CAC2BA'
  if (up === 'D9D9D9' || up === 'BFB6AE') return 'CFC8C1'
  return up
}

function ribbonPath(
  x0: number,
  y0t: number,
  y0b: number,
  x1: number,
  y1t: number,
  y1b: number,
  tension: number,
  s: number
): string {
  const curve = Math.max(90, (x1 - x0) * tension)
  const f = (v: number): string => (v * s).toFixed(2)
  return (
    `M ${f(x0)} ${f(y0t)} ` +
    `C ${f(x0 + curve)} ${f(y0t)}, ${f(x1 - curve)} ${f(y1t)}, ${f(x1)} ${f(y1t)} ` +
    `L ${f(x1)} ${f(y1b)} ` +
    `C ${f(x1 - curve)} ${f(y1b)}, ${f(x0 + curve)} ${f(y0b)}, ${f(x0)} ${f(y0b)} Z`
  )
}

interface Flow {
  id: string
  from: string // node id
  to: string // node id
  x0: number
  y0t: number
  y0b: number
  x1: number
  y1t: number
  y1b: number
  tension: number
  strength: number
  fromColor: string
  toColor: string
  kind: 'source' | 'right'
}

interface NodeGeom {
  id: string
  name: string
  color: string
  minutes: number
  metric: string
  percent: string
  bar: { x: number; y0: number; y1: number }
  labelY: number
}

export default function SankeySection({ snapshot, width }: Props): React.JSX.Element {
  const height = (width * VH) / VW
  const s = width / VW
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

  const geom = useMemo(() => {
    const { categories, apps, links, totalMinutes } = snapshot
    if (totalMinutes <= 0 || categories.length === 0) return null

    const catBands = allocateBands(
      categories.map((c) => c.minutes),
      CATS.top,
      CATS.bottom,
      CATS.gap,
      CATS.minHeight
    )
    const catBandByKey = new Map(categories.map((c, i) => [c.key, catBands[i]] as const))

    // App ordering by barycenter of incoming links; `other` forced last.
    const bary = (appKey: string): number => {
      let num = 0
      let den = 0
      for (const l of links) {
        if (l.to !== appKey) continue
        const band = catBandByKey.get(l.from)
        if (!band) continue
        num += ((band.y0 + band.y1) / 2) * l.minutes
        den += l.minutes
      }
      return den > 0 ? num / den : 999
    }
    let appsOrdered = [...apps].sort((a, b) => bary(a.key) - bary(b.key))
    const otherIdx = appsOrdered.findIndex((a) => a.key === 'other')
    if (otherIdx >= 0) {
      const other = appsOrdered[otherIdx]
      appsOrdered = appsOrdered.filter((_, i) => i !== otherIdx)
      appsOrdered.push(other)
    }
    const appBands = allocateBands(
      appsOrdered.map((a) => a.minutes),
      APPS.top,
      APPS.bottom,
      APPS.gap,
      APPS.minHeight
    )
    const appBandByKey = new Map(appsOrdered.map((a, i) => [a.key, appBands[i]] as const))

    // Source segments, proportional by category minutes in category order.
    const srcHeight = SRC.bottom - SRC.top
    const srcSegs: Band[] = []
    {
      let y = SRC.top
      for (const c of categories) {
        const h = srcHeight * (c.minutes / totalMinutes)
        srcSegs.push({ y0: y, y1: y + h })
        y += h
      }
    }

    // Category outgoing segments (ordered by target app bar minY).
    const catOutSeg = new Map<string, Band>()
    for (let i = 0; i < categories.length; i++) {
      const c = categories[i]
      const band = catBands[i]
      const outgoing = links
        .filter((l) => l.from === c.key)
        .sort((a, b) => (appBandByKey.get(a.to)?.y0 ?? 0) - (appBandByKey.get(b.to)?.y0 ?? 0))
      const totalOut = outgoing.reduce((sum, l) => sum + l.minutes, 0)
      let y = band.y0
      for (const l of outgoing) {
        const h =
          (band.y1 - band.y0) * (totalOut > 0 ? l.minutes / totalOut : 1 / outgoing.length)
        catOutSeg.set(`${l.from}-${l.to}`, { y0: y, y1: y + h })
        y += h
      }
    }

    // App incoming segments (ordered by source category bar minY).
    const appInSeg = new Map<string, Band>()
    for (let i = 0; i < appsOrdered.length; i++) {
      const a = appsOrdered[i]
      const band = appBands[i]
      const incoming = links
        .filter((l) => l.to === a.key)
        .sort((x, y2) => (catBandByKey.get(x.from)?.y0 ?? 0) - (catBandByKey.get(y2.from)?.y0 ?? 0))
      const totalIn = incoming.reduce((sum, l) => sum + l.minutes, 0)
      let y = band.y0
      for (const l of incoming) {
        const h =
          (band.y1 - band.y0) * (totalIn > 0 ? l.minutes / totalIn : 1 / incoming.length)
        appInSeg.set(`${l.from}-${l.to}`, { y0: y, y1: y + h })
        y += h
      }
    }

    const maxLinkMinutes = links.reduce((m, l) => Math.max(m, l.minutes), 0)

    const flows: Flow[] = []
    categories.forEach((c, i) => {
      const band = catBands[i]
      const seg = srcSegs[i]
      const base = 0.14 + 0.08 * Math.sqrt(c.minutes / totalMinutes)
      flows.push({
        id: `src-${c.key}`,
        from: 'source',
        to: `cat:${c.key}`,
        x0: SRC.x + SRC.barWidth,
        y0t: seg.y0,
        y0b: seg.y1,
        x1: CATS.x,
        y1t: band.y0,
        y1b: band.y1,
        tension: 0.15,
        strength: Math.max(0.08, Math.min(0.36, base)),
        fromColor: 'E3D8CF',
        toColor: tint(c.colorHex),
        kind: 'source'
      })
    })
    for (const l of links) {
      const out = catOutSeg.get(`${l.from}-${l.to}`)
      const inc = appInSeg.get(`${l.from}-${l.to}`)
      if (!out || !inc) continue
      const cat = categories.find((c) => c.key === l.from)
      const app = appsOrdered.find((a) => a.key === l.to)
      if (!cat || !app) continue
      const base = 0.08 + 0.18 * Math.sqrt(maxLinkMinutes > 0 ? l.minutes / maxLinkMinutes : 0)
      flows.push({
        id: `link-${l.from}-${l.to}`,
        from: `cat:${l.from}`,
        to: `app:${l.to}`,
        x0: CATS.x + CATS.barWidth,
        y0t: out.y0,
        y0b: out.y1,
        x1: APPS.x,
        y1t: inc.y0,
        y1b: inc.y1,
        tension: 0.42,
        strength: Math.max(0.08, Math.min(0.36, base)),
        fromColor: tint(cat.colorHex),
        toColor: tint(app.colorHex),
        kind: 'right'
      })
    }

    const catLabelYs = placeLabels(
      catBands.map((b) => (b.y0 + b.y1) / 2),
      CATS.labelHeight,
      CATS.labelSpacing,
      CATS.labelTop,
      CATS.labelBottom
    )
    const appLabelYs = placeLabels(
      appBands.map((b) => (b.y0 + b.y1) / 2),
      APPS.labelHeight,
      APPS.labelSpacing,
      APPS.labelTop,
      APPS.labelBottom
    )

    const sourceNode: NodeGeom = {
      id: 'source',
      name: snapshot.sourceName,
      color: 'D9CBC0',
      minutes: totalMinutes,
      metric: sankeyMetric(totalMinutes),
      percent: '100%',
      bar: { x: SRC.x, y0: SRC.top, y1: SRC.bottom },
      labelY: (SRC.top + SRC.bottom) / 2 - SRC.labelHeight / 2
    }
    const catNodes: NodeGeom[] = categories.map((c, i) => ({
      id: `cat:${c.key}`,
      name: c.name,
      color: c.colorHex,
      minutes: c.minutes,
      metric: sankeyMetric(c.minutes),
      percent: sankeyPercent(c.minutes, totalMinutes),
      bar: { x: CATS.x, y0: catBands[i].y0, y1: catBands[i].y1 },
      labelY: catLabelYs[i]
    }))
    const appNodes: NodeGeom[] = appsOrdered.map((a, i) => ({
      id: `app:${a.key}`,
      name: a.name,
      color: a.colorHex,
      minutes: a.minutes,
      metric: sankeyMetric(a.minutes),
      percent: sankeyPercent(a.minutes, totalMinutes),
      bar: { x: APPS.x, y0: appBands[i].y0, y1: appBands[i].y1 },
      labelY: appLabelYs[i]
    }))

    const catColumn: Band = { y0: catBands[0].y0, y1: catBands[catBands.length - 1].y1 }
    const appColumn: Band =
      appBands.length > 0
        ? { y0: appBands[0].y0, y1: appBands[appBands.length - 1].y1 }
        : { y0: APPS.top, y1: APPS.bottom }

    return { flows, sourceNode, catNodes, appNodes, catColumn, appColumn }
  }, [snapshot])

  const active = pinned ?? hovered

  const relatedNodes = useMemo(() => {
    if (!active || !geom) return null
    const set = new Set<string>(['source', active])
    for (const f of geom.flows) {
      if (f.from === active) set.add(f.to)
      if (f.to === active) set.add(f.from)
    }
    return set
  }, [active, geom])

  const flowOpacity = (f: Flow): number => {
    if (!active || active === 'source') return 1
    return f.from === active || f.to === active ? 1 : 0.12
  }
  const nodeOpacity = (id: string): number => {
    if (!active || active === 'source') return 1
    if (id === active || id === 'source') return 1
    return relatedNodes && relatedNodes.has(id) ? 1 : 0.25
  }

  const togglePin = (id: string): void => {
    setPinned((prev) => (prev === id ? null : id))
  }

  return (
    <section
      className="wk-card wk-sankey"
      style={{ width, height }}
      onClick={() => setPinned(null)}
    >
      <h2 className="wk-title" style={{ position: 'absolute', left: 72 * s, top: 64 * s }}>
        Weekly breakdown
      </h2>
      {!geom ? (
        <div className="wk-sk-empty">No activity recorded for this week yet.</div>
      ) : (
        <>
          <svg width={width} height={height} className="wk-sk-canvas">
            <defs>
              <linearGradient
                id="wk-sk-under-src"
                gradientUnits="userSpaceOnUse"
                x1={(SRC.x + SRC.barWidth) * s}
                x2={CATS.x * s}
                y1={0}
                y2={0}
              >
                <stop offset="0" stopColor="#E6DBD1" stopOpacity={0.48} />
                <stop offset="0.42" stopColor="#EFE9E3" stopOpacity={0.34} />
                <stop offset="0.76" stopColor="#F4EEE9" stopOpacity={0.2} />
                <stop offset="1" stopColor="#F7F2ED" stopOpacity={0.08} />
              </linearGradient>
              <linearGradient
                id="wk-sk-under-right"
                gradientUnits="userSpaceOnUse"
                x1={(CATS.x + CATS.barWidth) * s}
                x2={APPS.x * s}
                y1={0}
                y2={0}
              >
                <stop offset="0" stopColor="#EFE7E0" stopOpacity={0.08} />
                <stop offset="0.46" stopColor="#F4EEE9" stopOpacity={0.11} />
                <stop offset="1" stopColor="#EFE7E0" stopOpacity={0.07} />
              </linearGradient>
              {geom.flows.map((f) => {
                const st = f.strength
                return (
                  <linearGradient
                    key={f.id}
                    id={`wk-sk-grad-${f.id}`}
                    gradientUnits="userSpaceOnUse"
                    x1={f.x0 * s}
                    x2={f.x1 * s}
                    y1={0}
                    y2={0}
                  >
                    {f.kind === 'source' ? (
                      <>
                        <stop offset="0" stopColor="#E3D8CF" stopOpacity={0.18} />
                        <stop offset="0.24" stopColor="#ECE3DC" stopOpacity={0.16} />
                        <stop
                          offset="0.58"
                          stopColor={`#${f.toColor}`}
                          stopOpacity={Math.min(0.12, 0.42 * st)}
                        />
                        <stop
                          offset="0.82"
                          stopColor={`#${f.toColor}`}
                          stopOpacity={Math.min(0.2, 0.72 * st)}
                        />
                        <stop
                          offset="1"
                          stopColor={`#${f.toColor}`}
                          stopOpacity={Math.min(0.32, 1.08 * st)}
                        />
                      </>
                    ) : (
                      <>
                        <stop
                          offset="0"
                          stopColor={`#${f.fromColor}`}
                          stopOpacity={Math.min(0.2, 0.68 * st)}
                        />
                        <stop
                          offset="0.24"
                          stopColor={`#${f.fromColor}`}
                          stopOpacity={Math.min(0.11, 0.4 * st)}
                        />
                        <stop
                          offset="0.54"
                          stopColor={`#${f.toColor}`}
                          stopOpacity={Math.min(0.05, 0.2 * st)}
                        />
                        <stop
                          offset="0.78"
                          stopColor={`#${f.toColor}`}
                          stopOpacity={Math.min(0.12, 0.42 * st)}
                        />
                        <stop
                          offset="1"
                          stopColor={`#${f.toColor}`}
                          stopOpacity={Math.min(0.27, 0.9 * st)}
                        />
                      </>
                    )}
                  </linearGradient>
                )
              })}
            </defs>
            {/* Column underlays */}
            <path
              d={ribbonPath(
                SRC.x + SRC.barWidth,
                SRC.top,
                SRC.bottom,
                CATS.x,
                geom.catColumn.y0,
                geom.catColumn.y1,
                0.15,
                s
              )}
              fill="url(#wk-sk-under-src)"
              pointerEvents="none"
            />
            <path
              d={ribbonPath(
                CATS.x + CATS.barWidth,
                geom.catColumn.y0,
                geom.catColumn.y1,
                APPS.x,
                geom.appColumn.y0,
                geom.appColumn.y1,
                0.22,
                s
              )}
              fill="url(#wk-sk-under-right)"
              opacity={0.72}
              pointerEvents="none"
            />
            {/* Ribbons */}
            {geom.flows.map((f) => (
              <path
                key={f.id}
                d={ribbonPath(f.x0, f.y0t, f.y0b, f.x1, f.y1t, f.y1b, f.tension, s)}
                fill={`url(#wk-sk-grad-${f.id})`}
                opacity={flowOpacity(f)}
                style={{ transition: 'opacity 0.14s ease-out', cursor: 'pointer' }}
                onMouseEnter={() => setHovered(f.to)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(f.to)
                }}
              />
            ))}
            {/* Node bars */}
            {[geom.sourceNode, ...geom.catNodes, ...geom.appNodes].map((n) => (
              <rect
                key={n.id}
                x={n.bar.x * s}
                y={n.bar.y0 * s}
                width={SRC.barWidth * s}
                height={Math.max(1, (n.bar.y1 - n.bar.y0) * s)}
                fill={`#${n.color}`}
                opacity={nodeOpacity(n.id)}
                style={{ transition: 'opacity 0.14s ease-out', cursor: 'pointer' }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(n.id)
                }}
              />
            ))}
          </svg>
          {/* Source + category labels */}
          {[geom.sourceNode, ...geom.catNodes].map((n) => {
            const isSource = n.id === 'source'
            const labelX = isSource ? SRC.labelX : CATS.labelX
            const labelW = isSource ? SRC.labelWidth : CATS.labelWidth
            return (
              <div
                key={n.id}
                className="wk-sk-label"
                style={{
                  left: labelX * s,
                  top: n.labelY * s,
                  width: labelW * s,
                  opacity: nodeOpacity(n.id),
                  cursor: 'pointer'
                }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(n.id)
                }}
              >
                <span className="wk-sk-label-name">{n.name}</span>
                <span className="wk-sk-label-meta">
                  {n.metric}
                  <span className="wk-sk-divider" />
                  {n.percent}
                </span>
              </div>
            )
          })}
          {/* App labels */}
          {geom.appNodes.map((n) => {
            const icon = appIconFor(n.name)
            return (
              <div
                key={n.id}
                className="wk-sk-applabel"
                style={{
                  left: APPS.labelX * s,
                  top: n.labelY * s,
                  width: APPS.labelWidth * s,
                  opacity: nodeOpacity(n.id),
                  cursor: 'pointer'
                }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(n.id)
                }}
              >
                {icon ? (
                  <img className="wk-sk-appicon" src={icon} alt="" width={14} height={14} />
                ) : (
                  <span
                    className="wk-sk-monogram"
                    style={{ background: hexToRgba(n.color, 1) }}
                  >
                    {n.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="wk-sk-applabel-name">{n.name}</span>
                <span className="wk-sk-applabel-meta">
                  {n.metric}
                  <span className="wk-sk-divider small" />
                  {n.percent}
                </span>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
