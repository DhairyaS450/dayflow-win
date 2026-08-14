// "Most used per category" treemap (spec §2.10).

import { useMemo, useState } from 'react'
import { blendToWhite } from '../../state/store'
import { hexToRgba, durationTextHr } from './weeklyData'
import { squarifyLayout, type Rect, type SquarifyPlaced } from './squarify'
import { appIconFor } from './appIcons'
import type { TreemapSnapshot, TreemapCategory, TreemapApp } from './builders'

interface Props {
  snapshot: TreemapSnapshot
  width: number
}

interface TileLeaf {
  id: string
  name: string
  minutes: number
  changeText: string | null
  changeColor: string | null
  isAggregate: boolean
}

const HEADER_H = 30
const MIN_TILE_W = 44
const MIN_TILE_H = 28
const MIN_TILE_AREA = 1600

/** App-level layout with readability aggregation into an "Other" tile. */
function layoutApps(apps: TreemapApp[], rect: Rect): SquarifyPlaced<TileLeaf>[] {
  let leaves: TileLeaf[] = apps.map((a) => ({
    id: a.key,
    name: a.name,
    minutes: a.minutes,
    changeText: a.changeText,
    changeColor: a.changeColor,
    isAggregate: false
  }))
  let otherMinutes = 0
  for (;;) {
    const items: TileLeaf[] = [...leaves]
    if (otherMinutes > 0) {
      items.push({
        id: 'other',
        name: 'Other',
        minutes: otherMinutes,
        changeText: null,
        changeColor: null,
        isAggregate: true
      })
    }
    const placed = squarifyLayout(
      items.map((l) => ({ data: l, value: l.minutes, name: l.name })),
      rect,
      4
    )
    const offending = placed.some(
      (p) =>
        !p.data.isAggregate &&
        (p.rect.w < MIN_TILE_W || p.rect.h < MIN_TILE_H || p.rect.w * p.rect.h < MIN_TILE_AREA)
    )
    if (!offending || items.length <= 1 || leaves.length === 0) return placed
    let smallest = 0
    for (let i = 1; i < leaves.length; i++) {
      if (leaves[i].minutes < leaves[smallest].minutes) smallest = i
    }
    otherMinutes += leaves[smallest].minutes
    leaves = leaves.filter((_, i) => i !== smallest)
  }
}

interface TileTypography {
  name: number
  detail: number
  delta: number
  spacing: number
  padding: number
}

function typographyFor(w: number, h: number): TileTypography {
  if (w >= 160 && h >= 110) return { name: 20, detail: 12, delta: 12, spacing: 4, padding: 12 }
  if (w >= 90 && h >= 54) return { name: 16, detail: 12, delta: 12, spacing: 3, padding: 10 }
  return { name: 13, detail: 10, delta: 10, spacing: 2, padding: 6 }
}

type TileMode = 'full' | 'compact' | 'labelOnly'

function modeFor(w: number, h: number, hasChange: boolean, hasIcon: boolean): TileMode {
  const fullMinH = hasChange ? (hasIcon ? 92 : 72) : hasIcon ? 70 : 56
  if (w >= 90 && h >= fullMinH) return 'full'
  if (w >= 58 && h >= 34) return 'compact'
  return 'labelOnly'
}

interface HoverInfo {
  key: string
  name: string
  minutes: number
  changeText: string | null
  changeColor: string | null
  shellFill: string
  shellBorder: string
  left: number
  top: number
}

export default function TreemapSection({ snapshot, width }: Props): React.JSX.Element {
  const contentW = Math.max(797, width - 80)
  const contentH = 400
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const placedCats = useMemo(
    () =>
      squarifyLayout(
        snapshot.categories.map((c) => ({ data: c, value: c.minutes, name: c.name })),
        { x: 0, y: 0, w: contentW, h: contentH },
        6
      ),
    [snapshot, contentW]
  )

  const showHover = (
    cat: TreemapCategory,
    catRect: Rect,
    tile: SquarifyPlaced<TileLeaf>
  ): void => {
    const shellFill = hexToRgba(cat.accent, 0.25)
    const shellBorder = hexToRgba(cat.accent, 0.62)
    const absX = catRect.x + 8 + tile.rect.x
    const absY = catRect.y + HEADER_H + tile.rect.y
    let left = absX + tile.rect.w / 2 - 88
    left = Math.max(0, Math.min(contentW - 176, left))
    let top = absY - 92 - 10
    if (top < 0) top = absY + tile.rect.h + 10
    setHover({
      key: `${cat.key}|${tile.data.id}`,
      name: tile.data.name,
      minutes: tile.data.minutes,
      changeText: tile.data.changeText,
      changeColor: tile.data.changeColor,
      shellFill,
      shellBorder,
      left,
      top
    })
  }

  return (
    <section className="wk-card wk-treemap" style={{ width, height: 549 }}>
      <h2 className="wk-title" style={{ position: 'absolute', left: 40, top: 34 }}>
        Most used per category
      </h2>
      <div className="wk-tm-content" style={{ width: contentW, height: contentH }}>
        {placedCats.map(({ data: cat, rect }) => {
          const accent = `#${cat.accent}`
          const shellFill = hexToRgba(cat.accent, 0.25)
          const shellBorder = hexToRgba(cat.accent, 0.62)
          const tileFill = blendToWhite(accent, 0.86)
          const tileBorder = blendToWhite(accent, 0.36)
          const appRect: Rect = {
            x: 0,
            y: 0,
            w: Math.max(0, rect.w - 16),
            h: Math.max(0, rect.h - HEADER_H - 8)
          }
          const tiles = layoutApps(cat.apps, appRect)
          const showDuration = rect.w >= 120
          return (
            <div
              className="wk-tm-cat"
              key={cat.key}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                background: shellFill,
                borderColor: shellBorder
              }}
            >
              <div className="wk-tm-cat-header" style={{ color: accent }}>
                <span className="wk-tm-cat-name">{cat.name}</span>
                {showDuration && (
                  <span className="wk-tm-cat-duration">{durationTextHr(cat.minutes)}</span>
                )}
              </div>
              <div className="wk-tm-appgrid" style={{ left: 8, top: HEADER_H }}>
                {tiles.map((tile) => {
                  const icon = tile.data.isAggregate ? null : appIconFor(tile.data.name)
                  const mode = modeFor(
                    tile.rect.w,
                    tile.rect.h,
                    tile.data.changeText !== null,
                    icon !== null
                  )
                  const t = typographyFor(tile.rect.w, tile.rect.h)
                  const nameSize =
                    mode === 'full' ? t.name : mode === 'compact' ? t.name - 2 : t.name - 3
                  const iconSize = Math.max(12, Math.round(nameSize * 1.15))
                  return (
                    <div
                      className="wk-tm-tile"
                      key={tile.data.id}
                      style={{
                        left: tile.rect.x,
                        top: tile.rect.y,
                        width: tile.rect.w,
                        height: tile.rect.h,
                        background: tileFill,
                        borderColor: tileBorder,
                        padding: t.padding,
                        gap: t.spacing
                      }}
                      onMouseEnter={() => {
                        if (mode !== 'full') showHover(cat, rect, tile)
                      }}
                      onMouseLeave={() => setHover(null)}
                    >
                      <span className="wk-tm-tile-namerow" style={{ fontSize: nameSize }}>
                        {icon && (
                          <img src={icon} alt="" width={iconSize} height={iconSize} />
                        )}
                        <span className="wk-tm-tile-name">{tile.data.name}</span>
                      </span>
                      {mode !== 'labelOnly' && (
                        <span className="wk-tm-tile-duration" style={{ fontSize: t.detail }}>
                          {durationTextHr(tile.data.minutes)}
                        </span>
                      )}
                      {mode === 'full' && tile.data.changeText && (
                        <span
                          className="wk-tm-tile-delta"
                          style={{ fontSize: t.delta, color: `#${tile.data.changeColor}` }}
                        >
                          {tile.data.changeText}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {hover && (
          <div
            className="wk-tm-hover"
            style={{
              left: hover.left,
              top: hover.top,
              borderColor: hover.shellBorder,
              backgroundImage: `linear-gradient(${hover.shellFill}, ${hover.shellFill})`
            }}
          >
            <span className="wk-tm-hover-name">{hover.name}</span>
            <span className="wk-tm-hover-duration">{durationTextHr(hover.minutes)}</span>
            {hover.changeText && (
              <span className="wk-tm-hover-delta" style={{ color: `#${hover.changeColor}` }}>
                {hover.changeText}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
