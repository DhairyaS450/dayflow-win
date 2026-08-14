// Squarified treemap layout — port of the macOS Weekly treemap algorithm (spec §2.10).

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SquarifyInput<T> {
  data: T
  value: number
  name: string
}

export interface SquarifyPlaced<T> {
  data: T
  rect: Rect
}

function worstAspect(areas: number[], start: number, end: number, shortSide: number): number {
  let rowArea = 0
  for (let i = start; i < end; i++) rowArea += areas[i]
  const strip = rowArea / shortSide
  if (strip <= 0) return Infinity
  let worst = 0
  for (let i = start; i < end; i++) {
    const span = areas[i] / strip
    const aspect = span <= 0 ? Infinity : Math.max(strip / span, span / strip)
    worst = Math.max(worst, aspect)
  }
  return worst
}

/**
 * Squarified layout: drops non-positive values, sorts value desc → name asc,
 * lays greedy rows along the short side, then insets each frame by gap/2.
 */
export function squarifyLayout<T>(
  items: SquarifyInput<T>[],
  rect: Rect,
  gap: number
): SquarifyPlaced<T>[] {
  const positive = items.filter((i) => i.value > 0)
  positive.sort(
    (a, b) =>
      b.value - a.value || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
  const totalValue = positive.reduce((s, i) => s + i.value, 0)
  const totalArea = rect.w * rect.h
  if (positive.length === 0 || totalValue <= 0 || totalArea <= 0) return []

  const areas = positive.map((i) => (i.value / totalValue) * totalArea)
  const frames: Rect[] = new Array(positive.length)
  let avail: Rect = { ...rect }
  let start = 0
  while (start < positive.length) {
    const shortSide = Math.max(1e-6, Math.min(avail.w, avail.h))
    let end = start + 1
    let currentWorst = worstAspect(areas, start, end, shortSide)
    while (end < positive.length) {
      const next = worstAspect(areas, start, end + 1, shortSide)
      if (next > currentWorst) break
      currentWorst = next
      end++
    }
    let rowArea = 0
    for (let i = start; i < end; i++) rowArea += areas[i]
    const strip = rowArea / shortSide
    if (avail.w >= avail.h) {
      // vertical strip at left, children stacked top → bottom
      let y = avail.y
      for (let i = start; i < end; i++) {
        const span = areas[i] / strip
        frames[i] = { x: avail.x, y, w: strip, h: span }
        y += span
      }
      avail = { x: avail.x + strip, y: avail.y, w: avail.w - strip, h: avail.h }
    } else {
      // horizontal strip at top, children left → right
      let x = avail.x
      for (let i = start; i < end; i++) {
        const span = areas[i] / strip
        frames[i] = { x, y: avail.y, w: span, h: strip }
        x += span
      }
      avail = { x: avail.x, y: avail.y + strip, w: avail.w, h: avail.h - strip }
    }
    start = end
  }

  const out: SquarifyPlaced<T>[] = []
  const inset = gap / 2
  for (let i = 0; i < positive.length; i++) {
    const f = frames[i]
    const r: Rect = { x: f.x + inset, y: f.y + inset, w: f.w - gap, h: f.h - gap }
    if (r.w > 0.5 && r.h > 0.5) out.push({ data: positive[i].data, rect: r })
  }
  return out
}
