import { useEffect, useRef } from 'react'
import { cleanHtml } from '../lib/richText'

// A small text box with bold / italic / underline, link, bullets, numbers and alignment (as the RFI form).
// document.execCommand is old but works in every browser for exactly this; what's saved is cleaned by cleanHtml.
export default function RichTextEditor({ value, onChange, placeholder, minHeight = 140 }: { value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number }) {
  const box = useRef<HTMLDivElement>(null)
  // only set from outside when it differs from what's typed (so the cursor doesn't jump)
  useEffect(() => {
    if (box.current && box.current.innerHTML !== value) box.current.innerHTML = cleanHtml(value)
  }, [value])
  const cmd = (c: string, arg?: string) => {
    box.current?.focus()
    document.execCommand(c, false, arg)
    onChange(cleanHtml(box.current?.innerHTML ?? ''))
  }
  const btn = (label: string, title: string, run: () => void, extra = '') => (
    <button type="button" tabIndex={-1} className={'rte-btn ' + extra} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  )
  return (
    <div className="rte">
      <div className="rte-bar">
        {btn('B', 'Bold', () => cmd('bold'), 'b')}
        {btn('I', 'Italic', () => cmd('italic'), 'i')}
        {btn('U', 'Underline', () => cmd('underline'), 'u')}
        {btn('🔗', 'Link', () => {
          const url = prompt('Link address (https://…)')
          if (url && /^https?:\/\//i.test(url.trim())) cmd('createLink', url.trim())
        })}
        <span className="rte-sep" />
        {btn('• List', 'Bullets', () => cmd('insertUnorderedList'))}
        {btn('1. List', 'Numbers', () => cmd('insertOrderedList'))}
        <span className="rte-sep" />
        {btn('⇤', 'Align left', () => cmd('justifyLeft'))}
        {btn('↔', 'Centre', () => cmd('justifyCenter'))}
        {btn('⇥', 'Align right', () => cmd('justifyRight'))}
      </div>
      <div
        ref={box}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={() => onChange(cleanHtml(box.current?.innerHTML ?? ''))}
        onPaste={(e) => {
          // pasted text keeps its words, not its fonts and colours
          e.preventDefault()
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
        }}
      />
    </div>
  )
}
