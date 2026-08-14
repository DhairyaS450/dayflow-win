import { useState } from 'react'
import {
  ROLES,
  DOWNLOAD_REASONS,
  REFERRAL_SOURCES,
  REFERRAL_OTHER,
  shuffled,
  type SurveyOption
} from './presets'

// Onboarding survey steps: role selection, download reason, referral source.

function ContinueButton(props: { disabled: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      className="ob-primary-btn ob-continue"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      Continue
    </button>
  )
}

// ---------- Step 1: Role selection ----------

export function RoleStep(props: {
  onContinue: (role: string, otherDetail: string) => void
}): React.JSX.Element {
  const [role, setRole] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')

  const resolved = role !== null && (role !== 'Other' || otherText.trim().length > 0)
  const rows = [ROLES.slice(0, 4), ROLES.slice(4)]

  return (
    <div className="ob-step ob-role-step">
      <h1 className="ob-serif-heading">Help Dayflow understand your work patterns better.</h1>
      <div className="ob-role-questions">
        <p className="ob-question">What do you do for work?</p>
        <p className="ob-question">
          This will help Dayflow generate categories that are most helpful to you.
        </p>
      </div>
      <div className="ob-chip-rows">
        {rows.map((row, i) => (
          <div key={i} className="ob-chip-row">
            {row.map((r) => (
              <button
                key={r}
                className={`ob-chip${role === r ? ' selected' : ''}`}
                onClick={() => setRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
        ))}
      </div>
      {role === 'Other' && (
        <div className="ob-other-reveal">
          <p className="ob-question">Please specify</p>
          <input
            className="ob-text-field"
            style={{ width: 353 }}
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            autoFocus
          />
        </div>
      )}
      <div className="ob-step-spacer" />
      <ContinueButton
        disabled={!resolved}
        onClick={() => props.onContinue(role ?? 'Other', otherText.trim())}
      />
    </div>
  )
}

// ---------- Step 2: Download reason ----------

export function ReasonStep(props: {
  onContinue: (reasons: string[], otherDetail: string) => void
}): React.JSX.Element {
  const [options] = useState<SurveyOption[]>(() => [
    ...shuffled(DOWNLOAD_REASONS),
    { label: 'Other', value: 'other' }
  ])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [otherText, setOtherText] = useState('')

  const toggle = (value: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
        if (value === 'other') setOtherText('')
      } else {
        next.add(value)
      }
      return next
    })
  }

  const otherSelected = selected.has('other')
  const canContinue =
    selected.size > 0 && (!otherSelected || otherText.trim().length > 0)

  return (
    <div className="ob-step ob-reason-step">
      <div className="ob-reason-content">
        <p className="ob-question">What are you hoping to get out of Dayflow?</p>
        <p className="ob-question dim">This helps personalize the experience for you.</p>
        <div className="ob-check-list">
          {options.map((opt) => {
            const isSelected = selected.has(opt.value)
            return (
              <button
                key={opt.value}
                className={`ob-check-row${isSelected ? ' selected' : ''}`}
                onClick={() => toggle(opt.value)}
              >
                <span className={`ob-check-icon${isSelected ? ' selected' : ''}`}>
                  {isSelected ? '✓' : ''}
                </span>
                <span className="ob-check-label">{opt.label}</span>
              </button>
            )
          })}
        </div>
        {otherSelected && (
          <input
            className="ob-text-field ob-other-reveal"
            placeholder="Tell me more"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            autoFocus
          />
        )}
      </div>
      <div className="ob-step-spacer" />
      <ContinueButton
        disabled={!canContinue}
        onClick={() => props.onContinue(Array.from(selected), otherText.trim())}
      />
    </div>
  )
}

// ---------- Step 3: Referral survey ----------

export function ReferralStep(props: {
  onContinue: (source: string, detail: string) => void
}): React.JSX.Element {
  const [options] = useState<SurveyOption[]>(() => [
    ...shuffled(REFERRAL_SOURCES),
    REFERRAL_OTHER
  ])
  const [selected, setSelected] = useState<SurveyOption | null>(null)
  const [detail, setDetail] = useState('')

  const requiresDetail = Boolean(selected?.detailPlaceholder)
  const canContinue =
    selected !== null && (!requiresDetail || detail.trim().length > 0)

  return (
    <div className="ob-step ob-referral-step">
      <h1 className="ob-serif-heading">One quick question</h1>
      <div className="ob-referral-body">
        <p className="ob-referral-prompt">Where did you first hear about Dayflow?</p>
        <div className="ob-radio-grid">
          {options.map((opt) => {
            const isSelected = selected?.value === opt.value
            return (
              <button
                key={opt.value}
                className={`ob-radio-row${isSelected ? ' selected' : ''}`}
                onClick={() => {
                  setSelected(opt)
                  setDetail('')
                }}
              >
                <span className={`ob-radio-icon${isSelected ? ' selected' : ''}`} />
                <span className="ob-radio-label">{opt.label}</span>
              </button>
            )
          })}
        </div>
        {requiresDetail && (
          <input
            className="ob-text-field ob-other-reveal"
            placeholder={selected?.detailPlaceholder}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            autoFocus
          />
        )}
      </div>
      <div className="ob-step-spacer" />
      <ContinueButton
        disabled={!canContinue}
        onClick={() => props.onContinue(selected?.value ?? '', detail.trim())}
      />
    </div>
  )
}
