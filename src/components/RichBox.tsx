import { useEffect, useRef } from 'react'
import { plainOf, sanitizeRich } from '../lib/scopeRich'

// The detail lines under one scope item, in one box: a line each (Enter starts the next), with bold, italic, underline and
// colour as in RichLine. Each line is stored as its own detail row, numbered (a), (b)... in the email, but they are not
// separate scope items and are not levelled.
export function linesOf(html: string): string[] {
  const h = html.replace(/<\/div>\s*<div[^>]*>/gi, '<br>').replace(/<\/?div[^>]*>/gi, '<br>').replace(/<\/?p[^>]*>/gi, '<br>')
  return h
    .split(/<br\s*\/?>/i)
    .map((l) => sanitizeRich(l))
    .filter((l) => plainOf(l).trim())
}
const joinLines = (lines: string[]) => lines.map((l) => sanitizeRich(l)).join('<br>')

export default function RichBox({
  lines,
  onChange,
  onCommit,
  label,
  placeholder,
}: {
  lines: string[]
  onChange?: (lines: string[]) => void // every edit
  onCommit?: (lines: string[]) => void // when you leave the box, if it changed
  label?: string
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef(JSON.stringify(lines))
  useEffect(() => {
    const el = ref.current
    if (el && JSON.stringify(linesOf(el.innerHTML)) !== JSON.stringify(lines.map((l) => sanitizeRich(l)))) el.innerHTML = joinLines(lines)
    if (document.activeElement !== el) start.current = JSON.stringify(lines)
  }, [lines])
  const read = () => linesOf(ref.current?.innerHTML ?? '')
  return (
    <div
      ref={ref}
      className="rich-line rich-box"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-placeholder={placeholder}
      onFocus={() => (start.current = JSON.stringify(read()))}
      onInput={() => onChange?.(read())}
      onBlur={() => {
        const v = read()
        if (JSON.stringify(v) !== start.current) onCommit?.(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          document.execCommand('insertLineBreak')
        }
      }}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        if (/\r?\n/.test(text.trim())) {
          // a block of lines: one detail each, with any leading (a) / - / bullet taken off
          const rows = text.split(/\r?\n/).map((l) => l.trim().replace(/^(\(?[a-z0-9]{1,2}[.)]\s+|[-•*]\s+)/i, '')).filter(Boolean)
          document.execCommand('insertHTML', false, rows.map(esc).join('<br>'))
        } else {
          const h = e.clipboardData.getData('text/html')
          document.execCommand('insertHTML', false, (h && sanitizeRich(h)) || esc(text.replace(/\s+/g, ' ')))
        }
      }}
      dangerouslySetInnerHTML={{ __html: joinLines(lines) }}
    />
  )
}
