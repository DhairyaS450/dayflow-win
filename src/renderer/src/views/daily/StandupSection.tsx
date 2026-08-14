// Standup section — two joined bullet cards + blockers footer (spec §2.6).

import { useEffect, useRef, useState } from 'react'
import { dailyDateTitle, uid, type DailyStandupDraft, type StandupItem } from './dailyModel'
import './StandupSection.css'

interface StandupSectionProps {
  day: string
  draft: DailyStandupDraft
  onChange: (draft: DailyStandupDraft) => void
}

export default function StandupSection({
  day,
  draft,
  onChange
}: StandupSectionProps): React.JSX.Element {
  return (
    <section className="su-section">
      <h2 className="su-heading">Standup for {dailyDateTitle(day)}</h2>
      <div className="su-cards">
        <div className="su-card su-card-left">
          <div className="su-card-body">
            <h3 className="su-card-title">{draft.highlightsTitle}</h3>
            <BulletList
              items={draft.highlights}
              viewportClass="su-list-highlights"
              addPadClass="su-add-highlights"
              onChange={(items) => onChange({ ...draft, highlights: items })}
            />
          </div>
        </div>
        <div className="su-card su-card-right">
          <div className="su-card-body">
            <h3 className="su-card-title">{draft.tasksTitle}</h3>
            <BulletList
              items={draft.tasks}
              viewportClass="su-list-tasks"
              addPadClass="su-add-tasks"
              onChange={(items) => onChange({ ...draft, tasks: items })}
            />
          </div>
          <div className="su-blockers">
            <input
              className="su-blockers-title"
              value={draft.blockersTitle}
              placeholder="Blockers"
              onChange={(e) => onChange({ ...draft, blockersTitle: e.target.value })}
            />
            <div className="su-blockers-row">
              <DragHandleIcon />
              <textarea
                className="su-blockers-body"
                value={draft.blockersBody}
                placeholder="Fill in any blockers you may have"
                rows={1}
                onChange={(e) => onChange({ ...draft, blockersBody: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function DragHandleIcon(): React.JSX.Element {
  return (
    <span className="su-handle-icon" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="su-handle-dot" />
      ))}
    </span>
  )
}

interface BulletListProps {
  items: StandupItem[]
  viewportClass: string
  addPadClass: string
  onChange: (items: StandupItem[]) => void
}

function BulletList({
  items,
  viewportClass,
  addPadClass,
  onChange
}: BulletListProps): React.JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const fieldRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const viewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!focusId) return
    const el = fieldRefs.current.get(focusId)
    if (el) {
      el.focus()
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    setFocusId(null)
  }, [focusId, items])

  const insertAfter = (id: string): void => {
    const idx = items.findIndex((i) => i.id === id)
    const item: StandupItem = { id: uid(), text: '' }
    const next = [...items]
    next.splice(idx + 1, 0, item)
    onChange(next)
    setFocusId(item.id)
  }

  const removeItem = (id: string): void => {
    const idx = items.findIndex((i) => i.id === id)
    const next = items.filter((i) => i.id !== id)
    onChange(next)
    const prev = next[Math.max(0, idx - 1)]
    if (prev) setFocusId(prev.id)
  }

  const appendItem = (): void => {
    const item: StandupItem = { id: uid(), text: '' }
    onChange([...items, item])
    setFocusId(item.id)
  }

  const moveItem = (id: string, beforeId: string | null): void => {
    const from = items.findIndex((i) => i.id === id)
    if (from < 0) return
    const next = items.filter((i) => i.id !== id)
    const to = beforeId === null ? next.length : next.findIndex((i) => i.id === beforeId)
    if (to < 0) return
    next.splice(to, 0, items[from])
    onChange(next)
  }

  return (
    <div>
      <div
        className={`su-list ${viewportClass}`}
        ref={viewportRef}
        data-scroll={items.length > 5 ? 'yes' : 'no'}
        onDragOver={dragId ? (e) => e.preventDefault() : undefined}
        onDrop={
          dragId
            ? (e) => {
                e.preventDefault()
                moveItem(dragId, null)
                setDragId(null)
              }
            : undefined
        }
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="su-item"
            data-dragging={dragId === item.id ? 'yes' : 'no'}
            onDragOver={
              dragId && dragId !== item.id
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }
                : undefined
            }
            onDrop={
              dragId && dragId !== item.id
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    moveItem(dragId, item.id)
                    setDragId(null)
                  }
                : undefined
            }
          >
            <span
              className="su-handle"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', item.id)
                setDragId(item.id)
              }}
              onDragEnd={() => setDragId(null)}
            >
              <DragHandleIcon />
            </span>
            <textarea
              ref={(el) => {
                if (el) fieldRefs.current.set(item.id, el)
                else fieldRefs.current.delete(item.id)
              }}
              className="su-field"
              value={item.text}
              rows={1}
              onChange={(e) =>
                onChange(items.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  insertAfter(item.id)
                } else if (
                  e.key === 'Backspace' &&
                  !e.metaKey &&
                  !e.ctrlKey &&
                  !e.altKey &&
                  !e.shiftKey &&
                  item.text.trim().length === 0
                ) {
                  e.preventDefault()
                  removeItem(item.id)
                }
              }}
            />
          </div>
        ))}
      </div>
      <button className={`su-add ${addPadClass}`} onClick={appendItem}>
        <span className="su-add-plus">＋</span>
        <span>Add item</span>
      </button>
    </div>
  )
}
