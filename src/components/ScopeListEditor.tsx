import { useState } from 'react'
import { numberItems, parseScope, type ScopeKind } from '../lib/levelling'

// The scope of a tender package as a list (script 094): type items one at a time (Enter adds the next), add headings to group
// them, or paste a whole list. Numbered 1, 1.1, 1.2 ... as it goes out in the email, and the same items are what each contractor's
// price is levelled against afterwards.
export interface ScopeDraft {
  kind: ScopeKind
  description: string
}

export default function ScopeListEditor({ items, onChange }: { items: ScopeDraft[]; onChange: (items: ScopeDraft[]) => void }) {
  const [text, setText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [paste, setPaste] = useState('')
  const refs = numberItems(items)
  const set = (i: number, patch: Partial<ScopeDraft>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const l = [...items]
    ;[l[i], l[j]] = [l[j], l[i]]
    onChange(l)
  }
  const add = (kind: ScopeKind) => {
    if (!text.trim()) return
    onChange([...items, { kind, description: text.trim() }])
    setText('')
  }
  return (
    <div className="scope-list">
      {items.length === 0 && <p className="muted small">No items yet. Add them below, one at a time, or paste a list.</p>}
      {items.map((x, i) => (
        <div key={i} className={'scope-row' + (x.kind === 'heading' ? ' scope-heading' : '')}>
          <span className="scope-ref">{refs[i]}</span>
          <input value={x.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Scope item ${refs[i]}`} />
          <button type="button" className="small-button" title={x.kind === 'heading' ? 'Make it an item' : 'Make it a heading'} onClick={() => set(i, { kind: x.kind === 'heading' ? 'item' : 'heading' })}>
            {x.kind === 'heading' ? 'Heading' : 'Item'}
          </button>
          <button type="button" className="small-button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" className="small-button" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button type="button" className="small-button" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="scope-add">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a scope item and press Enter"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add('item')
            }
          }}
        />
        <button type="button" className="small-button" disabled={!text.trim()} onClick={() => add('item')}>
          + Item
        </button>
        <button type="button" className="small-button" disabled={!text.trim()} onClick={() => add('heading')}>
          + Heading
        </button>
        <button type="button" className="small-button" onClick={() => setPasting(!pasting)}>
          Paste a list
        </button>
      </div>
      {pasting && (
        <div className="scope-paste">
          <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'One item per line. Start a line with # (or end it with a colon) to make a heading.\n\n# Containment\nBasket tray to ceiling void\nTrunking to risers'} />
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={!paste.trim()}
              onClick={() => {
                onChange([...items, ...parseScope(paste)])
                setPaste('')
                setPasting(false)
              }}
            >
              Add these to the list
            </button>
            <button type="button" onClick={() => setPasting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
