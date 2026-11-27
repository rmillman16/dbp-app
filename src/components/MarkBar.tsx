import type { KeyboardEvent, RefObject } from 'react'

// Bold, italic and underline for a plain text box (the tender email). The formatting is kept as light marks in the text:
// **bold**, *italic*, __underline__. Select some words and click, or press Ctrl+B / I / U: the preview shows how it will look,
// and the email that is made carries the real formatting.
const MARKS = { b: '**', i: '*', u: '__' } as const
type Mark = keyof typeof MARKS

export function applyMark(el: HTMLTextAreaElement, kind: Mark, set: (v: string) => void) {
  const m = MARKS[kind]
  const v = el.value
  const a = el.selectionStart
  const b = el.selectionEnd
  const sel = v.slice(a, b)
  let next: string
  let na: number
  let nb: number
  if (v.slice(a - m.length, a) === m && v.slice(b, b + m.length) === m && (kind !== 'i' || (v[a - 2] !== '*' && v[b + 1] !== '*'))) {
    // already wrapped: take the marks off
    next = v.slice(0, a - m.length) + sel + v.slice(b + m.length)
    na = a - m.length
    nb = b - m.length
  } else {
    next = v.slice(0, a) + m + sel + m + v.slice(b)
    na = a + m.length
    nb = b + m.length
  }
  set(next)
  el.focus()
  requestAnimationFrame(() => el.setSelectionRange(na, nb))
}

export function markKey(e: KeyboardEvent<HTMLTextAreaElement>, set: (v: string) => void) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
  const k = e.key.toLowerCase()
  if (k === 'b' || k === 'i' || k === 'u') {
    e.preventDefault()
    applyMark(e.currentTarget, k as Mark, set)
  }
}

export default function MarkBar({ box, set }: { box: RefObject<HTMLTextAreaElement | null>; set: (v: string) => void }) {
  const go = (k: Mark) => box.current && applyMark(box.current, k, set)
  const hold = (e: React.MouseEvent) => e.preventDefault() // the box keeps its selection
  return (
    <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
      <button type="button" className="small-button" title="Bold (Ctrl+B)" onMouseDown={hold} onClick={() => go('b')}>
        <b>B</b>
      </button>
      <button type="button" className="small-button" title="Italic (Ctrl+I)" onMouseDown={hold} onClick={() => go('i')}>
        <i>I</i>
      </button>
      <button type="button" className="small-button" title="Underline (Ctrl+U)" onMouseDown={hold} onClick={() => go('u')}>
        <u>U</u>
      </button>
      <span className="muted small">Select some words, then click. They show as **bold**, *italic* or __underline__ here, and as real formatting in the preview and the email.</span>
    </div>
  )
}
