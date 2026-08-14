// Shared onboarding primitives: progress ring + feature rows.

/** Segmented onboarding progress ring (adaptation of ProgressRingView). */
export function ProgressRing(props: { total: number; filled: number }): React.JSX.Element {
  const size = 140
  const diameter = 76
  const r = diameter / 2
  const cx = size / 2
  const cy = size / 2
  const segAngle = 360 / props.total
  const gapAngle = Math.min(segAngle * 0.14, 6)
  const percent = Math.round((props.filled / props.total) * 100)

  const point = (angleDeg: number): [number, number] => {
    const rad = ((angleDeg - 90) * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }

  const arcs: React.JSX.Element[] = []
  for (let i = 0; i < props.total; i++) {
    const start = i * segAngle + gapAngle / 2
    const end = (i + 1) * segAngle - gapAngle / 2
    const [sx, sy] = point(start)
    const [ex, ey] = point(end)
    const large = end - start > 180 ? 1 : 0
    const d = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
    arcs.push(
      <path
        key={i}
        d={d}
        fill="none"
        stroke={i < props.filled ? '#FF8D40' : 'rgba(255, 200, 160, 0.3)'}
        strokeWidth={8}
        strokeLinecap="round"
      />
    )
  }

  return (
    <div className="ob-ring" aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs}
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          fill="#FF8D40"
          style={{ font: '700 16px Figtree, sans-serif' }}
        >
          {percent}%
        </text>
      </svg>
    </div>
  )
}

/** Provider-card feature row: green check for pros, red x for caveats. */
export function FeatureRow(props: { text: string; caveat?: boolean }): React.JSX.Element {
  return (
    <div className="ob-feature-row">
      <span className={`ob-feature-mark${props.caveat ? ' caveat' : ''}`}>
        {props.caveat ? '✕' : '✓'}
      </span>
      <span className="ob-feature-text">{props.text}</span>
    </div>
  )
}

/** Eye / eye-off glyph for secure fields. */
export function EyeIcon(props: { off?: boolean }): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      {props.off && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.8" />}
    </svg>
  )
}
