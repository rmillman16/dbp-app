// A job's team (job_team): who works on it and as what. Reminders that belong to the job, such as
// outstanding O&M documents (script 047), go on the bell of everyone here (the admins if nobody is).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'
import { TEAM_ROLES, loadTeam, type TeamMember } from '../lib/om'
import type { Job } from '../lib/types'
import SuggestInput from './SuggestInput'
import { useAccess } from '../lib/access'
import { createLogin, welcomeEmail } from '../lib/users'

type Person = { id: string; full_name: string | null; email: string | null; job_title: string | null }

export default function JobTeam({ job, embedded = false }: { job: Pick<Job, 'id'>; embedded?: boolean }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [who, setWho] = useState('')
  const [role, setRole] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // someone not on the list yet: admins create their login here (manage-users function), then add them (23 Nov)
  const { isAdmin } = useAccess()
  const [newPerson, setNewPerson] = useState<{ name: string; email: string } | null>(null)
  const [made, setMade] = useState<{ name: string; email: string; password: string } | null>(null)
  async function createPerson() {
    if (!newPerson) return
    const nm = newPerson.name.trim()
    const em = newPerson.email.trim().toLowerCase()
    if (!nm || !em) return
    setErr(null)
    setBusy(true)
    try {
      const r = await createLogin(em, nm, [])
      const p: Person = { id: r.user_id, full_name: nm, email: em, job_title: null }
      setPeople((l) => [...l, p].sort((a, b) => name(a).localeCompare(name(b), 'en-GB')))
      setWho(p.id)
      setMade({ name: nm, email: em, password: r.password })
      setNewPerson(null)
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(false)
  }

  const reload = () => loadTeam(job.id).then(setTeam, (e: Error) => (setErr(e.message), setTeam([])))
  useEffect(() => {
    reload()
    cached('profiles-basic', () => must<Person[]>(supabase.from('profiles').select('id,full_name,email,job_title').order('full_name'))).then(setPeople, () => setPeople([]))
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = (p: { full_name: string | null; email: string | null }) => p.full_name || p.email || 'Someone'
  async function act(what: () => PromiseLike<{ error: { message: string } | null }>) {
    setErr(null)
    if (!navigator.onLine) return setErr(saveError(new Error('offline')))
    setBusy(true)
    const r = await what()
    setBusy(false)
    if (r.error) setErr(/duplicate|primary key/i.test(r.error.message) ? 'They’re already on the team in that role.' : saveError(r.error))
    else reload()
  }

  const Wrap = embedded ? 'div' : 'section'
  return (
    <Wrap className={embedded ? "job-team-embedded" : "card"}>
      {!embedded && <h2>Team</h2>}
      <p className="muted small intro">DBP people on this job. The job’s reminders (e.g. O&M documents due, report due) go to everyone here.</p>
      {err && <p className="error">{err}</p>}
      {!team ? (
        <p className="muted small">Loading…</p>
      ) : !team.length ? (
        <p className="muted small">Nobody yet: until someone is added, the job’s reminders go to the admins.</p>
      ) : (
        <ul className="notif-list">
          {team.map((t) => (
            <li key={`${t.profile_id}:${t.role}`} className="notif" style={{ alignItems: 'center' }}>
              <span className="notif-main">
                <b>{name(t)}</b> <span className="tag">{t.role}</span>
                {t.job_title && <span className="muted small"> · {t.job_title}</span>}
              </span>
              <button
                className="link-button"
                aria-label={`Remove ${name(t)} (${t.role})`}
                title="Remove from the team"
                disabled={busy}
                onClick={() =>
                  confirm(`Take ${name(t)} off the team as ${t.role}?`) &&
                  act(() => supabase.from('job_team').delete().eq('job_id', job.id).eq('profile_id', t.profile_id).eq('role', t.role))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="button-row"
        style={{ flexWrap: 'wrap', alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!who || !role.trim()) return
          act(() => supabase.from('job_team').insert({ job_id: job.id, profile_id: who, role: role.trim() })).then(() => (setWho(''), setRole('')))
        }}
      >
        <select value={who} onChange={(e) => (e.target.value === '__new' ? (setNewPerson({ name: '', email: '' }), setWho('')) : setWho(e.target.value))} aria-label="Person">
          <option value="">Add someone…</option>
          {isAdmin && <option value="__new">+ Add a new person (creates their login)…</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {name(p)}
              {p.job_title ? ` (${p.job_title})` : ''}
            </option>
          ))}
        </select>
        <SuggestInput value={role} onChange={setRole} options={TEAM_ROLES} placeholder="Role, e.g. PM" aria-label="Role" style={{ maxWidth: 180 }} />
        <button type="submit" disabled={busy || !who || !role.trim()}>
          Add
        </button>
      </form>
      {newPerson && (
        <div className="new-person">
          <input autoFocus value={newPerson.name} placeholder="Full name" onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
          <input type="email" value={newPerson.email} placeholder="name@duboulay.co.uk" onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })} />
          <button type="button" className="small-button primary" onClick={createPerson} disabled={busy || !newPerson.name.trim() || !newPerson.email.trim()}>
            {busy ? 'Creating…' : 'Create login'}
          </button>
          <button type="button" className="small-button" onClick={() => setNewPerson(null)}>
            Cancel
          </button>
          <p className="muted small">Creates their app login (no profile type yet: set it in Settings › Users), then choose their role here and press Add.</p>
        </div>
      )}
      {made && (
        <div className="password-card">
          <strong>Login made for {made.name}</strong>
          <p>
            Temporary password: <code className="temp-password">{made.password}</code>{' '}
            <button type="button" className="link-button small" onClick={() => navigator.clipboard?.writeText(made.password)}>
              Copy
            </button>
          </p>
          <p className="muted small">It’s shown only now. Now choose their role above and press Add.</p>
          <div className="form-actions">
            <a className="button primary" href={welcomeEmail(made.email, made.name, made.password)}>
              Draft email to them
            </a>
            <button type="button" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </Wrap>
  )
}
