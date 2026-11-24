// Meeting minutes (22 Nov, scripts 045 / 046): DBP Minutes (dbp-mint.firebaseapp.com) copied into the app, same
// layout, look, wording and keyboard shortcuts. Minutes live in their project (23 Nov): a job's Minutes tab
// (/jobs/:id/minutes) or an estimate's (/estimating/e/:id/minutes, tender meetings, moved to the job when it's won).
// The job's or estimate's number, code and name are the project name. Full width, with a Full page button.
// Typing: Enter saves a point and starts the next; Shift+Enter a new line; Escape undoes the edit. "# " makes a
// heading, "! " urgent, "£ " a cost impact (in the app only). @ mentions an attendee (Enter / Tab picks the first
// match). On a point's ⋮⋮ handle, drag or use the up / down arrow keys to reorder.
// Actions with an owner feed the job's To do; a staff owner also gets it on their bell and in My tasks (045).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import '../minutes.css'
import { supabase } from '../lib/supabase'
import { cached, must } from '../lib/offline'
import { nudgeEmails } from '../lib/notifications'
import type { Enquiry } from '../lib/types'
import * as M from '../lib/minutes'
import { exportMinutesDocx, exportMinutesPdf } from '../lib/exportMinutes'
import { enquiryRef } from '../lib/quotations'
import { Icon, Mentions, useToast } from '../components/MinutesBits'
import MinutesEmail from '../components/MinutesEmail'
import { useJob } from './JobLayout'
import { loadEnquiry } from './Estimating'
import EnquiryHead from '../components/EnquiryHead'

interface StaffProfile {
  id: string
  full_name: string | null
  email: string | null
  initials: string | null
}
interface MentionState {
  pointId: string
  start: number
  end: number
  candidates: M.Attendee[]
  left: number
  top: number
}
type SaveState = { state: '' | 'saved' | 'saving' | 'error' | 'readonly'; text: string }

const MAILTO_BODY_LIMIT = 1500

// a job's Minutes tab
export function MinutesTab() {
  const { job } = useJob()
  const owner = useMemo<M.MinutesOwner>(() => ({ jobId: job.id, enquiryId: null, label: `${job.job_no} ${job.code} · ${job.name}` }), [job.id, job.job_no, job.code, job.name])
  return <MinutesApp owner={owner} readOnly={job.status === 'archived'} hubUrl={job.hub_url ?? null} />
}

// an estimate's minutes (tender meetings): Estimating › enquiry › Minutes
export function MinutesEnquiry() {
  const { enquiryId } = useParams()
  const [e, setE] = useState<Enquiry | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadEnquiry(enquiryId!).then(setE, (err: Error) => setError(err.message))
  }, [enquiryId])
  const owner = useMemo<M.MinutesOwner | null>(() => (e ? { jobId: null, enquiryId: e.id, label: `${enquiryRef(e)} · ${e.name}` } : null), [e])
  if (error) return <p className="error">{error}</p>
  if (!e || !owner) return <p className="muted">Loading…</p>
  return (
    <>
      <EnquiryHead e={e} />
      {e.job_id && (
        <p className="muted">
          This enquiry was won; its meetings are now in the job's Minutes tab. <Link to={`/jobs/${e.job_id}/minutes`}>Open them →</Link>
        </p>
      )}
      {!e.job_id && <MinutesApp owner={owner} readOnly={false} hubUrl={null} />}
    </>
  )
}

// a staff login's @initials: theirs if set and free, else worked out from the name
function staffInitials(p: StaffProfile, name: string, existing: M.Attendee[]) {
  const own = (p.initials ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return own && !existing.some((a) => a.initials === own) ? own : M.computeInitials(name, existing)
}
// "Name, Company, email@x.com" (any order after the name; the email is the bit with an @)
function parseAttendeeInput(v: string) {
  const parts = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const email = parts.find((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) ?? null
  const rest = parts.filter((s) => s !== email)
  return { name: rest[0] ?? (email ? email.split('@')[0] : ''), company: rest[1] ?? null, email }
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.max(35, el.scrollHeight) + 'px'
}

function MinutesApp({ owner, readOnly, hubUrl }: { owner: M.MinutesOwner; readOnly: boolean; hubUrl: string | null }) {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const ownerKey = owner.jobId ?? owner.enquiryId
  const base = M.minutesBase(owner)

  // the open meeting is edited in place (as DBP Minutes did) and the page redrawn after each change
  const activeRef = useRef<M.Meeting | null>(null)
  const [, setTick] = useState(0)
  const rerender = () => setTick((t) => t + 1)
  const active = activeRef.current

  const [list, setList] = useState<M.MeetingSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingPointId, setEditingState] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const setEditing = (id: string | null) => {
    editingRef.current = id
    setEditingState(id)
  }
  const [updatingPointId, setUpdatingPointId] = useState<string | null>(null)
  const [mention, setMentionState] = useState<MentionState | null>(null)
  const mentionRef = useRef<MentionState | null>(null)
  const setMention = (m: MentionState | null) => {
    mentionRef.current = m
    setMentionState(m)
  }
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SaveState>({ state: '', text: 'Ready' })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerOpenRef = useRef(false)
  drawerOpenRef.current = drawerOpen
  const [menu, setMenu] = useState<'export' | 'email' | null>(null)
  const [emailing, setEmailing] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [profiles, setProfiles] = useState<StaffProfile[]>([])
  const [attInput, setAttInput] = useState('')
  const [attPick, setAttPick] = useState(-1)
  const [presentToggle, setPresentToggle] = useState(true)
  const { showToast, toastElement } = useToast()

  // saving
  const savedRef = useRef(new Map<string, M.SavedState>())
  const pendingRef = useRef(new Map<string, M.Meeting>()) // waiting for a connection
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const retryTimer = useRef<number | undefined>(undefined)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const freshIdRef = useRef<string | null>(null) // a new meeting not yet in the address
  const mounted = useRef(true)
  const meetingIdRef = useRef(meetingId)
  meetingIdRef.current = meetingId
  const baseRef = useRef(base)
  baseRef.current = base

  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const pointsListRef = useRef<HTMLDivElement>(null)
  const editTaRef = useRef<HTMLTextAreaElement | null>(null)
  const exportWrapRef = useRef<HTMLDivElement>(null)
  const emailWrapRef = useRef<HTMLDivElement>(null)

  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  // ---------- loading ----------
  useEffect(() => {
    mounted.current = true
    let gone = false
    setList(null)
    M.loadMeetingList(owner).then(
      (l) => !gone && setList(l),
      (e: Error) => {
        if (gone) return
        setLoadError(e.message)
        setList([])
      },
    )
    cached('minutes:profiles', () => must<StaffProfile[]>(supabase.from('profiles').select('id,full_name,email,initials').order('full_name'))).then(
      (p) => !gone && setProfiles(p),
      () => {},
    )
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  // the meeting in the address; with none, the most recent one (or a fresh page if there are none)
  useEffect(() => {
    const cur = activeRef.current
    if (meetingId) {
      if (cur && cur.id === meetingId) return
      flushSave()
      let gone = false
      ;(async () => {
        const [remote, draft] = await Promise.all([
          M.loadMeeting(meetingId).catch((e: Error) => {
            setLoadError(e.message)
            return null
          }),
          M.getDraft(meetingId),
        ])
        if (gone || !mounted.current) return
        const useDraft = !!draft && (!remote || draft.updatedAt > remote.updatedAt)
        const m = useDraft ? draft! : remote
        if (!m) {
          showToast('That meeting couldn’t be found. It may have been deleted.', true)
          navigate(base, { replace: true })
          return
        }
        // a meeting of another job / estimate (e.g. an estimate's, since moved to the job): open it there
        if ((m.jobId ?? null) !== owner.jobId || (m.enquiryId ?? null) !== owner.enquiryId) {
          if (m.jobId || m.enquiryId) navigate(M.meetingPath(m), { replace: true })
          else navigate(base, { replace: true })
          return
        }
        savedRef.current.set(m.id, remote ? M.savedStateOf(remote) : M.emptySaved())
        // the project name is the job's / estimate's, kept up to date
        m.project = owner.label
        openMeeting(m)
        if (useDraft && !readOnlyRef.current) scheduleSave() // changes made on this device that never reached the database
      })()
      return () => {
        gone = true
      }
    }
    if (cur && cur.id === freshIdRef.current && cur.jobId === owner.jobId && cur.enquiryId === owner.enquiryId) return
    if (!list) return
    const recent = list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (recent) navigate(`${base}/${recent.id}`, { replace: true })
    else {
      const m = M.newMeeting(owner)
      freshIdRef.current = m.id
      openMeeting(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, list === null])

  function openMeeting(m: M.Meeting) {
    activeRef.current = m
    setEditing(null)
    setUpdatingPointId(null)
    setMention(null)
    setConfirmDel(null)
    rerender()
  }

  // ---------- saving ----------
  function summaryOf(m: M.Meeting): M.MeetingSummary {
    return { id: m.id, jobId: m.jobId, enquiryId: m.enquiryId, project: m.project, subtitle: m.subtitle, date: m.date, updatedAt: m.updatedAt, attendees: m.attendees }
  }
  function scheduleSave() {
    const target = activeRef.current
    if (!target || readOnlyRef.current) return
    target.updatedAt = Date.now()
    dirtyRef.current = true
    M.saveDraft(target)
    setStatus({ state: 'saving', text: 'Saving…' })
    // captures this meeting now, not whichever is open 1.2 s from now
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveNow(target), 1200)
  }
  // before moving to another meeting (or away): the pending save goes now
  function flushSave() {
    if (!dirtyRef.current) return
    window.clearTimeout(saveTimer.current)
    saveNow(activeRef.current)
  }
  function manualSave() {
    if (!activeRef.current || readOnlyRef.current) return
    activeRef.current.updatedAt = Date.now()
    window.clearTimeout(saveTimer.current)
    saveNow(activeRef.current)
  }
  function saveNow(target: M.Meeting | null) {
    if (!target) return
    chain.current = chain.current.then(() => doSave(target)).catch(() => {})
  }
  async function doSave(target: M.Meeting) {
    const isActive = () => target === activeRef.current
    if (M.isMeetingEmpty(target)) {
      if (isActive()) {
        dirtyRef.current = false
        setStatus({ state: 'saved', text: 'Saved' })
      }
      return
    }
    if (!navigator.onLine) {
      // kept on the device (saveDraft) and sent when the connection returns
      pendingRef.current.set(target.id, target)
      if (isActive()) {
        dirtyRef.current = false
        setStatus({ state: 'readonly', text: 'Offline — saved on this device, will sync' })
      }
      return
    }
    if (isActive()) setStatus({ state: 'saving', text: 'Saving…' })
    const startedAt = target.updatedAt
    try {
      const { saved, actionsChanged } = await M.saveMeeting(target, savedRef.current.get(target.id) ?? M.emptySaved())
      savedRef.current.set(target.id, saved)
      pendingRef.current.delete(target.id)
      if (target.updatedAt === startedAt) {
        M.clearDraft(target.id)
        if (isActive()) dirtyRef.current = false
      }
      if (actionsChanged) nudgeEmails()
      if (!mounted.current) return
      setList((l) => [...(l ?? []).filter((x) => x.id !== target.id), summaryOf(target)])
      if (isActive()) {
        setStatus(dirtyRef.current ? { state: 'saving', text: 'Saving…' } : { state: 'saved', text: 'Saved' })
        // a new meeting's first save: it gets its own address
        if (meetingIdRef.current !== target.id && (!target.jobId || baseRef.current.includes(target.jobId) || baseRef.current === '/minutes'))
          navigate(`${baseRef.current}/${target.id}`, { replace: true })
      }
    } catch (e) {
      console.error('Minutes save failed', e)
      if (isActive()) dirtyRef.current = true
      const msg = (e as Error).message
      if (mounted.current && isActive()) setStatus({ state: 'error', text: /script 045/.test(msg) ? msg : 'Couldn’t sync — will retry' })
      window.clearTimeout(retryTimer.current)
      retryTimer.current = window.setTimeout(() => saveNow(target), 15000)
    }
  }

  // warn before leaving with an edit not yet saved; send it when the tab is hidden or the connection returns
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    const onHide = () => document.visibilityState === 'hidden' && flushSave()
    const onOnline = () => {
      pendingRef.current.forEach((m) => saveNow(m))
      flushSave()
      setStatus(dirtyRef.current || pendingRef.current.size ? { state: 'saving', text: 'Saving…' } : { state: 'saved', text: 'Saved' })
    }
    const onOffline = () => setStatus({ state: 'readonly', text: 'Offline — saved on this device, will sync' })
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // leaving the page (another tab or area): the pending save still goes
  useEffect(
    () => () => {
      mounted.current = false
      flushSave()
      window.clearTimeout(retryTimer.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // clicks outside close the menus and the @ list
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!exportWrapRef.current?.contains(t) && !emailWrapRef.current?.contains(t)) setMenu(null)
      if (mentionRef.current && !t.closest('.mention-dropdown') && !t.closest('.point-edit-area')) setMention(null)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // ---------- meetings: new, next, delete ----------
  function startNewMeeting() {
    flushSave()
    const m = M.newMeeting(owner)
    freshIdRef.current = m.id
    openMeeting(m)
    if (meetingId) navigate(base)
    setDrawerOpen(false)
    requestAnimationFrame(() => subtitleInputRef.current?.focus())
  }

  function startNextMeeting() {
    const source = activeRef.current
    if (!source || readOnly) return
    flushSave()
    const carrying = M.countOpenActions(source)
    const next = M.buildNextMeeting(source) // marks the carried points on the source
    if (carrying) {
      // the carried flags on the meeting we've just left
      source.updatedAt = Date.now()
      saveNow(source)
    }
    freshIdRef.current = next.id
    openMeeting(next)
    if (meetingId) navigate(base)
    scheduleSave()
    setDrawerOpen(false)
    requestAnimationFrame(() => subtitleInputRef.current?.focus())
  }

  function confirmDeleteMeeting(id: string) {
    const wasActive = activeRef.current?.id === id
    if (wasActive) {
      window.clearTimeout(saveTimer.current)
      dirtyRef.current = false
    }
    pendingRef.current.delete(id)
    chain.current = chain.current.then(() => M.deleteMeeting(id)).catch((e: Error) => showToast(e.message, true))
    const remaining = (list ?? []).filter((m) => m.id !== id)
    setList(remaining)
    setConfirmDel(null)
    if (wasActive) {
      const next = remaining.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
      activeRef.current = null
      if (next) navigate(`${base}/${next.id}`)
      else {
        const m = M.newMeeting(owner)
        freshIdRef.current = m.id
        openMeeting(m)
        if (meetingId) navigate(base)
      }
    }
  }

  // ---------- sidebar: this job's / estimate's meetings, most recent first ----------
  function sidebarMeetings(): M.MeetingSummary[] {
    const cur = activeRef.current
    const l = (list ?? []).filter((m) => !cur || m.id !== cur.id)
    if (cur && !M.isMeetingEmpty(cur)) l.push(summaryOf(cur))
    return l.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  function openFromList(id: string) {
    setDrawerOpen(false)
    if (activeRef.current?.id === id) return
    navigate(`${base}/${id}`)
  }

  function renderMeetingItem(m: M.MeetingSummary) {
    const avatars = m.attendees.slice(0, 4)
    const more = m.attendees.length > 4 ? m.attendees.length - 4 : 0
    return (
      <div
        key={m.id}
        role="button"
        tabIndex={0}
        className={'meeting-item' + (active && active.id === m.id ? ' active' : '')}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-del]')) return
          openFromList(m.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) openFromList(m.id)
        }}
      >
        <div className="mi-top">
          <span className="mi-project">{m.subtitle || 'Meeting'}</span>
          <span className="mi-date">{M.formatDateSidebar(m.date)}</span>
        </div>
        <div className="mi-bottom">
          <div className="mi-avatars">
            {avatars.map((a) => (
              <span key={a.id} className="avatar" title={a.name}>
                {a.initials}
              </span>
            ))}
            {more > 0 && (
              <span className="avatar" style={{ background: 'var(--ink-faint)' }}>
                +{more}
              </span>
            )}
          </div>
          <div className="mi-right">
            {!readOnly &&
              (confirmDel === m.id ? (
                <span className="mi-confirm" data-del>
                  Delete?{' '}
                  <button
                    className="btn btn-small btn-danger"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmDeleteMeeting(m.id)
                    }}
                  >
                    Yes
                  </button>
                  <button
                    className="btn btn-small"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDel(null)
                    }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span
                  className="mi-delete"
                  data-del
                  role="button"
                  aria-label="Delete meeting"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDel(m.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      setConfirmDel(m.id)
                    }
                  }}
                >
                  <Icon.trash />
                </span>
              ))}
          </div>
        </div>
      </div>
    )
  }

  function renderSidebar() {
    if (list === null) return <div className="meeting-empty">Loading…</div>
    const all = sidebarMeetings()
    const q = query.trim().toLowerCase()
    if (q) {
      const filtered = all.filter((m) => [m.subtitle, ...m.attendees.map((a) => a.name)].join(' ').toLowerCase().includes(q))
      if (!filtered.length) return <div className="meeting-empty">No meetings match “{q}”.</div>
      return filtered.map(renderMeetingItem)
    }
    if (!all.length)
      return (
        <div className="meeting-empty">
          No saved meetings yet.
          <br />
          Start typing in the note to create your first one.
        </div>
      )
    return all.map(renderMeetingItem)
  }

  // ---------- full page: over the app's sidebar and top bar (not the browser's own full screen) ----------
  useEffect(() => {
    if (!full) return
    document.body.classList.add('no-scroll')
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement
      // Escape in a field (undo an edit, close the @ list) or with a menu open does that first
      if (t.closest('textarea, input, select') || mentionRef.current || drawerOpenRef.current) return
      setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('no-scroll')
      window.removeEventListener('keydown', onKey)
    }
  }, [full])

  // ---------- attendees ----------
  const attQuery = attInput.trim().toLowerCase()
  const suggestions =
    active && attQuery && !attQuery.includes(',')
      ? profiles
          .filter((p) => !active.attendees.some((a) => a.profileId === p.id))
          .filter(
            (p) =>
              (p.full_name ?? '')
                .toLowerCase()
                .split(/\s+/)
                .some((w) => w.startsWith(attQuery)) ||
              (p.full_name ?? '').toLowerCase().startsWith(attQuery) ||
              (p.email ?? '').toLowerCase().startsWith(attQuery),
          )
          .slice(0, 6)
      : []
  function previewInitials() {
    if (!active || !attInput.trim()) return ''
    const pick = attPick >= 0 ? suggestions[attPick] : undefined
    if (pick) return 'will be @' + staffInitials(pick, pick.full_name || pick.email || '', active.attendees)
    const { name } = parseAttendeeInput(attInput)
    return name ? 'will be @' + M.computeInitials(name, active.attendees) : ''
  }
  function addAttendee(profile?: StaffProfile) {
    const m = activeRef.current
    if (!m) return
    let att: M.Attendee | null = null
    if (profile) {
      const name = profile.full_name || profile.email || 'Unnamed'
      att = { id: M.uid(), name, initials: staffInitials(profile, name, m.attendees), present: presentToggle, profileId: profile.id, company: null, email: profile.email }
    } else {
      const { name, company, email } = parseAttendeeInput(attInput)
      if (!name) return
      // typed a staff member's exact name or email: link their login
      const match = profiles.find(
        (p) =>
          !m.attendees.some((a) => a.profileId === p.id) &&
          ((p.full_name && p.full_name.trim().toLowerCase() === name.toLowerCase()) || (email && p.email && p.email.toLowerCase() === email.toLowerCase())),
      )
      att = match
        ? {
            id: M.uid(),
            name: match.full_name || name,
            initials: staffInitials(match, match.full_name || name, m.attendees),
            present: presentToggle,
            profileId: match.id,
            company,
            email: match.email,
          }
        : { id: M.uid(), name, initials: M.computeInitials(name, m.attendees), present: presentToggle, profileId: null, company, email }
    }
    if (att.profileId && m.attendees.some((a) => a.profileId === att!.profileId)) return showToast('Already an attendee.')
    m.attendees.push(att)
    setAttInput('')
    setAttPick(-1)
    scheduleSave()
    rerender()
  }
  function toggleAttendeePresence(a: M.Attendee) {
    a.present = !(a.present !== false)
    scheduleSave()
    rerender()
  }
  function removeAttendee(a: M.Attendee) {
    const m = activeRef.current!
    m.attendees = m.attendees.filter((x) => x.id !== a.id)
    scheduleSave()
    rerender()
  }
  function attendeeChip(a: M.Attendee, isPresent: boolean) {
    return (
      <span key={a.id} className={'attendee-chip' + (isPresent ? '' : ' not-present')} title={a.profileId ? `Staff login${a.email ? ' · ' + a.email : ''}` : a.email || undefined}>
        <span className="avatar">{a.initials}</span>
        <span>
          {a.name}
          {a.company && <span className="ac-company"> · {a.company}</span>}
        </span>
        {!readOnly && (
          <>
            <button
              className="ac-toggle-presence"
              type="button"
              aria-label={`Mark ${a.name}${isPresent ? ' as not in attendance' : ' as in attendance'}`}
              title={isPresent ? 'In attendance — click to mark as referenced only' : 'Not in attendance — click to mark as attending'}
              onClick={() => toggleAttendeePresence(a)}
            >
              {isPresent ? Icon.check() : <Icon.info />}
            </button>
            <button className="ac-remove" type="button" aria-label={`Remove ${a.name}`} onClick={() => removeAttendee(a)}>
              {Icon.x()}
            </button>
          </>
        )}
      </span>
    )
  }

  // ---------- points ----------
  function enterEdit(id: string) {
    if (readOnly) return
    setEditing(id)
  }
  function closeMention() {
    if (mentionRef.current) setMention(null)
  }
  function addPoint(type: 'note' | 'heading') {
    const m = activeRef.current
    if (!m) return
    const p = M.newPoint(type)
    m.points.push(p)
    setEditing(p.id)
    rerender()
  }
  function toggleDone(point: M.Point) {
    point.done = !point.done
    // done takes it off the action list; un-ticking puts it back
    if (point.type !== 'heading') point.isAction = !point.done
    scheduleSave()
    rerender()
  }
  function removePoint(point: M.Point) {
    const m = activeRef.current!
    m.points = m.points.filter((p) => p.id !== point.id)
    if (editingRef.current === point.id) setEditing(null)
    if (updatingPointId === point.id) setUpdatingPointId(null)
    scheduleSave()
    rerender()
  }
  function saveUpdate(point: M.Point, input: HTMLInputElement | null) {
    const text = (input?.value ?? '').trim()
    setUpdatingPointId(null)
    if (!text) return
    point.updates = [...point.updates, { id: M.uid(), date: M.todayISO(), text }]
    scheduleSave()
    rerender()
  }
  function movePointBy(id: string, direction: number) {
    const m = activeRef.current!
    const idx = m.points.findIndex((p) => p.id === id)
    const newIdx = idx + direction
    if (idx === -1 || newIdx < 0 || newIdx >= m.points.length) return
    ;[m.points[idx], m.points[newIdx]] = [m.points[newIdx], m.points[idx]]
    scheduleSave()
    rerender()
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.mint .point[data-id="${id}"] .drag-handle`)?.focus())
  }
  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, point: M.Point) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const row = handle.closest('.point') as HTMLElement
    const listEl = pointsListRef.current
    if (!row || !listEl) return
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      /* not supported */
    }
    const ctx = { id: point.id, pointerId: e.pointerId, startY: e.clientY, targetId: null as string | null, placeBefore: true }
    row.classList.add('dragging')
    document.body.style.userSelect = 'none'
    const rows = () => Array.from(listEl.children) as HTMLElement[]
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== ctx.pointerId) return
      row.style.transform = `translateY(${ev.clientY - ctx.startY}px)`
      const all = rows()
      all.forEach((r) => r.classList.remove('drop-before', 'drop-after'))
      const others = all.filter((r) => r !== row)
      const target = others.find((r) => {
        const rect = r.getBoundingClientRect()
        return ev.clientY < rect.top + rect.height / 2
      })
      if (target) {
        target.classList.add('drop-before')
        ctx.targetId = target.getAttribute('data-id')
        ctx.placeBefore = true
      } else if (others.length) {
        const last = others[others.length - 1]
        last.classList.add('drop-after')
        ctx.targetId = last.getAttribute('data-id')
        ctx.placeBefore = false
      } else ctx.targetId = null
    }
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== ctx.pointerId) return
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      try {
        handle.releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      row.style.transform = ''
      row.classList.remove('dragging')
      document.body.style.userSelect = ''
      rows().forEach((r) => r.classList.remove('drop-before', 'drop-after'))
      const m = activeRef.current!
      const fromIdx = m.points.findIndex((p) => p.id === ctx.id)
      if (fromIdx === -1) return
      const [moved] = m.points.splice(fromIdx, 1)
      let toIdx = m.points.length
      if (ctx.targetId) {
        const t = m.points.findIndex((p) => p.id === ctx.targetId)
        if (t !== -1) toIdx = ctx.placeBefore ? t : t + 1
      }
      m.points.splice(toIdx, 0, moved)
      scheduleSave()
      rerender()
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  // "# ", "! " or "£ " at the very start converts the point (heading / urgent / cost impact) and is removed
  function applyLinePrefixShortcuts(point: M.Point, ta: HTMLTextAreaElement) {
    const v = ta.value
    const selStart = ta.selectionStart
    let m: RegExpExecArray | null = null
    if (point.type !== 'heading' && (m = /^#\s+/.exec(v))) point.type = 'heading'
    else if (!point.urgent && (m = /^!\s+/.exec(v))) point.urgent = true
    else if (!point.costFlag && (m = /^£\s+/.exec(v))) point.costFlag = true
    else return false
    const removed = m[0].length
    ta.value = v.slice(removed)
    const newSel = Math.max(0, selStart - removed)
    ta.setSelectionRange(newSel, newSel)
    return true
  }
  // inserts at the caret and fires a real input event, so a tapped @ behaves exactly like a typed one
  function insertAtCursor(ta: HTMLTextAreaElement, str: string) {
    const start = ta.selectionStart
    const end = ta.selectionEnd
    ta.focus()
    ta.setRangeText(str, start, end, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function handleMentionTyping(point: M.Point, ta: HTMLTextAreaElement) {
    const m = activeRef.current!
    const caret = ta.selectionStart
    const match = ta.value.slice(0, caret).match(/@([a-zA-Z0-9]*)$/)
    if (!match) return closeMention()
    const q = match[1].toLowerCase()
    const candidates = m.attendees.filter(
      (a) =>
        a.initials.toLowerCase().startsWith(q) ||
        a.name.toLowerCase().startsWith(q) ||
        a.name
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.startsWith(q)),
    )
    const rect = ta.getBoundingClientRect()
    setMention({ pointId: point.id, start: caret - match[1].length - 1, end: caret, candidates, left: rect.left, top: rect.bottom + 4 })
  }
  function applyMentionSelection(att: M.Attendee, ta: HTMLTextAreaElement, point: M.Point) {
    const ms = mentionRef.current
    if (!ms) return
    const before = ta.value.slice(0, ms.start)
    const after = ta.value.slice(ms.end)
    const insert = '@' + att.initials + ' '
    ta.value = before + insert + after
    const pos = (before + insert).length
    ta.focus()
    ta.setSelectionRange(pos, pos)
    setMention(null)
    autosize(ta)
    point.text = ta.value
    scheduleSave()
  }
  function commit(point: M.Point, ta: HTMLTextAreaElement) {
    point.text = ta.value
    // only this point's own commit may close the editor (a late blur from a previous point mustn't)
    const wasEditing = editingRef.current === point.id
    closeMention()
    if (wasEditing) {
      setEditing(null)
      scheduleSave()
      rerender()
    }
  }
  // Enter: saves this point and starts a fresh one below (Enter on an empty point means "done")
  function commitAndAdvance(point: M.Point, ta: HTMLTextAreaElement) {
    const m = activeRef.current!
    point.text = ta.value
    closeMention()
    const idx = m.points.findIndex((p) => p.id === point.id)
    const isBlank = !ta.value.trim()
    if (isBlank && !point.isAction) {
      if (idx !== -1) m.points.splice(idx, 1)
      setEditing(null)
    } else if (isBlank) {
      setEditing(null) // blank but has an owner / due date: keep it, just stop
    } else {
      const next = M.newPoint('note')
      if (idx !== -1) m.points.splice(idx + 1, 0, next)
      else m.points.push(next)
      setEditing(next.id)
    }
    scheduleSave()
    rerender()
  }

  function renderEditArea(point: M.Point) {
    return (
      <div className="point-edit-wrap">
        <textarea
          key={point.id}
          className="point-edit-area"
          rows={1}
          defaultValue={point.text}
          placeholder={point.type === 'heading' ? M.HEADING_PLACEHOLDER : M.POINT_PLACEHOLDER}
          ref={(el) => {
            editTaRef.current = el
            if (el && el.dataset.init !== '1') {
              el.dataset.init = '1'
              autosize(el)
              el.focus()
              el.setSelectionRange(el.value.length, el.value.length)
            }
          }}
          onInput={(e) => {
            const ta = e.currentTarget
            const converted = applyLinePrefixShortcuts(point, ta)
            autosize(ta)
            handleMentionTyping(point, ta)
            // keep what's typed on every keystroke, so a crash or refresh loses almost nothing
            point.text = ta.value
            scheduleSave()
            if (converted) rerender()
          }}
          onBlur={(e) => {
            const ta = e.currentTarget
            window.setTimeout(() => {
              if (mentionRef.current?.pointId === point.id && document.activeElement?.closest('.mention-dropdown')) return
              commit(point, ta)
            }, 120)
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            const ta = e.currentTarget
            const ms = mentionRef.current
            if (ms && ms.pointId === point.id) {
              if (e.key === 'Escape') return closeMention()
              if ((e.key === 'Enter' || e.key === 'Tab') && ms.candidates[0]) {
                e.preventDefault()
                return applyMentionSelection(ms.candidates[0], ta, point)
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitAndAdvance(point, ta)
            }
            if (e.key === 'Escape') {
              ta.value = point.text || ''
              commit(point, ta)
            }
          }}
        />
        {/* phones: an @ always in the same place (desktop hides it) */}
        <button
          type="button"
          className="mention-quick-btn"
          aria-label="Insert @ mention"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            if (editTaRef.current) insertAtCursor(editTaRef.current, '@')
          }}
        >
          @
        </button>
      </div>
    )
  }

  function renderPoint(point: M.Point) {
    const m = activeRef.current!
    const editing = editingPointId === point.id
    const isHeading = point.type === 'heading'
    const showActionBits = !isHeading && (point.isAction || point.done || point.updates.length > 0)
    const owner = M.attendeeById(m, point.ownerId)
    const itemWord = isHeading ? 'heading' : 'point'

    let marker: ReactNode
    if (isHeading) marker = <span className="point-marker" aria-hidden />
    else if (point.isAction || point.done)
      marker = (
        <button
          className={'point-marker is-action' + (point.done ? ' is-done' : '')}
          type="button"
          aria-label={point.done ? 'Mark not done' : 'Mark done'}
          onClick={() => !readOnly && toggleDone(point)}
        >
          {point.done ? Icon.check(2.4) : <Icon.box />}
        </button>
      )
    else
      marker = (
        <span className="point-marker" aria-hidden>
          <Icon.dot />
        </span>
      )

    return (
      <div
        key={point.id}
        data-id={point.id}
        className={
          'point' +
          (isHeading ? ' point-heading' : '') +
          (point.done ? ' done' : '') +
          (point.urgent ? ' point-urgent' : '') +
          (point.costFlag ? ' point-cost' : '') +
          (editing ? ' editing' : '')
        }
      >
        {marker}
        <div className="point-body">
          {editing ? (
            renderEditArea(point)
          ) : (
            <div
              className="point-text"
              tabIndex={0}
              data-placeholder={isHeading ? M.HEADING_PLACEHOLDER : M.POINT_PLACEHOLDER}
              onClick={() => enterEdit(point.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  enterEdit(point.id)
                }
              }}
            >
              {point.text ? <Mentions text={point.text} attendees={m.attendees} /> : null}
            </div>
          )}
          {!isHeading && (point.urgent || point.costFlag || showActionBits) && (
            <div className="point-meta">
              {point.urgent && (
                <span className="chip flag-urgent">
                  <Icon.warn />
                  Urgent
                </span>
              )}
              {point.costFlag && (
                <span className="chip flag-cost" title="Shown in the app only — never included in exports or emails">
                  £ Cost impact
                </span>
              )}
              {showActionBits && (
                <>
                  {owner && (
                    <span className="chip owner">
                      <span className="avatar" style={{ width: 14, height: 14, fontSize: 8 }}>
                        {owner.initials}
                      </span>
                      {owner.name}
                    </span>
                  )}
                  {point.dueDate && <span className={'chip due status-' + M.dueStatus(point)}>{M.dueLabel(point)}</span>}
                  {point.carriedFrom && (
                    <span className="chip chip-carried" title={'Carried forward from ' + (point.carriedFrom.project || 'a previous meeting')}>
                      <Icon.carried />
                      Carried from {M.formatDateSidebar(point.carriedFrom.date)}
                    </span>
                  )}
                  {!readOnly && (
                    <button
                      className={'btn-complete' + (point.done ? ' is-done' : '')}
                      type="button"
                      aria-label={point.done ? 'Mark not done' : 'Mark complete'}
                      onClick={() => toggleDone(point)}
                    >
                      {point.done ? (
                        <>
                          {Icon.check(2.6)}
                          Completed
                        </>
                      ) : (
                        <>
                          {Icon.check()}
                          Complete
                        </>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {/* an action's running log of what happened, which travels with it to the next meeting */}
          {showActionBits && (
            <>
              {point.updates.length > 0 && (
                <ul className="point-updates">
                  {point.updates.map((u) => (
                    <li key={u.id}>
                      <span className="pu-date">{M.formatDateSidebar(u.date)}</span>
                      {u.text}
                    </li>
                  ))}
                </ul>
              )}
              {!readOnly &&
                (updatingPointId === point.id ? (
                  <UpdateAddRow onSave={(input) => saveUpdate(point, input)} onCancel={() => setUpdatingPointId(null)} />
                ) : (
                  <button className="add-update-link" type="button" onClick={() => setUpdatingPointId(point.id)}>
                    + Add update
                  </button>
                ))}
            </>
          )}
          {!isHeading && !editing && !readOnly && (
            <div className="point-controls">
              <button
                className={'toggle-action' + (point.isAction ? ' on' : '')}
                type="button"
                onClick={() => {
                  // switching it off keeps done / owner / due / updates
                  point.isAction = !point.isAction
                  scheduleSave()
                  rerender()
                }}
              >
                <span className="switch" />
                Action item
              </button>
              {point.isAction && (
                <>
                  <span className="mini-field">
                    <select
                      className="owner-select"
                      value={point.ownerId && owner ? point.ownerId : ''}
                      onChange={(e) => {
                        point.ownerId = e.target.value || null
                        scheduleSave()
                        rerender()
                      }}
                    >
                      <option value="">Owner…</option>
                      {m.attendees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} (@{a.initials})
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="mini-field">
                    <input
                      type="date"
                      className="due-input"
                      value={point.dueDate || ''}
                      aria-label="Due date"
                      onChange={(e) => {
                        point.dueDate = e.target.value || null
                        scheduleSave()
                        rerender()
                      }}
                    />
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {!readOnly && (
          <div className="point-side">
            <button
              className="drag-handle"
              type="button"
              aria-label={`Reorder this ${itemWord} — drag, or focus and press the up/down arrow keys`}
              onPointerDown={(e) => startDrag(e, point)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  movePointBy(point.id, -1)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  movePointBy(point.id, 1)
                }
              }}
            >
              <Icon.grip />
            </button>
            <button className="point-remove" type="button" aria-label={`Delete ${itemWord}`} onClick={() => removePoint(point)}>
              <Icon.trash />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ---------- exports and email ----------
  function exportPdf() {
    const m = activeRef.current
    if (!m) return
    setMenu(null)
    exportMinutesPdf(m, hubUrl).then(
      (fn) => showToast('Saved ' + fn),
      () => showToast('Couldn’t build the PDF — try Export as Word instead.', true),
    )
  }
  function exportDocx() {
    const m = activeRef.current
    if (!m) return
    setMenu(null)
    exportMinutesDocx(m, hubUrl).then(
      (fn) => showToast('Saved ' + fn),
      (e: Error) => showToast('Couldn’t build the Word file: ' + e.message, true),
    )
  }
  function mailtoHref() {
    const m = activeRef.current
    if (!m) return '#'
    const subject = (m.project || 'Meeting notes') + ' — ' + M.formatDateNice(m.date)
    let body = M.buildPlainTextNotes(m)
    if (body.length > MAILTO_BODY_LIMIT) body = body.slice(0, MAILTO_BODY_LIMIT) + '\n…(truncated — use “Copy notes to clipboard” for the full text)'
    return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body)
  }
  function copyNotes() {
    const m = activeRef.current
    if (!m) return
    setMenu(null)
    const text = M.buildPlainTextNotes(m)
    const ok = () => showToast('Notes copied — paste them into your email.')
    const fallbackCopy = () => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      let copied = false
      try {
        copied = document.execCommand('copy')
      } catch {
        /* not allowed */
      }
      ta.remove()
      if (copied) ok()
      else showToast('Couldn’t copy automatically — select the notes and copy manually.', true)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, fallbackCopy)
    else fallbackCopy()
  }

  // ---------- render ----------
  const summary = active ? M.computeTaskSummary(active) : []
  const openCount = M.countOpenActions(active)
  const present = active ? M.presentAttendees(active) : []
  const away = active ? M.awayAttendees(active) : []
  const editingPoint = mention && active ? active.points.find((p) => p.id === mention.pointId) : undefined

  return (
    <div className={'mint in-owner' + (full ? ' mint-full' : '')}>
      <header className="mint-bar">
        <button className="icon-btn mint-drawer-toggle" aria-label="Show meeting list" type="button" onClick={() => setDrawerOpen(!drawerOpen)} data-readonly-ok>
          <Icon.menu />
        </button>
        <div className="brand">
          <img className="brand-mark brand-mark-sm" src="/minutes/logo-icon.png" alt="" />
          <span className="brand-name">Minutes</span>
        </div>
        <div className="mint-bar-spacer" />
        <div className={'save-status' + (status.state ? ' state-' + status.state : '')} aria-live="polite">
          <span className="dot" />
          <span className="dots3" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>{readOnly ? 'Read-only' : status.text}</span>
        </div>
        <button
          className={'icon-btn mint-full-btn' + (full ? ' is-on' : '')}
          type="button"
          aria-label="Full page"
          aria-pressed={full}
          title={full ? 'Back to the page (Esc)' : 'Full page: fill the window with the minutes'}
          onClick={() => setFull(!full)}
          data-readonly-ok
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={full ? 'M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5' : 'M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5'} />
          </svg>
        </button>
        {!readOnly && (
          <button className="btn btn-ghost" type="button" title="Save now" onClick={manualSave}>
            <Icon.save />
            Save
          </button>
        )}
        <div className="export-wrap" ref={exportWrapRef}>
          <button
            className="btn btn-ghost"
            type="button"
            aria-haspopup="true"
            aria-expanded={menu === 'export'}
            onClick={(e) => {
              e.stopPropagation()
              setMenu(menu === 'export' ? null : 'export')
            }}
          >
            <Icon.download />
            Export
          </button>
          {menu === 'export' && (
            <div className="export-menu" role="menu">
              <button type="button" role="menuitem" onClick={exportPdf}>
                <Icon.file />
                Export as PDF
              </button>
              <button type="button" role="menuitem" onClick={exportDocx}>
                <Icon.file />
                Export as Word (.docx)
              </button>
            </div>
          )}
        </div>
        <div className="export-wrap" ref={emailWrapRef}>
          <button
            className="btn btn-ghost"
            type="button"
            aria-haspopup="true"
            aria-expanded={menu === 'email'}
            title="Copy the notes or open a prefilled email draft"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(menu === 'email' ? null : 'email')
            }}
            data-readonly-ok
          >
            <Icon.mail />
            Email
          </button>
          {menu === 'email' && (
            <div className="export-menu" role="menu" data-readonly-ok>
              <button type="button" role="menuitem" onClick={() => (setMenu(null), setEmailing(true))}>
                <Icon.mail />
                Email the minutes (PDF) to the team…
              </button>
              <button type="button" role="menuitem" onClick={copyNotes}>
                <Icon.copy />
                Copy notes to clipboard
              </button>
              <a href={mailtoHref()} role="menuitem" target="_blank" rel="noopener noreferrer" onClick={() => setMenu(null)}>
                <Icon.mail />
                Open email draft
              </a>
              <button type="button" role="menuitem" onClick={exportPdf}>
                <Icon.file />
                Save PDF to attach
              </button>
              <div className="menu-note">Copy is the reliable one — mail apps vary in what they'll let a web page open directly.</div>
            </div>
          )}
        </div>
        <Link className="btn btn-ghost" to="/tasks" title="Your open action items across all meetings">
          <Icon.tasks />
          Tasks
        </Link>
        <button className="btn btn-primary" type="button" onClick={startNewMeeting}>
          <Icon.plus />
          New meeting
        </button>
      </header>

      <div className="body-row">
        <aside className={'drawer' + (drawerOpen ? ' open' : '')} aria-label="Past meetings">
          <div className="drawer-head">
            <input type="search" placeholder="Search meetings…" aria-label="Search meetings" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="meeting-list">{renderSidebar()}</div>
          <div className="drawer-foot">
            <img src="/minutes/mint-32.png" alt="" width="16" height="16" />
            <span>Mint</span>
          </div>
        </aside>
        {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}

        <main className="note">
          <div className="note-inner">
            {loadError && <p className="mint-error">{loadError}</p>}
            {!active ? (
              <div className="meeting-empty">Loading…</div>
            ) : (
              <>
                <div className="letterhead">
                  {/* the project is the job / estimate (23 Nov) */}
                  <div className="field-project" aria-label="Project">
                    {owner.label}
                  </div>
                  <input
                    ref={subtitleInputRef}
                    className="field-subtitle"
                    placeholder="Add a sub-title…"
                    aria-label="Sub-title"
                    value={active.subtitle}
                    readOnly={readOnly}
                    onChange={(e) => {
                      active.subtitle = e.target.value
                      scheduleSave()
                      rerender()
                    }}
                  />
                  <div className="letterhead-meta">
                    <label className="date-field">
                      <span className="field-label">Date</span>
                      <input
                        type="date"
                        aria-label="Meeting date"
                        value={active.date}
                        readOnly={readOnly}
                        onChange={(e) => {
                          active.date = e.target.value || M.todayISO()
                          scheduleSave()
                          rerender()
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="attendees-block">
                  <div className="field-label">Attendees</div>
                  <div className="attendee-chips">{present.map((a) => attendeeChip(a, true))}</div>
                  {away.length > 0 && <div className="attendee-group-label">Not in attendance — referenced only</div>}
                  <div className="attendee-chips">{away.map((a) => attendeeChip(a, false))}</div>
                  {!readOnly && (
                    <>
                      <div className="attendee-add attendee-add-wrap">
                        <input
                          type="text"
                          placeholder="Add person, press Enter"
                          autoComplete="off"
                          title="A staff login (pick from the list), or anyone else: Name, Company, email"
                          value={attInput}
                          onChange={(e) => {
                            setAttInput(e.target.value)
                            setAttPick(-1)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowDown' && suggestions.length) {
                              e.preventDefault()
                              setAttPick((attPick + 1) % suggestions.length)
                            } else if (e.key === 'ArrowUp' && suggestions.length) {
                              e.preventDefault()
                              setAttPick(attPick <= 0 ? suggestions.length - 1 : attPick - 1)
                            } else if (e.key === 'Escape') setAttPick(-1)
                            else if (e.key === 'Enter') {
                              e.preventDefault()
                              addAttendee(attPick >= 0 ? suggestions[attPick] : undefined)
                            }
                          }}
                        />
                        <span className="initials-preview">{previewInitials()}</span>
                        <label className="present-toggle" title="Uncheck to add someone as referenced only — not actually at the meeting">
                          <input type="checkbox" checked={presentToggle} onChange={(e) => setPresentToggle(e.target.checked)} />
                          In attendance
                        </label>
                        {suggestions.length > 0 && (
                          <div className="mention-dropdown" style={{ position: 'absolute', left: 0, top: '100%' }}>
                            {suggestions.map((p, i) => (
                              <button
                                key={p.id}
                                type="button"
                                className={i === attPick ? 'active' : undefined}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  addAttendee(p)
                                }}
                              >
                                <span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>
                                  {staffInitials(p, p.full_name || p.email || '', active.attendees)}
                                </span>
                                <span>{p.full_name || p.email}</span>
                                <span className="md-sub">Staff</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="attendee-hint">Staff logins come up as you type. Anyone else: Name, Company, email.</div>
                    </>
                  )}
                </div>

                <div className="points-canvas">
                  <div className="points-list" ref={pointsListRef}>
                    {active.points.map(renderPoint)}
                  </div>
                  {!readOnly && (
                    <div className="points-add-row">
                      <button className="add-link" type="button" onClick={() => addPoint('note')}>
                        + Add point
                      </button>
                      <button className="add-link add-link-muted" type="button" onClick={() => addPoint('heading')}>
                        + Add section heading
                      </button>
                    </div>
                  )}
                </div>

                {summary.length > 0 && (
                  <div className="task-summary">
                    <div className="ts-label">Task summary</div>
                    {summary.map((g, gi) => (
                      <div className="ts-group" key={g.owner?.id ?? 'unassigned-' + gi}>
                        <div className="ts-person">
                          <span className="avatar">{g.owner ? g.owner.initials : '?'}</span>
                          <span>{g.owner ? g.owner.name : 'Unassigned'}</span>
                        </div>
                        <ul className="ts-items">
                          {g.items.map((p) => (
                            <li key={p.id} className={p.done ? 'ts-done' : ''}>
                              <Mentions text={p.text || '(no description)'} attendees={active.attendees} />
                              {p.dueDate && (
                                <>
                                  {' '}
                                  <span className={'chip due status-' + M.dueStatus(p)}>{M.dueLabel(p)}</span>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {!M.isMeetingEmpty(active) && !readOnly && (
                  <div className="next-meeting-row">
                    <button className="btn btn-primary" type="button" onClick={startNextMeeting}>
                      Next meeting
                      <Icon.arrowRight />
                    </button>
                    <span className="next-meeting-hint">
                      {openCount
                        ? `Carries forward ${openCount} open action item${openCount === 1 ? '' : 's'} from this meeting.`
                        : `Starts a follow-up for ${active.project || 'this project'} — no open action items to carry yet.`}
                    </span>
                  </div>
                )}

                <div className="note-footnote">{M.FOOTNOTE_TEXT}</div>
              </>
            )}
          </div>
        </main>
      </div>

      {mention && editingPoint && (
        <div className="mention-dropdown" style={{ left: mention.left, top: mention.top }}>
          {mention.candidates.length ? (
            mention.candidates.map((a, i) => (
              <button
                key={a.id}
                type="button"
                className={i === 0 ? 'active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (editTaRef.current) applyMentionSelection(a, editTaRef.current, editingPoint)
                }}
              >
                <span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>
                  {a.initials}
                </span>
                <span>{a.name}</span>
              </button>
            ))
          ) : (
            <div className="md-empty">No matching attendee{active?.attendees.length ? '' : ' — add attendees above'}</div>
          )}
        </div>
      )}
      {emailing && active && <MinutesEmail meeting={active} hubUrl={hubUrl} onClose={() => setEmailing(false)} onDone={(msg, danger) => showToast(msg, danger)} />}
      {toastElement}
    </div>
  )
}

// "+ Add update": Enter adds, Escape cancels
function UpdateAddRow({ onSave, onCancel }: { onSave: (input: HTMLInputElement | null) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="update-add-row">
      <input
        ref={ref}
        type="text"
        className="update-input"
        placeholder="What happened this week…"
        aria-label="Add an update"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSave(ref.current)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <button className="btn btn-small" type="button" onClick={() => onSave(ref.current)}>
        Add
      </button>
      <button className="btn btn-small" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
