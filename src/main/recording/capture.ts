import { desktopCapturer, screen, powerMonitor, nativeImage } from 'electron'
import { writeFileSync } from 'fs'

// One-shot screenshot of a display, scaled to target height 1080 (even dims),
// JPEG quality 85. Returns the written file path or null.

const TARGET_HEIGHT = 1080
const JPEG_QUALITY = 85

export interface CaptureResult {
  filePath: string
  idleSeconds: number | null
}

function evenDims(width: number, height: number): { width: number; height: number } {
  let w = Math.round(width)
  let h = Math.round(height)
  if (w % 2 !== 0) w += 1
  if (h % 2 !== 0) h += 1
  return { width: w, height: h }
}

export async function captureDisplayToFile(
  displayId: number | null,
  filePath: string
): Promise<CaptureResult | null> {
  const displays = screen.getAllDisplays()
  const display = displays.find((d) => d.id === displayId) ?? displays[0]
  if (!display) return null

  const aspect = display.bounds.width / display.bounds.height
  const { width, height } = evenDims(TARGET_HEIGHT * aspect, TARGET_HEIGHT)

  let idleSeconds: number | null = null
  try {
    idleSeconds = Math.floor(powerMonitor.getSystemIdleTime())
    if (!Number.isFinite(idleSeconds) || idleSeconds < 0) idleSeconds = null
  } catch {
    idleSeconds = null
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  // Match source to display via display_id; fall back to first source.
  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return null

  const jpeg = source.thumbnail.toJPEG(JPEG_QUALITY)
  writeFileSync(filePath, jpeg)
  return { filePath, idleSeconds }
}

/** Privacy placeholder frame: near-black background with explanatory text. */
export function createPlaceholderJPEG(
  width: number,
  height: number,
  appName: string
): Buffer {
  // Simple SVG-rendered placeholder via nativeImage (no canvas dependency in main).
  const title = `${appName || 'Private app'} hidden by your privacy settings`
  const subtitle =
    "This screenshot was saved without the app's contents because you blocked it from recording."
  const titleSize = Math.min(width, height) * 0.035
  const subSize = Math.min(width, height) * 0.018
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#141414"/>
  <text x="50%" y="${height / 2 - 18}" font-family="Segoe UI, sans-serif" font-weight="600"
    font-size="${titleSize}" fill="rgba(255,255,255,0.82)" text-anchor="middle">${escapeXml(title)}</text>
  <text x="50%" y="${height / 2 + 26}" font-family="Segoe UI, sans-serif"
    font-size="${subSize}" fill="rgba(255,255,255,0.82)" text-anchor="middle">${escapeXml(subtitle)}</text>
</svg>`
  const img = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
  return img.toJPEG(JPEG_QUALITY)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
