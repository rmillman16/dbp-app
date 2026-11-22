import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'
import { exportAllData } from '../lib/exportAll'
import type { CompanySettings, Profile } from '../lib/types'
import { ROLES, SECTIONS, useAccess, type Role, type Section } from '../lib/access'
import AdminOnly from '../components/AdminOnly'
import { Insurances, OmStandardDocuments } from './Sections'

export default function Settings() {
  return (
    <AdminOnly>
      <h1>Settings</h1>
      <CompanyDetails />
      <Insurances />
      <OmStandardDocuments />
      <Users />
      <AccessGrid />
      <ExportAll />
    </AdminOnly>
  )
}

function CompanyDetails() {
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    cached('company-settings', () => must<CompanySettings>(supabase.from('company_settings').select('*').single())).then(
      (c) =>
        setForm({
          legal_name: c.legal_name,
          address: c.address ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          website: c.website ?? '',
          default_ohp_pct: String(c.default_ohp_pct),
          default_prelims_pct: String(c.default_prelims_pct),
          default_retention_pct: String(c.default_retention_pct),
        }),
      (e: Error) => setError(e.message),
    )
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    setBusy(true)
    const { error } = await supabase
      .from('company_settings')
      .update({
        legal_name: form.legal_name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() || null,
        default_ohp_pct: Number(form.default_ohp_pct),
        default_prelims_pct: Number(form.default_prelims_pct),
        default_retention_pct: Number(form.default_retention_pct),
      })
      .eq('id', 1)
    setBusy(false)
    if (error) setError(saveError(error))
    else setSaved(true)
  }

  if (!form) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>
  const field = (key: string, label: string, props: Record<string, unknown> = {}) => (
    <label {...(props.wide ? { className: 'span-2' } : {})}>
      {label}
      {props.multi ? (
        <textarea rows={2} value={form[key]} onChange={(e) => (setSaved(false), setForm({ ...form, [key]: e.target.value }))} />
      ) : (
        <input
          type={(props.type as string) ?? 'text'}
          step={props.type === 'number' ? '0.01' : undefined}
          value={form[key]}
          onChange={(e) => (setSaved(false), setForm({ ...form, [key]: e.target.value }))}
          required={key === 'legal_name' || props.type === 'number'}
        />
      )}
    </label>
  )

  return (
    <form className="card form" onSubmit={save}>
      <h2>Company details</h2>
      <p className="muted small">Used on every export and letter. Bank details are never stored in the app.</p>
      <div className="form-grid">
        {field('legal_name', 'Company name', { wide: true })}
        {field('address', 'Address', { wide: true, multi: true })}
        {field('phone', 'Phone')}
        {field('email', 'Email', { type: 'email' })}
        {field('website', 'Website')}
        <div />
      </div>
      <h2>Default rates for new jobs</h2>
      <p className="muted small">Each job can still be set differently on its own details page.</p>
      <div className="form-grid three">
        {field('default_ohp_pct', 'OHP %', { type: 'number' })}
        {field('default_prelims_pct', 'Prelims %', { type: 'number' })}
        {field('default_retention_pct', 'Retention %', { type: 'number' })}
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// Users and their profile types (script 035): admins tick each person's types here; what each type can open
// is the grid below (Access). No type yet = today's access, so nobody is locked out while types are given out.
function Users() {
  const [people, setPeople] = useState<Profile[] | null>(null)
  const { reload: reloadAccess } = useAccess()
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    cached('profiles', () => must<Profile[]>(supabase.from('profiles').select('*').order('email'))).then(setPeople, () => setPeople([]))
  }, [])
  async function toggle(p: Profile, role: Role) {
    setErr(null)
    const before = people
    const roles = (p.roles ?? []).includes(role) ? (p.roles ?? []).filter((r) => r !== role) : [...(p.roles ?? []), role]
    setPeople((people ?? []).map((x) => (x.id === p.id ? { ...x, roles } : x)))
    const r = await supabase.rpc('set_roles', { person: p.id, new_roles: roles })
    if (r.error) {
      setPeople(before)
      setErr(/function|schema cache/i.test(r.error.message) ? 'Run script 035 in Supabase first (supabase/README.md).' : r.error.message)
    } else reloadAccess()
  }
  const untyped = (people ?? []).filter((p) => !p.is_admin && !(p.roles ?? []).length).length
  return (
    <section className="card">
      <h2>Users and profile types</h2>
      <p className="muted small intro">
        Tick each person’s profile types (more than one is fine). What each type can open is set in Access below. Admins see everything.
        {untyped > 0 && ` ${untyped} ${untyped === 1 ? 'person has' : 'people have'} no type yet, so they still see everything but the buyer’s lists.`}
      </p>
      <table className="table stack users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Profile types</th>
          </tr>
        </thead>
        <tbody>
          {people?.map((p) => (
            <tr key={p.id}>
              <td className="stack-title">{p.full_name && p.full_name !== p.email ? p.full_name : '–'}</td>
              <td data-label="Email">{p.email}</td>
              <td data-label="Types">
                <div className="type-chips">
                  {p.is_admin && (
                    <span className="type-chip on fixed" title="Admin is changed in Supabase's SQL Editor">
                      Admin
                    </span>
                  )}
                  {ROLES.map(([r, label]) => (
                    <button key={r} type="button" className={`type-chip ${(p.roles ?? []).includes(r) ? 'on' : ''}`} onClick={() => toggle(p, r)}>
                      {label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
      <p className="muted small">
        Add a login in Supabase › Authentication › Users › Add user (tick Auto Confirm). To make someone an admin, run in Supabase › SQL Editor:{' '}
        <code>update profiles set is_admin = true where email = 'name@duboulay.co.uk';</code>
      </p>
    </section>
  )
}

// which profile types can open which parts of the app (role_access, script 035)
function AccessGrid() {
  const { grid, reload } = useAccess()
  const [ticks, setTicks] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setTicks(new Set(grid.map((g) => `${g.role}|${g.section}`))), [grid])
  async function toggle(role: Role, section: Section) {
    setErr(null)
    const key = `${role}|${section}`
    const on = !ticks.has(key)
    const next = new Set(ticks)
    if (on) next.add(key)
    else next.delete(key)
    setTicks(next)
    const r = on ? await supabase.from('role_access').insert({ role, section }) : await supabase.from('role_access').delete().eq('role', role).eq('section', section)
    if (r.error) {
      setTicks(ticks)
      setErr(/relation|schema cache|does not exist/i.test(r.error.message) ? 'Run script 035 in Supabase first (supabase/README.md).' : r.error.message)
    } else reload()
  }
  return (
    <section className="card">
      <h2>Access</h2>
      <p className="muted small intro">What each profile type can open. Someone with several types gets everything any of them allows. Settings is for admins only.</p>
      <div className="table-scroll">
        <table className="table access-grid">
          <thead>
            <tr>
              <th>Part of the app</th>
              {ROLES.map(([r, label]) => (
                <th key={r} className="centre">
                  {label}
                </th>
              ))}
              <th className="centre">Admin</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(([s, label, note]) => (
              <tr key={s}>
                <td>
                  {label}
                  {note && <div className="muted small">{note}</div>}
                </td>
                {ROLES.map(([r, rl]) => (
                  <td key={r} className="centre">
                    <input type="checkbox" checked={ticks.has(`${r}|${s}`)} onChange={() => toggle(r, s)} aria-label={`${rl}: ${label}`} />
                  </td>
                ))}
                <td className="centre">
                  <input type="checkbox" checked disabled aria-label={`Admin: ${label}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  )
}

function ExportAll() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const rows = await exportAllData(setStatus)
      setStatus(`Done: ${rows} rows exported. Save the file somewhere safe (e.g. SharePoint).`)
    } catch (e) {
      setStatus(saveError(e))
    }
    setBusy(false)
  }

  return (
    <section className="card">
      <h2>Export all data</h2>
      <p className="muted small">
        Downloads everything in the app (jobs, VOs, notifications, templates…) as one Excel workbook, a tab per table. A safety copy until Supabase's daily backups are switched on
        before go-live; worth running weekly until then.
      </p>
      <button className="primary" onClick={run} disabled={busy || !navigator.onLine}>
        {busy ? 'Exporting…' : 'Export all data'}
      </button>
      {status && <p className="small">{status}</p>}
    </section>
  )
}
