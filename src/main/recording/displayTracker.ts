import { screen, type Display } from 'electron'

// ActiveDisplayTracker port: records the display the mouse cursor is on.
// Poll every 10 s, 400 ms debounce, 10 px hysteresis inset.

const POLL_MS = 10_000
const DEBOUNCE_MS = 400
const HYSTERESIS_PX = 10

type Listener = (displayId: number) => void

export class ActiveDisplayTracker {
  activeDisplayId: number | null = null
  private candidateId: number | null = null
  private candidateSince = 0
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()

  start(): void {
    if (this.timer) return
    this.poll()
    this.timer = setInterval(() => this.poll(), POLL_MS)
    screen.on('display-added', () => this.resetAndPoll())
    screen.on('display-removed', () => this.resetAndPoll())
    screen.on('display-metrics-changed', () => this.resetAndPoll())
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private resetAndPoll(): void {
    this.candidateId = null
    this.candidateSince = 0
    this.poll()
  }

  private displayUnderCursor(): Display | null {
    try {
      const pt = screen.getCursorScreenPoint()
      const displays = screen.getAllDisplays()
      // Hysteresis: prefer a display whose bounds inset by 10px contain the cursor.
      for (const d of displays) {
        const b = d.bounds
        if (
          pt.x >= b.x + HYSTERESIS_PX &&
          pt.x < b.x + b.width - HYSTERESIS_PX &&
          pt.y >= b.y + HYSTERESIS_PX &&
          pt.y < b.y + b.height - HYSTERESIS_PX
        ) {
          return d
        }
      }
      return screen.getDisplayNearestPoint(pt)
    } catch {
      return null
    }
  }

  private poll(): void {
    const display = this.displayUnderCursor()
    if (!display) return
    const id = display.id
    const nowMs = Date.now()
    if (this.activeDisplayId === null) {
      this.activeDisplayId = id
      this.emit(id)
      return
    }
    if (id === this.activeDisplayId) {
      this.candidateId = null
      return
    }
    if (this.candidateId !== id) {
      this.candidateId = id
      this.candidateSince = nowMs
      return
    }
    if (nowMs - this.candidateSince >= DEBOUNCE_MS) {
      this.activeDisplayId = id
      this.candidateId = null
      this.emit(id)
    }
  }

  private emit(id: number): void {
    for (const fn of this.listeners) fn(id)
  }
}
