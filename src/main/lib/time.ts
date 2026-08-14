// Time helpers — logical day (4 AM boundary), h:mm a formatting/parsing.
// Parity with upstream StorageDateHelpers + TimeParsing.

export interface DayInfo {
  dayString: string // yyyy-MM-dd of the logical day start
  dayStart: Date // 4:00 AM local
  dayEnd: Date // +24h
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Logical day with 4 AM boundary. Timestamps before 4 AM belong to the previous date. */
export function dayInfoFor(ts: Date): DayInfo {
  const boundary = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate(), 4, 0, 0, 0)
  let dayStart: Date
  if (ts.getTime() < boundary.getTime()) {
    dayStart = new Date(boundary.getTime())
    dayStart.setDate(dayStart.getDate() - 1)
  } else {
    dayStart = boundary
  }
  const dayEnd = new Date(dayStart.getTime())
  dayEnd.setDate(dayEnd.getDate() + 1)
  return { dayString: ymd(dayStart), dayStart, dayEnd }
}

/** Window [start,end) in unix seconds for a logical day string yyyy-MM-dd. */
export function dayWindow(dayString: string): { startTs: number; endTs: number } {
  const [y, m, d] = dayString.split('-').map(Number)
  const start = new Date(y, m - 1, d, 4, 0, 0, 0)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 1)
  return { startTs: Math.floor(start.getTime() / 1000), endTs: Math.floor(end.getTime() / 1000) }
}

/** Format unix seconds as "h:mm a" local time, e.g. "3:07 PM". */
export function formatHMMA(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  let h = d.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${pad2(d.getMinutes())} ${ampm}`
}

/** Parse "h:mm a" variants → minutes since midnight (0-1439), or null. */
export function parseTimeHMMA(timeString: string): number | null {
  const m = timeString.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/)
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const minute = parseInt(m[2], 10)
  if (hour < 1 || hour > 12 || minute > 59) return null
  if (m[3] === 'PM' && hour !== 12) hour += 12
  if (m[3] === 'AM' && hour === 12) hour = 0
  return hour * 60 + minute
}

/**
 * Convert a card time string ("h:mm a") to unix seconds within a logical day.
 * Minutes < 4*60 (before 4 AM) belong to the day AFTER the logical day's date.
 */
export function cardTimeToUnix(timeString: string, dayString: string): number | null {
  const minutes = parseTimeHMMA(timeString)
  if (minutes === null) return null
  const [y, m, d] = dayString.split('-').map(Number)
  const base = new Date(y, m - 1, d, 0, 0, 0, 0)
  if (minutes < 4 * 60) base.setDate(base.getDate() + 1)
  base.setMinutes(minutes)
  return Math.floor(base.getTime() / 1000)
}

/** Screenshot filename: yyyyMMdd_HHmmssSSS */
export function screenshotFilename(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}` +
    `${String(d.getMilliseconds()).padStart(3, '0')}.jpg`
  )
}
