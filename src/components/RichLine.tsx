import { useEffect, useRef } from 'react'
import { plainOf, sanitizeRich } from '../lib/scopeRich'

// One line of a scope, with formatting (script 094): a single-line editable box that keeps bold, italic, underline and colour.
// Ctrl+B / I / U work as usual; RichToolbar does the same with buttons. Pasting keeps only that formatting.
export default function RichLine({
  html,
  onChange,
  onCommit,
  label,
  className,
}: {
  html: string
  onChange?: (html: string) => void // every edit
  onCommit?: (html: string) => void // when you leave the line, if it changed
  label?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef(html)
  useEffect(() => {
    const el = ref.current
    if (el && sanitizeRich(el.innerHTML) !== sanitizeRich(html)) el.innerHTML = sanitizeRich(html)
    if (document.activeElement !== el) start.current = html
  }, [html])
  const read = () => sanitizeRich(ref.current?.innerHTML ?? '')
  return (
    <div
      ref={ref}
      className={'rich-line' + (className ? ' ' + className : '')}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      onFocus={() => (start.current = read())}
      onInput={() => onChange?.(read())}
      onBlur={() => {
        const v = read()
        if (v !== sanitizeRich(start.current) && plainOf(v)) onCommit?.(v)
        else if (!plainOf(v) && ref.current) ref.current.innerHTML = sanitizeRich(start.current)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLElement).blur()
        }
      }}
      onPaste={(e) => {
        e.preventDefault()
        const h = e.clipboardData.getData('text/html')
        const clean = h ? sanitizeRich(h) : ''
        const text = e.clipboardData.getData('text/plain').replace(/\s+/g, ' ')
        document.execCommand('insertHTML', false, clean || text.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
      }}
      dangerouslySetInnerHTML={{ __html: sanitizeRich(html) }}
    />
  )
}

const COLOURS: [string, string][] = [
  ['#dc2626', 'Red'],
  ['#ea580c', 'Orange'],
  ['#16a34a', 'Green'],
  ['#2563eb', 'Blue'],
  ['#7c3aed', 'Purple'],
]

// B / I / U and colours for whichever scope line the cursor is in. The mouse-down is cancelled so the line keeps its selection.
export function RichToolbar() {
  const cmd = (name: string, value?: string) => {
    if (!(document.activeElement as HTMLElement | null)?.classList.contains('rich-line')) return
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(name, false, value)
  }
  const hold = (e: React.MouseEvent) => e.preventDefault()
  return (
    <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
      <button type="button" className="small-button" title="Bold (Ctrl+B)" onMouseDown={hold} onClick={() => cmd('bold')}>
        <b>B</b>
      </button>
      <button type="button" className="small-button" title="Italic (Ctrl+I)" onMouseDown={hold} onClick={() => cmd('italic')}>
        <i>I</i>
      </button>
      <button type="button" className="small-button" title="Underline (Ctrl+U)" onMouseDown={hold} onClick={() => cmd('underline')}>
        <u>U</u>
      </button>
      {COLOURS.map(([c, n]) => (
        <button key={c} type="button" className="small-button rich-swatch" title={n} aria-label={n} style={{ background: c }} onMouseDown={hold} onClick={() => cmd('foreColor', c)} />
      ))}
      <button type="button" className="small-button" title="Clear the colour" onMouseDown={hold} onClick={() => cmd('foreColor', '#000000')}>
        Clear colour
      </button>
      <span className="muted small">Select some text in a line, then click.</span>
    </div>
  )
}
