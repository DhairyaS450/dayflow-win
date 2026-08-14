import { useState } from 'react'
import { api } from '../../lib/api'
import './Report.css'

// Bug report view (Windows-port adaptation of BugReportView): a simple form
// that opens a prefilled GitHub issue on the upstream repo, plus quick
// contact links and a debug-log copier.

const GITHUB_ISSUES_URL = 'https://github.com/JerryZLiu/Dayflow/issues'
const CONTACT_EMAIL = 'jerry@dayflow.so'

export default function ReportView(): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [emailCopied, setEmailCopied] = useState(false)
  const [logState, setLogState] = useState<'idle' | 'preparing' | 'copied'>('idle')

  const submit = async (): Promise<void> => {
    let version = ''
    try {
      version = await api.app.version()
    } catch {
      /* ignore */
    }
    const body =
      `${description.trim()}\n\n---\n` +
      `Reported from the Dayflow Windows port (dayflow-win)${version ? ` v${version}` : ''}.`
    const url =
      `${GITHUB_ISSUES_URL}/new?title=${encodeURIComponent(`[Windows] ${title.trim()}`)}` +
      `&body=${encodeURIComponent(body)}`
    await api.app.openExternal(url)
  }

  const copyEmail = (): void => {
    void api.timeline.copyToClipboard(CONTACT_EMAIL)
    setEmailCopied(true)
    window.setTimeout(() => setEmailCopied(false), 5000)
  }

  const copyDebugLogs = async (): Promise<void> => {
    if (logState === 'preparing') return
    setLogState('preparing')
    try {
      const [version, batches, calls] = await Promise.all([
        api.app.version().catch(() => 'unknown'),
        api.batches.recentDebug(5).catch(() => [] as unknown[]),
        api.batches.llmCallsDebug(20).catch(() => [] as unknown[])
      ])
      const log = [
        `Dayflow Windows port v${version} — debug log`,
        `Generated: ${new Date().toISOString()}`,
        '',
        '--- Recent analysis batches (5) ---',
        JSON.stringify(batches, null, 2),
        '',
        '--- Recent LLM calls (20) ---',
        JSON.stringify(calls, null, 2)
      ].join('\n')
      await api.timeline.copyToClipboard(log)
      setLogState('copied')
      window.setTimeout(() => setLogState('idle'), 5000)
    } catch {
      setLogState('idle')
    }
  }

  const canSubmit = title.trim().length > 0

  return (
    <div className="rp-root">
      <div className="rp-content">
        <h1 className="rp-heading">Thanks for using Dayflow</h1>
        <p className="rp-intro">
          Email works great if you want to drop a quick note, Discord if you want to join the
          community, and if you&apos;d prefer to chat, find some time on my calendar - I&apos;d
          love to dig into why Dayflow is or isn&apos;t working well for you.
        </p>

        <div className="rp-group">
          <span className="rp-group-label">Report a bug</span>
          <div className="rp-form">
            <input
              className="rp-title-input"
              placeholder="What went wrong?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="rp-desc-input"
              placeholder="What did you expect, and what happened instead? Steps to reproduce help a lot."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="rp-form-actions">
              <button
                className="rp-submit-btn"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                Open GitHub issue ↗
              </button>
              <span className="rp-form-note">
                Opens a prefilled issue on the upstream Dayflow repo — mention that you&apos;re on
                the Windows port.
              </span>
            </div>
          </div>
        </div>

        <div className="rp-group">
          <span className="rp-group-label">Reach out</span>
          <div className="rp-pill-row">
            <button className="rp-pill" onClick={copyEmail}>
              ✉ {emailCopied ? 'Copied!' : `Email · ${CONTACT_EMAIL}`}
            </button>
            <button
              className="rp-pill"
              onClick={() => void api.app.openExternal('https://discord.gg/9YPAtctE6k')}
            >
              Join Discord
            </button>
            <button
              className="rp-pill"
              onClick={() => void api.app.openExternal('https://cal.com/jerry-liu/15min')}
            >
              Calendar
            </button>
          </div>
        </div>

        <div className="rp-group">
          <span className="rp-group-label">Quick utilities</span>
          <div className="rp-pill-row">
            <button className="rp-pill small" onClick={() => void copyDebugLogs()}>
              {logState === 'preparing'
                ? 'Preparing...'
                : logState === 'copied'
                  ? 'Copied!'
                  : 'Copy debug logs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
