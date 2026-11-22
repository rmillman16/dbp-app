import { useEffect, useRef, type ReactNode } from 'react'

// An archived job's pages (22 Nov): everything can be looked at, nothing changed. Inputs and buttons inside are
// switched off as they appear, except the ones for looking: exports / downloads / print, filters and search, and
// show / hide / open / view. The database refuses changes too (script 042), so this is about not offering them.
const LOOKING = /export|download|print|excel|pdf|show|hide|open|view|expand|collapse|zoom|today|full page|help|close|back/i

export default function ReadOnlyArea({ on, children }: { on: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!on || !root) return
    const lock = () => {
      root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input, textarea, select, button').forEach((el) => {
        if (el.dataset.roChecked) return
        el.dataset.roChecked = '1'
        const forLooking =
          !!el.closest('.toolbar, .segmented, .pills, .tabs, [data-readonly-ok]') ||
          (el instanceof HTMLInputElement && (el.type === 'search' || el.classList.contains('search'))) ||
          (el instanceof HTMLButtonElement && LOOKING.test(`${el.textContent ?? ''} ${el.title} ${el.getAttribute('aria-label') ?? ''}`))
        if (!forLooking) {
          el.disabled = true
          el.dataset.roLocked = '1'
        }
      })
    }
    lock()
    const watch = new MutationObserver(lock)
    watch.observe(root, { childList: true, subtree: true })
    return () => {
      watch.disconnect()
      root.querySelectorAll<HTMLElement>('[data-ro-checked]').forEach((el) => {
        if (el.dataset.roLocked) (el as HTMLInputElement).disabled = false
        delete el.dataset.roChecked
        delete el.dataset.roLocked
      })
    }
  }, [on])
  return (
    <div ref={ref} className={on ? 'read-only-area' : undefined}>
      {children}
    </div>
  )
}
