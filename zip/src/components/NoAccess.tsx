import { Component, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { saveError } from '../lib/offline'
import { nudgeEmails } from '../lib/notifications'
import { sectionLabel, useAccess, type Section } from '../lib/access'

// "You don't have access to this area" (22 Nov): a padlock, that line, and Request access, which sends IT a
// request (their bell; script 036). Shown instead of an error, so nobody thinks the app is broken.
export function NoAccess({ what }: { what: string }) {
  const { pathname } = useLocation()
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // asked already for this area and still waiting: say so rather than asking again
  useEffect(() => {
    supabase
      .from('access_requests')
      .select('created_at')
      .eq('area', what)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => data?.[0] && setSent(data[0].created_at as string))
  }, [what])

  async function send() {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    const { data } = await supabase.auth.getSession()
    const r = await supabase.from('access_requests').insert({ profile_id: data.session?.user.id, area: what, path: pathname, note: note.trim() || null })
    setBusy(false)
    if (r.error) return setError(/relation|schema cache|does not exist/i.test(r.error.message) ? 'Requests need script 036 run in Supabase first.' : saveError(r.error))
    nudgeEmails()
    setSent(new Date().toISOString())
    setAsking(false)
  }

  return (
    <section className="card no-access">
      <div className="no-access-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="56" height="56">
          <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <h2>You don’t have access to this area</h2>
      {sent ? (
        <p className="muted">Access requested on {new Date(sent).toLocaleDateString('en-GB')}. IT will be in touch.</p>
      ) : asking ? (
        <div className="no-access-ask">
          <textarea rows={2} value={note} placeholder="Why you need it (optional)" onChange={(e) => setNote(e.target.value)} />
          <div className="form-actions">
            <button className="primary" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="primary" onClick={() => setAsking(true)}>
          Request access
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

// a page (or job tab) only for the types ticked for its part
export function RequireAccess({ section, what, children }: { section: Section; what?: string; children: ReactNode }) {
  const { can } = useAccess()
  return can(section) ? <>{children}</> : <NoAccess what={what ?? sectionLabel(section)} />
}

// if a page fails, a message and a way on rather than a blank screen
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="card no-access">
        <h2>This page hit a problem</h2>
        <p>Your work saved so far is safe. Try reloading; if it keeps happening, tell Richard what you were doing.</p>
        <p className="muted small">{this.state.error.message}</p>
        <div className="form-actions">
          <button className="primary" onClick={() => location.reload()}>
            Reload
          </button>
          <Link to="/" className="button" onClick={() => this.setState({ error: null })}>
            Go to Home
          </Link>
        </div>
      </section>
    )
  }
}
