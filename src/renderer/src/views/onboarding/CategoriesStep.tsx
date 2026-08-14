import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { TimelineCategory } from '../../../../shared/types'

// Step: category customization. Seeded from the role preset applied at the
// role-selection step; supports rename, description edits, add, and delete.

const MAX_CATEGORIES = 20

export default function CategoriesStep(props: {
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<TimelineCategory[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<TimelineCategory | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const cats = await api.categories.load()
      setDrafts(cats)
      setLoaded(true)
    })()
  }, [])

  const visible = drafts.filter((c) => !c.isIdle)

  const update = (id: string, patch: Partial<TimelineCategory>): void => {
    setDrafts((d) => d.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const beginEdit = (cat: TimelineCategory): void => {
    setSnapshot({ ...cat })
    setEditingId(cat.id)
    setConfirmingDeleteId(null)
  }

  const cancelEdit = (): void => {
    if (snapshot) {
      setDrafts((d) => d.map((c) => (c.id === snapshot.id ? snapshot : c)))
    }
    setEditingId(null)
    setSnapshot(null)
  }

  const saveEdit = (): void => {
    setEditingId(null)
    setSnapshot(null)
    // Drop categories whose name ended up empty
    setDrafts((d) => d.filter((c) => c.isIdle || c.name.trim().length > 0))
  }

  const remove = (id: string): void => {
    setDrafts((d) => d.filter((c) => c.id !== id))
    setEditingId(null)
    setSnapshot(null)
    setConfirmingDeleteId(null)
  }

  const addCategory = (): void => {
    if (drafts.length >= MAX_CATEGORIES) return
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const palette = ['#6A7EFF', '#56CFEE', '#C787F7', '#FFAE8C', '#B984FF', '#6AADFF']
    const cat: TimelineCategory = {
      id: crypto.randomUUID().toUpperCase(),
      name: 'New Category',
      colorHex: palette[visible.length % palette.length],
      details: '',
      order: Math.max(...drafts.map((c) => c.order), -1) + 1,
      isSystem: false,
      isIdle: false,
      isNew: true,
      createdAt: now,
      updatedAt: now
    }
    // Insert before the hidden Idle category
    setDrafts((d) => {
      const idle = d.filter((c) => c.isIdle)
      const rest = d.filter((c) => !c.isIdle)
      return [...rest, cat, ...idle]
    })
    beginEdit(cat)
  }

  const handleNext = async (): Promise<void> => {
    if (saving || visible.length === 0) return
    setSaving(true)
    try {
      const reordered = drafts
        .slice()
        .sort((a, b) => Number(a.isIdle) - Number(b.isIdle))
        .map((c, i) => ({ ...c, order: i }))
      await api.categories.save(reordered)
      props.onNext()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ob-step ob-categories-step">
      <div className="ob-categories-columns">
        <div className="ob-categories-left">
          <h2 className="ob-serif-subheading">Help Dayflow understand your workflow</h2>
          <p className="ob-categories-copy">
            Dayflow will organize your activities based on the categories you provide.
          </p>
          <p className="ob-categories-copy">
            Here are options tailored to your work to help you get started. Provide more
            personalized descriptions to help Dayflow better understand your actions.
          </p>
          <p className="ob-categories-copy">
            You can customize or create new categories any time.
          </p>
        </div>
        <div className="ob-categories-right">
          {!loaded && <p className="ob-categories-copy">Loading…</p>}
          {visible.map((cat) =>
            editingId === cat.id ? (
              <div key={cat.id} className="ob-cat-card editing">
                <span className="ob-cat-swatch" style={{ background: cat.colorHex }} />
                <div className="ob-cat-edit-fields">
                  <input
                    className="ob-cat-name-input"
                    placeholder="Category name"
                    value={cat.name}
                    onChange={(e) => update(cat.id, { name: e.target.value })}
                    autoFocus
                  />
                  <textarea
                    className="ob-cat-desc-input"
                    placeholder="Describe what belongs in this category"
                    value={cat.details}
                    onChange={(e) => update(cat.id, { details: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="ob-cat-actions">
                  <button className="ob-cat-icon-btn save" title="Save" onClick={saveEdit}>
                    ✓
                  </button>
                  <button className="ob-cat-icon-btn cancel" title="Cancel" onClick={cancelEdit}>
                    ✕
                  </button>
                </div>
              </div>
            ) : confirmingDeleteId === cat.id ? (
              <div key={cat.id} className="ob-cat-card confirm">
                <span className="ob-cat-confirm-text">
                  Delete category? “{cat.name}” will be removed from your onboarding categories.
                </span>
                <div className="ob-cat-actions">
                  <button className="ob-cat-delete-confirm" onClick={() => remove(cat.id)}>
                    Delete
                  </button>
                  <button
                    className="ob-cat-delete-cancel"
                    onClick={() => setConfirmingDeleteId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={cat.id}
                className="ob-cat-card"
                onClick={() => !cat.isSystem && beginEdit(cat)}
              >
                <span className="ob-cat-swatch" style={{ background: cat.colorHex }} />
                <div className="ob-cat-text">
                  <span className="ob-cat-name">{cat.name}</span>
                  {cat.details && <span className="ob-cat-desc">{cat.details}</span>}
                </div>
                {!cat.isSystem && (
                  <div className="ob-cat-actions">
                    <button
                      className="ob-cat-icon-btn"
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation()
                        beginEdit(cat)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="ob-cat-icon-btn"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmingDeleteId(cat.id)
                      }}
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>
            )
          )}
          {loaded && (
            <button
              className="ob-cat-add"
              disabled={drafts.length >= MAX_CATEGORIES}
              onClick={addCategory}
            >
              + Add category
            </button>
          )}
        </div>
      </div>
      <div className="ob-categories-nav">
        <button className="ob-outline-btn" onClick={props.onBack}>
          Back
        </button>
        <button
          className="ob-filled-btn"
          disabled={visible.length === 0 || saving}
          onClick={() => void handleNext()}
        >
          Next
        </button>
      </div>
    </div>
  )
}
