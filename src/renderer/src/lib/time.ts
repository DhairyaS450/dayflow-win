// Renderer-side time helpers (mirror of main/lib/time.ts).

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Logical day string with 4 AM boundary. */
export function logicalDayString(date = new Date()): string {
  const d = new Date(date.getTime())
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  return ymd(d)
}

/** 4 AM start of a logical day. */
export function dayStart(dayString: string): Date {
  const [y, m, d] = dayString.split('-').map(Number)
  return new Date(y, m - 1, d, 4, 0, 0, 0)
}

export function addDays(dayString: string, delta: number): string {
  const [y, m, d] = dayString.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12, 0, 0, 0) // noon dodges DST
  date.setDate(date.getDate() + delta)
  return ymd(date)
}

export function formatHMMA(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  let h = d.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${pad2(d.getMinutes())} ${ampm}`
}

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

/** Minutes since 4 AM for a "h:mm a" string (values before 4 AM wrap +24h). */
export function minutesSince4AM(timeString: string): number | null {
  const mins = parseTimeHMMA(timeString)
  if (mins === null) return null
  const shifted = mins - 4 * 60
  return shifted < 0 ? shifted + 24 * 60 : shifted
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_SHORT = WEEKDAYS.map((w) => w.slice(0, 3))

/** "Today, Apr 16" or "Wed, Apr 16" */
export function headerDayLabel(dayString: string): string {
  const today = logicalDayString()
  const d = dayStart(dayString)
  const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
  if (dayString === today) return `Today, ${label}`
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${label}`
}

/** "Wednesday, Apr 16" (clipboard) */
export function fullDayLabel(dayString: string): string {
  const today = logicalDayString()
  const d = dayStart(dayString)
  const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
  if (dayString === today) return `Today, ${label}`
  return `${WEEKDAYS[d.getDay()]}, ${label}`
}

/** Monday (4 AM) of the week containing the logical day. */
export function weekStartOf(dayString: string): string {
  const d = dayStart(dayString)
  const dow = (d.getDay() + 6) % 7 // Monday=0
  return addDays(dayString, -dow)
}

/** "April 14 - April 20" */
export function weekLabel(weekStartDay: string): string {
  const start = dayStart(weekStartDay)
  const end = dayStart(addDays(weekStartDay, 6))
  return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${MONTHS[end.getMonth()]} ${end.getDate()}`
}

export function weekDays(weekStartDay: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartDay, i))
}

export { MONTHS, MONTHS_SHORT, WEEKDAYS, WEEKDAYS_SHORT }
