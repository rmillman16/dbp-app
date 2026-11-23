// A job's team (job_team): who works on it and as what. Reminders that belong to the job, such as
// outstanding O&M documents (script 047), go on the bell of everyone here (the admins if nobody is).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'
import { TEAM_ROLES, loadTeam, type TeamMember } from '../lib/om'
import type { Job } from '../lib/types'

type Person = { id: string; full_name: string | null; email: string | null; job_title: string | null }

export default function JobTeam({ job }: { job: Pick<Job, 'id'> }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [who, setWho] = useState('')
  const [role, setRole] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <section className="card">
      <h2>Team</h2>
      <p className="muted small intro">Who’s on this job. The job’s reminders (e.g. O&M documents due) go to everyone here.</p>
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
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
          <option value="">Add someone…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {name(p)}
              {p.job_title ? ` (${p.job_title})` : ''}
            </option>
          ))}
        </select>
        <input list="job-team-roles" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role, e.g. PM" aria-label="Role" style={{ maxWidth: 180 }} />
        <datalist id="job-team-roles">
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <button type="submit" disabled={busy || !who || !role.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}
