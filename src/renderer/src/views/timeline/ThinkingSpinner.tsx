import './ThinkingSpinner.css'

// 3×3 pixel-grid thinking spinner.

const PALETTES = {
  reference: ['#3D1A05', '#E07830', '#FF9F5A'],
  status: ['#435D97', '#B884BC', '#F6BE74']
} as const

export default function ThinkingSpinner(props: {
  palette?: keyof typeof PALETTES
  scale?: number
}): React.JSX.Element {
  const colors = PALETTES[props.palette ?? 'reference']
  const scale = props.scale ?? 1
  return (
    <div className="thinking-spinner" style={{ transform: `scale(${scale})` }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="thinking-dot"
          style={{ animationDelay: `${(i % 3) * 120 + Math.floor(i / 3) * 80}ms`, ['--dim' as string]: colors[0], ['--mid' as string]: colors[1], ['--hot' as string]: colors[2] }}
        />
      ))}
    </div>
  )
}
