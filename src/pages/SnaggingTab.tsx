import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { saveError } from '../lib/offline'
import { ukDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import { emlDraft, escHtml } from '../lib/orders'
import { useJob } from './JobLayout'
import {
  STATE_LABEL,
  issueSnagLink,
  loadAssignees,
  loadLinkStatus,
  loadSnags,
  revokeSnagLinks,
  snagPhotoBlob,
  stateOf,
  type Assignee,
  type Snag,
  type SnagFile,
  type SnagState,
} from '../lib/snags'
import { buildSnagListPdf, snagFileName } from '../lib/exportSnags'

// Job › Snagging. Made for a phone: big touch targets, a card per snag, the + New snag button always in reach. Filter by status
// and by trade; "Snag lists" compiles the whole list, or one per trade, and drafts the emails to each trade with their own link.
type Filter = 'open' | SnagState | 'all'

export default function SnaggingTab() {
  const { job } = useJob()
  const [data, setData] = useState<{ snags: Snag[]; photos: Record<string, number> } | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [who, setWho] = useState('') // a company, 'none' (not assigned) or '' (everyone)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(40)
  const [panel, setPanel] = useState(false)

  const reload = () => loadSnags(job.id).then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
    loadAssignees(job.id).then(setAssignees, () => setAssignees([]))
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDir = useMemo(() => new Map(assignees.map((a) => [a.id, a])), [assignees])
  const companyOf = (s: Snag) => (s.assignee_id ? (byDir.get(s.assignee_id)?.companyId ?? 'none') : 'none')
  const snags = data?.snags ?? []
  const count = (st: SnagState) => snags.filter((s) => stateOf(s) === st).length

  // the trades that have snags, for the filter
  const trades = useMemo(() => {
    const m = new Map<string, { name: string; trade: string; n: number }>()
    for (const s of snags) {
      const id = companyOf(s)
      if (id === 'none') continue
      const a = byDir.get(s.assignee_id!)!
      const e = m.get(id) ?? { name: a.company, trade: a.trade, n: 0 }
      e.n++
      m.set(id, e)
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [snags, byDir]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = snags.filter((s) => {
    const st = stateOf(s)
    if (filter === 'open' ? st === 'complete' : filter !== 'all' && st !== filter) return false
    if (who && companyOf(s) !== who) return false
    if (q.trim()) {
      const t = `${s.number} ${s.title} ${s.location ?? ''} ${s.description ?? ''} ${s.trade ?? ''} ${byDir.get(s.assignee_id ?? '')?.company ?? ''}`.toLowerCase()
      if (!q.toLowerCase().split(/\s+/).every((w) => t.includes(w))) return false
    }
    return true
  })

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  return (
    <div className="snag-page">
      <div className="snag-bar">
        <div className="snag-stats">
          <button className={`snag-stat todo ${filter === 'todo' ? 'on' : ''}`} onClick={() => setFilter(filter === 'todo' ? 'open' : 'todo')}>
            <strong>{count('todo')}</strong>
            <span>To do</span>
          </button>
          <button className={`snag-stat check ${filter === 'check' ? 'on' : ''}`} onClick={() => setFilter(filter === 'check' ? 'open' : 'check')}>
            <strong>{count('check')}</strong>
            <span>To check</span>
          </button>
          <button className={`snag-stat complete ${filter === 'complete' ? 'on' : ''}`} onClick={() => setFilter(filter === 'complete' ? 'open' : 'complete')}>
            <strong>{count('complete')}</strong>
            <span>Complete</span>
          </button>
        </div>
        <div className="snag-actions">
          <Link to="new" className="button primary snag-new">
            + New snag
          </Link>
          <button onClick={() => setPanel(!panel)} aria-expanded={panel}>
            Snag lists
          </button>
        </div>
      </div>

      {panel && <SnagLists job={job} snags={snags} assignees={assignees} onClose={() => setPanel(false)} />}

      <div className="snag-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Status">
          <option value="open">Not complete</option>
          <option value="todo">To do</option>
          <option value="check">To check</option>
          <option value="complete">Complete</option>
          <option value="all">All</option>
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Trade">
          <option value="">All trades</option>
          {trades.map(([id, t]) => (
            <option key={id} value={id}>
              {t.name}
              {t.trade ? ` · ${t.trade}` : ''} ({t.n})
            </option>
          ))}
          {snags.some((s) => companyOf(s) === 'none') && <option value="none">Not assigned</option>}
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search snags…" aria-label="Search" />
      </div>

      {snags.length === 0 && (
        <div className="card">
          <p>
            <strong>No snags yet.</strong> Tap <em>+ New snag</em> to log the first one: take a photo, name it, say where it is and who has to put it right. Each is numbered 1, 2, 3 on this job and the number never changes.
          </p>
        </div>
      )}
      {snags.length > 0 && shown.length === 0 && <p className="muted">No snags match.</p>}

      <ul className="snag-list">
        {shown.slice(0, limit).map((s) => {
          const st = stateOf(s)
          const a = s.assignee_id ? byDir.get(s.assignee_id) : null
          const n = data.photos[s.id] ?? 0
          return (
            <li key={s.id}>
              <Link to={s.id} className={`snag-card ${st}`}>
                <span className="snag-no">{s.number}</span>
                <span className="snag-main">
                  <strong>{s.title}</strong>
                  <span className="muted small">
                    {[s.location, a ? a.company : 'Not assigned'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="snag-side">
                  <span className={`snag-chip ${st}`}>{STATE_LABEL[st]}</span>
                  {n > 0 && <span className="attach-badge">📷 {n}</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {shown.length > limit && (
        <button className="snag-more" onClick={() => setLimit(limit + 60)}>
          Show more ({shown.length - limit} more)
        </button>
      )}
    </div>
  )
}

// ---------- compile a snag list, one per trade, and email each trade ----------
function SnagLists({ job, snags, assignees, onClose }: { job: ReturnType<typeof useJob>['job']; snags: Snag[]; assignees: Assignee[]; onClose: () => void }) {
  const [withComplete, setWithComplete] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [links, setLinks] = useState<Awaited<ReturnType<typeof loadLinkStatus>>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadLinkStatus(job.id).then(setLinks)
  }, [job.id])

  const byDir = new Map(assignees.map((a) => [a.id, a]))
  const live = (s: Snag) => withComplete || stateOf(s) !== 'complete'
  // each trade: its snags and who to send them to
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; trade: string; snags: Snag[]; emails: string[] }>()
    for (const s of snags.filter(live)) {
      const a = s.assignee_id ? byDir.get(s.assignee_id) : null
      if (!a) continue
      const g = m.get(a.companyId) ?? { id: a.companyId, name: a.company, trade: a.trade, snags: [], emails: [] }
      g.snags.push(s)
      if (a.email && !g.emails.includes(a.email)) g.emails.push(a.email)
      m.set(a.companyId, g)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [snags, assignees, withComplete]) // eslint-disable-line react-hooks/exhaustive-deps
  const unassigned = snags.filter((s) => live(s) && !s.assignee_id).length
  const picked = groups.filter((g) => chosen.has(g.id))
  const toggle = (id: string) => setChosen((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])))

  // the first photo of each snag, for the PDF
  async function firstPhotos(list: Snag[]) {
    const out = new Map<string, Blob | null>()
    const f = await supabase.from('snag_files').select('*').in('snag_id', list.map((s) => s.id)).eq('kind', 'raised').order('created_at')
    const first = new Map<string, SnagFile>()
    for (const x of (f.data ?? []) as SnagFile[]) if (!first.has(x.snag_id)) first.set(x.snag_id, x)
    const todo = [...first.values()]
    for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(async (x) => out.set(x.snag_id, await snagPhotoBlob(x.path))))
    return out
  }
  const who = (s: Snag) => (s.assignee_id ? (byDir.get(s.assignee_id)?.company ?? '') : '')
  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const run = async (key: string, f: () => Promise<void>) => {
    setError(null)
    setMsg(null)
    setBusy(key)
    try {
      await f()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(null)
  }
  const sorted = (list: Snag[]) => [...list].sort((a, b) => a.number - b.number)

  const compiled = () =>
    run('all', async () => {
      const list = snags.filter(live).sort((a, b) => who(a).localeCompare(who(b)) || a.number - b.number)
      const blob = await buildSnagListPdf({ job, title: 'Snag list', snags: list, who, photos: await firstPhotos(list), showWho: true })
      save(blob, snagFileName(job, 'all trades'))
      setMsg(`Compiled list made: ${list.length} snag${list.length === 1 ? '' : 's'}.`)
    })
  const perTrade = (only?: string) =>
    run(only ?? 'each', async () => {
      const gs = only ? groups.filter((g) => g.id === only) : picked.length ? picked : groups
      for (const g of gs) {
        const list = sorted(g.snags)
        save(await buildSnagListPdf({ job, title: `Snag list: ${g.name}`, snags: list, who, photos: await firstPhotos(list), showWho: false }), snagFileName(job, g.name))
      }
      setMsg(`${gs.length} list${gs.length === 1 ? '' : 's'} made, one per trade.`)
    })
  const emails = () =>
    run('mail', async () => {
      const gs = picked.length ? picked : groups
      let noAddress = 0
      for (const g of gs) {
        const list = sorted(g.snags)
        const link = await issueSnagLink(job.id, g.id)
        const pdf = await buildSnagListPdf({ job, title: `Snag list: ${g.name}`, snags: list, who, photos: await firstPhotos(list), showWho: false })
        const open = list.filter((s) => stateOf(s) !== 'complete').length
        const html =
          `<p>Hello,</p><p>Please find attached the snag list for <strong>${escHtml(job.job_no + ' ' + job.code + ' ' + job.name)}</strong>: ${open} item${open === 1 ? '' : 's'} for ${escHtml(g.name)} to put right.</p>` +
          `<p>You can also see your list on your phone, tick each snag off when it is done and add a photo as proof, with no login: <a href="${escHtml(link)}">${escHtml(link)}</a></p>` +
          `<p>Please let us know if you have any questions.</p>`
        if (!g.emails.length) noAddress++
        const eml = await emlDraft({ to: g.emails, subject: `Snag list: ${job.job_no} ${job.code} ${job.name} (${g.name})`, html, attachments: [{ name: snagFileName(job, g.name), blob: pdf }] })
        save(eml, `Snag list - ${g.name}.eml`)
      }
      setLinks(await loadLinkStatus(job.id))
      setMsg(`${gs.length} email draft${gs.length === 1 ? '' : 's'} made. Open each in Outlook to check it and send. Nothing has been sent.${noAddress ? ` ${noAddress} had no email address: add one in Supply Chain.` : ''}`)
    })
  const copyLink = (id: string) =>
    run('link' + id, async () => {
      const url = await issueSnagLink(job.id, id)
      await navigator.clipboard?.writeText(url).catch(() => {})
      setMsg(`Link copied: ${url}`)
      setLinks(await loadLinkStatus(job.id))
    })
  const withdraw = (id: string, name: string) =>
    confirm(`Withdraw ${name}'s links? Any link already sent to them stops working.`) &&
    run('w' + id, async () => {
      await revokeSnagLinks(job.id, id)
      setLinks(await loadLinkStatus(job.id))
      setMsg('Links withdrawn.')
    })
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname)

  return (
    <section className="card snag-lists">
      <div className="pane-head">
        <h2>Snag lists</h2>
        <button className="small-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted small">
        Make one list of everything, or a list for each trade, and draft the emails to send them. Each trade also gets a private link to their own list, where they can tick snags off and add a photo as proof, with no login. When they tick one, the person who raised it gets a task to check it.
      </p>
      {local && <p className="pqq-warning small">This copy of the app is running on your own computer, so links made here won't open for anyone else.</p>}
      <label className="rfi-notify">
        <input type="checkbox" checked={withComplete} onChange={(e) => setWithComplete(e.target.checked)} /> Include complete snags
      </label>
      {groups.length === 0 ? (
        <p className="muted">Nothing to list yet: give some snags an assignee.</p>
      ) : (
        <ul className="snag-trades">
          {groups.map((g) => {
            const l = links.get(g.id)
            return (
              <li key={g.id}>
                <label className="snag-trade-pick">
                  <input type="checkbox" checked={chosen.has(g.id)} onChange={() => toggle(g.id)} />
                  <span>
                    <strong>{g.name}</strong>
                    <span className="muted small">
                      {' '}
                      {g.trade ? `${g.trade} · ` : ''}
                      {g.snags.length} snag{g.snags.length === 1 ? '' : 's'}
                      {g.emails.length ? '' : ' · no email address'}
                    </span>
                    <span className="muted small block">{l?.active ? `Link ${l.uses ? `opened ${l.uses} time${l.uses === 1 ? '' : 's'}${l.lastUsed ? `, last ${ukDate(l.lastUsed.slice(0, 10))}` : ''}` : 'sent, not opened yet'}` : 'No link yet'}</span>
                  </span>
                </label>
                <span className="snag-trade-btns">
                  <button className="small-button" disabled={!!busy} onClick={() => perTrade(g.id)}>
                    PDF
                  </button>
                  <button className="small-button" disabled={!!busy} onClick={() => copyLink(g.id)} title="Copy a private link to send yourself">
                    Copy link
                  </button>
                  {!!l?.active && (
                    <button className="small-button" disabled={!!busy} onClick={() => withdraw(g.id, g.name)}>
                      Withdraw
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {unassigned > 0 && <p className="muted small">{unassigned} snag{unassigned === 1 ? ' has' : 's have'} no assignee, so only appear on the compiled list.</p>}
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      <div className="form-actions snag-list-actions">
        <button className="primary" disabled={!!busy} onClick={compiled}>
          {busy === 'all' ? 'Making…' : 'Compiled list (PDF)'}
        </button>
        <button disabled={!!busy || !groups.length} onClick={() => perTrade()}>
          {busy === 'each' ? 'Making…' : picked.length ? `List per trade (${picked.length} ticked)` : 'List per trade (all)'}
        </button>
        <button disabled={!!busy || !groups.length} onClick={emails}>
          {busy === 'mail' ? 'Making…' : picked.length ? `Email drafts (${picked.length} ticked)` : 'Email drafts (all)'}
        </button>
      </div>
    </section>
  )
}
