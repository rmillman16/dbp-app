// Small pieces shared by the Minutes page, My tasks and the job's To do (22 Nov): DBP Minutes' icons, @mentions
// as chips, and its toast.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { mentionSegments } from '../lib/minutes'

const svg = (children: ReactNode, o: { fill?: boolean; sw?: number; round?: boolean } = {}) => (
  <svg
    viewBox="0 0 24 24"
    fill={o.fill ? 'currentColor' : 'none'}
    stroke={o.fill ? undefined : 'currentColor'}
    strokeWidth={o.fill ? undefined : (o.sw ?? 2)}
    strokeLinecap="round"
    strokeLinejoin={o.round === false ? undefined : 'round'}
    aria-hidden
  >
    {children}
  </svg>
)

export const Icon = {
  menu: () => svg(<path d="M4 6h16M4 12h16M4 18h16" />, { round: false }),
  save: () =>
    svg(
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>,
    ),
  download: () => svg(<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />),
  file: () =>
    svg(
      <>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M14 2v5h5" />
      </>,
    ),
  mail: () =>
    svg(
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 6l8 7 8-7" />
      </>,
    ),
  copy: () =>
    svg(
      <>
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
      </>,
    ),
  tasks: () =>
    svg(
      <>
        <path d="M9 11l3 3 8-8" />
        <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      </>,
    ),
  plus: () => svg(<path d="M12 5v14M5 12h14" />, { sw: 2.2, round: false }),
  trash: () => svg(<path d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13" />),
  pencil: () =>
    svg(
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
      </>,
    ),
  chevronRight: () => svg(<path d="M9 6l6 6-6 6" />, { sw: 2.2 }),
  chevronLeft: () => svg(<path d="M15 18l-6-6 6-6" />, { sw: 2.2 }),
  check: (sw = 2) => svg(<path d="M20 6L9 17l-5-5" />, { sw }),
  info: () =>
    svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </>,
      { round: false },
    ),
  x: (sw = 2.4) => svg(<path d="M6 6l12 12M18 6L6 18" />, { sw, round: false }),
  box: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" />
    </svg>
  ),
  dot: () => svg(<circle cx="12" cy="12" r="3.4" />, { fill: true }),
  grip: () =>
    svg(
      <>
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </>,
      { fill: true },
    ),
  warn: () => svg(<path d="M12 9v4M12 17h.01M10.3 3.9L2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />),
  carried: () =>
    svg(
      <>
        <path d="M3 12a9 9 0 1 1 3 6.7" />
        <path d="M3 16v-4h4" />
      </>,
    ),
  arrowRight: () => svg(<path d="M5 12h14M13 6l6 6-6 6" />, { sw: 2.2 }),
}

// "@AK" in the editor and lists: a chip with the person's name on hover
export function Mentions({ text, attendees }: { text: string; attendees: { name: string; initials: string }[] }) {
  return (
    <>
      {mentionSegments(text, attendees).map((s, i) =>
        s.mention ? (
          <span key={i} className="mention" title={s.mention.name}>
            @{s.mention.initials}
          </span>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}

// DBP Minutes' toast: a pill at the bottom for a few seconds
export function useToast() {
  const [toast, setToast] = useState<{ msg: string; danger: boolean; show: boolean }>({ msg: '', danger: false, show: false })
  const timer = useRef<number | undefined>(undefined)
  const showToast = useCallback((msg: string, danger = false) => {
    setToast({ msg, danger, show: true })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const element = (
    <div className={`toast${toast.show ? ' show' : ''}${toast.danger ? ' toast-danger' : ''}`} role="status" aria-live="polite">
      {toast.msg}
    </div>
  )
  return { showToast, toastElement: element }
}
