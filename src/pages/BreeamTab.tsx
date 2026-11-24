import { useEffect, useMemo, useRef, useState } from 'react'
import { saveError } from '../lib/offline'
import { useJob } from './JobLayout'
import { ACTIONS, STATUSES, addItems, deleteItem, deleteItems, fileEvidence, lineKey, loadBreeam, loadEvidence, readTracker, removeEvidence, scoreOverview, updateItem, type BreeamEvidence, type BreeamItem, type BreeamStatus } from '../lib/breeam'
import { chooseFolder, folderAccess, folderSupported, linkedFolderName, unlinkFolder } from '../lib/orderFolder'
import { loadXlsx } from '../lib/xlsxLoad'

// Job › BREEAM (script 071): the tracker, worked like the sampling tracker. A dropdown per line, filters by status and category,
// an import from the Excel tracker the assessor sends, and an export to send it back.
const cellText = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string; hyperlink?: string }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return cellText(o.result)
    if (o.text !== undefined) return o.text
    if (o.hyperlink) return o.hyperlink
  }
  return v
}

const fmt = (n: number) => String(Math.round(n * 10) / 10)

// The first thing on the page: how close the job is. Per section the credits achieved against targeted and available, with a bar;
// click a section to filter the lines below to it.
function ScoreOverview({ score, cat, onPick }: { score: ReturnType<typeof scoreOverview>; cat: string; onPick: (c: string) => void }) {
  const t = score.total
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
  const toGo = Math.max(0, t.targeted - t.achieved)
  return (
    <section className="card breeam-score">
      <div className="breeam-headline">
        <div>
          <strong className="big">{pct(t.achieved, t.targeted)}%</strong>
          <span>of targeted credits achieved</span>
        </div>
        <div>
          <strong className="big">
            {fmt(t.achieved)} / {fmt(t.targeted)}
          </strong>
          <span>{toGo > 0 ? `${fmt(toGo)} targeted credits still to achieve` : 'all targeted credits achieved'}</span>
        </div>
        <div>
          <strong className="big">{pct(t.targeted, t.available)}%</strong>
          <span>
            of available credits targeted ({fmt(t.targeted)} of {fmt(t.available)})
          </span>
        </div>
        <div>
          <strong className="big">{pct(t.achieved, t.available)}%</strong>
          <span>of available credits achieved</span>
        </div>
        {t.prereqs > 0 && (
          <div>
            <strong className="big">
              {t.prereqsMet} / {t.prereqs}
            </strong>
            <span>prerequisites met</span>
          </div>
        )}
      </div>
      <table className="table breeam-score-table">
        <thead>
          <tr>
            <th>Section</th>
            <th className="num">Achieved</th>
            <th className="num">Targeted</th>
            <th className="num">Available</th>
            <th className="bar-col">Progress to target</th>
            <th className="num">Still to get</th>
          </tr>
        </thead>
        <tbody>
          {score.rows.map((r) => (
            <tr key={r.category} className={cat === r.category ? 'on' : ''} onClick={() => onPick(r.category)} title="Show just this section">
              <td>
                <strong>{r.category}</strong>
              </td>
              <td className="num">{fmt(r.achieved)}</td>
              <td className="num">{fmt(r.targeted)}</td>
              <td className="num">{fmt(r.available)}</td>
              <td className="bar-col">
                <div className="breeam-bar" aria-label={`${pct(r.achieved, r.targeted)}% of target`}>
                  <i style={{ width: `${Math.min(100, pct(r.achieved, r.targeted))}%` }} />
                  <span>{pct(r.achieved, r.targeted)}%</span>
                </div>
              </td>
              <td className="num">{fmt(Math.max(0, r.targeted - r.achieved))}</td>
            </tr>
          ))}
          <tr className="total">
            <td>
              <strong>Total</strong>
            </td>
            <td className="num">{fmt(t.achieved)}</td>
            <td className="num">{fmt(t.targeted)}</td>
            <td className="num">{fmt(t.available)}</td>
            <td className="bar-col">
              <div className="breeam-bar">
                <i style={{ width: `${Math.min(100, pct(t.achieved, t.targeted))}%` }} />
                <span>{pct(t.achieved, t.targeted)}%</span>
              </div>
            </td>
            <td className="num">{fmt(toGo)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

type Change = (i: BreeamItem, patch: Partial<BreeamItem>) => void

// One credit as a table row, in the order of the assessor's tracker: ref, credit, available / targeted / achieved, criteria, evidence
// required (with the evidence filed against it), action by; then the status dropdown and comments.
function LineRow({ i, evidence, actions, change, onAttach, onUnfile, onDelete }: { i: BreeamItem; evidence: BreeamEvidence[]; actions: string[]; change: Change; onAttach: (i: BreeamItem, f: FileList) => void; onUnfile: (e: BreeamEvidence) => void; onDelete: () => void }) {
  const pick = useRef<HTMLInputElement>(null)
  const nums = [
    ['Available', 'credits_available'],
    ['Targeted', 'credits_targeted'],
    ['Achieved', 'credits_achieved'],
  ] as const
  return (
    <tr className={`bt-row ${i.status}`}>
      <td data-label="Ref">
        <input defaultValue={i.ref ?? ''} onBlur={(e) => e.target.value !== (i.ref ?? '') && change(i, { ref: e.target.value || null })} />
      </td>
      <td data-label="Credit">
        <textarea defaultValue={i.title} onBlur={(e) => e.target.value.trim() && e.target.value !== i.title && change(i, { title: e.target.value.trim() })} />
      </td>
      {nums.map(([label, f]) => (
        <td key={f} data-label={label} className="bt-num">
          {i.prerequisite && i[f] == null ? (
            <b className="b-p" title="Prerequisite: a must-have, no credit">P</b>
          ) : (
            <input type="number" step="0.5" defaultValue={i[f] ?? ''} onBlur={(e) => e.target.value !== String(i[f] ?? '') && change(i, { [f]: e.target.value === '' ? null : Number(e.target.value) })} />
          )}
        </td>
      ))}
      <td data-label="Credit criteria">
        <textarea defaultValue={i.criteria ?? ''} onBlur={(e) => e.target.value !== (i.criteria ?? '') && change(i, { criteria: e.target.value || null })} />
      </td>
      <td data-label="Evidence required">
        <textarea defaultValue={i.evidence ?? ''} onBlur={(e) => e.target.value !== (i.evidence ?? '') && change(i, { evidence: e.target.value || null })} />
      </td>
      <td data-label="Action">
        <select
          value={i.responsible ?? ''}
          onChange={(e) => {
            if (e.target.value !== '__new__') return change(i, { responsible: e.target.value || null })
            const v = prompt('Who is responsible for this line?')?.trim()
            if (v) change(i, { responsible: v })
          }}
        >
          <option value="">Not assigned</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__new__">Other… (type a new one)</option>
        </select>
      </td>
      <td data-label="Status">
        <select value={i.status} className={`b-status ${i.status}`} onChange={(e) => change(i, { status: e.target.value as BreeamStatus })}>
          {STATUSES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td data-label="Comments">
        <textarea defaultValue={i.comments ?? ''} onBlur={(e) => e.target.value !== (i.comments ?? '') && change(i, { comments: e.target.value || null })} />
      </td>
      <td data-label="Evidence filed">
        <div className="bl-files bl-filed">
          {evidence.map((ev) => (
            <span key={ev.id} className="bl-file" title={`Filed in ${ev.folder ?? ''} by ${ev.added_by_name ?? ''} on ${new Date(ev.created_at).toLocaleDateString('en-GB')}`}>
              📎 {ev.file_name}
              <button type="button" aria-label="Remove from the list (the file stays in SharePoint)" onClick={() => onUnfile(ev)}>
                ✕
              </button>
            </span>
          ))}
          <input ref={pick} type="file" multiple hidden onChange={(e) => (e.target.files?.length && onAttach(i, e.target.files), (e.target.value = ''))} />
          <button
            type="button"
            className="bl-attach primary"
            title="Attach evidence: filed into the job's SharePoint folder"
            onClick={async () => {
              // the browser's folder-permission prompt must come straight from a click, so it is asked for here first
              if (await folderAccess(i.job_id, 'breeam')) pick.current?.click()
              else alert('Link the job\'s BREEAM folder first (the "Link BREEAM folder" button at the top), and allow access when the browser asks.')
            }}
          >
            📎 Attach evidence
          </button>
        </div>
      </td>
      <td className="bt-del">
        <button className="small-button" title="Remove this line" onClick={onDelete}>
          ✕
        </button>
      </td>
    </tr>
  )
}

export default function BreeamTab() {
  const { job } = useJob()
  const [items, setItems] = useState<BreeamItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<BreeamStatus | 'all' | 'open'>('all')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [cf, setCf] = useState<Record<string, string>>({}) // the filter above each column
  const setF = (k: string, v: string) => setCf((o) => ({ ...o, [k]: v }))
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ ref: '', category: '', title: '' })

  const [evidence, setEvidence] = useState<BreeamEvidence[]>([])
  const [linked, setLinked] = useState<string | null>(null)
  const reload = () => loadBreeam(job.id).then(setItems, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
    loadEvidence(job.id).then(setEvidence, () => setEvidence([])) // an unrun script 073 just means no evidence list yet
    linkedFolderName(job.id, 'breeam').then(setLinked)
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const actions = useMemo(() => [...new Set([...ACTIONS, ...(items ?? []).map((x) => x.responsible).filter((x): x is string => !!x)])].sort((x, y) => x.localeCompare(y)), [items])
  async function attach(i: BreeamItem, files: FileList) {
    setError(null)
    setMsg(null)
    try {
      for (const file of Array.from(files)) {
        const ev = await fileEvidence(job.id, i, file)
        setEvidence((l) => [...l, ev])
        setMsg(`Filed "${file.name}" in ${ev.folder}`)
      }
    } catch (e) {
      setError(saveError(e))
    }
  }
  const unfile = (ev: BreeamEvidence) => removeEvidence(ev.id).then(() => setEvidence((l) => l.filter((x) => x.id !== ev.id)), (e: Error) => setError(e.message))

  const all = items ?? []
  const count = (s: BreeamStatus) => all.filter((i) => i.status === s).length
  const categories = useMemo(() => [...new Set(all.map((i) => i.category || 'Other'))], [all])
  const shown = all.filter((i) => {
    if (filter === 'open' ? !['not_complete', 'in_progress'].includes(i.status) : filter !== 'all' && i.status !== filter) return false
    if (cat && (i.category || 'Other') !== cat) return false
    if (q.trim()) {
      const t = `${i.ref ?? ''} ${i.title} ${i.responsible ?? ''} ${i.comments ?? ''}`.toLowerCase()
      if (!q.toLowerCase().split(/\s+/).every((w) => t.includes(w))) return false
    }
    const has = (v: string | null | undefined, w: string | undefined) => !w?.trim() || (v ?? '').toLowerCase().includes(w.trim().toLowerCase())
    const numIs = (v: number | null, w: string | undefined) => !w?.trim() || (w.trim() === '-' ? v == null : v != null && String(v).startsWith(w.trim()))
    if (!has(i.ref, cf.ref) || !has(i.title, cf.title) || !has(i.criteria, cf.crit) || !has(i.evidence, cf.evid) || !has(i.comments, cf.comm)) return false
    if (!numIs(i.credits_available, cf.avail) || !numIs(i.credits_targeted, cf.targ) || !numIs(i.credits_achieved, cf.ach)) return false
    if (cf.action && (cf.action === '__none__' ? !!i.responsible : i.responsible !== cf.action)) return false
    if (cf.status && i.status !== cf.status) return false
    if (cf.filed === 'yes' ? !evidence.some((e) => e.item_id === i.id) : cf.filed === 'no' && evidence.some((e) => e.item_id === i.id)) return false
    return true
  })
  const groups = categories.map((c) => ({ c, rows: shown.filter((i) => (i.category || 'Other') === c) })).filter((g) => g.rows.length)
  const score = useMemo(() => scoreOverview(all), [all])

  async function change(i: BreeamItem, patch: Partial<BreeamItem>) {
    setError(null)
    if (patch.status === 'completed' && (i.credits_achieved ?? 0) < (i.credits_targeted ?? 0)) patch = { ...patch, credits_achieved: i.credits_targeted }
    setItems((l) => (l ?? []).map((x) => (x.id === i.id ? { ...x, ...patch } : x)))
    try {
      await updateItem(i.id, patch)
    } catch (e) {
      setError(saveError(e))
      reload()
    }
  }
  async function importFile(file: File) {
    setError(null)
    setMsg(null)
    setBusy(true)
    try {
      const wb = await loadXlsx(await file.arrayBuffer())
      const sheets = wb.worksheets.map((ws) => {
        const rows: unknown[][] = []
        ws.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellText)))
        return { name: ws.name, rows }
      })
      const { items: read, sheet } = readTracker(sheets)
      if (!read.length) throw new Error("Couldn't find a tracker in that file. It needs a heading row with words like Credits Available, Credits Targeted and Credit Criteria.")
      // lines already on the tracker (same ref and wording) aren't added twice
      const key = (x: { category: string | null; ref: string | null; title: string; criteria: string | null }) => `${lineKey(x)}|${(x.criteria ?? '').slice(0, 40).toLowerCase()}`
      // The file is the master for what the lines say: a line already on the tracker is brought up to date from the file (credits,
      // criteria, evidence required; its status, action and comments are kept), new lines are added, and leftovers from earlier
      // imports (no section or no ref: section headings that were read as lines) are removed. Lines added by hand are kept.
      const mine = new Map<string, BreeamItem>()
      const dupes: string[] = []
      for (const x of all) (mine.has(key(x)) ? dupes.push(x.id) : mine.set(key(x), x))
      const seen = new Set<string>()
      // lines that hold something typed by a person, found again by ref + name (or name alone) when the file's line is new
      const oldLine = new Map<string, BreeamItem>()
      for (const x of all) {
        if (!(x.comments || x.responsible || x.due_date || x.evidence_link || x.status !== 'not_complete')) continue
        oldLine.set(`${(x.ref ?? '').toLowerCase()}|${x.title.toLowerCase()}`, x)
        if (!oldLine.has(x.title.toLowerCase())) oldLine.set(x.title.toLowerCase(), x)
      }
      const fresh: typeof read = []
      const updates: [string, Partial<BreeamItem>][] = []
      read.forEach((x, k) => {
        const k0 = key(x)
        if (seen.has(k0)) return
        seen.add(k0)
        const have = mine.get(k0)
        if (!have) {
          // an older line for the same credit (e.g. from an earlier import with no section) hands over what was typed against it
          const old = oldLine.get(`${(x.ref ?? '').toLowerCase()}|${x.title.toLowerCase()}`) ?? oldLine.get(x.title.toLowerCase())
          return void fresh.push(old ? { ...x, comments: old.comments ?? x.comments, responsible: old.responsible ?? x.responsible, due_date: old.due_date ?? x.due_date, evidence_link: old.evidence_link ?? x.evidence_link, status: old.status !== 'not_complete' ? old.status : x.status, sort: k } : { ...x, sort: k })
        }
        updates.push([have.id, { ref: x.ref, category: x.category, title: x.title, credits_available: x.credits_available, credits_targeted: x.credits_targeted, credits_achieved: x.credits_achieved, criteria: x.criteria, evidence: x.evidence, prerequisite: x.prerequisite, responsible: have.responsible ?? x.responsible, sort: k }])
      })
      const stale = all.filter((x) => (!x.category || !x.ref || dupes.includes(x.id)) && !seen.has(key(x))).map((x) => x.id)
      const stale2 = all.filter((x) => dupes.includes(x.id) && !stale.includes(x.id)).map((x) => x.id)
      await deleteItems([...stale, ...stale2])
      for (let n = 0; n < updates.length; n += 10) await Promise.all(updates.slice(n, n + 10).map(([id, p]) => updateItem(id, p)))
      await addItems(job.id, fresh)
      setMsg(`Imported "${sheet}": ${fresh.length} new line${fresh.length === 1 ? '' : 's'}, ${updates.length} updated from the file${stale.length + stale2.length ? `, ${stale.length + stale2.length} old line${stale.length + stale2.length === 1 ? '' : 's'} removed (headings and duplicates from earlier imports)` : ''}.`)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }
  async function add() {
    if (!draft.title.trim()) return setError('Give the line a title.')
    setBusy(true)
    try {
      await addItems(job.id, [{ ref: draft.ref.trim() || null, category: draft.category.trim() || null, title: draft.title.trim(), credits_available: null, credits_targeted: null, credits_achieved: null, criteria: null, evidence: null, prerequisite: false, responsible: null, status: 'not_complete', due_date: null, evidence_link: null, comments: null, sort: all.length }])
      setDraft({ ref: draft.ref.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, '0')), category: draft.category, title: '' })
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  if (error && !items) return <p className="error">{error}</p>
  if (!items) return <p className="muted">Loading…</p>

  return (
    <div className="breeam-page">
      <div className="pane-head">
        <h2>BREEAM tracker</h2>
        <div className="form-actions">
          <label className="file-button">
            <input type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => (e.target.files?.[0] && importFile(e.target.files[0]), (e.target.value = ''))} />
            <span className="button primary">{busy ? 'Working…' : 'Import tracker (Excel)'}</span>
          </label>
          <button onClick={() => setAdding(!adding)}>+ Add a line</button>
          <button disabled={!all.length} onClick={() => import('../lib/exportBreeam').then((m) => m.exportBreeam(job, all)).catch((e) => setError(saveError(e)))}>
            Export Excel
          </button>
        </div>
      </div>
      <p className="small app-controls">
        {!folderSupported() ? (
          <span className="muted">Filing evidence into the synced SharePoint folder needs Microsoft Edge or Google Chrome on a PC.</span>
        ) : linked ? (
          <>
            Evidence is filed into the synced folder <strong>{linked}</strong> on this computer (<em>08. BREEAM / section / credit</em>).{' '}
            <button type="button" className="link-button small" onClick={() => chooseFolder(job.id, 'breeam').then(setLinked, (e: Error) => e.name !== 'AbortError' && setError(e.message))}>
              Change
            </button>{' '}
            <button type="button" className="link-button small" onClick={() => unlinkFolder(job.id, 'breeam').then(() => setLinked(null))}>
              Unlink
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => chooseFolder(job.id, 'breeam').then(setLinked, (e: Error) => e.name !== 'AbortError' && setError(e.message))}>
              Link BREEAM folder…
            </button>{' '}
            <span className="muted">Pick the job's EXTERNAL folder (or its "08. BREEAM" folder) from the SharePoint synced to this PC. Evidence you attach to a line is then filed into it, in 08. BREEAM / section / credit. Asked once per job on each computer.</span>
          </>
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}

      {adding && (
        <div className="card breeam-add">
          <label>
            Ref
            <input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} placeholder="Man 03" />
          </label>
          <label>
            Category
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} list="breeam-cats" placeholder="Management" />
            <datalist id="breeam-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="grow">
            Issue / credit
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Responsible construction practices" />
          </label>
          <button className="primary" disabled={busy} onClick={add}>
            Add
          </button>
        </div>
      )}

      {all.length === 0 ? (
        <div className="card">
          <p>
            <strong>Nothing on the tracker yet.</strong> Use <em>Import tracker (Excel)</em> to bring in the one the assessor or client sends (it finds the heading row and the columns), or <em>+ Add a line</em> to build it by hand. Each line has a dropdown: Not complete, In progress, Completed, By others, No action required.
          </p>
        </div>
      ) : (
        <>
          <ScoreOverview score={score} cat={cat} onPick={(c) => setCat(cat === c ? '' : c)} />
          <div className="breeam-stats">
            {STATUSES.map(([k, l]) => (
              <button key={k} className={`breeam-stat ${k} ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? 'all' : k)}>
                <strong>{count(k)}</strong>
                <span>{l}</span>
              </button>
            ))}
          </div>
          <div className="snag-filters">
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Status">
              <option value="all">All statuses</option>
              <option value="open">Still to do (not complete + in progress)</option>
              {STATUSES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search" />
          </div>
          {groups.length === 0 && <p className="muted">Nothing matches.</p>}
          <div className="bt-wrap">
            <table className="bt-sheet">
              <colgroup>
                <col className="c-ref" />
                <col className="c-credit" />
                <col className="c-n" />
                <col className="c-n" />
                <col className="c-n" />
                <col className="c-crit" />
                <col className="c-evid" />
                <col className="c-action" />
                <col className="c-status" />
                <col className="c-comm" />
                <col className="c-filed" />
                <col className="c-del" />
              </colgroup>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Credit</th>
                  <th>Credits Available</th>
                  <th>Credits Targeted</th>
                  <th>Credits Achieved</th>
                  <th>Credit Criteria</th>
                  <th>Evidence Required</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Comments</th>
                  <th>Evidence filed</th>
                  <th />
                </tr>
                <tr className="bt-filters">
                  <th>
                    <input value={cf.ref ?? ''} onChange={(e) => setF('ref', e.target.value)} placeholder="Filter" aria-label="Filter ref" />
                  </th>
                  <th>
                    <input value={cf.title ?? ''} onChange={(e) => setF('title', e.target.value)} placeholder="Filter" aria-label="Filter credit" />
                  </th>
                  {(['avail', 'targ', 'ach'] as const).map((k) => (
                    <th key={k}>
                      <input value={cf[k] ?? ''} onChange={(e) => setF(k, e.target.value)} placeholder="≥" title="Starts with this number; - for blank" aria-label={`Filter ${k}`} />
                    </th>
                  ))}
                  <th>
                    <input value={cf.crit ?? ''} onChange={(e) => setF('crit', e.target.value)} placeholder="Filter" aria-label="Filter criteria" />
                  </th>
                  <th>
                    <input value={cf.evid ?? ''} onChange={(e) => setF('evid', e.target.value)} placeholder="Filter" aria-label="Filter evidence required" />
                  </th>
                  <th>
                    <select value={cf.action ?? ''} onChange={(e) => setF('action', e.target.value)} aria-label="Filter action">
                      <option value="">All</option>
                      <option value="__none__">Not assigned</option>
                      {actions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <select value={cf.status ?? ''} onChange={(e) => setF('status', e.target.value)} aria-label="Filter status">
                      <option value="">All</option>
                      {STATUSES.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <input value={cf.comm ?? ''} onChange={(e) => setF('comm', e.target.value)} placeholder="Filter" aria-label="Filter comments" />
                  </th>
                  <th>
                    <select value={cf.filed ?? ''} onChange={(e) => setF('filed', e.target.value)} aria-label="Filter evidence filed">
                      <option value="">All</option>
                      <option value="yes">Has evidence</option>
                      <option value="no">None filed</option>
                    </select>
                  </th>
                  <th />
                </tr>
              </thead>
              {groups.map((g) => {
                const s = score.rows.find((r) => r.category === g.c)
                return (
                  <tbody key={g.c}>
                    <tr className="bt-section">
                      <td colSpan={12}>{g.c.trim()}</td>
                    </tr>
                    {g.rows.map((i) => (
                      <LineRow key={i.id} i={i} evidence={evidence.filter((e) => e.item_id === i.id)} actions={actions} change={change} onAttach={attach} onUnfile={unfile} onDelete={() => confirm(`Remove ${i.ref ?? 'this line'}?`) && deleteItem(i.id).then(reload, (e) => setError(saveError(e)))} />
                    ))}
                    {s && (
                      <tr className="bt-total">
                        <td colSpan={2}>{g.c.trim()} Totals:</td>
                        <td>{fmt(s.available)}</td>
                        <td>{fmt(s.targeted)}</td>
                        <td>{fmt(s.achieved)}</td>
                        <td colSpan={7} />
                      </tr>
                    )}
                  </tbody>
                )
              })}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
