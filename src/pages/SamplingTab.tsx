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
import { FIELD_LABELS, buildItems, findHeader, guessMapping, readWorkbook, type Field, type Mapping } from '../lib/samplingImport'
import { addCompany } from '../lib/subcontracts'
import ContractorPicker from '../components/ContractorPicker'
import { useJob } from './JobLayout'

type Data = Awaited<ReturnType<typeof loadSampling>>
type Filter = 'all' | 'overdue' | SampleStatus | 'changed'
const today = todayIso()

// Job › Sampling: physical samples, from the designer's finishes schedule (docs/decisions.md "Sampling
// module — scope", built 22 Nov). Grouped by material group; status, supplier, type and dates edited in
// the table; the rest (programme link, decision, photos, the designer's approval) in a side panel.
export default function SamplingTab() {
  const { job } = useJob()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
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
  if (!data) return <p className="muted">Loading…</p>

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
  const shown = data.samples.filter(
    (s) =>
      (filter === 'all' || (filter === 'overdue' ? overdue(s, today) : filter === 'changed' ? s.changed_after_approval : s.status === filter)) &&
      (!ql || `${s.code} ${s.designer_ref ?? ''} ${s.description ?? ''} ${s.specification ?? ''} ${(s.locations ?? []).join(' ')}`.toLowerCase().includes(ql)),
  )
  const groups = [...MATERIAL_GROUPS, ...new Set(data.samples.map((s) => s.material_group).filter((g) => !MATERIAL_GROUPS.includes(g)))]
  const latest = data.schedules[0]
  const chip = (f: Filter, label: string, cls = '') =>
    (f === 'all' || counts[f]) && (
      <button key={f} className={`${filter === f ? 'on' : ''} ${cls}`} onClick={() => setFilter(f)}>
        {label} <span className="seg-count">{counts[f] ?? 0}</span>
      </button>
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
            <button
              disabled={!data.samples.length}
              onClick={async () => {
                const { exportSampling } = await import('../lib/exportSampling')
                exportSampling(job, data.samples, data.companies, today).catch((e) => setError((e as Error).message))
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
            <div className="segmented">
              {chip('all', 'All')}
              {chip('overdue', 'Overdue', 'late-chip')}
              {chip('not_requested', 'To request')}
              {chip('requested', 'Requested')}
              {chip('submitted', 'Submitted')}
              {chip('approved', 'Approved')}
              {chip('approved_with_comments', 'With comments')}
              {chip('rejected_resubmit', 'Rejected')}
              {chip('changed', 'Spec changed', 'soon-chip')}
            </div>
            <input type="search" className="filter" placeholder="Find a code, description, spec or location…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  <th>Description</th>
                  <th>Locations</th>
                  <th>Status</th>
                  <th>Subcontractor / supplier</th>
                  <th>Type</th>
                  <th>Due</th>
                  <th>Submitted</th>
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
                          <tr key={s.id} className={`${late ? 'proc-late' : s.changed_after_approval ? 'proc-soon' : ''} ${panel?.id === s.id ? 'selected' : ''}`}>
                            <td className="stack-title">
                              <button className="proc-name" onClick={() => setPanel(s)} title="Open its details">
                                {s.code}
                              </button>
                              {s.designer_ref && <span className="muted small"> · {s.designer_ref}</span>}
                              {s.changed_after_approval && (
                                <span className="soon small" title="The schedule changed after it was approved: resample, possible VO">
                                  {' '}
                                  spec changed
                                </span>
                              )}
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
                            <td data-label="Type">
                              <select value={s.sample_type} onChange={(e) => change(s, { sample_type: e.target.value as SampleType })} aria-label="Type">
                                {(Object.keys(SAMPLE_TYPE_LABELS) as SampleType[]).map((k) => (
                                  <option key={k} value={k}>
                                    {SAMPLE_TYPE_LABELS[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td data-label="Due">
                              <input
                                type="date"
                                className={`proc-date ${fromProg ? 'from-programme' : ''}`}
                                value={s.due_date ?? ''}
                                onChange={(e) => change(s, { due_date: e.target.value || null, programme_task_code: null, weeks_before: null })}
                                title={fromProg ? 'From the programme: typing a date unlinks it' : 'Due date'}
                                aria-label="Due"
                              />
                              {late && <span className="late small proc-prov">overdue</span>}
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
          onClose={() => setImporting(false)}
          onImport={async (meta, items, deleteRemoved) => {
            const r = await applySchedule(job.id, meta, data.samples, items, deleteRemoved)
            setImporting(false)
            setMsg(`Schedule imported: ${r.added} added, ${r.changed} changed${r.removed ? `, ${r.removed} no longer on it${deleteRemoved ? ' (deleted)' : ' (kept)'}` : ''}.`)
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
            Designer ref
            <input value={s.designer_ref ?? ''} onChange={(e) => set({ designer_ref: e.target.value || null })} placeholder="e.g. SFF17" />
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
            Subcontractor / supplier
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
              <label className="file-button">
                <input type="file" disabled={busy || isNew} onChange={(e) => (e.target.files?.[0] && upload('evidence', e.target.files[0]), (e.target.value = ''))} />
                <span className="button small-button">{isNew ? 'Save first, then attach' : 'Attach the email / signed label…'}</span>
              </label>
            )}
          </div>
        </div>

        <h3>Photo</h3>
        <div className="sample-photo-row">
          {s.photo_path && <Thumb path={s.photo_path} big />}
          <label className="file-button">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy || isNew}
              onChange={(e) => (e.target.files?.[0] && upload('photo', e.target.files[0]), (e.target.value = ''))}
            />
            <span className="button small-button">{isNew ? 'Save first, then add a photo' : s.photo_path ? 'Replace photo…' : 'Take or add a photo…'}</span>
          </label>
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
  onClose,
  onImport,
}: {
  existing: Sample[]
  onClose: () => void
  onImport: (
    meta: { designer: string | null; document_no: string | null; revision: string | null; file_name: string },
    items: ScheduleItem[],
    deleteRemoved: boolean,
  ) => Promise<void>
}) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(null)
  const [sheet, setSheet] = useState(0)
  const [header, setHeader] = useState(-1)
  const [map, setMap] = useState<Mapping>({})
  const [fileName, setFileName] = useState('')
  const [meta, setMeta] = useState({ designer: '', document_no: '', revision: '' })
  const [deleteRemoved, setDeleteRemoved] = useState(false)
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
  const items = useMemo(() => (map.code !== undefined ? buildItems(rows, map) : []), [rows, map]) // eslint-disable-line react-hooks/exhaustive-deps
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
                        Against what's here: <b>{diff.added.length}</b> new, <b>{diff.changed.length}</b> changed
                        {diff.changed.some((c) => isApproved(c.sample)) && (
                          <span className="soon"> ({diff.changed.filter((c) => isApproved(c.sample)).length} already approved: they'll be flagged)</span>
                        )}
                        , <b>{diff.removed.length}</b> no longer on the schedule.
                      </p>
                    )}
                    {diff.removed.length > 0 && (
                      <label className="check">
                        <span>
                          <input type="checkbox" checked={deleteRemoved} onChange={(e) => setDeleteRemoved(e.target.checked)} /> Delete the {diff.removed.length} no longer on the
                          schedule (
                          {diff.removed
                            .slice(0, 6)
                            .map((s) => s.code)
                            .join(', ')}
                          {diff.removed.length > 6 ? '…' : ''})
                        </span>
                      </label>
                    )}
                    <div className="proc-scroll">
                      <table className="table small">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Group</th>
                            <th>Description</th>
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
                              deleteRemoved,
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
      return `<tr class="grp"><td colspan="8">${esc(g)} (${list.length})</td></tr>${list
        .map(
          (s) => `<tr class="${overdue(s, todayIso()) ? 'late' : s.changed_after_approval ? 'chg' : ''}">
        <td><b>${esc(s.code)}</b>${s.designer_ref ? `<br><span class="m">${esc(s.designer_ref)}</span>` : ''}</td>
        <td>${esc(s.description)}${s.specification ? `<br><span class="m">${esc(s.specification)}</span>` : ''}</td>
        <td>${esc((s.locations ?? []).join(', '))}</td>
        <td>${esc(companies.find((c) => c.id === s.supplier_company_id)?.name ?? '')}</td>
        <td>${esc(SAMPLE_STATUS_LABELS[s.status])}${s.changed_after_approval ? '<br><span class="m">spec changed since</span>' : ''}</td>
        <td>${esc(ukDate(s.due_date))}${isOpen(s) && s.due_date && s.due_date < todayIso() ? '<br><span class="m">overdue</span>' : ''}</td>
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
    tr.grp td { background: #eef3fa; font-weight: 700; color: #1f1246; } tr.late td { background: #fdecea; } tr.chg td { background: #fff4d6; }
    td img { width: 22mm; height: 22mm; object-fit: cover; border-radius: 3px; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body><header><div><h1>Sample tracker</h1><div class="sub">${esc(`${job.job_no} ${job.code} · ${job.name}`)} · ${esc(ukDate(todayIso()))}</div></div><img src="${location.origin}/dbp-logo.png" alt="du Boulay Projects"></header>
  <table><thead><tr><th>Code</th><th>Description / specification</th><th>Locations</th><th>Supplier</th><th>Status</th><th>Due</th><th>Designer comments</th><th>Photo</th></tr></thead><tbody>${body}</tbody></table>
  <script>window.onload = () => setTimeout(() => window.print(), 300)</script></body></html>`)
  w.document.close()
}
