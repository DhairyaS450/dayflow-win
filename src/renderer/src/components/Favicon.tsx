import { useState } from 'react'

// App/site favicon for timeline cards — fetched from Google's favicon service
// (upstream uses a FaviconService with bundled fallbacks).

export default function Favicon(props: {
  domain: string | null | undefined
  size: number
  radius?: number
}): React.JSX.Element | null {
  const [failed, setFailed] = useState(false)
  const domain = props.domain?.trim()
  if (!domain || failed) return null
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      width={props.size}
      height={props.size}
      style={{ borderRadius: props.radius ?? 2, flexShrink: 0 }}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}
