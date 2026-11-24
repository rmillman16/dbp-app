// Keyboard and mouse comforts for the RFI forms (24 Nov), spread on a form (or any element round the fields): <form {...formKeys}>.
// - clicking anywhere in a date box opens the calendar, not only its little icon (typing a date still works as before)
// - Enter on a dropdown (once you have tabbed to it) opens it, rather than doing nothing or submitting the form
// - Tab in a date box moves to the next field, rather than stopping on the day, then the month, then the year (the arrow keys
//   still move between those)
import type { KeyboardEvent, MouseEvent } from 'react'

function open(el: HTMLInputElement | HTMLSelectElement) {
  try {
    ;(el as HTMLInputElement).showPicker?.()
  } catch {
    /* already open, or the browser won't: leave it */
  }
}

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [contenteditable="true"], a[href]'

function step(from: HTMLElement, root: HTMLElement, back: boolean) {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.tabIndex >= 0 && e.offsetParent !== null)
  const i = all.indexOf(from)
  return i < 0 ? null : (all[i + (back ? -1 : 1)] ?? null)
}

export const formKeys = {
  onClick(e: MouseEvent<HTMLElement>) {
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && t.type === 'date' && !t.disabled && !t.readOnly) {
      // the icon at the right opens it by itself
      if (e.nativeEvent.offsetX < t.clientWidth - 30) open(t)
    }
  },
  onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === 'date')) {
        e.preventDefault()
        open(t)
      }
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && t instanceof HTMLInputElement && t.type === 'date') {
      const next = step(t, e.currentTarget, e.shiftKey)
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
  },
}
