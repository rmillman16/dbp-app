import { useState } from 'react'
import { saveError } from '../lib/offline'
import { CHASE_OPTIONS, addTrade, archiveTemplate, fillFromTemplate, saveTemplate, type RfiTemplate } from '../lib/rfis'
import { keyOf, type useRfiContext } from '../lib/rfiContext'
import PeoplePicker from './PeoplePicker'
import SuggestInput from './SuggestInput'

// Job › RFIs › Templates (23 Nov, script 058): this project's own templates. Who a joinery RFI goes to is different on every
// job, so each template here names its people outright (from this job's project directory and team) and is edited on the
// job. A new one can start blank or from a standard template, whose roles are filled in with this job's people.
type Draft = {
  id?: string
  name: string
  trade: string
  manager_id: string
  assignees: string[]
  cc: string[]
  title_prefix: string
  question: string
  due_days: string
  chase_days: number
}
const blank: Draft = { name: '', trade: '', manager_id: '', assignees: [], cc: [], title_prefix: '', question: '', due_days: '5', chase_days: 7 }

export default function JobRfiTemplates({ jobId, ctx, me, onClose }: { jobId: string; ctx: ReturnType<typeof useRfiContext>; me: string | null; onClose: () => void }) {
  const [d, setD] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mine = ctx.templates.filter((t) => t.job_id === jobId)
  const standard = ctx.templates.filter((t) => !t.job_id)
  const keys = (t: RfiTemplate) => t

  const fromTemplate = (t: RfiTemplate): Draft => {
    const f = fillFromTemplate(t, ctx.dir, ctx.team, me)
    const k = (p: { directory_id?: string; profile_id?: string }) => keyOf(p)
    return {
      name: t.job_id ? t.name : `${t.name}`,
      trade: f.trade,
      manager_id: f.managerId ?? '',
      assignees: f.assignees.map(k),
      cc: f.cc.map(k),
      title_prefix: t.title_prefix ?? '',
      question: t.question ?? '',
      due_days: t.due_days != null ? String(t.due_days) : '',
      chase_days: t.chase_days,
    }
  }
  const open = (t: RfiTemplate) => setD({ ...fromTemplate(keys(t)), id: t.id })

  async function save() {
    if (!d?.name.trim()) return setError('The template needs a name.')
    setError(null)
    setBusy(true)
    try {
      await saveTemplate({
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        job_id: jobId,
        trade: d.trade.trim() || null,
        manager_id: d.manager_id || null,
        assignee_keys: d.assignees,
        cc_keys: d.cc,
        assignee_roles: [],
        cc_roles: [],
        title_prefix: d.title_prefix || null,
        question: d.question || null,
        due_days: d.due_days === '' ? null : Number(d.due_days),
        chase_days: d.chase_days,
      })
      setD(null)
      await ctx.reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="quick-add job-rfi-templates">
      <div className="pane-head">
        <h3 className="sub-head">Templates for this project</h3>
        <button type="button" className="small-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted small">
        Each template names the people it goes to on <em>this</em> job, so a joinery RFI goes to this project's joinery people. Pick one in “Create RFI” and everything fills in. Add people to the
        Project directory first.
      </p>
      {error && <p className="error">{error}</p>}
      {mine.length === 0 && !d && <p className="muted small">No templates for this project yet.</p>}
      <ul className="std-list">
        {mine.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong>
            <span className="muted small">
              {[t.trade, `${(t.assignee_keys ?? []).length} assignee${(t.assignee_keys ?? []).length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            </span>
            <button type="button" className="small-button" onClick={() => open(t)}>
              Edit
            </button>
            <button
              type="button"
              className="small-button"
              title="Remove"
              onClick={() => confirm(`Remove the template "${t.name}" from this project?`) && archiveTemplate(t.id).then(() => ctx.reload(), (e: Error) => setError(e.message))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {!d && (
        <div className="app-controls inline-add">
          <button type="button" className="primary" onClick={() => setD({ ...blank, manager_id: me ?? '' })}>
            + New template
          </button>
          {standard.length > 0 && (
            <select
              value=""
              aria-label="Start from a standard template"
              onChange={(e) => {
                const t = standard.find((x) => x.id === e.target.value)
                if (t) setD(fromTemplate(t))
              }}
            >
              <option value="">+ Start from a standard template…</option>
              {standard.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {d && (
        <div className="form-grid">
          <label className="span-2">
            Template name
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Joinery RFI" />
          </label>
          <div className="span-2 rfi-field">
            <span className="label">Goes to (assignees)</span>
            <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={d.assignees} onChange={(v) => setD({ ...d, assignees: v })} placeholder="Pick who this goes to on this project" />
          </div>
          <div className="span-2 rfi-field">
            <span className="label">Cc</span>
            <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={d.cc} onChange={(v) => setD({ ...d, cc: v })} placeholder="Pick who is copied in" />
          </div>
          <label>
            RFI manager
            <select value={d.manager_id} onChange={(e) => setD({ ...d, manager_id: e.target.value })}>
              <option value="">The person creating it</option>
              {ctx.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Specification section (trade)
            <SuggestInput value={d.trade} onChange={(v) => setD({ ...d, trade: v })} options={ctx.trades} onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})} />
          </label>
          <label>
            Title starts with
            <input value={d.title_prefix} onChange={(e) => setD({ ...d, title_prefix: e.target.value })} placeholder="e.g. Joinery: " />
          </label>
          <label>
            Due after (working days)
            <input type="number" value={d.due_days} onChange={(e) => setD({ ...d, due_days: e.target.value })} />
          </label>
          <label className="span-2">
            Standard question (optional)
            <textarea rows={3} value={d.question} onChange={(e) => setD({ ...d, question: e.target.value })} />
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
