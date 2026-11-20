import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Sign-in only: accounts are added by an admin in Supabase › Authentication › Users.
export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email or password not recognised.' : error.message)
    setBusy(false)
  }

  return (
    <div className="centre-page">
      <form className="card narrow" onSubmit={submit}>
        <img src="/dbp-logo.svg" alt="du Boulay Projects" className="signin-logo" />
        <h1>Sign in</h1>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
