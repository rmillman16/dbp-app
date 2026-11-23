import { Fragment, useEffect, useMemo, useState, type InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import {
  DIRECTORY_ROLES,
  HANDOVER_TABLES,
  PROJECT_ITEMS,
  checkLink,
  addItemName,
  LINK_STATUS_TEXT,
  type LinkStatus,
  RISK_COLS,
  addDirectoryEntry,
  addLines,
  applyDraft,
  blankRow,
  buildDirectory,
  buildGroups,
  chaseMailto,
  chaseTo,
  defaultDue,
  deleteDirectoryEntry,
  deleteLines,
  draftPlan,
  groupFields,
  groupKeyOf,
  isMissing,
  isReceived,
  isRemoved,
  lineName,
  loadOm,
  matchFiles,
  removeClientDirect,
  saveLine,
  saveOmJob,
  setRemoved,
  standardFor,
  suggestTrade,
  withLink,
  type Col,
  type FileMatch,
  type OmData,
  type OmGroup,
  type OmJob,
  type OmLine,
  type Row,
} from '../lib/om'
import type { Include } from '../lib/omPdf'
import { addCompany } from '../lib/subcontracts'
import ContractorPicker from '../components/ContractorPicker'
import type { Job } from '../lib/types'
import { useJob } from './JobLayout'
import '../om.css'
import SuggestInput from '../components/SuggestInput'

// what's shown (23 Nov, Richard): all, received (has a link) or missing; removed items only when asked for.
// Remembered per job on this device.
type View = 'all' | 'received' | 'missing'
type Filters = { view: View; removed: boolean }
const NO_FILTERS: Filters = { view: 'all', removed: false }
const filterKey = (jobId: string) => `dbp-om-view:${jobId}`
const loadFilters = (jobId: string): Filters => {
  try {
    return { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(filterKey(jobId)) ?? '{}') }
  } catch {
    return NO_FILTERS
  }
}

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

type Run = (what: () => Promise<unknown>, done?: string) => Promise<void>

// Job › O&M (scripts 047–050): the items each package owes for the client's O&M manual, the file sections
// (description of works, directory, residual risks, handover document) and the combined client PDF.
// A line is an item and its contents: the SharePoint link. Received = it has a link (23 Nov, Richard).
// Removing (marking not required) is for admins and Operations only; the database enforces it (script 050).
export default function OmTab() {
  const { job } = useJob()
  const { isAdmin, roles, me } = useAccess()
  const canRemove = isAdmin || roles.includes('operations') || !!me?.is_operations
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
    const c = { all: 0, received: 0, missing: 0, removed: 0 }
    for (const l of data?.lines ?? []) {
      if (isRemoved(l)) c.removed++
      else {
        c.all++
        if (isReceived(l)) c.received++
        else c.missing++
      }
    }
    return c
  }, [data])

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const run: Run = async (what, done) => {
    setError(null)
    setMsg(null)
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
  const buildDraft = () => {
    const plan = draftPlan(data, groups)
    const n = plan.reduce((s, p) => s + p.items.length, 0)
    if (!n) return setMsg('Nothing to add: every package and General already has its items (or they were removed).')
    const summary = plan.map(
      (p) => `${p.g.kind === 'job' ? 'General' : p.g.title}: ${p.items.length}${p.g.kind === 'package' ? (p.trade ? ` (${p.trade} list)` : ' (generic set)') : ''}`,
    )
    if (
      !confirm(
        `Add ${n} item${n === 1 ? '' : 's'} to the O&M list?\n\n${summary.slice(0, 25).join('\n')}${summary.length > 25 ? '\n…' : ''}\n\nNothing already there (or removed) is added again.`,
      )
    )
      return
    run(() => applyDraft(job, plan, data.lines), `Draft pack: ${n} item${n === 1 ? '' : 's'} added (${summary.join('; ')}).`)
  }

  const ql = q.trim().toLowerCase()
  const shown = (l: OmLine) =>
    (isRemoved(l) ? fl.removed : fl.view === 'all' || (fl.view === 'received' ? isReceived(l) : isMissing(l))) &&
    (!ql || `${lineName(l, data.docTypes)} ${l.reviewer_comment ?? ''}`.toLowerCase().includes(ql))
  const filtering = fl.view !== 'all' || !!ql
  const trades = [...new Set(data.docTypes.map((t) => t.trade))].sort((a, b) => a.localeCompare(b, 'en-GB'))
  const section = (list: OmGroup[]) =>
    list.map((g) => {
      const all = data.lines.filter((l) => groupKeyOf(l, data.orders) === g.key)
      const vis = all.filter(shown)
      // a package with everything removed is hidden (unless removed items are shown); filtering hides empty groups
      if ((filtering || (all.length && all.every(isRemoved))) && !vis.length && !(fl.removed && all.length)) return null
      return <GroupRows key={g.key} job={job} g={g} all={all} list={vis} data={data} groups={groups} trades={trades} canRemove={canRemove} onChange={change} run={run} />
    })
  const head = (
    <thead>
      <tr>
        <th>Item</th>
        <th>Contents (SharePoint link)</th>
        <th>Comment</th>
        <th>Package</th>
        <th aria-label="Remove" />
      </tr>
    </thead>
  )
  const segment = (v: View, label: string, n: number, cls: string) => (
    <button className={`${fl.view === v ? 'on' : ''} ${cls}`} onClick={() => setFl((p) => ({ ...p, view: v }))} aria-pressed={fl.view === v}>
      {label} <span className="seg-count">{n}</span>
    </button>
  )

  return (
    <div className="om">
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      <section className="card">
        <div className="pane-head">
          <div>
            <h2>O&M information</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {counts.all
                ? `${counts.all} item${counts.all === 1 ? '' : 's'} · ${counts.received} received · ${counts.missing} missing`
                : 'Start with a draft pack from the SoW, or add items to each package.'}
              {' · '}
              {job.pc_date ? `Missing items are due ${ukDate(defaultDue(job))} (4 weeks before PC)` : 'No PC date on the job, so no due date for reminders'}
              {saving > 0 && ' · Saving…'}
            </p>
          </div>
          <div className="form-actions om-actions">
            <button
              onClick={buildDraft}
              title="Adds the usual items for each SoW package (by its trade) and for General. Never adds anything already there or removed. Run it again after the SoW changes."
            >
              Build a draft pack
            </button>
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
              }, 'Client direct contractor added: add its items below.')
            }
          />
        )}

        <div className="toolbar om-filters">
          <div className="segmented" role="group" aria-label="Show">
            {segment('all', 'All', counts.all, '')}
            {segment('received', '✓ Received', counts.received, 'om-seg-received')}
            {segment('missing', 'Missing', counts.missing, 'om-seg-missing')}
          </div>
          <input type="search" className="filter" placeholder="Find an item or comment…" value={q} onChange={(e) => setQ(e.target.value)} />
          {counts.removed > 0 && (
            <label className="small om-show-removed">
              <input type="checkbox" checked={fl.removed} onChange={(e) => setFl((p) => ({ ...p, removed: e.target.checked }))} /> Show removed ({counts.removed})
            </label>
          )}
        </div>

        <h3 className="om-section-head">Package information</h3>
        <p className="muted small om-section-note">
          One group per package of the SoW / procurement schedule, with its subcontractor when known; plus client direct contractors. Paste each item’s SharePoint link: with a link
          it’s received.
        </p>
        {groups.length === 1 && (
          <p className="muted small">No packages yet: they come from the job’s SoW (Overview › SoW) and the procurement schedule. Client direct contractors can be added now.</p>
        )}
        <div className="proc-scroll">
          <table className="table stack proc-table proc-inline om-table">
            {head}
            <tbody>{section(groups.filter((g) => g.kind !== 'job'))}</tbody>
          </table>
        </div>

        <h3 className="om-section-head">General / packs</h3>
        <p className="muted small om-section-note">
          Items for the whole job, not tied to a package: Building Control, Reg 38 fire safety pack, H&S file, BREEAM, client requirements…
        </p>
        <div className="proc-scroll">
          <table className="table stack proc-table proc-inline om-table">
            {head}
            <tbody>{section(groups.filter((g) => g.kind === 'job'))}</tbody>
          </table>
        </div>
        <p className="muted small om-foot">
          Missing items go on the bell of everyone in the job’s team (<Link to="..">Overview › Team</Link>), one reminder per package.
          {canRemove ? ' Removed items are kept as not required: the draft pack won’t add them again.' : ' Only admins and Operations can remove items.'}
        </p>
      </section>

      <FileSections job={job} data={data} onSaved={(o) => (setData((d) => (d ? { ...d, omJob: o } : d)), setMsg('File sections saved.'))} run={run} />

      {pdfOpen && <PdfPanel job={job} data={data} groups={groups} onClose={() => setPdfOpen(false)} />}
    </div>
  )
}

// ---------- one package: its heading row, its items and an add row ----------
function GroupRows({
  job,
  g,
  all,
  list,
  data,
  groups,
  trades,
  canRemove,
  onChange,
  run,
}: {
  job: Job
  g: OmGroup
  all: OmLine[]
  list: OmLine[]
  data: OmData
  groups: OmGroup[]
  trades: string[]
  canRemove: boolean
  onChange: (l: OmLine, p: Partial<OmLine>) => void
  run: Run
}) {
  const [name, setName] = useState('')
  const live = all.filter((l) => !isRemoved(l))
  const got = live.filter(isReceived).length
  const missing = live.filter(isMissing)
  const to = chaseTo(g, data.contacts)
  const suggested = g.kind === 'job' ? null : suggestTrade(g, trades, data.orders)
  const add = (items: { name: string; doc_type_id?: string | null }[]) =>
    run(async () => {
      const n = await addLines(job, g, items, data.lines, data.orders)
      if (!n) throw new Error(items.length === 1 ? `${g.title} already has “${items[0].name}”.` : `${g.title} already has those items.`)
    }, `Added to ${g.title}.`)
  const removeGroup = () => {
    const what = g.kind === 'job' ? 'the whole General / packs section' : g.kind === 'client' ? `${g.title} as a client direct contractor` : `the ${g.title} package`
    if (
      !confirm(
        `Remove ${what}${live.length ? ` (${live.length} item${live.length === 1 ? '' : 's'})` : ''}? Its items are kept as not required, and the draft pack won’t add them again.`,
      )
    )
      return
    run(
      () =>
        g.kind === 'client'
          ? removeClientDirect(job.id, g, all)
          : setRemoved(
              live.map((l) => l.id),
              true,
            ),
      `${g.kind === 'job' ? 'General / packs' : g.title} removed.`,
    )
  }
  const moveTo = (l: OmLine, key: string) => {
    const target = groups.find((x) => x.key === key)
    if (target) onChange(l, groupFields(target))
  }
  return (
    <Fragment>
      <tr className="group-head om-group">
        <td colSpan={5}>
          <div className="om-group-line">
            <span className="om-group-title">
              <b>{g.kind === 'job' ? 'General / packs' : g.title}</b> {g.kind !== 'job' && <span className="muted">· {g.subtitle}</span>}{' '}
              {live.length > 0 && (
                <span className={`tag ${got === live.length ? 'om-all-in' : ''}`}>
                  {got} of {live.length} received
                </span>
              )}
            </span>
            <span className="om-group-actions">
              {trades.length > 0 && g.kind !== 'job' && (
                <select
                  value=""
                  aria-label={`Add standard items to ${g.title}`}
                  onChange={(e) => {
                    const t = e.target.value
                    if (t) add(standardFor(t, data.docTypes))
                  }}
                >
                  <option value="">Add standard items…</option>
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
              {missing.length > 0 && g.company && (
                <a
                  className="button small-button"
                  href={chaseMailto(job, g, all, data.contacts, data.docTypes)}
                  title={
                    to?.email
                      ? `A draft email to ${to.email} listing the ${missing.length} missing`
                      : 'No email for this company on the contractor list: add one, or type the address'
                  }
                >
                  ✉ Draft chase email{to?.email ? '' : ' (no email)'}
                </a>
              )}
            </span>
            {/* removing the whole package: an ✕ on the far right (23 Nov) */}
            {canRemove && (live.length > 0 || g.kind === 'client') && (
              <button
                className="link-button om-group-x"
                onClick={removeGroup}
                title={g.kind === 'job' ? 'Remove all the General items (not required on this job)' : `Remove ${g.title} (not required on this job)`}
                aria-label={g.kind === 'job' ? 'Remove all General items' : `Remove ${g.title}`}
              >
                ✕
              </button>
            )}
          </div>
        </td>
      </tr>
      {list.map((l) => {
        const gone = isRemoved(l)
        return (
          <tr key={l.id} className={gone ? 'om-not-required' : ''}>
            <td className="stack-title om-doc">
              <LazyInput
                value={lineName(l, data.docTypes)}
                onCommit={(v) => v.trim() && onChange(l, { custom_name: v.trim() })}
                aria-label="Item"
                className="om-name"
                disabled={gone}
              />
              {gone ? (
                <span className="tag om-state removed">Removed</span>
              ) : isReceived(l) ? (
                <span className="tag om-state received">✓ Received</span>
              ) : (
                <span className="tag om-state missing">Missing</span>
              )}
            </td>
            <td data-label="Contents" className="om-link">
              <LazyInput
                type="url"
                value={l.file_url ?? ''}
                placeholder="Paste the SharePoint link"
                onCommit={(v) => onChange(l, withLink(l, v.trim() || null))}
                aria-label="SharePoint link"
                disabled={gone}
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
              <LazyInput value={l.reviewer_comment ?? ''} placeholder="–" onCommit={(v) => onChange(l, { reviewer_comment: v.trim() || null })} aria-label="Comment" />
            </td>
            <td data-label="Package" className="om-pkg">
              <select value={groupKeyOf(l, data.orders)} onChange={(e) => moveTo(l, e.target.value)} aria-label="Package" disabled={gone}>
                {groups.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.kind === 'job' ? 'General / packs' : x.title}
                  </option>
                ))}
              </select>
            </td>
            <td className="om-del">
              {canRemove &&
                (gone ? (
                  <span className="om-removed-actions">
                    <button className="link-button small" onClick={() => run(() => setRemoved([l.id], false), `“${lineName(l, data.docTypes)}” is back.`)}>
                      Restore
                    </button>
                    <button
                      className="link-button small"
                      title="Delete for good"
                      onClick={() =>
                        confirm(`Delete “${lineName(l, data.docTypes)}” for good? (Removed items stay out of the draft pack; deleted ones could come back.)`) &&
                        run(() => deleteLines([l.id]))
                      }
                    >
                      Delete
                    </button>
                  </span>
                ) : (
                  <button
                    className="link-button"
                    title="Remove: not required on this job"
                    aria-label="Remove"
                    onClick={() =>
                      confirm(`Remove “${lineName(l, data.docTypes)}”? It’s kept as not required, and the draft pack won’t add it again.`) && run(() => setRemoved([l.id], true))
                    }
                  >
                    ✕
                  </button>
                ))}
            </td>
          </tr>
        )
      })}
      {!all.length && (
        <tr className="om-empty">
          <td colSpan={5} className="muted small">
            {g.kind === 'job' ? 'E.g. Building Control completion certificate, Reg 38 fire safety pack, BREEAM evidence, the client’s own requirements.' : 'No items yet.'}
          </td>
        </tr>
      )}
      <tr className="om-add">
        <td colSpan={5}>
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
              options={g.kind === 'job' ? [...PROJECT_ITEMS, ...data.itemNames] : [...data.docTypes.map((t) => t.name), ...PROJECT_ITEMS, ...data.itemNames]}
              onAdd={(v) => {
                data.itemNames.push(v)
                addItemName(v).catch((e: Error) => alert(e.message))
              }}
              placeholder={g.kind === 'job' ? 'Add a General item…' : `Add an item to ${g.title}…`}
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
                    return [...keep, ...matchFiles(files, data.lines, groups, data.docTypes, data.orders)]
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
                                  const ls = lines.filter((l) => groupKeyOf(l, data.orders) === g.key)
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
                      {groups.find((g) => g.key === groupKeyOf(l, data.orders))?.title}: {lineName(l, data.docTypes)}{' '}
                      <span className="muted">({isReceived(l) ? 'received, no file chosen' : 'missing'})</span>
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
