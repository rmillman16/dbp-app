import { useState } from 'react'
import { numberItems, parseScope, type ScopeKind } from '../lib/levelling'
import { escapeText } from '../lib/scopeRich'
import RichLine, { RichToolbar } from './RichLine'

// The scope of a tender package as a list (script 094): type items one at a time (Enter adds the next), add headings to group
// them, or paste a whole list. Numbered 1, 1.1, 1.2 ... as it goes out in the email, and the same items are what each contractor's
// price is levelled against afterwards. Each line can carry bold, italic, underline and colour.
export interface ScopeDraft {
  kind: ScopeKind
  description: string // plain text escaped, or the light formatting HTML from scopeRich
}

export const KIND_LABEL: Record<ScopeKind, string> = { heading: 'Heading', item: 'Item', detail: 'Detail' }
export const NEXT_KIND: Record<ScopeKind, ScopeKind> = { item: 'detail', detail: 'heading', heading: 'item' }

// Tab in a text box would move to the next field: here it indents instead (Shift+Tab takes the indent back off), so a pasted
// list can be laid out as heading / item / detail by hand.
export function indentKey(e: React.KeyboardEvent<HTMLTextAreaElement>, setValue: (v: string) => void) {
  if (e.key !== 'Tab') return
  e.preventDefault()
  const el = e.currentTarget
  const v = el.value
  const a = el.selectionStart
  const b = el.selectionEnd
  const from = v.lastIndexOf('\n', a - 1) + 1
  let next: string
  let na = a
  let nb = b
  if (!e.shiftKey && a === b) {
    next = v.slice(0, a) + '\t' + v.slice(b)
    na = nb = a + 1
  } else {
    const block = v.slice(from, b)
    const lines = block.split('\n')
    const changed = lines.map((l) => (e.shiftKey ? l.replace(/^(\t| {1,4})/, '') : '\t' + l))
    next = v.slice(0, from) + changed.join('\n') + v.slice(b)
    const delta = (i: number) => changed[i].length - lines[i].length
    na = Math.max(from, a + delta(0))
    nb = b + changed.reduce((n, _, i) => n + delta(i), 0)
  }
  setValue(next)
  requestAnimationFrame(() => el.setSelectionRange(na, nb))
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
    onChange([...items, { kind, description: escapeText(text.trim()) }])
    setText('')
  }
  return (
    <div className="scope-list">
      <RichToolbar />
      {items.length === 0 && <p className="muted small">No items yet. Add them below, one at a time, or paste a list.</p>}
      {items.map((x, i) => (
        <div key={i} className={'scope-row' + (x.kind === 'heading' ? ' scope-heading' : x.kind === 'detail' ? ' scope-detail' : '')}>
          <span className="scope-ref">{refs[i]}</span>
          <RichLine html={x.description} onChange={(h) => set(i, { description: h })} label={`Scope item ${refs[i]}`} />
          <button type="button" className="small-button" title="Click to change: heading, item (priced and levelled), detail (a point under an item)" onClick={() => set(i, { kind: NEXT_KIND[x.kind] })}>
            {KIND_LABEL[x.kind]}
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
        <button type="button" className="small-button" disabled={!text.trim()} onClick={() => add('detail')} title="A point under the item above: goes in the email, not priced separately">
          + Detail
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
          <textarea
            rows={10}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => indentKey(e, setPaste)}
            placeholder={'One line per entry. Press Tab to indent a line (Shift+Tab to take it back): lines at the left are scope items and indented lines under them are details of that item. Start a line with # (or end it with a colon) to make a heading. Add bold, colours and so on afterwards, on each line.'}
          />
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={!paste.trim()}
              onClick={() => {
                onChange([...items, ...parseScope(paste).map((x) => ({ ...x, description: escapeText(x.description) }))])
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
