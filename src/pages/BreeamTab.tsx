import { useEffect, useMemo, useState } from 'react'
import { saveError } from '../lib/offline'
import { useJob } from './JobLayout'
import { STATUSES, addItems, deleteItem, lineKey, loadBreeam, readTracker, scoreOverview, updateItem, type BreeamItem, type BreeamStatus } from '../lib/breeam'
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

export default function BreeamTab() {
  const { job } = useJob()
  const [items, setItems] = useState<BreeamItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<BreeamStatus | 'all' | 'open'>('all')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ ref: '', category: '', title: '' })

  const reload = () => loadBreeam(job.id).then(setItems, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const have = new Set(all.map(key))
      const fresh = read.filter((x) => !have.has(key(x))).map((x, k) => ({ ...x, sort: all.length + k }))
      await addItems(job.id, fresh)
      setMsg(`Imported ${fresh.length} line${fresh.length === 1 ? '' : 's'} from "${sheet}"${read.length - fresh.length ? ` (${read.length - fresh.length} already on the tracker)` : ''}.`)
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
            <strong>Nothing on the tracker yet.</strong> Use <em>Import tracker (Excel)</em> to bring in the one the assessor or client sends (any layout: it finds the heading row), or <em>+ Add a line</em> to build it by hand. Each line has a dropdown: Not complete, In progress, Completed, By others, No action required.
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
          {groups.map((g) => (
            <section key={g.c} className="card breeam-group">
              <h3>
                {g.c}{' '}
                <span className="muted small">
                  {g.rows.length} line{g.rows.length === 1 ? '' : 's'}
                  {(() => {
                    const s = score.rows.find((r) => r.category === g.c)
                    return s ? ` · ${fmt(s.achieved)} of ${fmt(s.targeted)} targeted credits achieved (${fmt(s.available)} available)` : ''
                  })()}
                </span>
              </h3>
              <div className="breeam-wrap">
                <table className="table breeam-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Credit</th>
                      <th className="num" title="Credits available">Avail.</th>
                      <th className="num" title="Credits targeted">Target</th>
                      <th className="num" title="Credits achieved">Achvd</th>
                      <th>Credit criteria</th>
                      <th>Evidence required</th>
                      <th>Action</th>
                      <th>Status</th>
                      <th>Comments</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((i) => (
                      <tr key={i.id} className={`breeam-row ${i.status}`}>
                        <td data-label="Ref">
                          <input defaultValue={i.ref ?? ''} onBlur={(e) => e.target.value !== (i.ref ?? '') && change(i, { ref: e.target.value || null })} className="b-ref" />
                        </td>
                        <td data-label="Issue">
                          <textarea defaultValue={i.title} rows={2} onBlur={(e) => e.target.value.trim() && e.target.value !== i.title && change(i, { title: e.target.value.trim() })} />
                        </td>
                        {(
                          [
                            ['Available', 'credits_available'],
                            ['Targeted', 'credits_targeted'],
                            ['Achieved', 'credits_achieved'],
                          ] as const
                        ).map(([label, f]) => (
                          <td key={f} data-label={label}>
                            {i.prerequisite && i[f] == null ? (
                              <span className="b-p" title="Prerequisite: a must-have, no credit">P</span>
                            ) : (
                              <input type="number" step="0.5" defaultValue={i[f] ?? ''} onBlur={(e) => e.target.value !== String(i[f] ?? '') && change(i, { [f]: e.target.value === '' ? null : Number(e.target.value) })} className="b-num" />
                            )}
                          </td>
                        ))}
                        <td data-label="Criteria">
                          <textarea defaultValue={i.criteria ?? ''} rows={3} onBlur={(e) => e.target.value !== (i.criteria ?? '') && change(i, { criteria: e.target.value || null })} />
                        </td>
                        <td data-label="Evidence">
                          <textarea defaultValue={i.evidence ?? ''} rows={3} onBlur={(e) => e.target.value !== (i.evidence ?? '') && change(i, { evidence: e.target.value || null })} />
                        </td>
                        <td data-label="Action">
                          <input defaultValue={i.responsible ?? ''} onBlur={(e) => e.target.value !== (i.responsible ?? '') && change(i, { responsible: e.target.value || null })} />
                        </td>
                        <td data-label="Status">
                          <select value={i.status} className={`b-status ${i.status}`} onChange={(e) => change(i, { status: e.target.value as BreeamStatus })} aria-label="Status">
                            {STATUSES.map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td data-label="Comments">
                          <textarea defaultValue={i.comments ?? ''} rows={3} onBlur={(e) => e.target.value !== (i.comments ?? '') && change(i, { comments: e.target.value || null })} />
                        </td>
                        <td>
                          <button className="small-button" title="Remove this line" onClick={() => confirm(`Remove ${i.ref ?? 'this line'}?`) && deleteItem(i.id).then(reload, (e) => setError(saveError(e)))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
