import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveError } from '../lib/offline'

// Outside people on an RFI / submittal (script 061): a private link for each, which DBP can copy and send, withdraw, and see
// whether it's been opened. Outside people are not users of the app: the link opens one page with just their item.
// Until the platform's own email is set up, copy the link into your own email.
export interface OutsidePerson {
  id: string // rfi_people / submittal_people row
  name: string
  role: string // assignee | reviewer | cc
  email: string | null
}
interface Status {
  active: number
  lastUsed: string | null
  uses: number
}

export default function ExternalAccess({ kind, people, disabled }: { kind: 'rfi' | 'submittal'; people: OutsidePerson[]; disabled?: boolean }) {
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [link, setLink] = useState<{ name: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ids = people.map((p) => p.id).join(',')

  const load = useCallback(async () => {
    if (!people.length) return
    const r = await supabase.from('external_links').select('person_id, last_used_at, use_count, revoked_at, expires_at').eq('kind', kind).in('person_id', people.map((p) => p.id))
    if (r.error) return // before script 061
    const m: Record<string, Status> = {}
    const now = new Date().toISOString()
    for (const l of r.data as { person_id: string; last_used_at: string | null; use_count: number; revoked_at: string | null; expires_at: string }[]) {
      const s = (m[l.person_id] ??= { active: 0, lastUsed: null, uses: 0 })
      if (!l.revoked_at && l.expires_at > now) s.active++
      s.uses += l.use_count
      if (l.last_used_at && (!s.lastUsed || l.last_used_at > s.lastUsed)) s.lastUsed = l.last_used_at
    }
    setStatus(m)
  }, [ids, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
  }, [load])

  async function copy(p: OutsidePerson) {
    setError(null)
    setBusy(p.id)
    try {
      const r = await supabase.rpc('issue_external_link', { p_kind: kind, p_person: p.id })
      if (r.error) throw new Error(/function|does not exist/i.test(r.error.message) ? 'Outside access needs script 061 run in Supabase first.' : r.error.message)
      const url = `${location.origin}/r/${r.data as string}`
      setLink({ name: p.name, url })
      navigator.clipboard?.writeText(url).catch(() => {})
      load()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(null)
  }
  async function withdraw(p: OutsidePerson) {
    if (!confirm(`Withdraw ${p.name}'s links? Any link already sent to them stops working.`)) return
    setBusy(p.id)
    const r = await supabase.rpc('revoke_external_links', { p_kind: kind, p_person: p.id })
    if (r.error) setError(r.error.message)
    setLink(null)
    await load()
    setBusy(null)
  }
  if (!people.length) return null
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname)

  return (
    <section className="card">
      <h2>Outside people</h2>
      <p className="muted small">
        They don't have a login and can't see anything else: each gets a private link to this {kind === 'rfi' ? 'RFI' : 'submittal'} only. The platform emails it for you once email is set up; until then copy a link and send it
        yourself. A link works for 90 days and is personal to them.
      </p>
      {local && <p className="pqq-warning small">This copy of the app is running on your own computer, so links made here won't open for anyone else. They work once the app is on its public address.</p>}
      {error && <p className="error">{error}</p>}
      <ul className="ext-access">
        {people.map((p) => {
          const s = status[p.id]
          return (
            <li key={p.id}>
              <strong>{p.name}</strong>
              <span className="rfi-kind">{p.role === 'cc' ? 'Cc: reads only' : kind === 'rfi' ? 'Assignee' : 'Reviewer'}</span>
              <span className="muted small">{p.email ?? 'no email on file'}</span>
              <span className="muted small">{s?.lastUsed ? `opened ${new Date(s.lastUsed).toLocaleDateString('en-GB')} (${s.uses}×)` : s?.active ? 'link made, not opened yet' : 'no link yet'}</span>
              <button type="button" className="small-button" disabled={disabled || busy === p.id} onClick={() => copy(p)}>
                Copy a link
              </button>
              {s?.active ? (
                <button type="button" className="small-button" disabled={busy === p.id} onClick={() => withdraw(p)}>
                  Withdraw links
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {link && (
        <div>
          <p className="saved small">
            Link for {link.name} copied. Send it to them yourself (it is shown only now):
          </p>
          <input className="ext-linkbox" readOnly value={link.url} onFocus={(e) => e.target.select()} />
        </div>
      )}
    </section>
  )
}
