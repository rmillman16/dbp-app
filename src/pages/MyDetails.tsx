import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveError } from '../lib/offline'
import { loadMe } from '../lib/admin'
import type { Profile } from '../lib/types'

// Each user's own name, initials and job title: letters are signed with these and
// references start with the initials (e.g. RM/DBP/DN/2).
export default function MyDetails() {
  const [me, setMe] = useState<Profile | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    loadMe().then(setMe, (e: Error) => setMsg(e.message))
  }, [])

  if (!me) return msg ? <p className="error">{msg}</p> : <p className="muted">Loading…</p>
  const set = (k: 'full_name' | 'initials' | 'job_title', v: string) => setMe({ ...me, [k]: v || null })

  async function save() {
    setMsg(null)
    if (!navigator.onLine) return setMsg(saveError(new Error('offline')))
    const r = await supabase.from('profiles').update({ full_name: me!.full_name, initials: me!.initials, job_title: me!.job_title }).eq('id', me!.id)
    setMsg(r.error ? saveError(r.error) : 'Saved.')
  }

  return (
    <>
      <h1>My details</h1>
      <section className="card">
        <p className="muted small">Letters you produce are signed with these, and their references start with your initials.</p>
        <div className="form-grid three">
          <label>
            Full name
            <input value={me.full_name ?? ''} onChange={(x) => set('full_name', x.target.value)} />
          </label>
          <label>
            Initials
            <input value={me.initials ?? ''} maxLength={4} onChange={(x) => set('initials', x.target.value.toUpperCase())} />
          </label>
          <label>
            Job title
            <input value={me.job_title ?? ''} onChange={(x) => set('job_title', x.target.value)} placeholder="e.g. Quantity Surveyor" />
          </label>
        </div>
        {msg && <p className={msg === 'Saved.' ? 'saved' : 'error'}>{msg}</p>}
        <div className="form-actions">
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </section>
    </>
  )
}
