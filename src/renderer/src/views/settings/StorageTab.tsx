import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Section, Row, PrimaryButton, Toggle } from './SettingsUI'

// Settings → Storage: per-type caps, usage display, purge, timelapse toggle.

const LIMIT_OPTIONS: { label: string; bytes: number | null }[] = [
  { label: '1 GB', bytes: 1_000_000_000 },
  { label: '2 GB', bytes: 2_000_000_000 },
  { label: '3 GB', bytes: 3_000_000_000 },
  { label: '5 GB', bytes: 5_000_000_000 },
  { label: '10 GB', bytes: 10_000_000_000 },
  { label: '20 GB', bytes: 20_000_000_000 },
  { label: 'Unlimited', bytes: null }
]

const DEFAULT_LIMIT = 10_000_000_000

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

function limitLabel(bytes: number | null): string {
  return LIMIT_OPTIONS.find((o) => o.bytes === bytes)?.label ?? formatBytes(bytes ?? 0)
}

function UsageRow(props: {
  label: string
  usedBytes: number
  limit: number | null
  divider?: boolean
  onLimitChange: (bytes: number | null) => void
}): React.JSX.Element {
  const percent =
    props.limit !== null && props.limit > 0
      ? Math.min(100, Math.round((props.usedBytes / props.limit) * 100))
      : null
  return (
    <>
      <Row
        label={props.label}
        subtitle={`${formatBytes(props.usedBytes)}${percent !== null ? ` · ${percent}%` : ''}`}
        divider={false}
      >
        <select
          className="st-select"
          value={props.limit === null ? 'unlimited' : String(props.limit)}
          onChange={(e) =>
            props.onLimitChange(e.target.value === 'unlimited' ? null : Number(e.target.value))
          }
        >
          {LIMIT_OPTIONS.map((o) => (
            <option key={o.label} value={o.bytes === null ? 'unlimited' : String(o.bytes)}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {percent !== null && (
        <div className="st-usage-bar">
          <div className="st-usage-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
      {props.divider !== false && <div className="st-divider" />}
    </>
  )
}

export default function StorageTab(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [usage, setUsage] = useState({ recordingsBytes: 0, timelapsesBytes: 0 })
  const [recLimit, setRecLimit] = useState<number | null>(DEFAULT_LIMIT)
  const [tlLimit, setTlLimit] = useState<number | null>(DEFAULT_LIMIT)
  const [saveTimelapses, setSaveTimelapses] = useState(false)
  const [purging, setPurging] = useState(false)

  const refreshUsage = useCallback(async (): Promise<void> => {
    try {
      setUsage(await api.storage.usage())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const [rec, tl, save] = await Promise.all([
        api.settings.get<number | null>('storageLimitRecordingsBytes', DEFAULT_LIMIT),
        api.settings.get<number | null>('storageLimitTimelapsesBytes', DEFAULT_LIMIT),
        api.settings.get<boolean>('saveAllTimelapsesToDisk', false)
      ])
      setRecLimit(rec)
      setTlLimit(tl)
      setSaveTimelapses(save)
      await refreshUsage()
      setLoaded(true)
    })()
  }, [refreshUsage])

  const changeLimit = async (
    category: 'Recordings' | 'Timelapses',
    next: number | null
  ): Promise<void> => {
    const current = category === 'Recordings' ? recLimit : tlLimit
    const lowering = next !== null && (current === null || next < current)
    if (lowering) {
      const ok = window.confirm(
        `Lower ${category} limit?\n\nReducing the ${category.toLowerCase()} limit to ${limitLabel(next)} will immediately delete the oldest ${category.toLowerCase()} data to stay under the new cap.`
      )
      if (!ok) return
    }
    if (category === 'Recordings') {
      setRecLimit(next)
      await api.settings.set('storageLimitRecordingsBytes', next)
    } else {
      setTlLimit(next)
      await api.settings.set('storageLimitTimelapsesBytes', next)
    }
    if (lowering) {
      await api.storage.purgeNow()
      await refreshUsage()
    }
  }

  const purgeNow = async (): Promise<void> => {
    setPurging(true)
    try {
      await api.storage.purgeNow()
      await refreshUsage()
    } finally {
      setPurging(false)
    }
  }

  const toggleSaveTimelapses = (v: boolean): void => {
    setSaveTimelapses(v)
    void api.settings.set('saveAllTimelapsesToDisk', v)
  }

  if (!loaded) return <div />

  return (
    <div className="st-tab">
      <Section title="Disk usage" subtitle="Open folders or adjust per-type storage caps.">
        <UsageRow
          label="Recordings"
          usedBytes={usage.recordingsBytes}
          limit={recLimit}
          onLimitChange={(b) => void changeLimit('Recordings', b)}
        />
        <UsageRow
          label="Timelapses"
          usedBytes={usage.timelapsesBytes}
          limit={tlLimit}
          divider={false}
          onLimitChange={(b) => void changeLimit('Timelapses', b)}
        />
        <div className="st-inline-actions" style={{ marginTop: 14 }}>
          <PrimaryButton
            label={purging ? 'Purging…' : 'Purge now'}
            loading={purging}
            onClick={() => void purgeNow()}
          />
        </div>
        <p className="st-footer-note">
          Recording cap: {limitLabel(recLimit)} • Timelapse cap: {limitLabel(tlLimit)}. Lowering a
          cap immediately deletes the oldest files for that type. Timeline card text stays
          preserved. Please avoid deleting files manually so you do not remove Dayflow&apos;s
          database.
        </p>
      </Section>

      <Section title="Timelapses" subtitle="Pre-generate timelapse videos for timeline cards.">
        <Row
          label="Save all timelapses to disk"
          subtitle="New and reprocessed timeline cards will pre-generate timelapse videos and store them on disk instead of building them on demand. Uses more storage and background processing."
          divider={false}
        >
          <Toggle checked={saveTimelapses} onChange={toggleSaveTimelapses} />
        </Row>
      </Section>
    </div>
  )
}
