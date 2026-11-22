// The programme editor: DBP Timeline built into the app (Richard, 22 Nov: "take the layout of Timeline
// and copy every feature of it"). Used on a job's Programme tab and on an Estimating enquiry (a tender
// often needs a programme too). Laid out as Timeline: the toolbar, quick add, then the task list and
// chart. Every change is kept in memory (Undo goes back up to 30), and saved a moment later, so the
// cashflow and procurement always work from the latest programme. Timeline's Save / Commit become
// automatic saving / Issue revision (Initial issue, Rev A, Rev B…, with history and what changed).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ukDate } from '../../lib/format'
import { saveError } from '../../lib/offline'
import {
  has026,
  issueRevision,
  listProgrammes,
  listRevisions,
  loadProgramme,
  loadProgrammeById,
  loadRevisionData,
  parseProgramme,
  saveProgramme,
  startBlankProgramme,
  syncProgramme,
  type Owner,
  type ParsedProgramme,
  type ProgrammeListItem,
  type ProgrammeRevision,
  type ProgrammeTask,
} from '../../lib/programme'
import { calendarOf, criticalPath } from '../../lib/programmeLinks'
import { finishFor } from '../../lib/programmeEdit'
import {
  DEFAULT_TRADES,
  addTrade,
  brandColours,
  copyForNewStart,
  deleteSection,
  deleteTask,
  draftTask,
  duplicateSection,
  duplicateTask,
  findTask,
  insertSectionBefore,
  insertTemplate,
  addSection,
  lengthOf,
  prepare,
  quickAdd,
  renameSection,
  saveTask,
  setBaseline,
  setSetting,
  setShutdowns,
  setStart,
  setTradeColor,
  shiftProgramme,
  shiftSection,
  toggleLink,
  toneDown,
  weekOneMonday,
  type Working,
} from '../../lib/programmeOps'
import { GENERATED_FILE } from '../../lib/programmeGen'
import { fromTimeline, revName, toTimeline, type TLState } from '../../lib/timelineFormat'
import { diffProgrammeData } from '../../lib/timelineDiff'
import { buildMSProjectXML, buildXER, downloadFile, exportFileName } from '../../lib/timelineExport'
import { printProgramme } from '../../lib/timelinePrint'
import { loadCompanies } from '../../lib/subcontracts'
import GenerateProgramme from '../GenerateProgramme'
import type { Job } from '../../lib/types'
import ProgrammeChart, { DEFAULT_COL_WIDTHS, type Zoom } from './ProgrammeChart'
import { DeleteSectionDialog, DuplicateSectionDialog, LegendMenu, Modal, Popover, ShiftMenu, ShutdownMenu, TaskModal } from './ProgrammeParts'
import '../../programme.css'

const COLWIDTHS_KEY = 'duboulay-timeline-colwidths-v1' // the same as Timeline's, so widths carry over
const ZOOM_KEY = 'dbp-programme-zoom'
const fmtShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const sameName = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private browsing: not remembered */
    }
  },
}
type Pop = 'section' | 'shutdown' | 'shift' | 'legend' | 'export' | 'help' | null
type Dialog =
  | { kind: 'dup'; section: string }
  | { kind: 'del'; section: string }
  | { kind: 'issue' }
  | { kind: 'history' }
  | { kind: 'previous' }
  | { kind: 'import'; parsed: ParsedProgramme; name: string }
  | { kind: 'new' }
  | null

export default function ProgrammeEditor({
  owner,
  ownerName,
  job,
  defaults,
}: {
  owner: Owner
  ownerName: string
  job?: Job
  defaults: { start?: string | null; pc?: string | null }
}) {
  const [w, setW] = useState<Working | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const saved = useRef<Working | null>(null) // as last saved
  const live = useRef<Working | null>(null) // as now
  const busy = useRef(false)
  const undo = useRef<{ label: string; w: Working }[]>([])
  const [undoTop, setUndoTop] = useState<string | null>(null)

  const [zoom, setZoomState] = useState<Zoom>(() => (store.get(ZOOM_KEY) as Zoom) || 'Week')
  const setZoom = (z: Zoom) => (setZoomState(z), store.set(ZOOM_KEY, z))
  const [colWidths, setColWidthsState] = useState<number[]>(() => {
    try {
      const v = JSON.parse(store.get(COLWIDTHS_KEY) ?? 'null')
      return Array.isArray(v) && v.length === DEFAULT_COL_WIDTHS.length ? v : DEFAULT_COL_WIDTHS
    } catch {
      return DEFAULT_COL_WIDTHS
    }
  })
  const setColWidths = (v: number[]) => (setColWidthsState(v), store.set(COLWIDTHS_KEY, JSON.stringify(v)))
  const [critOnly, setCritOnly] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [linkMsg, setLinkMsg] = useState<string>('')
  const [contractor, setContractor] = useState('')
  const [modal, setModal] = useState<{ task: ProgrammeTask; isNew: boolean } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [pop, setPop] = useState<Pop>(null)
  const [todayTick, setTodayTick] = useState(0)
  const [companies, setCompanies] = useState<string[]>([])
  const [revisions, setRevisions] = useState<ProgrammeRevision[]>([])
  const [compact, setCompact] = useState(() => window.innerWidth < 700)
  const [full, setFull] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const quickName = useRef<HTMLInputElement>(null)
  const [qa, setQa] = useState({ name: '', trade: '', days: '5', link: true })
  const shiftKey = useRef(false)

  const flashToast = (m: string) => {
    setToast(m)
    setTimeout(() => setToast((t) => (t === m ? null : t)), 2600)
  }

  // ----- loading -----
  const load = useCallback(async () => {
    setError(null)
    try {
      const p = await loadProgramme(owner)
      const working = p.programme ? prepare(p.programme, p.tasks) : null
      saved.current = working
      live.current = working
      setW(working)
      undo.current = []
      setUndoTop(null)
      if (p.programme && has026(p.programme)) listRevisions(p.programme.id).then(setRevisions, () => setRevisions([]))
    } catch (e) {
      const m = (e as Error).message
      setError(/enquiry_id/.test(m) ? 'Programmes for estimates need script 026 run in Supabase first (supabase/README.md).' : m)
    }
    setLoaded(true)
  }, [owner]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
    loadCompanies().then(
      (cs) => setCompanies(cs.map((c) => c.name).sort((a, b) => a.localeCompare(b, 'en-GB'))),
      () => setCompanies([]),
    )
  }, [load])
  useEffect(() => {
    const r = () => setCompact(window.innerWidth < 700)
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  // ----- saving: a moment after each change, one save at a time -----
  const flush = useCallback(async () => {
    if (busy.current || !saved.current || !live.current || live.current === saved.current) return
    if (!navigator.onLine) {
      setStatus('error')
      return setSaveMsg("You're offline: changes are kept on this page and saved when you're back online.")
    }
    busy.current = true
    setStatus('saving')
    const target = live.current
    try {
      await syncProgramme(saved.current, target)
      saved.current = target
      setStatus(live.current === target ? 'saved' : 'saving')
      setSaveMsg(null)
    } catch (e) {
      setStatus('error')
      setSaveMsg(saveError(e))
    }
    busy.current = false
    if (live.current !== saved.current && live.current !== target) setTimeout(flush, 300)
  }, [])
  useEffect(() => {
    if (!w || w === saved.current) return
    const h = setTimeout(flush, 700)
    return () => clearTimeout(h)
  }, [w, flush])
  useEffect(() => {
    const online = () => flush()
    const leave = (e: BeforeUnloadEvent) => {
      if (live.current && live.current !== saved.current) e.preventDefault()
    }
    window.addEventListener('online', online)
    window.addEventListener('beforeunload', leave)
    return () => (window.removeEventListener('online', online), window.removeEventListener('beforeunload', leave))
  }, [flush])

  // a change: kept for Undo, shown, saved shortly
  const apply = useCallback((next: Working, label = 'change') => {
    const cur = live.current
    if (!cur || next === cur) return
    undo.current.push({ label, w: cur })
    if (undo.current.length > 30) undo.current.shift()
    setUndoTop(label)
    live.current = next
    setW(next)
  }, [])
  const undoLast = useCallback(() => {
    const u = undo.current.pop()
    setUndoTop(undo.current.at(-1)?.label ?? null)
    if (!u) return
    live.current = u.w
    setW(u.w)
    flashToast(`Undone: ${u.label}`)
  }, [])

  // keyboard: Ctrl+Z undo, N quick add, Esc ends link mode (Timeline's shortcuts)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase()
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && !modal && !dialog) {
        e.preventDefault()
        undoLast()
      } else if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && !modal && !dialog) {
        e.preventDefault()
        quickName.current?.focus()
      } else if (e.key === 'Escape' && linking) {
        setLinking(false)
        setLinkFrom(null)
      }
    }
    const shift = (e: PointerEvent) => (shiftKey.current = e.shiftKey)
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', shift, true)
    return () => (document.removeEventListener('keydown', key), document.removeEventListener('pointerdown', shift, true))
  }, [undoLast, linking, modal, dialog])

  // full screen
  useEffect(() => {
    if (!full) return
    const left = () => !document.fullscreenElement && setFull(false)
    document.addEventListener('fullscreenchange', left)
    document.body.classList.add('no-scroll')
    return () => (document.removeEventListener('fullscreenchange', left), document.body.classList.remove('no-scroll'))
  }, [full])
  const toggleFull = () => {
    if (!full) {
      setFull(true)
      root.current?.requestFullscreen?.().catch(() => {})
    } else {
      setFull(false)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }

  const sd = w?.programme.shutdowns ?? []
  const critical = useMemo(() => (w ? criticalPath(w.tasks, sd) : new Set<string>()), [w]) // eslint-disable-line react-hooks/exhaustive-deps
  const usedContractors = useMemo(() => {
    const out: string[] = []
    for (const t of w?.tasks ?? []) if (t.contractor?.trim() && !out.some((o) => sameName(o, t.contractor))) out.push(t.contractor.trim())
    return out.sort((a, b) => a.localeCompare(b, 'en-GB'))
  }, [w])
  const contractorNames = useMemo(() => {
    const out = [...companies]
    for (const n of usedContractors) if (!out.some((o) => sameName(o, n))) out.push(n)
    return out.sort((a, b) => a.localeCompare(b, 'en-GB'))
  }, [companies, usedContractors])

  // something that replaces the whole programme (import, new, a previous one): saved straight away
  const replace = async (p: ParsedProgramme, fileName: string, done: string) => {
    setDialog(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    try {
      await flush()
      await saveProgramme(owner, p, fileName)
      await load()
      flashToast(done)
    } catch (e) {
      setError(saveError(e))
    }
  }

  if (!loaded) return <p className="muted">Loading…</p>
  if (error && !w) return <p className="error">{error}</p>
  if (!w)
    return (
      <StartPanel
        owner={owner}
        ownerName={ownerName}
        job={job}
        defaults={defaults}
        onImport={(parsed, name) => replace(parsed, name, `Programme imported: ${parsed.tasks.length} tasks.`)}
        onBlank={(s, pc) =>
          startBlankProgramme(owner, ownerName, s, pc).then(
            () => load(),
            (e) => setError(saveError(e)),
          )
        }
        onEmpty={() =>
          replace(
            { project_name: ownerName, start_date: null, finish_date: null, tasks: [], trades: DEFAULT_TRADES, project_start: defaults.start ?? null },
            'New programme',
            'New programme started.',
          )
        }
        onGenerated={() => load()}
        onPrevious={(p, name) => replace(p, `Copied from ${name}`, `Programme copied from ${name}.`)}
      />
    )

  const programme = w.programme
  const tl = () => toTimeline(programme, w.tasks)
  const monday = weekOneMonday(w)
  const lastRev = revisions[0]
  const openTask = (code: string) => {
    const t = findTask(w, code)
    if (t) setModal({ task: structuredClone(t), isNew: false })
  }
  const link = (code: string) => {
    const t = findTask(w, code)
    if (!t) return
    if (!linkFrom) {
      setLinkFrom(code)
      return setLinkMsg(`${t.name} selected. Now click the task that depends on it (Shift-click for start-to-start). Click it again to cancel.`)
    }
    if (linkFrom === code) {
      setLinkFrom(null)
      return setLinkMsg('Selection cleared. Click the task that comes first.')
    }
    const first = findTask(w, linkFrom)!
    const type = shiftKey.current ? 'SS' : 'FS'
    const r = toggleLink(w, linkFrom, code, type)
    if (r.result === 'loop') return setLinkMsg(`Can't link: ${first.name} already depends on ${t.name} (that would be a loop).`)
    apply(r.w, r.result === 'linked' ? `link ${first.name} → ${t.name}` : `unlink ${first.name} → ${t.name}`)
    if (r.result === 'unlinked') {
      setLinkFrom(null)
      setLinkMsg(`Removed link: ${first.name} → ${t.name}. Click the next task that comes first.`)
    } else {
      setLinkFrom(code) // chain: the follower is the next one to link from
      setLinkMsg(`Linked ${first.name} → ${t.name} (${type}). ${t.name} is now selected: click the next task to chain on, or click it again to stop.`)
    }
  }
  const promptRename = (name: string) => {
    const to = prompt('Rename section:', name)?.trim()
    if (to && to !== name) apply(renameSection(w, name, to), `rename section "${name}"`)
  }
  const onLogo = async (file: File) => {
    // scaled down so it stays small in the database (shown 36 px high on screen and print)
    const url = await new Promise<string>((res, rej) => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 160 / img.height, 600 / img.width)
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        res(c.toDataURL('image/png'))
      }
      img.onerror = () => rej(new Error("That file isn't an image the browser can read."))
      img.src = URL.createObjectURL(file)
    })
    apply(setSetting(w, { client_logo: url }), 'client logo')
  }
  const statusChip =
    status === 'saving' ? (
      <span className="tl-cloud-chip">Saving…</span>
    ) : status === 'error' ? (
      <span className="tl-cloud-chip behind" title={saveMsg ?? ''}>
        Not saved{' '}
        <button className="tl-link-btn" onClick={() => flush()}>
          retry
        </button>
      </span>
    ) : (
      <span className="tl-cloud-chip linked" title="Every change is saved for everyone straight away">
        Saved{lastRev ? ` · ${revName(lastRev.rev_no)} issued ${ukDate(lastRev.created_at.slice(0, 10))}` : ' · not yet issued'}
      </span>
    )

  return (
    <div className={`tl ${full ? 'tl-full' : ''}`} ref={root}>
      {error && <p className="error">{error}</p>}
      {status === 'error' && saveMsg && <p className="error small">{saveMsg}</p>}
      {!has026(programme) && (
        <p className="warning small">
          Run script <strong>026</strong> in Supabase (supabase/README.md) so contractor, RAG, prerequisites, skeleton crew, baselines, section order, Wk 1, the client logo and
          issued revisions are saved. Tasks, dates, links and shutdowns save already.
        </p>
      )}
      {programme.file_name === GENERATED_FILE && <p className="warning small">A simple programme made from the SoW: edit it here, or use Open file… to import the real one.</p>}

      {/* the toolbar (Timeline's) */}
      <div className="tl-toolbar">
        <div className="tl-proj">
          <label>Project</label>
          <input
            type="text"
            className="tl-proj-name"
            value={programme.project_name ?? ''}
            onChange={(e) => {
              const next = setSetting(w, { project_name: e.target.value })
              live.current = next // typing isn't an Undo step per letter
              setW(next)
            }}
          />
          {statusChip}
        </div>
        <div
          className="tl-proj"
          title="The date of the very first task (e.g. LOI / precon). New tasks begin here, and dates typed without a year (e.g. 4/1) resolve to the first matching date on or after it. This is separate from Wk 1 (start on site)."
        >
          <label htmlFor="tl-start">Programme starts</label>
          <input
            id="tl-start"
            type="date"
            value={programme.project_start ?? ''}
            onChange={(e) => apply(setSetting(w, { project_start: e.target.value || null }), 'programme start')}
          />
        </div>
        <div className="tl-proj" title="The date Week 1 starts, e.g. start on site. Weeks before it count down (Wk -1, -2...). Leave blank for automatic.">
          <label htmlFor="tl-wk1">Start on site (Wk 1)</label>
          <input id="tl-wk1" type="date" value={programme.week_start ?? ''} onChange={(e) => apply(setSetting(w, { week_start: e.target.value || null }), 'Wk 1')} />
          <span className="tl-wk1-hint">{monday ? (programme.week_start ? `wk of ${fmtShort(monday)}` : `auto: wk of ${fmtShort(monday)}`) : ''}</span>
          {programme.week_start && (
            <button className="tl-icon" onClick={() => apply(setSetting(w, { week_start: null }), 'Wk 1')} title="Go back to automatic week numbering">
              ✕
            </button>
          )}
        </div>
        <div className="tl-divider" />
        <button className="tl-btn" onClick={() => setDialog({ kind: 'new' })}>
          New
        </button>
        <button className="tl-btn tl-btn-sm" onClick={undoLast} disabled={!undoTop} title={undoTop ? `Undo: ${undoTop} (Ctrl+Z)` : 'Nothing to undo'}>
          Undo
        </button>
        <button className="tl-btn" onClick={() => setDialog({ kind: 'previous' })} title="Start again from another job's or estimate's programme">
          Programmes
        </button>
        <button
          className="tl-btn tl-btn-primary"
          onClick={() => setDialog({ kind: 'issue' })}
          disabled={!has026(programme)}
          title="Issue the programme as a numbered revision (Initial issue, Rev A, Rev B…)"
        >
          Issue revision
        </button>
        <button className="tl-btn" onClick={() => setDialog({ kind: 'history' })} disabled={!has026(programme)} title="Issued revisions and what changed between them">
          History{revisions.length ? ` (${revisions.length})` : ''}
        </button>
        <label className="tl-btn tl-btn-sm" title="Open a programme from a file (DBP Timeline .json, P6 .xer, MS Project .xml): replaces this one">
          Open file…
          <input
            type="file"
            hidden
            accept=".json,.xer,.xml,.mpp"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                setDialog({ kind: 'import', parsed: await parseProgramme(f), name: f.name })
              } catch (err) {
                setError((err as Error).message)
              }
            }}
          />
        </label>
        <button
          className="tl-btn tl-btn-sm"
          onClick={() => downloadFile(exportFileName(tl(), '.json'), JSON.stringify(tl(), null, 2), 'application/json')}
          title="Save to a file on this computer (opens in DBP Timeline too)"
        >
          Save file
        </button>
        <div className="tl-divider" />
        <button className="tl-btn tl-btn-primary" onClick={() => setModal({ task: draftTask(w, false, contractor || null), isNew: true })}>
          + Task
        </button>
        <button className="tl-btn" onClick={() => setModal({ task: draftTask(w, true, contractor || null), isNew: true })}>
          + Milestone
        </button>
        <span className="tl-pop-wrap">
          <button className="tl-btn" onClick={() => setPop(pop === 'section' ? null : 'section')}>
            + Section ▾
          </button>
          <Popover open={pop === 'section'} onClose={() => setPop(null)}>
            <div
              className="tl-menu-item"
              onClick={() => {
                setPop(null)
                const name = prompt('Section name (e.g. Precon, Construction, Close-out):')?.trim()
                if (name) apply(addSection(w, name), `add section "${name}"`)
              }}
            >
              Blank section…
            </div>
            <div className="tl-legend-title">Starter tasks</div>
            <div className="tl-menu-item" onClick={() => (setPop(null), apply(insertTemplate(w, 'precon'), 'add Precon'))}>
              Precon
            </div>
            <div className="tl-menu-item" onClick={() => (setPop(null), apply(insertTemplate(w, 'closeout'), 'add Close-out'))}>
              Close-out
            </div>
          </Popover>
        </span>
        <div className="tl-divider" />
        <div className="tl-seg" role="group" aria-label="Zoom">
          {(['Day', 'Week', 'Fortnight', 'Month'] as Zoom[]).map((z) => (
            <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>
              {z}
            </button>
          ))}
        </div>
        <button className="tl-btn tl-btn-sm" onClick={() => setTodayTick(todayTick + 1)}>
          Today
        </button>
        <div className="tl-divider" />
        <span className="tl-pop-wrap">
          <button className="tl-btn" onClick={() => setPop(pop === 'shutdown' ? null : 'shutdown')} title="Block out Christmas (or any other) shutdown period">
            Shutdown{sd.length ? ` (${sd.length})` : ''}
            {suggestedXmas(w) && <span className="tl-attn" title="Programme runs over Christmas" />} ▾
          </button>
          <Popover open={pop === 'shutdown'} onClose={() => setPop(null)} width={520}>
            <ShutdownMenu w={w} onChange={(list) => apply(setShutdowns(w, list), 'shutdowns')} />
          </Popover>
        </span>
        <span className="tl-pop-wrap">
          <button
            className="tl-btn"
            onClick={() => setPop(pop === 'shift' ? null : 'shift')}
            title="Move the whole programme, or just one section, forward or back by a number of days"
          >
            Shift ▾
          </button>
          <Popover open={pop === 'shift'} onClose={() => setPop(null)} width={340}>
            <ShiftMenu
              w={w}
              onShift={(scope, days) => {
                setPop(null)
                if (scope === undefined)
                  apply(shiftProgramme(w, days), `shift programme ${days > 0 ? 'forward' : 'back'} by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`)
                else {
                  if (!w.tasks.some((t) => t.section === scope)) return alert('That section has no tasks.')
                  apply(
                    shiftSection(w, scope, days),
                    `shift "${scope ?? 'ungrouped tasks'}" ${days > 0 ? 'forward' : 'back'} by ${Math.abs(days)} working day${Math.abs(days) === 1 ? '' : 's'}`,
                  )
                }
              }}
            />
          </Popover>
        </span>
        <button
          className="tl-btn"
          onClick={() => {
            if (!w.tasks.length) return alert('Add some tasks first.')
            const already = w.tasks.filter((t) => t.baseline_start).length
            const msg = already
              ? `${already} task(s) already have a baseline and will be left untouched. Set baseline for the remaining ${w.tasks.length - already} task(s)?`
              : `Set the current schedule as the baseline for all ${w.tasks.length} task(s)? This is normally done once, at the start of the project.`
            if (confirm(msg)) apply(setBaseline(w).w, 'set baseline')
          }}
        >
          Set baseline
        </button>
        <button
          className={`tl-btn ${linking ? 'is-on' : ''}`}
          onClick={() => {
            setLinking(!linking)
            setLinkFrom(null)
            setLinkMsg('Link mode. Click the task that comes first, then the task that depends on it. Shift-click the second for start-to-start. Esc to finish.')
          }}
          title="Click a task, then the task that depends on it, to link them (in the chart or the list)"
        >
          Link tasks
        </button>
        <button className={`tl-btn ${critOnly ? 'is-on' : ''}`} onClick={() => setCritOnly(!critOnly)} title="Fade everything that isn't on the critical path">
          Critical path ({critical.size})
        </button>
        <select className="tl-btn tl-select" value={contractor} onChange={(e) => setContractor(e.target.value)} title="Show (and print) only one contractor's tasks">
          <option value="">All contractors</option>
          {usedContractors.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="tl-pop-wrap">
          <button className="tl-btn" onClick={() => setPop(pop === 'legend' ? null : 'legend')}>
            Legend
          </button>
          <Popover open={pop === 'legend'} onClose={() => setPop(null)}>
            <LegendMenu
              w={w}
              onColor={(name, color) => apply(setTradeColor(w, name, color), `${name} colour`)}
              onBrand={() => (setPop(null), apply(brandColours(w), 'apply brand colours'))}
              onToneDown={() => (setPop(null), apply(toneDown(w), 'tone down trade colours'))}
            />
          </Popover>
        </span>
        <label className="tl-btn" title="The client's logo, shown on the programme and its print">
          Client logo…
          <input
            type="file"
            hidden
            accept="image/*"
            onChange={(e) => (e.target.files?.[0] && onLogo(e.target.files[0]).catch((err) => setError(err.message)), (e.target.value = ''))}
          />
        </label>
        <button
          className="tl-btn"
          onClick={() => {
            if (!w.tasks.length) return alert('Add some tasks before printing.')
            printProgramme(tl(), {
              logoUrl: '/dbp-logo.png',
              contractor: contractor || null,
              criticalOnly: critOnly,
              critical,
              revision: lastRev ? revName(lastRev.rev_no) : undefined,
            }).catch((e) => setError((e as Error).message))
          }}
          title="A3 landscape, as many pages as it needs (save as PDF from the print window)"
        >
          Print / PDF
        </button>
        <span className="tl-pop-wrap">
          <button className="tl-btn" onClick={() => setPop(pop === 'export' ? null : 'export')} title="Download the programme for Primavera P6 or MS Project">
            Export ▾
          </button>
          <Popover open={pop === 'export'} onClose={() => setPop(null)} align="right">
            <div
              className="tl-menu-item"
              onClick={() => {
                setPop(null)
                if (!w.tasks.length) return alert('Add some tasks before exporting.')
                downloadFile(exportFileName(tl(), ' (MS Project).xml'), buildMSProjectXML(tl()), 'application/xml')
              }}
            >
              MS Project (.xml)
            </div>
            <div
              className="tl-menu-item"
              onClick={() => {
                setPop(null)
                if (!w.tasks.length) return alert('Add some tasks before exporting.')
                downloadFile(exportFileName(tl(), '.xer'), buildXER(tl()), 'application/octet-stream')
              }}
            >
              Primavera P6 (.xer)
            </div>
            <div className="tl-menu-item" onClick={() => (setPop(null), downloadFile(exportFileName(tl(), '.json'), JSON.stringify(tl(), null, 2), 'application/json'))}>
              DBP Timeline file (.json)
            </div>
          </Popover>
        </span>
        <button className="tl-btn" onClick={toggleFull} title={full ? 'Back to the page' : 'Fill the screen'}>
          {full ? '✕ Exit full screen' : '⛶ Full screen'}
        </button>
        <span className="tl-pop-wrap tl-help-wrap">
          <button className="tl-btn" onClick={() => setPop(pop === 'help' ? null : 'help')}>
            Help
          </button>
          <Popover open={pop === 'help'} onClose={() => setPop(null)} align="right" width={360}>
            <Help />
          </Popover>
        </span>
        {programme.client_logo && (
          <span className="tl-client-logo">
            <img src={programme.client_logo} alt="Client logo" />
            <button className="tl-icon" title="Remove the client logo" onClick={() => apply(setSetting(w, { client_logo: null }), 'remove client logo')}>
              ✕
            </button>
          </span>
        )}
      </div>

      {linking && (
        <div className="tl-banner">
          <span>{linkMsg}</span>
          <button className="tl-btn tl-btn-sm" onClick={() => (setLinking(false), setLinkFrom(null))}>
            Done
          </button>
        </div>
      )}

      {/* quick add (submitQuickAdd) */}
      <div className="tl-quick-add">
        <input
          ref={quickName}
          type="text"
          value={qa.name}
          placeholder="Quick add task… type a name, press Enter"
          autoComplete="off"
          onChange={(e) => setQa({ ...qa, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return (setQa({ ...qa, name: '' }), (e.target as HTMLInputElement).blur())
            if (e.key !== 'Enter' || !qa.name.trim()) return
            e.preventDefault()
            const trade = qa.trade || w.tasks.at(-1)?.trade || programme.trades?.[0]?.name || null
            const r = quickAdd(w, { name: qa.name, trade, days: parseInt(qa.days) || 5, link: qa.link, contractor: contractor || null })
            apply(r.w, `add ${qa.name.trim()}`)
            setQa({ ...qa, name: '' })
          }}
        />
        <select value={qa.trade || w.tasks.at(-1)?.trade || ''} onChange={(e) => setQa({ ...qa, trade: e.target.value })} title="Trade for the next quick-added task">
          {(programme.trades ?? []).map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <input type="number" min={1} value={qa.days} onChange={(e) => setQa({ ...qa, days: e.target.value })} title="Duration (working days)" />
        <label className="tl-qa-link" title="Make the new task finish-to-start dependent on the task before it">
          <input type="checkbox" checked={qa.link} onChange={(e) => setQa({ ...qa, link: e.target.checked })} /> Link to previous
        </label>
        <span className="tl-qa-hint">⏎ to add, next task starts right after this one</span>
      </div>

      <ProgrammeChart
        w={w}
        zoom={zoom}
        critical={critical}
        critOnly={critOnly}
        contractor={contractor}
        linking={linking}
        linkFrom={linkFrom}
        selected={modal?.task.code ?? null}
        compact={compact}
        colWidths={colWidths}
        todayTick={todayTick}
        onColWidths={setColWidths}
        onApply={apply}
        onOpen={openTask}
        onLink={link}
        onRenameSection={promptRename}
        onDuplicateSection={(name) => {
          if (!w.tasks.some((t) => t.section === name)) return alert('That section has no tasks to duplicate yet.')
          setDialog({ kind: 'dup', section: name })
        }}
        onDeleteSection={(name) => {
          const n = w.tasks.filter((t) => t.section === name).length
          if (n) return setDialog({ kind: 'del', section: name })
          if (confirm(`Delete the empty section "${name}"?`)) apply(deleteSection(w, name, 'header'), `delete section "${name}"`)
        }}
        onInsertSectionBefore={(code) => {
          const name = prompt('New section name. This task and the ones after it (up to the next section) will move into it:')?.trim()
          if (name) apply(insertSectionBefore(w, code, name), `new section "${name}"`)
        }}
        onAddFirst={() => setModal({ task: draftTask(w), isNew: true })}
      />

      {toast && <div className="tl-toast">{toast}</div>}

      {modal && (
        <TaskModal
          w={w}
          task={modal.task}
          isNew={modal.isNew}
          contractors={contractorNames}
          onClose={() => setModal(null)}
          onSave={(t) => {
            setModal(null)
            let next = w
            if (t.trade && !(next.programme.trades ?? []).some((x) => x.name === t.trade)) next = addTrade(next, t.trade)
            if (t.section && !(next.programme.sections ?? []).some((s) => s.name === t.section)) next = addSection(next, t.section)
            const before = findTask(w, t.code)
            if (!modal.isNew && before && before.predecessors?.length && t.start_date !== before.start_date) {
              // a linked task given a new start: kept by adding to its links' lag (its new length too)
              const days = lengthOf(t, sd)
              next = saveTask(next, { ...t, start_date: before.start_date, finish_date: t.milestone ? before.start_date : finishFor(before.start_date, days, calendarOf(t, sd)) })
              next = setStart(next, t.code, t.start_date)
            } else next = saveTask(next, t)
            apply(next, modal.isNew ? `add ${t.name}` : `edit ${t.name}`)
          }}
          onDelete={() => {
            const t = modal.task
            setModal(null)
            apply(deleteTask(w, t.code), `delete ${t.name}`)
          }}
          onDuplicate={() => {
            const r = duplicateTask(w, modal.task.code)
            apply(r.w, `duplicate ${modal.task.name}`)
            const copy = findTask(r.w, r.code)
            setModal(copy ? { task: structuredClone(copy), isNew: false } : null)
          }}
        />
      )}
      {dialog?.kind === 'dup' && (
        <DuplicateSectionDialog
          name={dialog.section}
          count={w.tasks.filter((t) => t.section === dialog.section).length}
          onClose={() => setDialog(null)}
          onDuplicate={(o) => (setDialog(null), apply(duplicateSection(w, dialog.section, o), `duplicate section "${dialog.section}"`))}
        />
      )}
      {dialog?.kind === 'del' && (
        <DeleteSectionDialog
          name={dialog.section}
          count={w.tasks.filter((t) => t.section === dialog.section).length}
          onClose={() => setDialog(null)}
          onDelete={(mode) => (
            setDialog(null),
            apply(deleteSection(w, dialog.section, mode), mode === 'all' ? `delete section "${dialog.section}" and its tasks` : `delete section header "${dialog.section}"`)
          )}
        />
      )}
      {dialog?.kind === 'issue' && (
        <IssueDialog
          next={revName((lastRev?.rev_no ?? 0) + 1)}
          onClose={() => setDialog(null)}
          onIssue={async (note) => {
            await flush()
            const no = await issueRevision(programme.id, note, tl(), w.tasks.length)
            setRevisions(await listRevisions(programme.id))
            setDialog(null)
            flashToast(`${revName(no)} issued.`)
          }}
        />
      )}
      {dialog?.kind === 'history' && (
        <HistoryDialog
          programmeId={programme.id}
          revisions={revisions}
          current={tl()}
          onClose={() => setDialog(null)}
          onRestore={(state, label) => {
            const p = fromTimeline(state)
            const next = prepare(
              {
                ...programme,
                project_name: p.project_name,
                trades: p.trades,
                shutdowns: p.shutdowns,
                sections: p.sections,
                project_start: p.project_start,
                week_start: p.week_start,
                client_logo: p.client_logo,
              },
              p.tasks,
            )
            // the tasks keep their place in the database where their codes match, so links elsewhere hold
            for (const t of next.tasks) t.id = w.tasks.find((x) => x.code === t.code)?.id ?? t.id
            setDialog(null)
            apply(next, `restore ${label}`)
            flashToast(`${label} restored as the working programme. Undo to go back.`)
          }}
        />
      )}
      {dialog?.kind === 'previous' && (
        <PreviousDialog
          excludeId={programme.id}
          defaultStart={programme.project_start || defaults.start || new Date().toISOString().slice(0, 10)}
          onClose={() => setDialog(null)}
          onUse={(p, name) => {
            if (confirm(`Replace this programme with a copy of ${name}? Issued revisions of this one are kept in History.`))
              replace({ ...p, project_name: programme.project_name || p.project_name }, `Copied from ${name}`, `Programme copied from ${name}.`)
          }}
        />
      )}
      {dialog?.kind === 'import' && (
        <Modal
          title="Open file"
          onClose={() => setDialog(null)}
          footer={
            <>
              <span />
              <div className="tl-row-gap">
                <button className="tl-btn" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button className="tl-btn tl-btn-primary" onClick={() => replace(dialog.parsed, dialog.name, `Programme imported: ${dialog.parsed.tasks.length} tasks.`)}>
                  Replace this programme
                </button>
              </div>
            </>
          }
        >
          <ImportSummary p={dialog.parsed} name={dialog.name} />
          <p className="tl-p tl-light">This programme's issued revisions are kept in History. Issue a revision first if you want to keep a copy of it as it is now.</p>
        </Modal>
      )}
      {dialog?.kind === 'new' && (
        <Modal
          title="New programme"
          onClose={() => setDialog(null)}
          footer={
            <>
              <span />
              <div className="tl-row-gap">
                <button className="tl-btn" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  className="tl-btn tl-danger"
                  onClick={() =>
                    replace(
                      {
                        project_name: programme.project_name || ownerName,
                        start_date: null,
                        finish_date: null,
                        tasks: [],
                        trades: DEFAULT_TRADES,
                        project_start: programme.project_start ?? null,
                      },
                      'New programme',
                      'New programme started.',
                    )
                  }
                >
                  Clear it and start again
                </button>
              </div>
            </>
          }
        >
          <p className="tl-p">
            This clears every task from {ownerName}'s programme to start again. Issued revisions stay in History. To start from another job's programme instead, use{' '}
            <b>Programmes</b>.
          </p>
        </Modal>
      )}
    </div>
  )
}

const suggestedXmas = (w: Working) => {
  const sd = w.programme.shutdowns ?? []
  if (!w.tasks.length) return false
  const min = w.tasks.map((t) => t.start_date).sort()[0]
  const max = w.tasks
    .map((t) => t.finish_date)
    .sort()
    .pop()!
  for (let y = Number(min.slice(0, 4)); y <= Number(max.slice(0, 4)); y++) {
    const x = `${y}-12-25`
    if (x >= min && x <= max && !sd.some((p) => p.start <= x && p.end >= x)) return true
  }
  return false
}

function ImportSummary({ p, name }: { p: ParsedProgramme; name: string }) {
  const links = p.tasks.reduce((n, t) => n + (t.predecessors?.length ?? 0), 0)
  return (
    <p className="tl-p">
      <b>{p.project_name}</b> ({name}): {p.tasks.length} tasks{links ? `, ${links} links` : ''}
      {p.start_date ? `, ${ukDate(p.start_date)} to ${ukDate(p.finish_date)}` : ''}
      {p.shutdowns?.length ? ` · shutdowns: ${p.shutdowns.map((s) => s.name).join(', ')}` : ''}.
    </p>
  )
}

function Help() {
  return (
    <div className="tl-help-pop">
      <div className="tl-legend-title">Using the programme</div>
      <ul>
        <li>
          <b>Add:</b> type in Quick add and press Enter (press <kbd>N</kbd> to jump there); it starts after the last task and links to it. Or + Task / + Milestone / + Section.
        </li>
        <li>
          <b>Edit:</b> click a task; click its start or days in the list to type a new one (dates like 4/1 or 4/1/27); click the RAG dot to change it.
        </li>
        <li>
          <b>Move:</b> drag a bar; drag its right-hand end to change its length; drag rows in the list to reorder (by the ⋮⋮ grip on a touch screen).
        </li>
        <li>
          <b>Link:</b> Link tasks, then click the task that comes first and the one that follows it (Shift-click for start-to-start). Linked tasks move together.
        </li>
        <li>
          <b>Undo:</b> <kbd>Ctrl</kbd>+<kbd>Z</kbd> or Undo (the last 30 changes).
        </li>
        <li>
          <b>Saving:</b> automatic, for everyone. <b>Issue revision</b> keeps a numbered copy (Initial issue, Rev A…); <b>History</b> shows what changed.
        </li>
        <li>
          <b>Working days</b> are Monday to Friday, less shutdowns. Durations are working days.
        </li>
      </ul>
    </div>
  )
}

// ---------- no programme yet ----------
function StartPanel({
  owner,
  ownerName,
  job,
  defaults,
  onImport,
  onBlank,
  onEmpty,
  onGenerated,
  onPrevious,
}: {
  owner: Owner
  ownerName: string
  job?: Job
  defaults: { start?: string | null; pc?: string | null }
  onImport: (p: ParsedProgramme, name: string) => void
  onBlank: (start: string, pc: string) => void
  onEmpty: () => void
  onGenerated: () => void
  onPrevious: (p: ParsedProgramme, name: string) => void
}) {
  const [start, setStart] = useState(defaults.start ?? '')
  const [pc, setPc] = useState(defaults.pc ?? '')
  const [pending, setPending] = useState<{ p: ParsedProgramme; name: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [trades, setTrades] = useState<string[]>([])
  useEffect(() => {
    if (!job) return
    import('../../lib/cvr').then(({ loadPackages }) =>
      loadPackages(job.id).then(
        (ps) => setTrades(ps.filter((p) => p.kind === 'cost' && Number(p.budget ?? 0) > 0).map((p) => p.name)),
        () => setTrades([]),
      ),
    )
  }, [job])
  return (
    <div className="tl-start">
      <section className="card">
        <h2>Programme</h2>
        <p className="muted small">
          No programme for {ownerName} yet. Start one in any of these ways, then edit it here{'jobId' in owner ? '; the cashflow and procurement work from it' : ''}.
        </p>
        <div className="tl-start-grid">
          <div>
            <h3>Start from a previous programme</h3>
            <p className="muted small">Copy another job's or estimate's programme, moved to a new start date (links and sections kept).</p>
            <PreviousPicker defaultStart={start || new Date().toISOString().slice(0, 10)} onUse={onPrevious} />
          </div>
          <div>
            <h3>Import it</h3>
            <p className="muted small">From DBP Timeline (.json), P6 (.xer) or MS Project (.xml).</p>
            <label className="file-button">
              <input
                type="file"
                accept=".xer,.xml,.mpp,.json"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setErr(null)
                  try {
                    setPending({ p: await parseProgramme(f), name: f.name })
                  } catch (x) {
                    setErr((x as Error).message)
                  }
                }}
              />
              <span className="button">Choose the programme file…</span>
            </label>
            {err && <p className="error">{err}</p>}
            {pending && (
              <>
                <ImportSummary p={pending.p} name={pending.name} />
                <div className="form-actions">
                  <button className="primary" onClick={() => onImport(pending.p, pending.name)}>
                    Use this programme
                  </button>
                  <button onClick={() => setPending(null)}>Cancel</button>
                </div>
              </>
            )}
          </div>
          {job && (
            <div>
              <h3>Make a simple one from the SoW</h3>
              <GenerateProgramme job={job} trades={trades} onSaved={onGenerated} />
            </div>
          )}
          <div>
            <h3>Start a blank one</h3>
            <div className="form-grid">
              <label>
                Start on site
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label>
                Practical completion
                <input type="date" value={pc} onChange={(e) => setPc(e.target.value)} />
              </label>
            </div>
            <div className="form-actions">
              <button onClick={() => onBlank(start, pc)} disabled={!start || !pc || pc <= start}>
                Start with these two milestones
              </button>
              <button onClick={onEmpty}>Start empty</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// a previous programme chosen, with the date it should now start
function PreviousPicker({ defaultStart, excludeId, onUse }: { defaultStart: string; excludeId?: string; onUse: (p: ParsedProgramme, name: string) => void }) {
  const [list, setList] = useState<ProgrammeListItem[] | null>(null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<ProgrammeListItem | null>(null)
  const [start, setStart] = useState(defaultStart)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    listProgrammes().then(
      (l) => setList(l.filter((x) => x.id !== excludeId)),
      (e) => (setErr((e as Error).message), setList([])),
    )
  }, [excludeId])
  if (!list) return <p className="muted small">Loading programmes…</p>
  const shown = list.filter((p) => !q || `${p.owner} ${p.project_name}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="tl-prev">
      {err && <p className="error">{err}</p>}
      {!list.length ? (
        <p className="muted small">There are no other programmes yet.</p>
      ) : (
        <>
          <input type="search" placeholder="Search by job or estimate" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="tl-prev-list">
            {shown.slice(0, 50).map((p) => (
              <li key={p.id}>
                <button className={pick?.id === p.id ? 'on' : ''} onClick={() => setPick(p)}>
                  <b>{p.owner}</b>
                  <span className="muted small">
                    {p.project_name && p.project_name !== p.owner ? `${p.project_name} · ` : ''}
                    {p.start_date ? `${ukDate(p.start_date)} to ${ukDate(p.finish_date)}` : 'no tasks'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {pick && (
        <div className="form-grid">
          <label>
            New start date
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <div className="form-actions">
            <button
              className="primary"
              disabled={!start || busy}
              onClick={async () => {
                setBusy(true)
                setErr(null)
                try {
                  const src = await loadProgrammeById(pick.id)
                  const c = copyForNewStart(src, start)
                  const starts = c.tasks.map((t) => t.start_date).sort()
                  const ends = c.tasks.map((t) => t.finish_date).sort()
                  onUse(
                    {
                      project_name: src.programme.project_name || pick.owner,
                      start_date: starts[0] ?? null,
                      finish_date: ends.at(-1) ?? null,
                      tasks: c.tasks,
                      sections: c.sections,
                      trades: c.trades,
                      project_start: start,
                    },
                    pick.owner,
                  )
                } catch (e) {
                  setErr((e as Error).message)
                }
                setBusy(false)
              }}
            >
              {busy ? 'Copying…' : `Use ${pick.owner}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PreviousDialog({
  excludeId,
  defaultStart,
  onClose,
  onUse,
}: {
  excludeId: string
  defaultStart: string
  onClose: () => void
  onUse: (p: ParsedProgramme, name: string) => void
}) {
  return (
    <Modal title="Programmes: start from another one" onClose={onClose} wide>
      <p className="tl-p">
        Pick a job's or estimate's programme to copy into this one, moved to a new start date. Links, sections and trades are kept; RAG, progress and baselines are cleared.
      </p>
      <PreviousPicker defaultStart={defaultStart} excludeId={excludeId} onUse={onUse} />
    </Modal>
  )
}

// openCommitModal: the programme issued as the next revision
function IssueDialog({ next, onClose, onIssue }: { next: string; onClose: () => void; onIssue: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal
      title={`Issue ${next}`}
      onClose={onClose}
      footer={
        <>
          <span />
          <div className="tl-row-gap">
            <button className="tl-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="tl-btn tl-btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onIssue(note.trim())
                } catch (e) {
                  setErr(saveError(e))
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Issuing…' : `Issue ${next}`}
            </button>
          </div>
        </>
      }
    >
      <p className="tl-p">
        Keeps a copy of the programme as it is now as <b>{next}</b>, to look back at and compare in History. You carry on editing the working programme as normal.
      </p>
      <div className="tl-field">
        <label>Note (what's changed, who it's for)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Issued with tender; joinery resequenced after design review" autoFocus />
      </div>
      {err && <div className="tl-err">{err}</div>}
    </Modal>
  )
}

// openHistoryModal: issued revisions, what changed in each, restore one
function HistoryDialog({
  programmeId,
  revisions,
  current,
  onClose,
  onRestore,
}: {
  programmeId: string
  revisions: ProgrammeRevision[]
  current: TLState
  onClose: () => void
  onRestore: (state: TLState, label: string) => void
}) {
  const [open, setOpen] = useState<Record<number, string[] | 'loading'>>({})
  const [err, setErr] = useState<string | null>(null)
  const show = async (no: number | 'now') => {
    const key = no === 'now' ? 0 : no
    if (open[key]) return setOpen({ ...open, [key]: undefined as unknown as string[] })
    setOpen({ ...open, [key]: 'loading' })
    try {
      if (no === 'now') {
        const last = revisions[0]
        const data = last ? await loadRevisionData(programmeId, [last.rev_no]) : []
        setOpen((o) => ({ ...o, 0: last ? diffProgrammeData(data[0]?.data as TLState, current) : ['Not issued yet.'] }))
      } else {
        const data = await loadRevisionData(programmeId, [no - 1, no])
        const cur = data.find((d) => d.rev_no === no)?.data as TLState
        const prev = data.find((d) => d.rev_no === no - 1)?.data as TLState | undefined
        setOpen((o) => ({ ...o, [no]: diffProgrammeData(prev ?? null, cur) }))
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const fetchOne = async (no: number) => (await loadRevisionData(programmeId, [no]))[0]?.data as TLState
  return (
    <Modal title="History" onClose={onClose} wide>
      {err && <div className="tl-err">{err}</div>}
      <div className="tl-prog-row">
        <div className="tl-prog-main">
          <div className="tl-prog-name">
            <span className="tl-rev-badge draft">Working</span> The programme as it is now
          </div>
          <div className="tl-prog-meta">Saved automatically as you go</div>
          {Array.isArray(open[0]) && <Diff lines={open[0] as string[]} />}
        </div>
        <button className="tl-btn tl-btn-sm" onClick={() => show('now')}>
          {open[0] ? 'Hide' : 'Changes since last issue'}
        </button>
      </div>
      {!revisions.length && <p className="tl-p tl-light">Nothing issued yet. Use Issue revision to keep a numbered copy (Initial issue, then Rev A, Rev B…).</p>}
      {revisions.map((r) => (
        <div key={r.id} className="tl-prog-row">
          <div className="tl-prog-main">
            <div className="tl-prog-name">
              <span className="tl-rev-badge">{revName(r.rev_no)}</span> {r.note || <span className="tl-light">No note</span>}
            </div>
            <div className="tl-prog-meta">
              Issued {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })} · {r.task_count}{' '}
              tasks
            </div>
            {Array.isArray(open[r.rev_no]) && <Diff lines={open[r.rev_no] as string[]} />}
          </div>
          <div className="tl-row-gap">
            <button className="tl-btn tl-btn-sm" onClick={() => show(r.rev_no)}>
              {open[r.rev_no] ? 'Hide' : 'What changed'}
            </button>
            <button
              className="tl-btn tl-btn-sm"
              onClick={async () => downloadFile(`${revName(r.rev_no)}.json`, JSON.stringify(await fetchOne(r.rev_no), null, 2), 'application/json')}
            >
              Download
            </button>
            <button
              className="tl-btn tl-btn-sm"
              onClick={async () => {
                if (confirm(`Make ${revName(r.rev_no)} the working programme again? (You can undo this.)`)) onRestore(await fetchOne(r.rev_no), revName(r.rev_no))
              }}
            >
              Restore
            </button>
          </div>
        </div>
      ))}
    </Modal>
  )
}
function Diff({ lines }: { lines: string[] }) {
  return <div className="tl-rev-diff">{lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : <div>No changes.</div>}</div>
}
