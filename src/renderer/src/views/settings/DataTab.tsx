import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { formatHMMA, logicalDayString } from '../../lib/time'
import { Section, Row, PrimaryButton, SecondaryButton } from './SettingsUI'
import type { AnalysisBatchDebugEntry, LLMCallDBRecord } from '../../../../shared/types'

// Settings → Data: open data folder, reprocess a day, debug tables.

export default function DataTab(): React.JSX.Element {
  const [day, setDay] = useState(logicalDayString())
  const [confirming, setConfirming] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [progressError, setProgressError] = useState(false)

  const [batches, setBatches] = useState<AnalysisBatchDebugEntry[] | null>(null)
  const [calls, setCalls] = useState<(LLMCallDBRecord & { id?: number })[] | null>(null)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [loadingCalls, setLoadingCalls] = useState(false)

  useEffect(() => {
    const off = api.on('reprocess:progress', (msg) => {
      setProgress(String(msg))
      setProgressError(false)
    })
    return off
  }, [])

  const startReprocess = async (): Promise<void> => {
    setConfirming(false)
    setReprocessing(true)
    setProgressError(false)
    setProgress(`Starting reprocess for ${day}…`)
    try {
      await api.batches.reprocessDay(day)
      setProgress('Reprocess completed.')
    } catch (err) {
      setProgress(err instanceof Error ? err.message : String(err))
      setProgressError(true)
    } finally {
      setReprocessing(false)
    }
  }

  const loadBatches = async (): Promise<void> => {
    setLoadingBatches(true)
    try {
      setBatches((await api.batches.recentDebug(25)) as AnalysisBatchDebugEntry[])
    } finally {
      setLoadingBatches(false)
    }
  }

  const loadCalls = async (): Promise<void> => {
    setLoadingCalls(true)
    try {
      setCalls((await api.batches.llmCallsDebug(25)) as (LLMCallDBRecord & { id?: number })[])
    } finally {
      setLoadingCalls(false)
    }
  }

  return (
    <div className="st-tab">
      <Section title="Data folder" subtitle="Where Dayflow keeps its database and recordings.">
        <Row label="App data" divider={false}>
          <SecondaryButton label="Open data folder" onClick={() => void api.app.openDataFolder()} />
        </Row>
      </Section>

      <Section
        title="Reprocess day"
        subtitle="Re-run analysis for every batch on one timeline day."
      >
        <Row label="Day" subtitle={day}>
          <input
            className="st-date-input"
            type="date"
            value={day}
            disabled={reprocessing}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value)
            }}
          />
        </Row>
        <p className="st-intro-text">
          Clears existing cards and observations for that day, then runs analysis again from the
          original recordings.{' '}
          <strong>Heads up: this can consume a large number of API calls.</strong>
        </p>
        {!confirming ? (
          <div className="st-inline-actions">
            <PrimaryButton
              label={reprocessing ? 'Reprocessing…' : 'Reprocess day'}
              loading={reprocessing}
              onClick={() => setConfirming(true)}
            />
          </div>
        ) : (
          <div className="st-confirm-box">
            <p className="st-confirm-title">Reprocess day?</p>
            <p className="st-confirm-body">
              This will delete existing timeline cards for {day} and re-run analysis. It can
              consume many API calls.
            </p>
            <div className="st-inline-actions">
              <button className="st-destructive-btn" onClick={() => void startReprocess()}>
                Reprocess
              </button>
              <SecondaryButton label="Cancel" onClick={() => setConfirming(false)} />
            </div>
          </div>
        )}
        {progress && (
          <p className={`st-progress-line${progressError ? ' error' : ''}`}>{progress}</p>
        )}
      </Section>

      <Section title="Debug" subtitle="Recent analysis batches and LLM calls.">
        <div className="st-inline-actions">
          <SecondaryButton
            label={loadingBatches ? 'Loading…' : 'Load recent batches'}
            disabled={loadingBatches}
            onClick={() => void loadBatches()}
          />
          <SecondaryButton
            label={loadingCalls ? 'Loading…' : 'Load LLM calls'}
            disabled={loadingCalls}
            onClick={() => void loadCalls()}
          />
        </div>
        {batches !== null && (
          <div className="st-debug-table-wrap">
            <table className="st-debug-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Window</th>
                  <th>Created</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 && (
                  <tr>
                    <td colSpan={5}>No batches yet.</td>
                  </tr>
                )}
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td>{b.status}</td>
                    <td>
                      {formatHMMA(b.startTs)} – {formatHMMA(b.endTs)}
                    </td>
                    <td>{b.createdAt ?? '—'}</td>
                    <td className="st-debug-reason">{b.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {calls !== null && (
          <div className="st-debug-table-wrap">
            <table className="st-debug-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Provider</th>
                  <th>Operation</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>HTTP</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {calls.length === 0 && (
                  <tr>
                    <td colSpan={7}>No LLM calls yet.</td>
                  </tr>
                )}
                {calls.map((c, i) => (
                  <tr key={c.id ?? i}>
                    <td>{c.batchId ?? '—'}</td>
                    <td>{c.provider}</td>
                    <td>{c.operation}</td>
                    <td>{c.status}</td>
                    <td>{c.latencyMs != null ? `${c.latencyMs} ms` : '—'}</td>
                    <td>{c.httpStatus ?? '—'}</td>
                    <td className="st-debug-reason">{c.errorMessage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
