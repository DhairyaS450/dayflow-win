import { randomUUID } from 'crypto'
import type { Distraction, TimelineMetadata } from '../../shared/types'

/** Decode timeline_cards.metadata — object form first, legacy bare-array fallback. */
export function decodeMetadata(raw: string | null): TimelineMetadata {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { distractions: normalizeDistractions(parsed) }
    }
    if (parsed && typeof parsed === 'object') {
      const meta = parsed as TimelineMetadata
      if (meta.distractions) meta.distractions = normalizeDistractions(meta.distractions)
      return meta
    }
  } catch {
    /* ignore */
  }
  return {}
}

function normalizeDistractions(arr: unknown[]): Distraction[] {
  const out: Distraction[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const d = item as Partial<Distraction>
    out.push({
      id: typeof d.id === 'string' && d.id.length > 0 ? d.id : randomUUID().toUpperCase(),
      startTime: d.startTime ?? '',
      endTime: d.endTime ?? '',
      title: d.title ?? '',
      summary: d.summary ?? '',
      videoSummaryURL: d.videoSummaryURL ?? undefined
    })
  }
  return out
}

/** Encode metadata, omitting empty fields (parity with Swift encodeIfPresent). */
export function encodeMetadata(meta: TimelineMetadata): string | null {
  const out: Record<string, unknown> = {}
  if (meta.distractions && meta.distractions.length > 0) out.distractions = meta.distractions
  if (meta.appSites && (meta.appSites.primary || meta.appSites.secondary)) out.appSites = meta.appSites
  if (meta.isBackupGenerated != null) out.isBackupGenerated = meta.isBackupGenerated
  if (meta.idle) out.idle = meta.idle
  if (Object.keys(out).length === 0) return null
  return JSON.stringify(out)
}
