import { Component, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { cached, must } from '../lib/offline'
import { roleLabel, sectionLabel, useAccess, type Section } from '../lib/access'

// "You don't have access" (22 Nov): a part of the app your profile type can't open shows this instead of an
// error, so nobody thinks the app is broken or calls IT. It says who to ask: DBP's admins, not IT.
export function NoAccess({ what }: { what: string }) {
  const { roles } = useAccess()
  const [admins, setAdmins] = useState<{ full_name: string | null; email: string | null }[]>([])
  useEffect(() => {
    cached('admins', () =>
      must<{ full_name: string | null; email: string | null }[]>(supabase.from('profiles').select('full_name,email').eq('is_admin', true).order('full_name')),
    ).then(setAdmins, () => {})
  }, [])
  return (
    <section className="card no-access">
      <div className="no-access-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="40" height="40">
          <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <h2>You don’t have access to {what}</h2>
      <p>
        <strong>The app is working fine:</strong> this part just isn’t switched on for your login
        {roles.length > 0 ? ` (${roles.map(roleLabel).join(', ')})` : ''}.
      </p>
      <p className="muted">
        Access is set by DBP’s app admins, not IT. If you need it, ask
        {admins.length === 0 && ' an admin'}
        {admins.map((a, i) => (
          <span key={a.email ?? i}>
            {i === 0 ? ' ' : i === admins.length - 1 ? ' or ' : ', '}
            {a.email ? (
              <a href={`mailto:${a.email}?subject=${encodeURIComponent(`DBP app access: ${what}`)}`}>{a.full_name && a.full_name !== a.email ? a.full_name : a.email}</a>
            ) : (
              a.full_name
            )}
          </span>
        ))}
        .
      </p>
      <Link to="/" className="button primary">
        Go to Home
      </Link>
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
