import { useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import type { TimelineCategory } from '../../../../shared/types'
import './CategoryEditor.css'

// Category editor: two stages (details, colors) matching upstream ColorOrganizerRoot.

const SWATCH_COLORS = [
  '#B984FF', '#6AADFF', '#FF5950', '#6A7EFF',
  '#56CFEE', '#C787F7', '#FFAE8C', '#ADE3E3'
]

export default function CategoryEditor(props: { onClose: () => void }): React.JSX.Element {
  const categories = useStore((s) => s.categories)
  const [drafts, setDrafts] = useState<TimelineCategory[]>(() =>
    categories.map((c) => ({ ...c }))
  )
  const [stage, setStage] = useState<'details' | 'colors'>('details')
  const [editingId, setEditingId] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    await api.categories.save(drafts)
    await useStore.getState().loadCategories()
    props.onClose()
  }

  const update = (id: string, patch: Partial<TimelineCategory>): void => {
    setDrafts((d) => d.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const addCategory = (): void => {
    if (drafts.length >= 20) return
    const names = new Set(drafts.map((d) => d.name))
    let name = 'New category'
    let n = 2
    while (names.has(name)) name = `New category ${n++}`
    const now = new Date().toISOString()
    setDrafts((d) => [
      ...d,
      {
        id: crypto.randomUUID().toUpperCase(),
        name,
        colorHex: '#E5E7EB',
        details: '',
        order: Math.max(...d.map((c) => c.order), -1) + 1,
        isSystem: false,
        isIdle: false,
        isNew: true,
        createdAt: now,
        updatedAt: now
      }
    ])
  }

  const remove = (id: string): void => {
    setDrafts((d) => d.filter((c) => c.id !== id || c.isIdle))
  }

  return (
    <div className="ce-scrim" onClick={props.onClose}>
      <div className="ce-card" onClick={(e) => e.stopPropagation()}>
        <h1 className="ce-heading">Customize your categories</h1>
        <div className="ce-body">
          <div className="ce-instructions">
            <span className="ce-part">{stage === 'details' ? 'Part 1 of 2' : 'Part 2 of 2'}</span>
            <h2 className="ce-sub">
              {stage === 'details' ? 'Edit title and description' : 'Edit colors'}
            </h2>
            {stage === 'details' ? (
              <>
                <p className="ce-copy">
                  Dayflow organizes your activities by the category titles and descriptions you
                  provide.
                </p>
                <p className="ce-copy">
                  Try to provide as much details in the descriptions as you can to help Dayflow
                  understand your workflow and habits.
                </p>
              </>
            ) : (
              <p className="ce-copy">
                Click a swatch below, then click a category to apply the color.
              </p>
            )}
            <p className="ce-optional">
              {stage === 'details'
                ? 'This step is optional. You can customize the categories or create new ones anytime while using Dayflow.'
                : 'This step is optional. You can change the colors anytime while using Dayflow.'}
            </p>
            {stage === 'colors' && (
              <div className="ce-swatches">
                {SWATCH_COLORS.map((hex) => (
                  <button
                    key={hex}
                    className="ce-swatch"
                    style={{ background: hex }}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', hex)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="ce-list">
            {drafts.length === 0 && <p className="ce-copy">Add a category to get started.</p>}
            {drafts.map((cat) => (
              <div
                key={cat.id}
                className="ce-row"
                onDragOver={(e) => stage === 'colors' && e.preventDefault()}
                onDrop={(e) => {
                  if (stage !== 'colors') return
                  const hex = e.dataTransfer.getData('text/plain')
                  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) update(cat.id, { colorHex: hex })
                }}
              >
                {stage === 'colors' && (
                  <span className="ce-row-swatch" style={{ background: cat.colorHex }} />
                )}
                {editingId === cat.id ? (
                  <div className="ce-edit">
                    <input
                      className="ce-edit-name"
                      value={cat.name}
                      disabled={cat.isIdle}
                      onChange={(e) => update(cat.id, { name: e.target.value })}
                    />
                    <textarea
                      className="ce-edit-desc"
                      value={cat.details}
                      placeholder="Professional, school, or career-focused tasks (coding, design, meetings)."
                      onChange={(e) => update(cat.id, { details: e.target.value })}
                    />
                    <button className="ce-save-row" onClick={() => setEditingId(null)}>
                      ✓
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="ce-row-text">
                      <span className="ce-row-name">{cat.name}</span>
                      <span className="ce-row-desc">
                        {cat.details ||
                          'Add a description to help Dayflow understand your workflow.'}
                      </span>
                    </div>
                    {stage === 'details' && !cat.isSystem && (
                      <div className="ce-row-actions">
                        <button onClick={() => setEditingId(cat.id)}>✎</button>
                        <button onClick={() => remove(cat.id)}>🗑</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {stage === 'details' && (
              <button
                className="ce-add"
                disabled={drafts.length >= 20}
                onClick={addCategory}
              >
                + Create a new category
              </button>
            )}
          </div>
        </div>
        <div className="ce-footer">
          <button
            className="ce-back"
            onClick={() => (stage === 'colors' ? setStage('details') : props.onClose())}
          >
            Back
          </button>
          <button
            className="ce-next"
            onClick={() => (stage === 'details' ? setStage('colors') : void save())}
          >
            {stage === 'details' ? 'Next' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
