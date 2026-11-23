import { useState } from 'react'
import { saveError } from '../lib/offline'
import { CHASE_OPTIONS, addTrade } from '../lib/rfis'
import type { useRfiContext } from '../lib/rfiContext'
import { TYPES, archiveSubmittalTemplate, saveSubmittalTemplate, type SubmittalTemplate, type SubmittalType } from '../lib/submittals'
import PeoplePicker from './PeoplePicker'
import SuggestInput from './SuggestInput'

// Job › Submittals › Templates: this project's own, naming who each kind of submittal is submitted by and reviewed by on THIS
// job (a joinery shop drawing goes to one set of people here and another on the next job).
type Draft = { id?: string; name: string; type: SubmittalType; trade: string; submitter: string[]; reviewers: string[]; cc: string[]; manager_id: string; title_prefix: string; due_days: string; chase_days: number }
const blank: Draft = { name: '', type: 'shop_drawing', trade: '', submitter: [], reviewers: [], cc: [], manager_id: '', title_prefix: '', due_days: '10', chase_days: 7 }

export default function SubmittalTemplates({ jobId, ctx, templates, reload, me, onClose }: { jobId: string; ctx: ReturnType<typeof useRfiContext>; templates: SubmittalTemplate[]; reload: () => void; me: string | null; onClose: () => void }) {
  const [d, setD] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const outside = ctx.whos.filter((w) => w.external)
  const open = (t: SubmittalTemplate) =>
    setD({ id: t.id, name: t.name, type: t.type, trade: t.trade ?? '', submitter: t.submitter_key ? [t.submitter_key] : [], reviewers: t.reviewer_keys, cc: t.cc_keys, manager_id: t.manager_id ?? '', title_prefix: t.title_prefix ?? '', due_days: t.due_days != null ? String(t.due_days) : '', chase_days: t.chase_days })

  async function save() {
    if (!d?.name.trim()) return setError('The template needs a name.')
    setError(null)
    setBusy(true)
    try {
      await saveSubmittalTemplate({
        ...(d.id ? { id: d.id } : {}),
        job_id: jobId,
        name: d.name.trim(),
        type: d.type,
        trade: d.trade.trim() || null,
        submitter_key: d.submitter[0] ?? null,
        reviewer_keys: d.reviewers,
        cc_keys: d.cc,
        manager_id: d.manager_id || null,
        title_prefix: d.title_prefix || null,
        due_days: d.due_days === '' ? null : Number(d.due_days),
        chase_days: d.chase_days,
      })
      setD(null)
      reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="quick-add job-rfi-templates">
      <div className="pane-head">
        <h3 className="sub-head">Submittal templates for this project</h3>
        <button type="button" className="small-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted small">Each template names who it is submitted by and who reviews it on <em>this</em> job. Pick one in “Create submittal” and the people fill in. Add people to the Project directory first.</p>
      {error && <p className="error">{error}</p>}
      {templates.length === 0 && !d && <p className="muted small">No templates for this project yet.</p>}
      <ul className="std-list">
        {templates.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong>
            <span className="muted small">{[t.trade, `${t.reviewer_keys.length} reviewer${t.reviewer_keys.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
            <button type="button" className="small-button" onClick={() => open(t)}>
              Edit
            </button>
            <button type="button" className="small-button" title="Remove" onClick={() => confirm(`Remove the template "${t.name}"?`) && archiveSubmittalTemplate(t.id).then(reload, (e: Error) => setError(e.message))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {!d && (
        <button type="button" className="primary" onClick={() => setD({ ...blank, manager_id: me ?? '' })}>
          + New template
        </button>
      )}
      {d && (
        <div className="form-grid">
          <label className="span-2">
            Template name
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Joinery shop drawings" />
          </label>
          <label>
            Type
            <select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as SubmittalType })}>
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Specification section (trade)
            <SuggestInput value={d.trade} onChange={(v) => setD({ ...d, trade: v })} options={ctx.trades} onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})} />
          </label>
          <div className="rfi-field">
            <span className="label">Submitted by</span>
            <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={outside} value={d.submitter} onChange={(v) => setD({ ...d, submitter: v.slice(-1) })} placeholder="Which subcontractor / supplier" />
          </div>
          <label>
            DBP manager
            <select value={d.manager_id} onChange={(e) => setD({ ...d, manager_id: e.target.value })}>
              <option value="">The person creating it</option>
              {ctx.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </label>
          <div className="span-2 rfi-field">
            <span className="label">Reviewers</span>
            <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={d.reviewers} onChange={(v) => setD({ ...d, reviewers: v })} placeholder="Who reviews it" />
          </div>
          <div className="span-2 rfi-field">
            <span className="label">Cc</span>
            <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={d.cc} onChange={(v) => setD({ ...d, cc: v })} placeholder="Who is copied in" />
          </div>
          <label>
            Title starts with
            <input value={d.title_prefix} onChange={(e) => setD({ ...d, title_prefix: e.target.value })} placeholder="e.g. Joinery: " />
          </label>
          <label>
            Return by (working days after)
            <input type="number" value={d.due_days} onChange={(e) => setD({ ...d, due_days: e.target.value })} />
          </label>
          <label>
            Chase
            <select value={d.chase_days} onChange={(e) => setD({ ...d, chase_days: Number(e.target.value) })}>
              {CHASE_OPTIONS.map(([n, l]) => (
                <option key={n} value={n}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions span-2">
            <button type="button" className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
            <button type="button" onClick={() => setD(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
