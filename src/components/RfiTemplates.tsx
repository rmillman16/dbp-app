import { useEffect, useState } from 'react'
import { saveError } from '../lib/offline'
import { CHASE_OPTIONS, archiveTemplate, loadTemplates, saveTemplate, type RfiTemplate } from '../lib/rfis'
import { TEAM_ROLES } from '../lib/om'
import { DEFAULT_ROLES } from '../lib/roles'

// Settings › RFI templates (23 Nov, script 057): a template fills in the people by ROLE, looked up in each job's project
// directory and team, so one template works on every job: e.g. "Joinery subcontractor" finds whoever holds that role on
// the job being worked on. Also a title prefix, standard question, due days and chase frequency.
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function RfiTemplates() {
  const [list, setList] = useState<RfiTemplate[] | null>(null)
  const [edit, setEdit] = useState<(Partial<RfiTemplate> & { name: string; assignees: string; cc: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => loadTemplates().then(setList)
  useEffect(() => {
    load()
  }, [])

  const open = (t?: RfiTemplate) =>
    setEdit(
      t
        ? { ...t, assignees: t.assignee_roles.join(', '), cc: t.cc_roles.join(', ') }
        : { name: '', trade: '', manager_role: 'PM', assignees: '', cc: 'Designer, Site manager', title_prefix: '', question: '', due_days: 5, chase_days: 7, assignee_roles: [], cc_roles: [] },
    )
  async function save() {
    if (!edit?.name.trim()) return setError('The template needs a name.')
    setError(null)
    setBusy(true)
    try {
      const { assignees, cc, ...rest } = edit
      await saveTemplate({ ...rest, name: edit.name.trim(), assignee_roles: csv(assignees), cc_roles: csv(cc), trade: edit.trade?.trim() || null, manager_role: edit.manager_role?.trim() || null, title_prefix: edit.title_prefix || null, question: edit.question || null })
      setEdit(null)
      await load()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <section className="card" id="rfi-templates">
      <div className="pane-head">
        <h2>RFI templates</h2>
        <button className="primary" onClick={() => open()}>
          + New template
        </button>
      </div>
      <p className="muted small intro">
        These are the <strong>standard starting points</strong>. Who an RFI goes to differs on every project, so each job has its <strong>own templates</strong> (RFIs tab › Templates) with its own
        named people. A job can copy one of these, and its roles (e.g. "Joinery subcontractor" in the Project directory, "PM" on the Team) are filled in with that job's people, which you then adjust.
      </p>
      {error && <p className="error">{error}</p>}
      {list === null && <p className="muted">Loading…</p>}
      {list && list.length === 0 && <p className="muted small">No templates yet (or script 057 hasn't been run).</p>}
      <ul className="std-list">
        {list?.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong>
            <span className="muted small">
              {[t.trade, t.assignee_roles.length ? 'to ' + t.assignee_roles.join(', ') : '', t.due_days != null ? `due ${t.due_days} working days` : '', CHASE_OPTIONS.find(([n]) => n === t.chase_days)?.[1]]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <button className="small-button" onClick={() => open(t)}>
              Edit
            </button>
            <button className="small-button" title="Remove" onClick={() => confirm(`Remove the template "${t.name}"? RFIs already made from it are not affected.`) && archiveTemplate(t.id).then(load, (e: Error) => setError(e.message))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {edit && (
        <div className="quick-add">
          <h3 className="sub-head">{edit.id ? 'Edit template' : 'New template'}</h3>
          <div className="form-grid">
            <label className="span-2">
              Name
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Joinery technical RFI" />
            </label>
            <label>
              Specification section (trade)
              <input value={edit.trade ?? ''} onChange={(e) => setEdit({ ...edit, trade: e.target.value })} placeholder="e.g. Joinery" />
            </label>
            <label>
              RFI manager role (on the job's Team)
              <input value={edit.manager_role ?? ''} onChange={(e) => setEdit({ ...edit, manager_role: e.target.value })} list="tpl-team-roles" />
              <datalist id="tpl-team-roles">
                {TEAM_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            <label className="span-2">
              Assignee roles (in the job's directory), separated by commas
              <input value={edit.assignees} onChange={(e) => setEdit({ ...edit, assignees: e.target.value })} placeholder="e.g. Joinery subcontractor" />
              <span className="hint">Roles in use: {DEFAULT_ROLES.filter((r) => /subcontractor|Architect|engineer|consultant/i.test(r)).slice(0, 8).join(', ')}…</span>
            </label>
            <label className="span-2">
              Cc roles (directory or Team), separated by commas
              <input value={edit.cc} onChange={(e) => setEdit({ ...edit, cc: e.target.value })} />
            </label>
            <label>
              Title starts with
              <input value={edit.title_prefix ?? ''} onChange={(e) => setEdit({ ...edit, title_prefix: e.target.value })} placeholder="e.g. Joinery: " />
            </label>
            <label>
              Due after (working days)
              <input type="number" value={edit.due_days ?? ''} onChange={(e) => setEdit({ ...edit, due_days: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="span-2">
              Standard question (optional)
              <textarea rows={3} value={edit.question ?? ''} onChange={(e) => setEdit({ ...edit, question: e.target.value })} />
            </label>
            <label>
              Chase
              <select value={edit.chase_days ?? 7} onChange={(e) => setEdit({ ...edit, chase_days: Number(e.target.value) })}>
                {CHASE_OPTIONS.map(([n, l]) => (
                  <option key={n} value={n}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
            <button onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
