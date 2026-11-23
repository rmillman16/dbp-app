import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'

// A text box with the app's own suggestions list (23 Nov: "make the dropdown inbuilt into the software, not a
// Google-looking one"): replaces the browser's <datalist>. Type to filter; ↑ ↓ to move, Enter or click to pick,
// Escape to close. Anything can still be typed. Enter with nothing highlighted submits the form as normal.
export default function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  style,
  'aria-label': ariaLabel,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  className?: string
  style?: CSSProperties
  'aria-label'?: string
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const listId = useId()
  const box = useRef<HTMLInputElement>(null)
  // the list floats over the page (fixed), so a table that scrolls sideways can't clip it
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null)
  const place = () => {
    const r = box.current?.getBoundingClientRect()
    if (r) setAt({ top: r.bottom + 4, left: r.left, width: r.width })
  }
  useEffect(() => {
    if (!open) return
    place()
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase()
    const all = [...new Set(options)]
    const hits = q ? all.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q) : all
    // starts-with first, then contains
    return hits.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || a.localeCompare(b, 'en-GB')).slice(0, 12)
  }, [value, options])
  const pick = (o: string) => {
    onChange(o)
    setOpen(false)
    setHi(-1)
    box.current?.focus()
  }
  return (
    <span className={`suggest ${className ?? ''}`} style={style}>
      <input
        ref={box}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(-1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && shown.length) {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, shown.length - 1))
          } else if (e.key === 'ArrowUp' && shown.length) {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && hi >= 0 && shown[hi]) {
            e.preventDefault()
            pick(shown[hi])
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            setOpen(false)
          }
        }}
      />
      {open && shown.length > 0 && (
        <ul className="suggest-list" id={listId} role="listbox" style={at ? { top: at.top, left: at.left, minWidth: at.width } : undefined}>
          {shown.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o)
              }}
              onMouseEnter={() => setHi(i)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
