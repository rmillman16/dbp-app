import { useEffect, useState } from 'react'

// A £ amount box (23 Nov): type 1000 and it tidies to £1,000.00 when you leave the box. The value passed up is the plain
// number (or null when empty), so nothing else changes. Accepts £, commas and spaces as you type or paste.
const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const show = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '' : fmt.format(v))
export const parseMoney = (s: string): number | null => {
  const t = s.replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null
  return Number(t)
}

export default function MoneyInput({ value, onChange, placeholder, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; disabled?: boolean }) {
  const [text, setText] = useState(show(value))
  const [focused, setFocused] = useState(false)
  // follow the value when it changes from outside (not while typing)
  useEffect(() => {
    if (!focused) setText(show(value))
  }, [value, focused])
  return (
    <input
      type="text"
      inputMode="decimal"
      className="money-input"
      value={text}
      placeholder={placeholder ?? '£0.00'}
      disabled={disabled}
      onFocus={(e) => {
        setFocused(true)
        // while editing, show the bare number so it's easy to change
        setText(value == null ? '' : String(value))
        requestAnimationFrame(() => e.target.select())
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseMoney(e.target.value))
      }}
      onBlur={() => {
        setFocused(false)
        const v = parseMoney(text)
        setText(show(v))
        if (v !== value) onChange(v)
      }}
    />
  )
}
