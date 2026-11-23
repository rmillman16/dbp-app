import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'

// The people at one company (contacts table): name, role, phone, email.
// Saved row by row, so a contact used elsewhere (e.g. a job's project directory) keeps its id.
export interface Contact {
  id?: string
  company_id: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
}

export function loadContacts(companyId: string) {
  return cached(`contacts:${companyId}`, () => must<Contact[]>(supabase.from('contacts').select('*').eq('company_id', companyId).order('name')))
}

export default function ContactsEditor({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<Contact[] | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadContacts(companyId).then(setRows, () => setRows([]))
  }, [companyId])

  if (!rows) return <p className="muted small">Loading contacts…</p>

  const set = (i: number, patch: Partial<Contact>) => (setMsg(null), setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))))

  async function save() {
    if (!rows) return
    if (!navigator.onLine) return setMsg(saveError(new Error('offline')))
    if (rows.some((r) => !r.name.trim())) return setMsg('Every contact needs a name (or remove the empty row).')
    setBusy(true)
    try {
      for (const id of removed) {
        const r = await supabase.from('contacts').delete().eq('id', id)
        if (r.error) throw r.error
      }
      const saved: Contact[] = []
      for (const c of rows) {
        const values = { company_id: companyId, name: c.name.trim(), role: c.role?.trim() || null, phone: c.phone?.trim() || null, email: c.email?.trim() || null }
        const r = c.id ? await supabase.from('contacts').update(values).eq('id', c.id).select('*').single() : await supabase.from('contacts').insert(values).select('*').single()
        if (r.error) throw r.error
        saved.push(r.data as Contact)
      }
      setRows(saved)
      setRemoved([])
      setMsg('Contacts saved.')
    } catch (e) {
      setMsg(saveError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="contacts">
      <h4>Contacts</h4>
      {rows.length === 0 && <p className="muted small">No contacts yet.</p>}
      {rows.map((c, i) => (
        <div key={c.id ?? `new${i}`} className="contact-row">
          <input value={c.name} placeholder="Name" onChange={(e) => set(i, { name: e.target.value })} />
          <input value={c.role ?? ''} placeholder="Role, e.g. Contracts manager" onChange={(e) => set(i, { role: e.target.value })} />
          <span className="with-link">
            <input type="tel" value={c.phone ?? ''} placeholder="Phone" onChange={(e) => set(i, { phone: e.target.value })} />
            {c.id && c.phone && (
              <a href={`tel:${c.phone.replace(/\s/g, '')}`} title="Call">
                📞
              </a>
            )}
          </span>
          <span className="with-link">
            <input type="email" value={c.email ?? ''} placeholder="Email" onChange={(e) => set(i, { email: e.target.value })} />
            {c.id && c.email && (
              <a href={`mailto:${c.email}`} title="Email">
                ✉
              </a>
            )}
          </span>
          <button
            className="small-button"
            title="Remove contact"
            onClick={() => {
              setMsg(null)
              if (c.id) setRemoved([...removed, c.id])
              setRows(rows.filter((_, j) => j !== i))
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="button-row">
        <button className="small-button" onClick={() => setRows([...rows, { company_id: companyId, name: '', role: null, phone: null, email: null }])}>
          + Add contact
        </button>
        <button className="small-button primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save contacts'}
        </button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </div>
  )
}
