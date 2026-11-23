import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'
import { exportAllData } from '../lib/exportAll'
import type { CompanySettings, Profile } from '../lib/types'
import { ROLES, SECTIONS, roleLabel, useAccess, type Role, type Section } from '../lib/access'
import AdminOnly from '../components/AdminOnly'
import { nudgeEmails } from '../lib/notifications'
import { createLogin, listLogins, resetPassword, setLoginOn, welcomeEmail, type LoginStatus } from '../lib/users'
import { Insurances, OmStandardDocuments } from './Sections'
import StandardDocuments from '../components/StandardDocuments'

export default function Settings() {
  return (
    <AdminOnly>
      <h1>Settings</h1>
      <CompanyDetails />
      <Insurances />
      <OmStandardDocuments />
      <StandardDocuments />
      <AccessRequests />
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
// Admins (IT included) add, reset and switch off logins here too (manage-users Edge Function, 22 Nov).
function Users() {
  const [people, setPeople] = useState<Profile[] | null>(null)
  const { reload: reloadAccess, me } = useAccess()
  const [err, setErr] = useState<string | null>(null)
  const [logins, setLogins] = useState<Record<string, LoginStatus> | null>(null)
  const [loginsErr, setLoginsErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [shown, setShown] = useState<{ email: string; name: string; password: string; isNew: boolean; warning?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  function loadPeople() {
    cached('profiles', () => must<Profile[]>(supabase.from('profiles').select('*').order('email'))).then(setPeople, () => setPeople([]))
    listLogins().then(setLogins, (e: Error) => setLoginsErr(e.message))
  }
  useEffect(loadPeople, [])

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
  // admin (script 037): admins make other people admins; not yourself off, never the last admin (the database checks)
  async function setAdmin(p: Profile, on: boolean) {
    const who = p.full_name ?? p.email
    if (on && !confirm(`Make ${who} an admin? Admins see everything and can change Settings, users and access.`)) return
    if (!on && !confirm(`Take admin off ${who}?`)) return
    setErr(null)
    const before = people
    setPeople((people ?? []).map((x) => (x.id === p.id ? { ...x, is_admin: on, is_it: on ? x.is_it : false } : x)))
    const r = await supabase.rpc('set_admin', { person: p.id, on_off: on })
    if (r.error) {
      setPeople(before)
      setErr(/function|schema cache/i.test(r.error.message) ? 'Run script 037 in Supabase first (supabase/README.md).' : r.error.message)
    }
  }
  async function setIt(p: Profile, on: boolean) {
    setErr(null)
    const before = people
    setPeople((people ?? []).map((x) => (x.id === p.id ? { ...x, is_it: on } : x)))
    const r = await supabase.rpc('set_it', { person: p.id, on_off: on })
    if (r.error) {
      setPeople(before)
      setErr(/function|schema cache/i.test(r.error.message) ? 'Run script 036 in Supabase first (supabase/README.md).' : r.error.message)
    }
  }
  async function reset(p: Profile) {
    if (!confirm(`Give ${p.full_name ?? p.email} a new temporary password? Their old one stops working.`)) return
    setErr(null)
    setBusy(p.id)
    try {
      const password = await resetPassword(p.id)
      setShown({ email: p.email ?? '', name: p.full_name ?? '', password, isNew: false })
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(null)
  }
  async function switchLogin(p: Profile, on: boolean) {
    if (!on && !confirm(`Switch off ${p.full_name ?? p.email}'s login? They can't sign in until it's switched back on. Nothing they did is deleted.`)) return
    setErr(null)
    setBusy(p.id)
    try {
      await setLoginOn(p.id, on)
      setLogins({ ...(logins ?? {}), [p.id]: { ...(logins?.[p.id] ?? { last_sign_in_at: null }), disabled: !on } })
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(null)
  }

  const noIt = people != null && !people.some((p) => p.is_admin && p.is_it)
  const untyped = (people ?? []).filter((p) => !p.is_admin && !(p.roles ?? []).length && !logins?.[p.id]?.disabled).length
  return (
    <section className="card">
      <div className="pane-head">
        <h2>Users and profile types</h2>
        <button className="primary" onClick={() => (setAdding(true), setShown(null))}>
          + Add user
        </button>
      </div>
      <p className="muted small intro">
        Tick each person’s profile types (more than one is fine). What each type can open is set in Access below. Admins see everything.
        {untyped > 0 && ` ${untyped} ${untyped === 1 ? 'person has' : 'people have'} no type yet, so they still see everything but the buyer’s lists.`} Tick <strong>IT</strong> on
        the admin login IT uses: access requests go to it{noIt ? ' (until then they go to every admin)' : ''}.
      </p>
      {adding && (
        <AddUser
          onCancel={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false)
            setShown({ ...r, isNew: true })
            loadPeople()
          }}
        />
      )}
      {shown && <PasswordCard {...shown} onClose={() => setShown(null)} />}
      {loginsErr && <p className="warning small">{loginsErr}</p>}
      <table className="table stack users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Profile types</th>
            <th>Last signed in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {people?.map((p) => {
            const st = logins?.[p.id]
            return (
              <tr key={p.id} className={st?.disabled ? 'login-off' : ''}>
                <td className="stack-title">
                  {p.full_name && p.full_name !== p.email ? p.full_name : '–'}
                  <div className="muted small">{p.email}</div>
                  {st?.disabled && <span className="tag">Switched off</span>}
                </td>
                <td data-label="Types">
                  <div className="type-chips">
                    <button
                      type="button"
                      className={`type-chip admin ${p.is_admin ? 'on' : ''}`}
                      onClick={() => setAdmin(p, !p.is_admin)}
                      disabled={p.is_admin && p.id === me?.id}
                      title={p.is_admin && p.id === me?.id ? 'You can’t take admin off yourself' : 'Admins see everything and can change Settings'}
                    >
                      Admin
                    </button>
                    {/* IT (script 036): the admin login(s) IT uses; access requests go to them */}
                    <button
                      type="button"
                      className={`type-chip it ${p.is_it ? 'on' : ''}`}
                      onClick={() => setIt(p, !p.is_it)}
                      disabled={!p.is_admin}
                      title={p.is_admin ? 'Access requests go to IT' : 'Make them an admin first'}
                    >
                      IT
                    </button>
                    <span className="type-sep" aria-hidden />

                    {ROLES.map(([r, label]) => (
                      <button key={r} type="button" className={`type-chip ${(p.roles ?? []).includes(r) ? 'on' : ''}`} onClick={() => toggle(p, r)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="nowrap" data-label="Last signed in">
                  {st ? (st.last_sign_in_at ? new Date(st.last_sign_in_at).toLocaleDateString('en-GB') : 'Never') : ''}
                </td>
                <td className="nowrap user-actions">
                  {logins && (
                    <>
                      <button className="link-button small" disabled={busy === p.id} onClick={() => reset(p)}>
                        Reset password
                      </button>
                      {p.id !== me?.id &&
                        (st?.disabled ? (
                          <button className="link-button small" disabled={busy === p.id} onClick={() => switchLogin(p, true)}>
                            Switch on
                          </button>
                        ) : (
                          <button className="link-button small danger" disabled={busy === p.id} onClick={() => switchLogin(p, false)}>
                            Switch off
                          </button>
                        ))}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
      <p className="muted small">
        Someone who leaves: switch their login off (nothing they did is deleted). Admin and IT: you can’t take admin off yourself, and there’s always at least one admin.
      </p>
    </section>
  )
}

function AddUser({ onCancel, onDone }: { onCancel: () => void; onDone: (r: { email: string; name: string; password: string; warning?: string }) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const r = await createLogin(email, name, roles)
      onDone({ email: email.trim().toLowerCase(), name: name.trim(), password: r.password, warning: r.warning })
    } catch (x) {
      setErr((x as Error).message)
      setBusy(false)
    }
  }
  return (
    <form className="add-user" onSubmit={submit}>
      <h3>Add a user</h3>
      <div className="form-grid">
        <label>
          Full name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Email
          <input type="email" value={email} placeholder="name@duboulay.co.uk" onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="span-2">
          <span className="label-text">Profile types</span>
          <div className="type-chips">
            {ROLES.map(([r, label]) => (
              <button
                key={r}
                type="button"
                className={`type-chip ${roles.includes(r) ? 'on' : ''}`}
                onClick={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}
              >
                {label}
              </button>
            ))}
          </div>
          {roles.length === 0 && <p className="muted small">With no type they’ll see everything but the buyer’s lists.</p>}
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add user'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// the temporary password, shown once: copy it, or open a draft email to them (nothing is sent from the app)
function PasswordCard({
  email,
  name,
  password,
  isNew,
  warning,
  onClose,
}: {
  email: string
  name: string
  password: string
  isNew: boolean
  warning?: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="password-card">
      <strong>{isNew ? `Login made for ${name || email}` : `New password for ${name || email}`}</strong>
      <p>
        Temporary password: <code className="temp-password">{password}</code>{' '}
        <button className="link-button small" onClick={() => navigator.clipboard?.writeText(password).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </p>
      <p className="muted small">It’s shown only now. Pass it on, and ask them to change it in My details after signing in.</p>
      {warning && <p className="warning small">{warning}</p>}
      <div className="form-actions">
        <a className="button primary" href={welcomeEmail(email, name, password)}>
          Draft email to them
        </a>
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

// requests from the "no access" screen (script 036): shown while any are waiting
interface AccessRequest {
  id: string
  profile_id: string
  area: string
  path: string | null
  note: string | null
  status: 'open' | 'done' | 'declined'
  created_at: string
}
function AccessRequests() {
  const [rows, setRows] = useState<AccessRequest[]>([])
  const [people, setPeople] = useState<Map<string, Profile>>(new Map())
  const [err, setErr] = useState<string | null>(null)
  function load() {
    supabase
      .from('access_requests')
      .select('*')
      .eq('status', 'open')
      .order('created_at')
      .then(({ data }) => setRows((data ?? []) as AccessRequest[]))
  }
  useEffect(() => {
    load()
    cached('profiles', () => must<Profile[]>(supabase.from('profiles').select('*'))).then(
      (ps) => setPeople(new Map(ps.map((p) => [p.id, p]))),
      () => {},
    )
    if (location.hash === '#access-requests') setTimeout(() => document.getElementById('access-requests')?.scrollIntoView(), 300)
  }, [])
  async function handle(r: AccessRequest, status: 'done' | 'declined') {
    setErr(null)
    const { data } = await supabase.auth.getSession()
    const u = await supabase.from('access_requests').update({ status, handled_by: data.session?.user.id, handled_at: new Date().toISOString() }).eq('id', r.id)
    if (u.error) setErr(saveError(u.error))
    else (load(), nudgeEmails())
  }
  if (rows.length === 0) return <span id="access-requests" />
  return (
    <section className="card" id="access-requests">
      <h2>Access requests</h2>
      <p className="muted small intro">Give the person the right profile type in Users below (or tick the area for their type in Access), then mark it done: they’re told.</p>
      <table className="table stack">
        <thead>
          <tr>
            <th>Who</th>
            <th>Area</th>
            <th>Why</th>
            <th>Asked</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = people.get(r.profile_id)
            return (
              <tr key={r.id}>
                <td className="stack-title">
                  {p?.full_name && p.full_name !== p.email ? p.full_name : p?.email}
                  {p && <div className="muted small">{(p.roles ?? []).map(roleLabel).join(', ') || 'No type'}</div>}
                </td>
                <td data-label="Area">{r.area}</td>
                <td className={r.note ? '' : 'stack-hide'} data-label="Why">
                  {r.note}
                </td>
                <td className="nowrap" data-label="Asked">
                  {new Date(r.created_at).toLocaleDateString('en-GB')}
                </td>
                <td className="nowrap">
                  <button className="small-button primary" onClick={() => handle(r, 'done')}>
                    Done
                  </button>{' '}
                  <button className="small-button" onClick={() => handle(r, 'declined')}>
                    Decline
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
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
