import { useEffect, useMemo, useState } from 'react'
import { saveError } from '../lib/offline'
import { useJob } from './JobLayout'
import { STATUSES, addItems, deleteItem, loadBreeam, readTracker, updateItem, type BreeamItem, type BreeamStatus } from '../lib/breeam'
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
  const targeted = all.filter((i) => i.status !== 'no_action' && i.status !== 'by_others').reduce((s, i) => s + (i.credits_targeted ?? 0), 0)
  const achieved = all.filter((i) => i.status === 'completed').reduce((s, i) => s + (i.credits_targeted ?? 0), 0)

  async function change(i: BreeamItem, patch: Partial<BreeamItem>) {
    setError(null)
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
      if (!read.length) throw new Error("Couldn't find a tracker in that file. It needs a heading row with words like Ref, Issue / Credit, Status and Responsible.")
      // lines already on the tracker (same ref and wording) aren't added twice
      const have = new Set(all.map((x) => `${(x.ref ?? '').toLowerCase()}|${x.title.toLowerCase()}`))
      const fresh = read.filter((x) => !have.has(`${(x.ref ?? '').toLowerCase()}|${x.title.toLowerCase()}`)).map((x, k) => ({ ...x, sort: all.length + k }))
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
      await addItems(job.id, [{ ref: draft.ref.trim() || null, category: draft.category.trim() || null, title: draft.title.trim(), credits_available: null, credits_targeted: null, responsible: null, status: 'not_complete', due_date: null, evidence_link: null, comments: null, sort: all.length }])
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
          <div className="breeam-stats">
            {STATUSES.map(([k, l]) => (
              <button key={k} className={`breeam-stat ${k} ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? 'all' : k)}>
                <strong>{count(k)}</strong>
                <span>{l}</span>
              </button>
            ))}
            <div className="breeam-stat credits" title="Credits targeted on lines that are not 'by others' or 'no action'; completed ones count as achieved">
              <strong>
                {achieved} / {targeted}
              </strong>
              <span>credits achieved</span>
            </div>
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
                {g.c} <span className="muted small">{g.rows.length}</span>
              </h3>
              <div className="table-wrap">
                <table className="table breeam-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Issue / credit</th>
                      <th className="num">Avail.</th>
                      <th className="num">Target</th>
                      <th>Responsible</th>
                      <th>Status</th>
                      <th>Due</th>
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
                        <td data-label="Available">
                          <input type="number" step="0.5" defaultValue={i.credits_available ?? ''} onBlur={(e) => change(i, { credits_available: e.target.value === '' ? null : Number(e.target.value) })} className="b-num" />
                        </td>
                        <td data-label="Targeted">
                          <input type="number" step="0.5" defaultValue={i.credits_targeted ?? ''} onBlur={(e) => change(i, { credits_targeted: e.target.value === '' ? null : Number(e.target.value) })} className="b-num" />
                        </td>
                        <td data-label="Responsible">
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
                        <td data-label="Due">
                          <input type="date" defaultValue={i.due_date ?? ''} onBlur={(e) => e.target.value !== (i.due_date ?? '') && change(i, { due_date: e.target.value || null })} />
                        </td>
                        <td data-label="Comments">
                          <textarea defaultValue={i.comments ?? ''} rows={2} onBlur={(e) => e.target.value !== (i.comments ?? '') && change(i, { comments: e.target.value || null })} />
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
