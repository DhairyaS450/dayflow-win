import { spawn } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { Screenshot } from '../../shared/types'

// VideoProcessingService port: composite screenshots into MP4 via ffmpeg.
// Compressed timeline: frame i shown at i/fps seconds. Frames are aspect-fit
// letterboxed onto a black canvas so mixed resolutions never distort.

function ffmpegPath(): string {
  const p = require('ffmpeg-static') as string
  // In packaged apps ffmpeg-static lives in asar.unpacked.
  return p.replace('app.asar', 'app.asar.unpacked')
}

export interface VideoOptions {
  fps?: number // default 1
  maxOutputHeight?: number | null // e.g. 720 for Gemini input
  bitrate?: number // bps, default 2_000_000
}

export async function generateVideoFromScreenshots(
  screenshots: Screenshot[],
  outputPath: string,
  options: VideoOptions = {}
): Promise<void> {
  const { fps = 1, maxOutputHeight = null, bitrate = 2_000_000 } = options
  const frames = screenshots.filter((s) => existsSync(s.filePath))
  if (frames.length === 0) throw new Error('No screenshots to composite')

  mkdirSync(dirname(outputPath), { recursive: true })
  rmSync(outputPath, { force: true })

  // concat demuxer list — each frame 1/fps seconds
  const listPath = join(tmpdir(), `dayflow_concat_${randomUUID()}.txt`)
  const dur = 1 / fps
  const lines: string[] = []
  for (const f of frames) {
    lines.push(`file '${f.filePath.replace(/'/g, "'\\''")}'`)
    lines.push(`duration ${dur}`)
  }
  // concat demuxer needs the last file repeated for the final duration to apply
  lines.push(`file '${frames[frames.length - 1].filePath.replace(/'/g, "'\\''")}'`)
  writeFileSync(listPath, lines.join('\n'), 'utf-8')

  const scaleFilter = maxOutputHeight
    ? `scale=-2:'min(${maxOutputHeight},ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:black`
    : `pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:black`

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-vf', scaleFilter,
    '-r', String(fps),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-b:v', String(Math.max(bitrate, 100_000)),
    '-g', String(Math.max(1, Math.round(fps * 10))), // keyframe every 10 s
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath
  ]

  try {
    await runFfmpeg(args)
  } finally {
    rmSync(listPath, { force: true })
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))
    })
  })
}
