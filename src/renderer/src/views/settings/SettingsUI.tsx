// Settings design-system primitives (SettingsComponents port).
// "The warm paper background IS the surface. No cards on top. Hierarchy from
// typography + opacity, not borders + backgrounds."

import type { ReactNode } from 'react'

export function Section(props: {
  title: string
  subtitle?: string
  trailing?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <section className="st-section">
      <div className="st-section-header">
        <div className="st-section-titles">
          <h2 className="st-section-title">{props.title}</h2>
          {props.subtitle && <p className="st-section-subtitle">{props.subtitle}</p>}
        </div>
        {props.trailing && <div className="st-section-trailing">{props.trailing}</div>}
      </div>
      {props.children}
    </section>
  )
}

export function Row(props: {
  label: string
  subtitle?: string
  divider?: boolean
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className={`st-row${props.divider === false ? ' no-divider' : ''}`}>
      <div className="st-row-labels">
        <span className="st-row-label">{props.label}</span>
        {props.subtitle && <span className="st-row-subtitle">{props.subtitle}</span>}
      </div>
      <div className="st-row-control">{props.children}</div>
    </div>
  )
}

export function PrimaryButton(props: {
  label: string
  loading?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="st-primary-btn"
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
    >
      {props.loading && <span className="st-spinner" />}
      {props.label}
    </button>
  )
}

export function SecondaryButton(props: {
  label: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className="st-secondary-btn" disabled={props.disabled} onClick={props.onClick}>
      {props.label}
    </button>
  )
}

export function LinkButton(props: {
  label: string
  external?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className="st-link-btn" onClick={props.onClick}>
      {props.label}
      {props.external && <span className="st-link-arrow">↗</span>}
    </button>
  )
}

export type StatusDotState = 'good' | 'idle' | 'warn' | 'bad'

export function StatusDot(props: { state: StatusDotState; label: string }): React.JSX.Element {
  return (
    <span className={`st-status ${props.state}`}>
      <span className="st-status-dot" />
      {props.label}
    </span>
  )
}

export function Toggle(props: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <button
      className={`st-toggle${props.checked ? ' on' : ''}`}
      disabled={props.disabled}
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="st-toggle-knob" />
    </button>
  )
}

export function Badge(props: {
  children: ReactNode
  tone?: 'accent' | 'neutral'
}): React.JSX.Element {
  return <span className={`st-badge ${props.tone ?? 'accent'}`}>{props.children}</span>
}

export function Metadata(props: { children: ReactNode }): React.JSX.Element {
  return <span className="st-metadata">{props.children}</span>
}

export function Segmented<T extends string>(props: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="st-segmented">
      {props.options.map((opt) => (
        <button
          key={opt.value}
          className={`st-segment${props.value === opt.value ? ' selected' : ''}`}
          onClick={() => props.onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
