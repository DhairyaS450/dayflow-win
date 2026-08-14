// Hand-rolled lightweight markdown renderer (spec §3.8) — no libraries.
// Blocks: headings, paragraphs, lists, blockquotes, fenced code, tables.
// Inline: bold, italic, code, links.

import type { ReactNode } from 'react'
import { api } from '../../lib/api'

// ---------- Inline rendering ----------

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/g

function normalizeHref(url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url
  if (/^mailto:/i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null // other schemes blocked
  if (url.includes('.') && !url.includes(' ')) return `https://${url}`
  return null
}

function openLink(url: string): void {
  const href = normalizeHref(url)
  if (href && /^https?:\/\//i.test(href)) void api.app.openExternal(href)
}

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let k = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const t = m[0]
    const key = `${keyPrefix}-${k++}`
    if (m[1]) {
      nodes.push(
        <code key={key} className="md-inline-code">
          {t.slice(1, -1)}
        </code>
      )
    } else if (m[2]) {
      nodes.push(<strong key={key}>{renderInline(t.slice(2, -2), key)}</strong>)
    } else if (m[3] || m[4]) {
      nodes.push(<em key={key}>{renderInline(t.slice(1, -1), key)}</em>)
    } else {
      const lm = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      if (lm && normalizeHref(lm[2])) {
        const href = lm[2]
        nodes.push(
          <a
            key={key}
            className="md-link"
            href="#"
            onClick={(e) => {
              e.preventDefault()
              openLink(href)
            }}
          >
            {renderInline(lm[1], key)}
          </a>
        )
      } else {
        nodes.push(t)
      }
    }
    last = m.index + t.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// ---------- Block parsing ----------

interface ListItem {
  marker: string
  indent: number
  text: string
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; header: string[]; rows: string[][] }

const UL_RE = /^(\s*)([-*+])\s+(.*)$/
const OL_RE = /^(\s*)(\d+)\.\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const FENCE_RE = /^\s*```(.*)$/
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'paragraph', lines: para })
      para = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code
    const fence = line.match(FENCE_RE)
    if (fence) {
      flushPara()
      const lang = fence[1].trim()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      i++ // skip closing fence (or EOF)
      blocks.push({ kind: 'code', lang, code: code.join('\n') })
      continue
    }

    // Blank line
    if (line.trim() === '') {
      flushPara()
      i++
      continue
    }

    // Heading
    const h = line.match(HEADING_RE)
    if (h) {
      flushPara()
      blocks.push({ kind: 'heading', level: h[1].length, text: h[2].trim() })
      i++
      continue
    }

    // Table: current line has a pipe, next line is a separator row
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      flushPara()
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    // Blockquote
    if (QUOTE_RE.test(line)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        const qm = lines[i].match(QUOTE_RE)
        quote.push(qm ? qm[1] : '')
        i++
      }
      blocks.push({ kind: 'quote', lines: quote })
      continue
    }

    // Lists (unordered + ordered grouped together; continuation lines folded in)
    if (UL_RE.test(line) || OL_RE.test(line)) {
      flushPara()
      const items: ListItem[] = []
      while (i < lines.length) {
        const ul = lines[i].match(UL_RE)
        const ol = lines[i].match(OL_RE)
        if (ul) {
          items.push({ marker: '•', indent: Math.floor(ul[1].length / 2), text: ul[3] })
          i++
        } else if (ol) {
          items.push({ marker: `${ol[2]}.`, indent: Math.floor(ol[1].length / 2), text: ol[3] })
          i++
        } else if (
          items.length > 0 &&
          lines[i].trim() !== '' &&
          /^\s{2,}/.test(lines[i]) &&
          !HEADING_RE.test(lines[i]) &&
          !FENCE_RE.test(lines[i])
        ) {
          // Continuation line with deeper indent folds into the previous item.
          items[items.length - 1].text += ` ${lines[i].trim()}`
          i++
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    // Paragraph line
    para.push(line)
    i++
  }
  flushPara()
  return blocks
}

// ---------- Component ----------

export default function Markdown(props: { text: string }): React.JSX.Element {
  const blocks = parseBlocks(props.text)
  return (
    <div className="md-root">
      {blocks.map((b, bi) => {
        const key = `b-${bi}`
        switch (b.kind) {
          case 'heading': {
            const cls = b.level <= 1 ? 'md-h1' : b.level === 2 ? 'md-h2' : 'md-h3'
            return (
              <div key={key} className={cls}>
                {renderInline(b.text, key)}
              </div>
            )
          }
          case 'paragraph':
            return (
              <p key={key} className="md-p">
                {b.lines.map((ln, li) => (
                  <span key={`${key}-${li}`}>
                    {li > 0 && <br />}
                    {renderInline(ln, `${key}-${li}`)}
                  </span>
                ))}
              </p>
            )
          case 'list':
            return (
              <div key={key} className="md-list">
                {b.items.map((it, ii) => (
                  <div
                    key={`${key}-${ii}`}
                    className="md-li"
                    style={{ paddingLeft: it.indent * 16 }}
                  >
                    <span className="md-marker">{it.marker}</span>
                    <span className="md-li-text">{renderInline(it.text, `${key}-${ii}`)}</span>
                  </div>
                ))}
              </div>
            )
          case 'quote':
            return (
              <div key={key} className="md-quote">
                {b.lines.map((ln, li) => (
                  <span key={`${key}-${li}`}>
                    {li > 0 && <br />}
                    {renderInline(ln, `${key}-${li}`)}
                  </span>
                ))}
              </div>
            )
          case 'code':
            return (
              <div key={key} className="md-code">
                {b.lang && <div className="md-lang">{b.lang}</div>}
                <pre>
                  <code>{b.code}</code>
                </pre>
              </div>
            )
          case 'table':
            return (
              <div key={key} className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {b.header.map((c, ci) => (
                        <th key={`${key}-h-${ci}`}>{renderInline(c, `${key}-h-${ci}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={`${key}-r-${ri}`}>
                        {row.map((c, ci) => (
                          <td key={`${key}-r-${ri}-${ci}`}>
                            {renderInline(c, `${key}-r-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
