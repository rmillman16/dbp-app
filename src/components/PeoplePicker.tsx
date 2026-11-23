import { useState } from 'react'
import { useDirectoryRoles } from '../lib/roles'
import { saveError } from '../lib/offline'
import { isExternalEmail } from '../lib/users'
import type { NewPerson, Who } from '../lib/rfiContext'
import SuggestInput from './SuggestInput'

// chips for the people chosen, and a list to add more from (the project directory and DBP's team).
// "+ New person…" adds someone who isn't on the job yet: they're saved to the company's contacts and to this job's project
// directory, then picked, without leaving the form.
export default function PeoplePicker({
  whos,
  value,
  onChange,
  placeholder,
  onNew,
  companies = [],
}: {
  whos: Who[]
  value: string[]
  onChange: (keys: string[]) => void
  placeholder: string
  onNew?: (p: NewPerson) => Promise<string>
  companies?: { id: string; name: string; type: string }[]
}) {
  const { roles, add: addRole } = useDirectoryRoles()
  const left = whos.filter((w) => !value.includes(w.key))
  const [adding, setAdding] = useState(false)
  const [p, setP] = useState<NewPerson>({ companyId: '', newCompany: '', newCompanyType: 'subcontractor', name: '', email: '', phone: '', role: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<NewPerson>) => setP((c) => ({ ...c, ...patch }))

  async function add() {
    setError(null)
    if (!p.name.trim()) return setError('Their name is needed.')
    if (!p.companyId && !p.newCompany.trim()) return setError('Choose their company, or add a new one.')
    if (!p.role.trim()) return setError('Give their role on this job, e.g. Joinery subcontractor.')
    setBusy(true)
    try {
      const key = await onNew!(p)
      onChange([...value, key])
      setAdding(false)
      setP({ companyId: '', newCompany: '', newCompanyType: 'subcontractor', name: '', email: '', phone: '', role: '' })
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="people-picker">
      <div className="chips">
        {value.map((k) => {
          const w = whos.find((x) => x.key === k)
          return (
            <span key={k} className={'chip person-chip' + (w?.external ? ' ext' : '')} title={w?.email ?? ''}>
              {w?.name ?? 'Someone'}
              <button type="button" aria-label={`Remove ${w?.name ?? ''}`} onClick={() => onChange(value.filter((x) => x !== k))}>
                ✕
              </button>
            </span>
          )
        })}
      </div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value === '__new') return setAdding(true)
          if (e.target.value) onChange([...value, e.target.value])
        }}
        aria-label={placeholder}
      >
        <option value="">{value.length ? '+ Add another…' : placeholder}</option>
        {onNew && <option value="__new">+ New person…</option>}
        {left.some((w) => w.external) && (
          <optgroup label="Project directory (outside DBP)">
            {left.filter((w) => w.external).map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </optgroup>
        )}
        {left.some((w) => !w.external) && (
          <optgroup label="DBP team">
            {left.filter((w) => !w.external).map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {adding && onNew && (
        <div className="quick-add new-person-form">
          <div className="form-grid">
            <label>
              Name *
              <input autoFocus value={p.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} />
              {p.email && isExternalEmail(p.email) && <span className="hint">Outside DBP: they'll answer through their own private link.</span>}
              {!p.email && <span className="hint">Needed for them to be emailed the RFI and chasers.</span>}
            </label>
            <label>
              Company *
              <select value={p.companyId} onChange={(e) => set({ companyId: e.target.value, newCompany: '' })}>
                <option value="">{p.newCompany ? '(new company below)' : 'Choose…'}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              …or a new company
              <span className="inline-add">
                <input value={p.newCompany} placeholder="Company name" onChange={(e) => set({ newCompany: e.target.value, companyId: '' })} />
                <select value={p.newCompanyType} onChange={(e) => set({ newCompanyType: e.target.value })} aria-label="Type of company">
                  <option value="subcontractor">Subcontractor</option>
                  <option value="supplier">Supplier</option>
                  <option value="consultant">Consultant</option>
                  <option value="designer">Designer</option>
                  <option value="client">Client</option>
                  <option value="other">Other</option>
                </select>
              </span>
            </label>
            <label>
              Role on this job *
              <SuggestInput value={p.role} onChange={(v) => set({ role: v })} options={roles} limit={80} onAdd={(v) => addRole(v).catch((e: Error) => setError(e.message))} placeholder="e.g. Joinery subcontractor" />
            </label>
            <label>
              Phone
              <input type="tel" value={p.phone} onChange={(e) => set({ phone: e.target.value })} />
            </label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="primary" disabled={busy} onClick={add}>
              {busy ? 'Adding…' : 'Add to the job and pick them'}
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
