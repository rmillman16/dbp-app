import { Fragment, useEffect, useMemo, useState, type InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import {
  DIRECTORY_ROLES,
  HANDOVER_TABLES,
  OM_STATUSES,
  OM_STATUS_LABELS,
  PROJECT_ITEMS,
  checkLink,
  addItemName,
  LINK_STATUS_TEXT,
  type LinkStatus,
  RISK_COLS,
  addDirectoryEntry,
  addLines,
  blankRow,
  buildDirectory,
  buildGroups,
  chaseMailto,
  chaseTo,
  defaultDue,
  deleteDirectoryEntry,
  deleteLines,
  groupKeyOf,
  isOutstanding,
  isOverdue,
  lineName,
  loadOm,
  matchFiles,
  removeClientDirect,
  saveLine,
  saveOmJob,
  standardFor,
  suggestTrade,
  type Col,
  type FileMatch,
  type OmData,
  type OmGroup,
  type OmJob,
  type OmLine,
  type OmStatus,
  type Row,
} from '../lib/om'
import type { Include } from '../lib/omPdf'
import { addCompany } from '../lib/subcontracts'
import ContractorPicker from '../components/ContractorPicker'
import type { Job } from '../lib/types'
import { useJob } from './JobLayout'
import '../om.css'
import SuggestInput from '../components/SuggestInput'

// what's shown: statuses switched off are hidden; overdue only; remembered per job on this device
type Filters = { hide: OmStatus[]; overdue: boolean }
const NO_FILTERS: Filters = { hide: [], overdue: false }
const filterKey = (jobId: string) => `dbp-om-filters:${jobId}`
const loadFilters = (jobId: string): Filters => {
  try {
    return { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(filterKey(jobId)) ?? '{}') }
  } catch {
    return NO_FILTERS
  }
}
const today = todayIso()

// an input that saves when you leave it (or press Enter), not on every key
function LazyInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

// Job › O&M (script 047): the documents each package owes for the client's O&M manual, the file sections
// (description of works, directory, residual risks, handover document) and the combined client PDF.
// Documents stay in SharePoint: each line holds a link; the PDF is built on this device from the synced folder.
export default function OmTab() {
  const { job } = useJob()
  const [data, setData] = useState<OmData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [fl, setFl] = useState<Filters>(() => loadFilters(job.id))
  const [q, setQ] = useState('')
  const [addingClient, setAddingClient] = useState(false)
  const [pdfOpen, setPdfOpen] = useState(false)
  useEffect(() => setFl(loadFilters(job.id)), [job.id])
  useEffect(() => {
    try {
      localStorage.setItem(filterKey(job.id), JSON.stringify(fl))
    } catch {
      /* private browsing: not remembered */
    }
  }, [fl, job.id])

  const reload = () => loadOm(job).then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => (data ? buildGroups(data) : []), [data])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, overdue: 0, outstanding: 0, done: 0 }
    for (const l of data?.lines ?? []) {
      c[l.status] = (c[l.status] ?? 0) + 1
      if (l.status === 'not_required') continue
      c.all++
      if (isOutstanding(l)) c.outstanding++
      if (l.status === 'received' || l.status === 'accepted') c.done++
      if (isOverdue(l, today)) c.overdue++
    }
    return c
  }, [data])

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const run = async (what: () => Promise<unknown>, done?: string) => {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setSaving((n) => n + 1)
    try {
      await what()
      if (done) setMsg(done)
    } catch (e) {
      setError(saveError(e))
    } finally {
      setSaving((n) => n - 1)
      reload()
    }
  }
  // a change in the table: shown straight away and saved
  const change = async (l: OmLine, p: Partial<OmLine>) => {
    const next = { ...l, ...p }
    setData({ ...data, lines: data.lines.map((x) => (x.id === l.id ? next : x)) })
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setSaving((n) => n + 1)
    try {
      await saveLine(next)
    } catch (e) {
      setError(saveError(e))
      reload()
    } finally {
      setSaving((n) => n - 1)
    }
  }
  const setStatus = (l: OmLine, status: OmStatus) =>
    change(l, {
      status,
      // the date that goes with the step, if it's not filled in yet
      ...(status === 'requested' && !l.requested_date ? { requested_date: today } : {}),
      ...((status === 'received' || status === 'accepted') && !l.received_date ? { received_date: today } : {}),
    })

  const ql = q.trim().toLowerCase()
  const shown = (l: OmLine) =>
    !fl.hide.includes(l.status) && (!fl.overdue || isOverdue(l, today)) && (!ql || `${lineName(l, data.docTypes)} ${l.reviewer_comment ?? ''}`.toLowerCase().includes(ql))
  const filtering = fl.hide.length > 0 || fl.overdue || !!ql
  const trades = [...new Set(data.docTypes.map((t) => t.trade))].sort((a, b) => a.localeCompare(b, 'en-GB'))
  const statusChip = (st: OmStatus) => (
    <button
      key={st}
      className={`sample-chip oms-${st} ${fl.hide.includes(st) ? 'off' : ''} ${counts[st] ? '' : 'empty'}`}
      onClick={() => setFl((p) => ({ ...p, hide: p.hide.includes(st) ? p.hide.filter((x) => x !== st) : [...p.hide, st] }))}
      aria-pressed={!fl.hide.includes(st)}
      title={fl.hide.includes(st) ? `Hidden: click to show ${OM_STATUS_LABELS[st].toLowerCase()}` : `Shown: click to hide ${OM_STATUS_LABELS[st].toLowerCase()}`}
    >
      {OM_STATUS_LABELS[st]} <span className="seg-count">{counts[st] ?? 0}</span>
    </button>
  )

  return (
    <div className="om">
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      <section className="card">
        <div className="pane-head">
          <div>
            <h2>O&M documents</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {counts.all
                ? `${counts.all} document${counts.all === 1 ? '' : 's'} · ${counts.done} in · ${counts.outstanding} outstanding${counts.overdue ? ` · ${counts.overdue} overdue` : ''}`
                : 'One group per package (the job’s orders), plus client direct contractors and project items.'}
              {' · '}
              {job.pc_date ? `New documents due ${ukDate(defaultDue(job))} (4 weeks before PC)` : 'No PC date on the job, so new documents have no due date'}
              {saving > 0 && ' · Saving…'}
            </p>
          </div>
          <div className="form-actions om-actions">
            <button onClick={() => setAddingClient(!addingClient)} aria-expanded={addingClient}>
              + Client direct contractor
            </button>
            <button className="primary" onClick={() => setPdfOpen(true)} title="The client’s O&M manual: front page, contents, file sections and the documents from SharePoint">
              Client O&M manual (PDF)…
            </button>
          </div>
        </div>

        {addingClient && (
          <ClientDirectForm
            data={data}
            onCancel={() => setAddingClient(false)}
            onCompany={(c) => setData((d) => (d ? { ...d, companies: [...d.companies, c] } : d))}
            onAdd={(companyId, role) =>
              run(async () => {
                await addDirectoryEntry({ job_id: job.id, company_id: companyId, contact_id: null, role: role || 'Client direct contractor', client_direct: true })
                setAddingClient(false)
              }, 'Client direct contractor added: add its documents below.')
            }
          />
        )}

        {data.lines.length > 0 && (
          <div className="sample-filters om-filters">
            <div className="sample-chips" role="group" aria-label="Show statuses">
              {OM_STATUSES.map(statusChip)}
            </div>
            <div className="sample-chips">
              <button
                className={`sample-chip only only-late ${fl.overdue ? 'on' : ''}`}
                onClick={() => setFl((p) => ({ ...p, overdue: !p.overdue }))}
                aria-pressed={fl.overdue}
                disabled={!counts.overdue && !fl.overdue}
              >
                ⚠ Overdue only <span className="seg-count">{counts.overdue}</span>
              </button>
            </div>
            <input type="search" className="filter" placeholder="Find a document or comment…" value={q} onChange={(e) => setQ(e.target.value)} />
            {filtering && (
              <span className="small muted">
                <button className="link-button small" onClick={() => (setFl(NO_FILTERS), setQ(''))}>
                  Clear filters
                </button>
              </span>
            )}
          </div>
        )}

        {!data.orders.length && (
          <p className="muted small">
            No orders on this job yet {data.lines.length || data.directory.some((d) => d.client_direct) ? '' : '(or Job › Commercial isn’t ticked for you)'}: each appointed
            subcontractor (Payment notices › orders) becomes a package here. Client direct contractors and project items can be added now.
          </p>
        )}

        <div className="proc-scroll">
          <table className="table stack proc-table proc-inline om-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Due</th>
                <th>Received</th>
                <th>SharePoint link</th>
                <th>Reviewer comment</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const all = data.lines.filter((l) => groupKeyOf(l) === g.key)
                const list = all.filter(shown)
                if (filtering && !list.length) return null
                return <GroupRows key={g.key} job={job} g={g} all={all} list={list} data={data} trades={trades} onChange={change} onStatus={setStatus} run={run} />
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small om-foot">
          Documents stay in SharePoint: paste each one’s link. Outstanding documents with a due date go on the bell of everyone in the job’s team (
          <Link to="..">Overview › Team</Link>), one reminder per package per due date.
        </p>
      </section>

      <FileSections job={job} data={data} onSaved={(o) => (setData((d) => (d ? { ...d, omJob: o } : d)), setMsg('File sections saved.'))} run={run} />

      {pdfOpen && <PdfPanel job={job} data={data} groups={groups} onClose={() => setPdfOpen(false)} />}
    </div>
  )
}

// ---------- one package: its heading row, its documents and an add row ----------
function GroupRows({
  job,
  g,
  all,
  list,
  data,
  trades,
  onChange,
  onStatus,
  run,
}: {
  job: Job
  g: OmGroup
  all: OmLine[]
  list: OmLine[]
  data: OmData
  trades: string[]
  onChange: (l: OmLine, p: Partial<OmLine>) => void
  onStatus: (l: OmLine, s: OmStatus) => void
  run: (what: () => Promise<unknown>, done?: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const counted = all.filter((l) => l.status !== 'not_required')
  const inCount = counted.filter((l) => l.status === 'received' || l.status === 'accepted').length
  const owed = all.filter(isOutstanding)
  const late = owed.filter((l) => isOverdue(l, today)).length
  const to = chaseTo(g, data.contacts)
  const suggested = g.kind === 'job' ? null : suggestTrade(g, trades, data.orders)
  const add = (items: { name: string; doc_type_id?: string | null }[]) =>
    run(async () => {
      const n = await addLines(job, g, items, data.lines)
      if (!n) throw new Error(items.length === 1 ? `${g.title} already has “${items[0].name}”.` : `${g.title} already has those documents.`)
    }, `Added to ${g.title}.`)
  return (
    <Fragment>
      <tr className="group-head om-group">
        <td colSpan={8}>
          <div className="om-group-line">
            <span className="om-group-title">
              <b>{g.title}</b> {g.subtitle && <span className="muted">· {g.subtitle}</span>}{' '}
              {counted.length > 0 && (
                <span className={`tag ${inCount === counted.length ? 'om-all-in' : ''}`}>
                  {inCount} of {counted.length} in
                </span>
              )}{' '}
              {late > 0 && <span className="late small">⚠ {late} overdue</span>}
            </span>
            <span className="om-group-actions">
              {trades.length > 0 && (
                <select
                  value=""
                  aria-label={`Add standard documents to ${g.title}`}
                  onChange={(e) => {
                    const t = e.target.value
                    if (t) add(standardFor(t, data.docTypes))
                  }}
                >
                  <option value="">Add standard documents…</option>
                  {suggested && <option value={suggested}>{suggested} (suggested)</option>}
                  {trades
                    .filter((t) => t !== suggested)
                    .map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </select>
              )}
              {owed.length > 0 && g.kind !== 'job' && (
                <a
                  className="button small-button"
                  href={chaseMailto(job, g, all, data.contacts, data.docTypes)}
                  title={
                    to?.email
                      ? `A draft email to ${to.email} listing the ${owed.length} outstanding`
                      : 'No email for this company on the contractor list: add one, or type the address'
                  }
                  onClick={() => {
                    const fresh = all.filter((l) => l.status === 'not_requested')
                    if (!fresh.length) return
                    // after the draft opens: mark the ones never asked for as requested today
                    window.setTimeout(() => {
                      if (confirm(`Mark the ${fresh.length} not yet requested as Requested today?`))
                        run(async () => {
                          for (const l of fresh) await saveLine({ ...l, status: 'requested', requested_date: l.requested_date ?? today })
                        })
                    }, 400)
                  }}
                >
                  ✉ Draft chase email{to?.email ? '' : ' (no email)'}
                </a>
              )}
              {g.kind === 'client' && (
                <button
                  className="small-button"
                  onClick={() => {
                    if (confirm(`Remove ${g.title} as a client direct contractor${all.length ? `, with its ${all.length} O&M document line${all.length === 1 ? '' : 's'}` : ''}?`))
                      run(() => removeClientDirect(job.id, g), `${g.title} removed.`)
                  }}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        </td>
      </tr>
      {list.map((l) => {
        const lateLine = isOverdue(l, today)
        return (
          <tr key={l.id} className={`${lateLine ? 'proc-late' : ''} ${l.status === 'not_required' ? 'om-not-required' : ''}`}>
            <td className="stack-title om-doc">
              <LazyInput value={lineName(l, data.docTypes)} onCommit={(v) => v.trim() && onChange(l, { custom_name: v.trim() })} aria-label="Document" className="om-name" />
              {lateLine && (
                <span className="late small om-late" title={`Due ${ukDate(l.due_date)}, not yet received`}>
                  ⚠ overdue
                </span>
              )}
            </td>
            <td data-label="Status">
              <select className={`proc-status oms-${l.status}`} value={l.status} onChange={(e) => onStatus(l, e.target.value as OmStatus)} aria-label="Status">
                {OM_STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {OM_STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
            </td>
            <td data-label="Requested">
              <input
                type="date"
                className="proc-date"
                value={l.requested_date ?? ''}
                onChange={(e) => onChange(l, { requested_date: e.target.value || null })}
                aria-label="Requested"
              />
            </td>
            <td data-label="Due">
              <input
                type="date"
                className={`proc-date ${lateLine ? 'om-date-late' : ''}`}
                value={l.due_date ?? ''}
                onChange={(e) => onChange(l, { due_date: e.target.value || null })}
                aria-label="Due"
              />
            </td>
            <td data-label="Received">
              <input
                type="date"
                className="proc-date"
                value={l.received_date ?? ''}
                onChange={(e) => onChange(l, { received_date: e.target.value || null })}
                aria-label="Received"
              />
            </td>
            <td data-label="SharePoint" className="om-link">
              <LazyInput
                type="url"
                value={l.file_url ?? ''}
                placeholder="Paste the SharePoint link"
                onCommit={(v) => onChange(l, { file_url: v.trim() || null })}
                aria-label="SharePoint link"
              />
              {l.file_url && (
                <span className="om-link-row">
                  <a href={l.file_url} target="_blank" rel="noreferrer" className="small" title="Open it in SharePoint">
                    Open ↗
                  </a>
                  <LinkTick line={l} />
                </span>
              )}
            </td>
            <td data-label="Comment">
              <LazyInput value={l.reviewer_comment ?? ''} placeholder="–" onCommit={(v) => onChange(l, { reviewer_comment: v.trim() || null })} aria-label="Reviewer comment" />
            </td>
            <td className="om-del">
              <button
                className="link-button"
                title="Remove this document line"
                aria-label="Remove"
                onClick={() => confirm(`Remove “${lineName(l, data.docTypes)}”?`) && run(() => deleteLines([l.id]))}
              >
                ✕
              </button>
            </td>
          </tr>
        )
      })}
      {!all.length && (
        <tr className="om-empty">
          <td colSpan={8} className="muted small">
            {g.kind === 'job'
              ? 'Items for the whole project: e.g. Reg 38 fire safety pack, BREEAM evidence, the client’s own requirements.'
              : 'No documents yet: add the standard ones for its trade, or type one below.'}
          </td>
        </tr>
      )}
      <tr className="om-add">
        <td colSpan={8}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              add([{ name: name.trim(), doc_type_id: data.docTypes.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null }]).then(() => setName(''))
            }}
          >
            <SuggestInput
              value={name}
              onChange={setName}
              options={[...PROJECT_ITEMS, ...data.itemNames, ...data.docTypes.map((t) => t.name)]}
              onAdd={(v) => {
                data.itemNames.push(v)
                addItemName(v).catch((e: Error) => alert(e.message))
              }}
              placeholder={g.kind === 'job' ? 'Add a project item…' : `Add a document for ${g.title}…`}
            />
            <button type="submit" className="small-button" disabled={!name.trim()}>
              Add
            </button>
          </form>
        </td>
      </tr>
    </Fragment>
  )
}

// ---------- a client direct contractor: from the contractor list, or typed (added to the list) ----------
function ClientDirectForm({
  data,
  onAdd,
  onCancel,
  onCompany,
}: {
  data: OmData
  onAdd: (companyId: string, role: string) => void
  onCancel: () => void
  onCompany: (c: OmData['companies'][number]) => void
}) {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  return (
    <div className="om-inline-form">
      <label>
        Contractor
        <ContractorPicker
          companies={data.companies}
          value={companyId}
          onChange={setCompanyId}
          onAdd={async (name) => {
            const c = await addCompany(name, 'subcontractor', role || null)
            onCompany(c)
            return c
          }}
        />
      </label>
      <label>
        Package / trade
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. AV, Security, Kitchen equipment" />
      </label>
      <div className="form-actions">
        <button
          className="primary"
          disabled={!companyId || data.directory.some((d) => d.client_direct && d.company_id === companyId)}
          onClick={() => companyId && onAdd(companyId, role.trim())}
        >
          Add
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ---------- the file sections ----------
type SectionKey = 'description' | 'directory' | 'risks' | 'handover'
function FileSections({ job, data, onSaved, run }: { job: Job; data: OmData; onSaved: (o: OmJob) => void; run: (what: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [tab, setTab] = useState<SectionKey>('description')
  const [draft, setDraft] = useState<OmJob>(data.omJob)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // a reload with the same saved sections (after a tracker change) keeps what's being typed
  const savedJson = JSON.stringify(data.omJob)
  useEffect(() => setDraft(data.omJob), [savedJson]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== savedJson
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await saveOmJob(draft)
      onSaved(draft)
    } catch (e) {
      setErr(saveError(e))
    }
    setBusy(false)
  }
  const TABS: [SectionKey, string][] = [
    ['description', 'Description of works'],
    ['directory', 'Project directory'],
    ['risks', 'Residual risks'],
    ['handover', 'Handover document'],
  ]
  return (
    <section className="card">
      <div className="pane-head">
        <div>
          <h2>File sections</h2>
          <p className="muted small" style={{ margin: 0 }}>
            The manual’s own sections, ahead of the documents. Only sections with something in them go in the PDF.
          </p>
        </div>
        {tab !== 'directory' && (
          <div className="form-actions om-actions">
            {dirty && <span className="soon small">Not saved yet</span>}
            <button className="primary" disabled={busy || !dirty} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {dirty && <button onClick={() => setDraft(data.omJob)}>Undo changes</button>}
          </div>
        )}
      </div>
      <div className="toolbar">
        <div className="segmented" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {tab === 'description' && (
        <>
          <p className="muted small intro">What was built, where and for whom, in plain words for the building’s users and maintainers. Leave a blank line between paragraphs.</p>
          <textarea rows={14} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value || null })} className="om-description" />
        </>
      )}
      {tab === 'risks' && (
        <>
          <p className="muted small intro">
            Significant risks left in the finished works (e.g. glass balustrade cleaning at height, high-level luminaires, a fragile ceiling void) and how they’re controlled.
          </p>
          <RowsEditor cols={RISK_COLS} rows={draft.risks} onChange={(risks) => setDraft({ ...draft, risks })} addLabel="+ Add a risk" />
        </>
      )}
      {tab === 'handover' &&
        HANDOVER_TABLES.map((t) => (
          <div key={t.key} className="om-handover">
            <h3 className="sub-head">{t.title}</h3>
            <RowsEditor
              cols={t.cols}
              rows={draft.handover[t.key] ?? []}
              onChange={(rows) => setDraft({ ...draft, handover: { ...draft.handover, [t.key]: rows } })}
              addLabel="+ Add a row"
            />
          </div>
        ))}
      {tab === 'directory' && <DirectoryEditor job={job} data={data} run={run} />}
    </section>
  )
}

function RowsEditor({ cols, rows, onChange, addLabel }: { cols: Col[]; rows: Row[]; onChange: (r: Row[]) => void; addLabel: string }) {
  const set = (i: number, k: string, v: string) => onChange(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)))
  return (
    <>
      {rows.length > 0 && (
        <div className="proc-scroll">
          <table className="table stack proc-inline om-rows">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.k}>{c.label}</th>
                ))}
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.k} data-label={c.label}>
                      {c.type === 'date' ? (
                        <input type="date" className="proc-date" value={r[c.k] ?? ''} onChange={(e) => set(i, c.k, e.target.value)} aria-label={c.label} />
                      ) : c.w >= 3 ? (
                        <textarea rows={1} value={r[c.k] ?? ''} onChange={(e) => set(i, c.k, e.target.value)} aria-label={c.label} />
                      ) : (
                        <input value={r[c.k] ?? ''} onChange={(e) => set(i, c.k, e.target.value)} aria-label={c.label} />
                      )}
                    </td>
                  ))}
                  <td className="om-del">
                    <button className="link-button" aria-label="Remove row" title="Remove row" onClick={() => onChange(rows.filter((_, n) => n !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button className="small-button" onClick={() => onChange([...rows, blankRow(cols)])}>
        {addLabel}
      </button>
    </>
  )
}

// the directory: the client, consultants / client team (job_directory), DBP and every package's company
function DirectoryEditor({ job, data, run }: { job: Job; data: OmData; run: (what: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const rows = buildDirectory(job, data)
  const [role, setRole] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [contactId, setContactId] = useState('')
  const [companies, setCompanies] = useState(data.companies)
  useEffect(() => setCompanies(data.companies), [data.companies])
  const contacts = data.contacts.filter((c) => c.company_id === companyId)
  const SOURCE: Record<string, string> = { dbp: 'DBP', client: 'Job’s client', directory: 'Added here', order: 'Order', client_direct: 'Client direct' }
  return (
    <>
      <p className="muted small intro">
        Built from the job’s client, the people added here (consultants, client team), DBP’s team and every package’s company. Phone numbers and emails come from the contractor
        list (Contractors), so correct them there.
      </p>
      <div className="proc-scroll">
        <table className="table stack om-dir">
          <thead>
            <tr>
              <th>Role</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Email</th>
              <th>From</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="stack-title">{r.role}</td>
                <td data-label="Company">{r.company}</td>
                <td data-label="Contact">{r.contact || <span className="muted">–</span>}</td>
                <td data-label="Phone">{r.phone || <span className="muted">–</span>}</td>
                <td data-label="Email">{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : <span className="muted">–</span>}</td>
                <td data-label="From">
                  <span className="tag">{SOURCE[r.source]}</span>
                </td>
                <td className="om-del">
                  {r.directoryId && (
                    <button
                      className="link-button"
                      aria-label="Remove"
                      title="Remove from the directory"
                      onClick={() => confirm(`Remove ${r.role}?`) && run(() => deleteDirectoryEntry(r.directoryId!))}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="sub-head">Add to the directory</h3>
      <div className="om-inline-form">
        <label>
          Role
          <SuggestInput value={role} onChange={setRole} options={DIRECTORY_ROLES} placeholder="e.g. Architect" />
        </label>
        <label>
          Company
          <ContractorPicker
            companies={companies}
            value={companyId}
            onChange={(id) => (setCompanyId(id), setContactId(''))}
            onAdd={async (name) => {
              const c = await addCompany(name, 'consultant', null)
              setCompanies((l) => [...l, c])
              return c
            }}
          />
        </label>
        <label>
          Contact
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!contacts.length}>
            <option value="">{contacts.length ? '–' : 'None on the contractor list'}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.role ? ` (${c.role})` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            className="primary"
            disabled={!role.trim() || !companyId}
            onClick={() =>
              run(async () => {
                await addDirectoryEntry({ job_id: job.id, company_id: companyId, contact_id: contactId || null, role: role.trim(), client_direct: false })
                setRole('')
                setCompanyId(null)
                setContactId('')
              }, 'Added to the directory.')
            }
          >
            Add
          </button>
        </div>
      </div>
    </>
  )
}

// ---------- the client's PDF: choose the files from the synced SharePoint folder, check the matches, build ----------
const SKIP = '__skip'
function PdfPanel({ job, data, groups, onClose }: { job: Job; data: OmData; groups: OmGroup[]; onClose: () => void }) {
  const oj = data.omJob
  const has = {
    description: !!oj.description?.trim(),
    directory: true,
    risks: oj.risks.some((r) => Object.values(r).some((v) => String(v).trim())),
    handover: Object.values(oj.handover).some((rows) => rows.some((r) => Object.values(r).some((v) => String(v).trim()))),
    documents: true,
  }
  const [inc, setInc] = useState<Include>({ description: has.description, directory: true, risks: has.risks, handover: has.handover, documents: true })
  const [matches, setMatches] = useState<FileMatch[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ pages: number; warnings: string[]; filename: string } | null>(null)
  const lines = data.lines.filter((l) => l.status !== 'not_required')
  const covered = new Set(matches.filter((m) => !m.skip && m.lineId).map((m) => m.lineId))
  const missing = lines.filter((l) => !covered.has(l.id))
  const setMatch = (i: number, v: string) =>
    setMatches((ms) => ms.map((m, n) => (n === i ? { ...m, skip: v === SKIP || m.kind === 'other', lineId: v === SKIP || v === '' ? null : v, how: m.how } : m)))
  const LABEL: Record<SectionKey | 'documents', string> = {
    description: 'Description of works',
    directory: 'Project directory',
    risks: 'Residual risks register',
    handover: 'Project handover document',
    documents: 'O&M documents (the files below)',
  }
  return (
    <div className="proc-panel-wrap" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <aside className="proc-panel wide om om-pdf" role="dialog" aria-label="Client O&M manual" data-readonly-ok>
        <div className="proc-panel-head">
          <h2>Client O&M manual (PDF)</h2>
          <button className="link-button" onClick={onClose} aria-label="Close" disabled={!!busy}>
            ✕
          </button>
        </div>
        <p className="muted small">
          A front page, a contents page with links, the sections ticked below and the documents by package, with bookmarks. The files are read on this device only to build the PDF:
          nothing is uploaded.
        </p>
        {err && <p className="error">{err}</p>}

        <h3>Sections</h3>
        <div className="om-checks">
          {(Object.keys(LABEL) as (keyof Include)[]).map((k) => (
            <label key={k} className="sample-check">
              <input type="checkbox" checked={inc[k]} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} /> {LABEL[k]}
              {!has[k] && <span className="muted small"> (nothing typed yet: left out)</span>}
            </label>
          ))}
        </div>

        {inc.documents && (
          <>
            <h3>Documents</h3>
            <p className="small">
              Choose the PDFs from the job’s O&M folder, synced from SharePoint to this computer (select several at once). Each is matched to a document line, by the file name in
              its SharePoint link or else by its name. Check them, then build. JPG and PNG become a page each.
            </p>
            <label className="file-button">
              <input
                type="file"
                multiple
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (!files.length) return
                  setDone(null)
                  // added to any chosen already (same name: replaced)
                  setMatches((prev) => {
                    const keep = prev.filter((m) => !files.some((f) => f.name === m.file.name))
                    return [...keep, ...matchFiles(files, data.lines, groups, data.docTypes)]
                  })
                }}
              />
              <span className="button">{matches.length ? 'Add more files…' : 'Choose files…'}</span>
            </label>
            {matches.length > 0 && (
              <>
                <p className="small">
                  {matches.length} file{matches.length === 1 ? '' : 's'}: {matches.filter((m) => m.how === 'link' && !m.skip).length} matched by link,{' '}
                  {matches.filter((m) => m.how === 'name' && !m.skip).length} by name, {matches.filter((m) => !m.lineId && !m.skip).length} under Other documents
                  {matches.some((m) => m.kind === 'other') && `, ${matches.filter((m) => m.kind === 'other').length} not PDF / JPG / PNG (left out)`}.{' '}
                  <button className="link-button small" onClick={() => setMatches([])}>
                    Clear
                  </button>
                </p>
                <div className="proc-scroll om-matches">
                  <table className="table small">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Goes under</th>
                        <th>Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m, i) => (
                        <tr key={m.file.name + i} className={m.skip ? 'om-skip' : !m.lineId ? 'proc-soon' : ''}>
                          <td>
                            {m.file.name} <span className="muted">({Math.max(1, Math.round(m.file.size / 1024))} KB)</span>
                          </td>
                          <td>
                            {m.kind === 'other' ? (
                              <span className="muted">Left out: only PDF, JPG and PNG</span>
                            ) : (
                              <select value={m.skip ? SKIP : (m.lineId ?? '')} onChange={(e) => setMatch(i, e.target.value)} aria-label={`Where ${m.file.name} goes`}>
                                <option value="">Other documents</option>
                                <option value={SKIP}>Leave it out</option>
                                {groups.map((g) => {
                                  const ls = lines.filter((l) => groupKeyOf(l) === g.key)
                                  return ls.length ? (
                                    <optgroup key={g.key} label={g.title}>
                                      {ls.map((l) => (
                                        <option key={l.id} value={l.id}>
                                          {lineName(l, data.docTypes)}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ) : null
                                })}
                              </select>
                            )}
                          </td>
                          <td className="muted">{m.skip ? '–' : m.how === 'link' ? 'By link' : m.how === 'name' ? 'By name: check' : 'No match'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {lines.length > 0 && (
              <details className="small om-missing">
                <summary>
                  {missing.length} of {lines.length} document lines have no file chosen
                  {missing.length ? ' (they’re left out of the manual)' : ''}
                </summary>
                <ul>
                  {missing.map((l) => (
                    <li key={l.id}>
                      {groups.find((g) => g.key === groupKeyOf(l))?.title}: {lineName(l, data.docTypes)} <span className="muted">({OM_STATUS_LABELS[l.status]})</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {busy && <p className="muted small">{busy}</p>}
        {done && (
          <div className="saved">
            {done.filename} downloaded: {done.pages} pages.
            {done.warnings.length > 0 && (
              <ul className="om-warnings">
                {done.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button
            className="primary"
            disabled={!!busy}
            onClick={async () => {
              setErr(null)
              setDone(null)
              setBusy('Starting…')
              try {
                const { downloadOmPdf } = await import('../lib/omPdf')
                const r = await downloadOmPdf(job, data, inc, inc.documents ? matches : [], setBusy)
                setDone({ pages: r.pages, warnings: r.warnings, filename: r.filename })
              } catch (e) {
                setErr((e as Error).message)
              }
              setBusy(null)
            }}
          >
            {busy ? 'Building…' : 'Build and download the PDF'}
          </button>
          <button onClick={onClose} disabled={!!busy}>
            Close
          </button>
        </div>
      </aside>
    </div>
  )
}

// can anyone open the link? Green tick if so; checked once per link (again when the link changes, or on ↻)
function LinkTick({ line }: { line: OmLine }) {
  const known = line.link_checked_url === line.file_url ? (line.link_status ?? null) : null
  const [st, setSt] = useState<LinkStatus | null>(known)
  const [busy, setBusy] = useState(false)
  const run = () => {
    setBusy(true)
    checkLink(line).then((r) => {
      if (r) {
        setSt(r.status)
        line.link_status = r.status
        line.link_checked_url = line.file_url
      }
      setBusy(false)
    })
  }
  useEffect(() => {
    if (known) setSt(known)
    else if (line.file_url) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.file_url])
  if (busy) return <span className="om-tick muted small">checking…</span>
  return (
    <span className="om-tick-wrap">
      {st === 'public' && (
        <span className="om-tick ok" title={LINK_STATUS_TEXT.public}>
          ✓ <span className="small">anyone can open</span>
        </span>
      )}
      {st === 'sign_in' && (
        <span className="om-tick warn" title={LINK_STATUS_TEXT.sign_in}>
          🔒 <span className="small">sign-in needed</span>
        </span>
      )}
      {st === 'broken' && (
        <span className="om-tick bad" title={LINK_STATUS_TEXT.broken}>
          ✗ <span className="small">doesn’t open</span>
        </span>
      )}
      {st === 'unknown' && (
        <span className="om-tick muted" title={LINK_STATUS_TEXT.unknown}>
          ? <span className="small">not checked</span>
        </span>
      )}
      <button type="button" className="link-button small om-recheck" onClick={run} title="Check the link again">
        ↻
      </button>
    </span>
  )
}
