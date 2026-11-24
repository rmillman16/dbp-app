import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import {
  MATERIAL_GROUPS,
  SAMPLE_STATUS_LABELS,
  SAMPLE_TYPE_LABELS,
  applySchedule,
  compareSchedule,
  deleteSample,
  fillSuppliers,
  fileUrl,
  isApproved,
  isOpen,
  loadSampling,
  overdue,
  programmeDue,
  removeSampleFile,
  saveSample,
  uploadSampleFile,
  type Sample,
  type SampleStatus,
  type SampleType,
  type ScheduleItem,
} from '../lib/sampling'
import { FIELD_LABELS, buildItems, findHeader, guessMapping, readWorkbook, supplierFromDescription, supplierFromSpec, type Field, type Mapping } from '../lib/samplingImport'
import { addCompany } from '../lib/subcontracts'
import ContractorPicker from '../components/ContractorPicker'
import { useJob } from './JobLayout'
import Loading from '../components/Loading'

type Data = Awaited<ReturnType<typeof loadSampling>>
// what's shown (22 Nov): statuses switched off are hidden; "only" switches; and narrowing by group, location,
// supplier and type (empty = all). Remembered per job on this device.
type Filters = { hide: SampleStatus[]; overdue: boolean; changed: boolean; groups: string[]; locations: string[]; suppliers: string[]; types: SampleType[] }
const NO_FILTERS: Filters = { hide: [], overdue: false, changed: false, groups: [], locations: [], suppliers: [], types: [] }
const filterKey = (jobId: string) => `dbp-sampling-filters:${jobId}`
const loadFilters = (jobId: string): Filters => {
  try {
    return { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(filterKey(jobId)) ?? '{}') }
  } catch {
    return NO_FILTERS
  }
}
const NONE = '(none)' // no supplier / no location
const today = todayIso()

// Job › Sampling: physical samples, from the designer's finishes schedule (docs/decisions.md "Sampling
// module — scope", built 22 Nov). Grouped by material group; status, supplier, type and dates edited in
// the table; the rest (programme link, decision, photos, the designer's approval) in a side panel.
export default function SamplingTab() {
  const { job } = useJob()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [fl, setFl] = useState<Filters>(() => loadFilters(job.id))
  const [filtersOpen, setFiltersOpen] = useState(false)
  useEffect(() => setFl(loadFilters(job.id)), [job.id])
  useEffect(() => {
    try {
      localStorage.setItem(filterKey(job.id), JSON.stringify(fl))
    } catch {
      /* private browsing: not remembered */
    }
  }, [fl, job.id])
  useEffect(() => {
    if (!filtersOpen) return
    const close = (e: PointerEvent) => !(e.target as Element).closest('.sample-more') && setFiltersOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [filtersOpen])
  const [q, setQ] = useState('')
  const [panel, setPanel] = useState<Sample | null>(null)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(0)

  const reload = () => loadSampling(job.id).then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, overdue: 0, changed: 0 }
    for (const s of data?.samples ?? []) {
      c.all++
      c[s.status] = (c[s.status] ?? 0) + 1
      if (overdue(s, today)) c.overdue++
      if (s.changed_after_approval) c.changed++
    }
    return c
  }, [data])

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <Loading />

  // a change in the table: shown straight away and saved
  const change = async (s: Sample, p: Partial<Sample>) => {
    const next = { ...s, ...p }
    setData({ ...data, samples: data.samples.map((x) => (x.id === s.id ? next : x)) })
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setSaving((n) => n + 1)
    try {
      await saveSample(next)
    } catch (e) {
      setError(saveError(e))
      reload()
    } finally {
      setSaving((n) => n - 1)
    }
  }
  const addNew = () => {
    const n = data.samples.length + 1
    setPanel({
      id: `new${Date.now()}`,
      job_id: job.id,
      finish_schedule_id: null,
      code: '',
      designer_ref: null,
      material_group: 'Other',
      locations: [],
      description: null,
      specification: null,
      quantity: null,
      supplier_company_id: null,
      sample_type: 'sample',
      requested_date: null,
      due_date: null,
      submitted_date: null,
      status: 'not_requested',
      designer_comments: null,
      decided_by: null,
      decision_date: null,
      approval_evidence_url: null,
      stored_location: null,
      photo_url: null,
      changed_after_approval: false,
      sort: Math.max(0, ...data.samples.map((s) => s.sort)) + n,
      programme_task_code: null,
      weeks_before: null,
      photo_path: null,
      evidence_path: null,
      evidence_name: null,
    })
  }

  const ql = q.trim().toLowerCase()
  const supplierOf = (x: Sample) => data.companies.find((c) => c.id === x.supplier_company_id)?.name ?? NONE
  const locsOf = (x: Sample) => (x.locations?.length ? x.locations : [NONE])
  const shown = data.samples.filter(
    (x) =>
      !fl.hide.includes(x.status) &&
      (!fl.overdue || overdue(x, today)) &&
      (!fl.changed || x.changed_after_approval) &&
      (!fl.groups.length || fl.groups.includes(x.material_group)) &&
      (!fl.locations.length || locsOf(x).some((l) => fl.locations.includes(l))) &&
      (!fl.suppliers.length || fl.suppliers.includes(supplierOf(x))) &&
      (!fl.types.length || fl.types.includes(x.sample_type)) &&
      (!ql || `${x.code} ${x.designer_ref ?? ''} ${x.description ?? ''} ${x.specification ?? ''} ${(x.locations ?? []).join(' ')}`.toLowerCase().includes(ql)),
  )
  const narrowed = fl.groups.length + fl.locations.length + fl.suppliers.length + fl.types.length
  const filtering = fl.hide.length > 0 || fl.overdue || fl.changed || narrowed > 0 || !!ql
  const toggle = <K extends 'groups' | 'locations' | 'suppliers' | 'types' | 'hide'>(k: K, v: Filters[K][number]) =>
    setFl((p) => ({ ...p, [k]: (p[k] as string[]).includes(v as string) ? (p[k] as string[]).filter((x) => x !== v) : [...(p[k] as string[]), v] }))
  // the options for each list, with how many samples each has
  const tally = (vals: string[]) =>
    [...vals.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0], 'en-GB', { numeric: true }))
  const groupOpts = tally(data.samples.map((x) => x.material_group))
  const locOpts = tally(data.samples.flatMap(locsOf))
  const supOpts = tally(data.samples.map(supplierOf))
  const typeOpts = tally(data.samples.map((x) => x.sample_type))
  const groups = [...MATERIAL_GROUPS, ...new Set(data.samples.map((s) => s.material_group).filter((g) => !MATERIAL_GROUPS.includes(g)))]
  const latest = data.schedules[0]
  // samples with no supplier that their own spec names one for (the spec reads "Maker · product · finish")
  const names = data.companies.map((c) => c.name)
  const fillable = data.samples
    .filter((x) => !x.supplier_company_id && x.status !== 'omitted')
    .map((x) => ({ sample: x, name: supplierFromSpec(x.specification ?? '', names) || supplierFromDescription(x.description ?? '', names) }))
    .filter((f): f is { sample: Sample; name: string } => !!f.name)
  // a status switch: on = shown (click to hide it)
  const statusChip = (st: SampleStatus, label: string) => (
    <button
      key={st}
      className={`sample-chip sst-${st} ${fl.hide.includes(st) ? 'off' : ''} ${counts[st] ? '' : 'empty'}`}
      onClick={() => toggle('hide', st)}
      aria-pressed={!fl.hide.includes(st)}
      title={fl.hide.includes(st) ? `Hidden: click to show ${label.toLowerCase()}` : `Shown: click to hide ${label.toLowerCase()}`}
    >
      {label} <span className="seg-count">{counts[st] ?? 0}</span>
    </button>
  )
  const checkList = (title: string, k: 'groups' | 'locations' | 'suppliers' | 'types', opts: [string, number][], label: (v: string) => string = (v) => v) =>
    opts.length > 1 && (
      <div className="sample-check-group">
        <div className="sample-check-title">
          {title}
          {fl[k].length > 0 && (
            <button className="link-button small" onClick={() => setFl((p) => ({ ...p, [k]: [] }))}>
              all
            </button>
          )}
        </div>
        {opts.map(([v, n]) => (
          <label key={v} className="sample-check">
            <input type="checkbox" checked={(fl[k] as string[]).includes(v)} onChange={() => toggle(k, v as never)} /> {label(v)} <span className="muted">{n}</span>
          </label>
        ))}
      </div>
    )

  return (
    <>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      <section className="card">
        <div className="pane-head">
          <div>
            <h2>Sampling</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {latest
                ? `From ${[latest.designer, latest.document_no, latest.revision && `rev ${latest.revision}`].filter(Boolean).join(' ') || latest.file_name || 'the finishes schedule'}, imported ${ukDate(latest.imported_at.slice(0, 10))}`
                : 'Import the designer’s finishes schedule (Excel), or add samples by hand.'}
              {saving > 0 && ' · Saving…'}
            </p>
          </div>
          <div className="form-actions">
            <button className="primary" onClick={() => setImporting(true)}>
              {latest ? 'Import a new revision…' : 'Import finishes schedule…'}
            </button>
            <button onClick={addNew}>+ Add sample</button>
            {fillable.length > 0 && (
              <button
                title="Give samples with no supplier the one their spec names (matched to the contractor list; new names added). Never changes a supplier already chosen."
                onClick={async () => {
                  const eg = fillable
                    .slice(0, 8)
                    .map((f) => `${f.sample.code} → ${f.name}`)
                    .join('\n')
                  if (!confirm(`Fill the supplier on ${fillable.length} sample${fillable.length === 1 ? '' : 's'} from their specs?\n\n${eg}${fillable.length > 8 ? '\n…' : ''}`))
                    return
                  setError(null)
                  try {
                    const n = await fillSuppliers(fillable, data.companies)
                    setMsg(`Supplier filled on ${n} sample${n === 1 ? '' : 's'}.`)
                    reload()
                  } catch (e) {
                    setError(saveError(e))
                  }
                }}
              >
                Fill suppliers from specs ({fillable.length})
              </button>
            )}
            <button
              disabled={!shown.length}
              title="The samples shown (filter first for a part of the tracker)"
              onClick={async () => {
                const { exportSampling } = await import('../lib/exportSampling')
                exportSampling(job, shown, data.companies, today).catch((e) => setError((e as Error).message))
              }}
            >
              Excel
            </button>
            <button
              disabled={!data.samples.length}
              onClick={() => printTracker(job, shown, data.companies).catch((e) => setError((e as Error).message))}
              title="For design team meetings: the samples shown, with photos"
            >
              PDF
            </button>
          </div>
        </div>

        {data.samples.length > 0 && (
          <div className="sample-filters">
            <div className="sample-chips" role="group" aria-label="Show statuses">
              {statusChip('not_requested', 'To request')}
              {statusChip('requested', 'Requested')}
              {statusChip('submitted', 'Submitted')}
              {statusChip('approved', 'Approved')}
              {statusChip('approved_with_comments', 'With comments')}
              {statusChip('rejected_resubmit', 'Rejected')}
              {statusChip('omitted', 'Omitted')}
            </div>
            <div className="sample-chips">
              <button
                className={`sample-chip only only-late ${fl.overdue ? 'on' : ''}`}
                onClick={() => setFl((p) => ({ ...p, overdue: !p.overdue }))}
                aria-pressed={fl.overdue}
                disabled={!counts.overdue && !fl.overdue}
              >
                Overdue only <span className="seg-count">{counts.overdue}</span>
              </button>
              <button
                className={`sample-chip only only-soon ${fl.changed ? 'on' : ''}`}
                onClick={() => setFl((p) => ({ ...p, changed: !p.changed }))}
                aria-pressed={fl.changed}
                disabled={!counts.changed && !fl.changed}
              >
                Spec changed only <span className="seg-count">{counts.changed}</span>
              </button>
              <span className="sample-more">
                <button className={`sample-chip ${narrowed ? 'on' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
                  Filters{narrowed ? ` (${narrowed})` : ''} ▾
                </button>
                {filtersOpen && (
                  <div className="sample-more-pop">
                    {checkList('Material group', 'groups', groupOpts)}
                    {checkList('Location / level', 'locations', locOpts)}
                    {checkList('Supplier', 'suppliers', supOpts)}
                    {checkList('Type', 'types', typeOpts, (v) => SAMPLE_TYPE_LABELS[v as SampleType] ?? v)}
                    <p className="muted small" style={{ margin: '6px 0 0' }}>
                      Tick to show only those. Nothing ticked in a list: all of it.
                    </p>
                  </div>
                )}
              </span>
            </div>
            <input type="search" className="filter" placeholder="Find a code, description, spec or location…" value={q} onChange={(e) => setQ(e.target.value)} />
            {filtering && (
              <span className="small muted sample-showing">
                Showing {shown.length} of {data.samples.length} ·{' '}
                <button className="link-button small" onClick={() => (setFl(NO_FILTERS), setQ(''))}>
                  Clear filters
                </button>
              </span>
            )}
          </div>
        )}

        {!data.samples.length ? (
          <p className="muted">
            No samples yet. Import the finishes schedule (the designer’s Excel), or add them one by one. A due date can follow the <Link to="../programme">programme</Link>: N weeks
            before the activity it’s needed for.
          </p>
        ) : (
          <div className="proc-scroll">
            <table className="table stack proc-table proc-inline sample-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Supplier</th>
                  <th>Description</th>
                  <th>Locations</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Submitted</th>
                  <th>Signed off</th>
                  <th>Photo</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const list = shown.filter((s) => s.material_group === g)
                  if (!list.length) return null
                  return (
                    <Fragment key={g}>
                      <tr className="group-head">
                        <td colSpan={9}>
                          {g} <span className="muted small">({list.length})</span>
                        </td>
                      </tr>
                      {list.map((s) => {
                        const late = overdue(s, today)
                        const fromProg = !!s.programme_task_code && programmeDue(s, data.tasks) === s.due_date
                        return (
                          <tr
                            key={s.id}
                            className={`${late ? 'proc-late' : s.changed_after_approval ? 'proc-soon' : ''} ${s.status === 'omitted' ? 'sample-omitted' : ''} ${panel?.id === s.id ? 'selected' : ''}`}
                          >
                            <td className="stack-title">
                              <button className="proc-name" onClick={() => setPanel(s)} title="Open its details">
                                {s.code}
                              </button>
                              {late && (
                                <span className="late small" title={`Due ${ukDate(s.due_date)}${fromProg ? ' (from the programme)' : ''}, not yet submitted`}>
                                  {' '}
                                  overdue
                                </span>
                              )}
                              {s.changed_after_approval && (
                                <span className="soon small" title="The schedule changed after it was approved: resample, possible VO">
                                  {' '}
                                  spec changed
                                </span>
                              )}
                            </td>
                            <td data-label="Supplier" className="proc-sub">
                              <ContractorPicker
                                companies={data.companies}
                                value={s.supplier_company_id}
                                placeholder="Type or choose"
                                onChange={(id) => id !== s.supplier_company_id && change(s, { supplier_company_id: id })}
                                onAdd={async (name) => {
                                  const c = await addCompany(name, 'supplier', s.material_group)
                                  setData((d) => (d ? { ...d, companies: [...d.companies, c] } : d))
                                  return c
                                }}
                              />
                            </td>
                            <td data-label="Description">
                              {s.description ?? <span className="muted">–</span>}
                              {s.specification && <span className="muted small sample-spec">{s.specification}</span>}
                            </td>
                            <td data-label="Locations" className="small">
                              {(s.locations ?? []).join(', ') || <span className="muted">–</span>}
                            </td>
                            <td data-label="Status">
                              <select
                                className={`proc-status sst-${s.status}`}
                                value={s.status}
                                onChange={(e) => {
                                  const status = e.target.value as SampleStatus
                                  // the date that goes with the step, if it's not filled in yet
                                  change(s, {
                                    status,
                                    ...(status === 'requested' && !s.requested_date ? { requested_date: today } : {}),
                                    ...(status === 'submitted' && !s.submitted_date ? { submitted_date: today } : {}),
                                    ...((status === 'approved' || status === 'approved_with_comments' || status === 'rejected_resubmit') && !s.decision_date
                                      ? { decision_date: today }
                                      : {}),
                                    ...(status === 'approved' || status === 'approved_with_comments' ? { changed_after_approval: false } : {}),
                                  })
                                }}
                                aria-label="Status"
                              >
                                {(Object.keys(SAMPLE_STATUS_LABELS) as SampleStatus[]).map((k) => (
                                  <option key={k} value={k}>
                                    {SAMPLE_STATUS_LABELS[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td data-label="Type">
                              <select value={s.sample_type} onChange={(e) => change(s, { sample_type: e.target.value as SampleType })} aria-label="Type">
                                {(Object.keys(SAMPLE_TYPE_LABELS) as SampleType[]).map((k) => (
                                  <option key={k} value={k}>
                                    {SAMPLE_TYPE_LABELS[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td data-label="Submitted">
                              <input
                                type="date"
                                className="proc-date"
                                value={s.submitted_date ?? ''}
                                onChange={(e) => change(s, { submitted_date: e.target.value || null })}
                                aria-label="Submitted"
                              />
                            </td>
                            <td data-label="Signed off">
                              <input
                                type="date"
                                className="proc-date"
                                value={s.decision_date ?? ''}
                                onChange={(e) => change(s, { decision_date: e.target.value || null })}
                                title="The date the designer signed it off (or rejected it)"
                                aria-label="Signed off"
                              />
                            </td>
                            <td data-label="Photo">
                              {s.photo_path ? (
                                <button className="sample-thumb-btn" onClick={() => setPanel(s)} title="Open its details">
                                  <Thumb path={s.photo_path} />
                                </button>
                              ) : (
                                <span className="muted small">–</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {!shown.length && <p className="muted small">Nothing matches.</p>}
          </div>
        )}
      </section>

      {panel && (
        <SamplePanel
          key={panel.id}
          sample={panel}
          data={data}
          onClose={() => setPanel(null)}
          onSaved={(s, close) => {
            setMsg(`${s.code} saved.`)
            reload()
            setPanel(close ? null : s)
          }}
          onDeleted={() => {
            setPanel(null)
            reload()
          }}
          onCompany={(c) => setData((d) => (d ? { ...d, companies: [...d.companies, c] } : d))}
        />
      )}
      {importing && (
        <ImportDialog
          existing={data.samples}
          known={data.companies.map((c) => c.name)}
          onClose={() => setImporting(false)}
          onImport={async (meta, items, removedAction) => {
            const r = await applySchedule(job.id, meta, data.samples, items, removedAction, data.companies)
            setImporting(false)
            setMsg(
              `Schedule imported: ${r.added} added, ${r.changed} changed${r.removed ? `, ${r.removed} no longer on it (${removedAction === 'delete' ? 'deleted' : removedAction === 'omit' ? 'marked Omitted' : 'kept'})` : ''}.`,
            )
            reload()
          }}
        />
      )}
    </>
  )
}

// a photo from the private storage area
function Thumb({ path, big }: { path: string; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fileUrl(path).then(setUrl, () => setUrl(null))
  }, [path])
  return url ? <img className={big ? 'sample-photo' : 'sample-thumb'} src={url} alt="Sample" /> : <span className={big ? 'sample-photo empty' : 'sample-thumb empty'} />
}

// ---------- one sample: everything (side panel) ----------
function SamplePanel({
  sample,
  data,
  onClose,
  onSaved,
  onDeleted,
  onCompany,
}: {
  sample: Sample
  data: Data
  onClose: () => void
  onSaved: (s: Sample, close: boolean) => void
  onDeleted: () => void
  onCompany: (c: Data['companies'][number]) => void
}) {
  const [s, setS] = useState<Sample>(sample)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isNew = s.id.startsWith('new')
  const set = (p: Partial<Sample>) => setS((x) => ({ ...x, ...p }))
  const due = programmeDue(s, data.tasks)
  const linked = data.tasks.find((t) => t.code === s.programme_task_code)
  const save = async (close = true) => {
    if (!s.code.trim()) return setErr('Give it a code (e.g. M-S102).')
    setBusy(true)
    setErr(null)
    try {
      const next = { ...s, code: s.code.trim(), due_date: due ?? s.due_date }
      await saveSample(next)
      onSaved(next, close)
    } catch (e) {
      setErr(saveError(e))
    }
    setBusy(false)
  }
  const upload = async (kind: 'photo' | 'evidence', file: File) => {
    setBusy(true)
    setErr(null)
    try {
      const path = await uploadSampleFile(s, kind, file)
      const next = kind === 'photo' ? { ...s, photo_path: path } : { ...s, evidence_path: path, evidence_name: file.name }
      setS(next)
      await saveSample(next)
      onSaved(next, false)
    } catch (e) {
      setErr(saveError(e))
    }
    setBusy(false)
  }
  return (
    <div className="proc-panel-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="proc-panel" role="dialog" aria-label={s.code || 'New sample'}>
        <div className="proc-panel-head">
          <h2>{isNew ? 'New sample' : s.code}</h2>
          <button className="link-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {err && <p className="error">{err}</p>}
        {s.changed_after_approval && (
          <p className="warning small">
            The finishes schedule changed after this was approved: resample, and check whether it's a variation.{' '}
            <button className="link-button" onClick={() => set({ changed_after_approval: false })}>
              Clear the flag
            </button>
          </p>
        )}
        <div className="form-grid">
          <label>
            Code
            <input value={s.code} onChange={(e) => set({ code: e.target.value })} placeholder="e.g. M-S102" autoFocus={isNew} />
          </label>
          <label>
            Material group
            <select
              value={s.material_group}
              onChange={(e) => {
                if (e.target.value !== '__new__') return set({ material_group: e.target.value })
                // a group of the job's own (22 Nov), e.g. "Sanitaryware": it joins the list for every sample here
                const name = prompt('New material group (e.g. Sanitaryware, Signage):')?.trim()
                if (name) set({ material_group: name })
              }}
            >
              {/* the standard groups, any this job has added, and this sample's own */}
              {[...new Set([...MATERIAL_GROUPS, ...data.samples.map((x) => x.material_group), s.material_group])].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value="__new__">+ Add a group…</option>
            </select>
          </label>
          <label>
            Quantity
            <input value={s.quantity ?? ''} onChange={(e) => set({ quantity: e.target.value || null })} />
          </label>
          <label className="span-2">
            Description
            <input value={s.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} placeholder="e.g. Banquette upholstery" />
          </label>
          <label className="span-2">
            Specification
            <textarea rows={2} value={s.specification ?? ''} onChange={(e) => set({ specification: e.target.value || null })} placeholder="Manufacturer · product · finish" />
          </label>
          <label className="span-2">
            Locations
            <input
              value={(s.locations ?? []).join(', ')}
              onChange={(e) =>
                set({
                  locations: e.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
              placeholder="e.g. L00, L01"
            />
            <span className="hint">Separate with commas: one sample, sampled once.</span>
          </label>
          <label>
            Supplier
            <ContractorPicker
              companies={data.companies}
              value={s.supplier_company_id}
              onChange={(id) => set({ supplier_company_id: id })}
              onAdd={async (name) => {
                const c = await addCompany(name, 'supplier', s.material_group)
                onCompany(c)
                return c
              }}
            />
          </label>
          <label>
            Type
            <select value={s.sample_type} onChange={(e) => set({ sample_type: e.target.value as SampleType })}>
              {(Object.keys(SAMPLE_TYPE_LABELS) as SampleType[]).map((k) => (
                <option key={k} value={k}>
                  {SAMPLE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={s.status} onChange={(e) => set({ status: e.target.value as SampleStatus })}>
              {(Object.keys(SAMPLE_STATUS_LABELS) as SampleStatus[]).map((k) => (
                <option key={k} value={k}>
                  {SAMPLE_STATUS_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stored at
            <input value={s.stored_location ?? ''} onChange={(e) => set({ stored_location: e.target.value || null })} placeholder="e.g. site office, sample board 2" />
          </label>
        </div>

        <h3>Due date</h3>
        {data.tasks.length ? (
          <div className="form-grid">
            <label className="span-2">
              Needed for (programme activity)
              <select value={s.programme_task_code ?? ''} onChange={(e) => set({ programme_task_code: e.target.value || null, weeks_before: s.weeks_before ?? 4 })}>
                <option value="">Not linked: type the due date</option>
                {[...new Set(data.tasks.map((t) => t.section ?? 'No section'))].map((sec) => (
                  <optgroup key={sec} label={sec}>
                    {data.tasks
                      .filter((t) => (t.section ?? 'No section') === sec)
                      .map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name} (starts {ukDate(t.start_date)})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {s.programme_task_code ? (
              <>
                <label>
                  Weeks before it starts
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={s.weeks_before ?? ''}
                    onChange={(e) => set({ weeks_before: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </label>
                <p className="small" style={{ alignSelf: 'end' }}>
                  Due <b>{ukDate(due) || '–'}</b>
                  {linked && <span className="muted"> · follows the programme</span>}
                </p>
              </>
            ) : (
              <label>
                Due
                <input type="date" value={s.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} />
              </label>
            )}
          </div>
        ) : (
          <div className="form-grid">
            <label>
              Due
              <input type="date" value={s.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} />
              <span className="hint">
                With a <Link to="../programme">programme</Link>, it can follow the activity it's needed for.
              </span>
            </label>
          </div>
        )}
        <div className="form-grid">
          <label>
            Requested
            <input type="date" value={s.requested_date ?? ''} onChange={(e) => set({ requested_date: e.target.value || null })} />
          </label>
          <label>
            Submitted
            <input type="date" value={s.submitted_date ?? ''} onChange={(e) => set({ submitted_date: e.target.value || null })} />
          </label>
        </div>

        <h3>Designer's decision</h3>
        <div className="form-grid">
          <label>
            Decided by
            <input value={s.decided_by ?? ''} onChange={(e) => set({ decided_by: e.target.value || null })} placeholder="e.g. AJR (Sarah)" />
          </label>
          <label>
            Decision date
            <input type="date" value={s.decision_date ?? ''} onChange={(e) => set({ decision_date: e.target.value || null })} />
          </label>
          <label className="span-2">
            Designer comments
            <textarea rows={2} value={s.designer_comments ?? ''} onChange={(e) => set({ designer_comments: e.target.value || null })} />
          </label>
          <div className="span-2">
            <span className="field-label">Approval (email or signed label)</span>
            {s.evidence_path ? (
              <div className="sample-file">
                <button className="link-button" onClick={() => fileUrl(s.evidence_path!).then((u) => window.open(u, '_blank', 'noopener'))}>
                  {s.evidence_name || 'Open the approval'}
                </button>
                <button
                  className="small-button"
                  disabled={busy}
                  onClick={async () => {
                    await removeSampleFile(s.evidence_path!)
                    const next = { ...s, evidence_path: null, evidence_name: null }
                    setS(next)
                    await saveSample(next)
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="sample-file">
                {/* on a phone: photograph the signed label there and then, or attach the email / a file */}
                <label className="file-button">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={busy || isNew}
                    onChange={(e) => (e.target.files?.[0] && upload('evidence', e.target.files[0]), (e.target.value = ''))}
                  />
                  <span className="button small-button">📷 Photograph the signed label</span>
                </label>
                <label className="file-button">
                  <input type="file" disabled={busy || isNew} onChange={(e) => (e.target.files?.[0] && upload('evidence', e.target.files[0]), (e.target.value = ''))} />
                  <span className="button small-button">{isNew ? 'Save first, then attach' : 'Attach the email / a file…'}</span>
                </label>
              </div>
            )}
          </div>
        </div>

        <h3>Photo</h3>
        <div className="sample-photo-row">
          {s.photo_path && <Thumb path={s.photo_path} big />}
          {/* two buttons (22 Nov): the camera straight away, or a photo already taken (library / files) */}
          <div className="sample-file">
            <label className="file-button">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy || isNew}
                onChange={(e) => (e.target.files?.[0] && upload('photo', e.target.files[0]), (e.target.value = ''))}
              />
              <span className="button small-button primary">{isNew ? 'Save first, then add a photo' : s.photo_path ? '📷 Take a new photo' : '📷 Take photo'}</span>
            </label>
            {!isNew && (
              <label className="file-button">
                <input type="file" accept="image/*" disabled={busy} onChange={(e) => (e.target.files?.[0] && upload('photo', e.target.files[0]), (e.target.value = ''))} />
                <span className="button small-button">Choose a photo…</span>
              </label>
            )}
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: 16 }}>
          <button className="primary" disabled={busy} onClick={() => save(true)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {isNew && (
            <button disabled={busy} onClick={() => save(false)}>
              Save, then add files
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          {!isNew && (
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Delete ${s.code} and its photo / approval?`)) return
                await deleteSample(s)
                onDeleted()
              }}
            >
              Delete
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}

// ---------- importing the finishes schedule (Excel) ----------
function ImportDialog({
  existing,
  known,
  onClose,
  onImport,
}: {
  existing: Sample[]
  known: string[] // the contractor list's names, to match suppliers
  onClose: () => void
  onImport: (
    meta: { designer: string | null; document_no: string | null; revision: string | null; file_name: string },
    items: ScheduleItem[],
    removedAction: 'keep' | 'omit' | 'delete',
  ) => Promise<void>
}) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(null)
  const [sheet, setSheet] = useState(0)
  const [header, setHeader] = useState(-1)
  const [map, setMap] = useState<Mapping>({})
  const [fileName, setFileName] = useState('')
  const [meta, setMeta] = useState({ designer: '', document_no: '', revision: '' })
  const [removedAction, setRemovedAction] = useState<'keep' | 'omit' | 'delete'>('omit')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pickSheet = (all: { name: string; rows: string[][] }[], i: number) => {
    setSheet(i)
    const h = findHeader(all[i].rows)
    setHeader(h)
    setMap(h >= 0 ? guessMapping(all[i].rows[h]) : {})
  }
  const rows = sheets && header >= 0 ? sheets[sheet].rows.slice(header + 1) : []
  const headers = sheets && header >= 0 ? sheets[sheet].rows[header] : []
  const items = useMemo(() => (map.code !== undefined ? buildItems(rows, map, known) : []), [rows, map, known]) // eslint-disable-line react-hooks/exhaustive-deps
  const diff = useMemo(() => compareSchedule(existing, items), [existing, items])

  return (
    <div className="proc-panel-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="proc-panel wide" role="dialog" aria-label="Import finishes schedule">
        <div className="proc-panel-head">
          <h2>Import finishes schedule</h2>
          <button className="link-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted small">
          The designer’s schedule in Excel, any layout. Check the columns below, then import. A new revision keeps each sample’s status; anything changed after approval is flagged
          (resample, possible VO). PDF schedules need the PDF reader (with IT): until then, ask the designer for the Excel, or add samples by hand.
        </p>
        {err && <p className="error">{err}</p>}
        <label className="file-button">
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setErr(null)
              try {
                const all = await readWorkbook(f)
                if (!all.length) throw new Error('That file has no filled-in sheets.')
                setSheets(all)
                setFileName(f.name)
                const rev = /\b(P|C|rev\.?\s*)(\d{1,2}|[A-Z])\b/i.exec(f.name)
                setMeta({ designer: '', document_no: f.name.replace(/\.(xlsx|xlsm)$/i, ''), revision: rev ? rev[0].replace(/rev\.?\s*/i, '') : '' })
                // the sheet with the best header row
                let best = 0
                all.forEach((s, i) => findHeader(s.rows) >= 0 && findHeader(all[best].rows) < 0 && (best = i))
                pickSheet(all, best)
              } catch (x) {
                setErr((x as Error).message)
              }
            }}
          />
          <span className="button">{sheets ? 'Choose another file…' : 'Choose the Excel file…'}</span>
        </label>

        {sheets && (
          <>
            <div className="form-grid">
              {sheets.length > 1 && (
                <label>
                  Sheet
                  <select value={sheet} onChange={(e) => pickSheet(sheets, Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Header row
                <select
                  value={header}
                  onChange={(e) => {
                    const h = Number(e.target.value)
                    setHeader(h)
                    setMap(h >= 0 ? guessMapping(sheets[sheet].rows[h]) : {})
                  }}
                >
                  <option value={-1}>–</option>
                  {sheets[sheet].rows.slice(0, 40).map((r, i) => (
                    <option key={i} value={i}>
                      Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {header >= 0 && (
              <>
                <h3>Columns</h3>
                <div className="form-grid three">
                  {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
                    <label key={f}>
                      {FIELD_LABELS[f]}
                      {f === 'code' && ' *'}
                      <select
                        value={map[f] ?? ''}
                        onChange={(e) => {
                          const m = { ...map }
                          if (e.target.value === '') delete m[f]
                          else m[f] = Number(e.target.value)
                          setMap(m)
                        }}
                      >
                        <option value="">–</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="form-grid three">
                  <label>
                    Designer
                    <input value={meta.designer} onChange={(e) => setMeta({ ...meta, designer: e.target.value })} placeholder="e.g. AJR" />
                  </label>
                  <label>
                    Document no.
                    <input value={meta.document_no} onChange={(e) => setMeta({ ...meta, document_no: e.target.value })} />
                  </label>
                  <label>
                    Revision
                    <input value={meta.revision} onChange={(e) => setMeta({ ...meta, revision: e.target.value })} placeholder="e.g. P02" />
                  </label>
                </div>
                {map.code === undefined ? (
                  <p className="warning small">Choose which column holds each item’s code.</p>
                ) : (
                  <>
                    <h3>{items.length} samples found</h3>
                    {existing.length > 0 && (
                      <p className="small">
                        Against what's here: <b>{existing.length - diff.removed.length - diff.changed.length}</b> unchanged (status kept), <b>{diff.added.length}</b> new,{' '}
                        <b>{diff.changed.length}</b> changed (status kept)
                        {diff.changed.some((c) => isApproved(c.sample)) && (
                          <span className="soon"> ({diff.changed.filter((c) => isApproved(c.sample)).length} already approved: they'll be flagged)</span>
                        )}
                        , <b>{diff.removed.length}</b> no longer on the schedule.
                      </p>
                    )}
                    {diff.removed.length > 0 && (
                      <label className="sample-removed">
                        The {diff.removed.length} no longer on the schedule (
                        {diff.removed
                          .slice(0, 6)
                          .map((x) => x.code)
                          .join(', ')}
                        {diff.removed.length > 6 ? '…' : ''}):
                        <select value={removedAction} onChange={(e) => setRemovedAction(e.target.value as 'keep' | 'omit' | 'delete')}>
                          <option value="omit">Mark them Omitted</option>
                          <option value="keep">Keep them as they are</option>
                          <option value="delete">Delete them</option>
                        </select>
                      </label>
                    )}
                    <div className="proc-scroll">
                      <table className="table small">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Group</th>
                            <th>Description</th>
                            <th>Supplier</th>
                            <th>Specification</th>
                            <th>Locations</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.slice(0, 12).map((it) => (
                            <tr
                              key={it.code}
                              className={diff.changed.some((c) => c.item.code === it.code) ? 'proc-soon' : diff.added.includes(it) && existing.length ? 'moved' : ''}
                            >
                              <td>{it.code}</td>
                              <td>{it.material_group}</td>
                              <td>{it.description}</td>
                              <td>{it.supplier}</td>
                              <td>{it.specification}</td>
                              <td>{it.locations.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {items.length > 12 && <p className="muted small">…and {items.length - 12} more.</p>}
                    </div>
                    <div className="form-actions">
                      <button
                        className="primary"
                        disabled={busy || !items.length}
                        onClick={async () => {
                          setBusy(true)
                          setErr(null)
                          try {
                            await onImport(
                              { designer: meta.designer || null, document_no: meta.document_no || null, revision: meta.revision || null, file_name: fileName },
                              items,
                              removedAction,
                            )
                          } catch (x) {
                            setErr(saveError(x))
                            setBusy(false)
                          }
                        }}
                      >
                        {busy ? 'Importing…' : existing.length ? 'Import this revision' : `Import ${items.length} samples`}
                      </button>
                      <button onClick={onClose}>Cancel</button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

// ---------- PDF for design team meetings: the samples shown, grouped, with photos ----------
async function printTracker(job: { job_no: number; code: string; name: string }, samples: Sample[], companies: { id: string; name: string }[]) {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const photos = new Map<string, string>()
  await Promise.all(samples.filter((s) => s.photo_path).map(async (s) => photos.set(s.id, await fileUrl(s.photo_path!).catch(() => ''))))
  const groups = [...MATERIAL_GROUPS, ...new Set(samples.map((s) => s.material_group).filter((g) => !MATERIAL_GROUPS.includes(g)))]
  const body = groups
    .map((g) => {
      const list = samples.filter((s) => s.material_group === g)
      if (!list.length) return ''
      return `<tr class="grp"><td colspan="9">${esc(g)} (${list.length})</td></tr>${list
        .map(
          (s) => `<tr class="${s.status === 'omitted' ? 'omit' : overdue(s, todayIso()) ? 'late' : s.changed_after_approval ? 'chg' : ''}">
        <td><b>${esc(s.code)}</b></td>
        <td>${esc(companies.find((c) => c.id === s.supplier_company_id)?.name ?? '')}</td>
        <td>${esc(s.description)}${s.specification ? `<br><span class="m">${esc(s.specification)}</span>` : ''}</td>
        <td>${esc((s.locations ?? []).join(', '))}</td>
        <td>${esc(SAMPLE_STATUS_LABELS[s.status])}${s.changed_after_approval ? '<br><span class="m">spec changed since</span>' : ''}</td>
        <td>${esc(ukDate(s.submitted_date))}</td>
        <td>${esc(ukDate(s.decision_date))}${isOpen(s) && s.due_date && s.due_date < todayIso() ? '<br><span class="m">overdue</span>' : ''}</td>
        <td>${esc(s.designer_comments)}</td>
        <td>${photos.get(s.id) ? `<img src="${photos.get(s.id)}">` : ''}</td></tr>`,
        )
        .join('')}`
    })
    .join('')
  const w = window.open('', '_blank')
  if (!w) throw new Error('The browser blocked the print window: allow pop-ups for the app.')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(`${job.job_no} ${job.code} - Sample Tracker`)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font: 10pt 'Segoe UI', Arial, sans-serif; color: #1d1d24; margin: 0; }
    header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    h1 { font-size: 15pt; color: #1f1246; margin: 0; } .sub { color: #6b6b78; font-size: 9pt; }
    header img { width: 60mm; height: 15mm; object-fit: contain; }
    table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 8pt; text-transform: uppercase; color: #6b6b78; border-bottom: 1px solid #bfbfbf; padding: 4px; }
    td { border-bottom: 1px solid #e2e2e8; padding: 4px; vertical-align: top; font-size: 9pt; } .m { color: #6b6b78; font-size: 8pt; }
    tr.grp td { background: #eef3fa; font-weight: 700; color: #1f1246; } tr.late td { background: #fdecea; } tr.chg td { background: #fff4d6; } tr.omit td { color: #9a9aa6; }
    td img { width: 22mm; height: 22mm; object-fit: cover; border-radius: 3px; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body><header><div><h1>Sample tracker</h1><div class="sub">${esc(`${job.job_no} ${job.code} · ${job.name}`)} · ${esc(ukDate(todayIso()))}</div></div><img src="${location.origin}/dbp-logo.png" alt="du Boulay Projects"></header>
  <table><thead><tr><th>Code</th><th>Supplier</th><th>Description / specification</th><th>Locations</th><th>Status</th><th>Submitted</th><th>Signed off</th><th>Designer comments</th><th>Photo</th></tr></thead><tbody>${body}</tbody></table>
  <script>window.onload = () => setTimeout(() => window.print(), 300)</script></body></html>`)
  w.document.close()
}
