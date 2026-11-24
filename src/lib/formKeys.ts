// Keyboard and mouse comforts for every form in the app (24 Nov), installed once for the whole page (main.tsx):
// - clicking anywhere in a date box opens the calendar, not only its little icon (typing a date still works as before)
// - Enter on a dropdown (once you have tabbed to it) opens it, rather than doing nothing or submitting the form
// - Tab in a date box moves to the next field, rather than stopping on the day, then the month, then the year (the arrow keys
//   still move between those)
// Left alone: the outside snag page (/s/, made for phones) and the Minutes editor, which has its own keys.
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

const skip = (t: HTMLElement) => location.pathname.startsWith('/s/') || !!t.closest('.mint')

export function installFormKeys() {
  document.addEventListener('click', (e) => {
    const t = e.target
    if (t instanceof HTMLInputElement && t.type === 'date' && !t.disabled && !t.readOnly && !skip(t)) {
      // the icon at the right opens it by itself
      if (e.offsetX < t.clientWidth - 30) open(t)
    }
  })
  document.addEventListener('keydown', (e) => {
    const t = e.target
    if (!(t instanceof HTMLElement) || skip(t) || e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'Enter' && !e.shiftKey) {
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === 'date')) {
        e.preventDefault()
        open(t)
      }
    } else if (e.key === 'Tab' && t instanceof HTMLInputElement && t.type === 'date') {
      const root = t.closest<HTMLElement>('form') ?? t.closest<HTMLElement>('main') ?? document.body
      const next = step(t, root, e.shiftKey)
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
  })
}