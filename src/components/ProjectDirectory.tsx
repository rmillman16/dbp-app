import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { saveError } from '../lib/offline'
import { useDirectoryRoles } from '../lib/roles'
import { addDirectoryEntry, deleteDirectoryEntry, type DirectoryEntry } from '../lib/om'
import JobTeam from './JobTeam'
import type { Company, CompanyType, Job } from '../lib/types'
import SuggestInput from './SuggestInput'
import { isExternalEmail } from '../lib/users'

type Contact = { id: string; company_id: string; name: string; role: string | null; email: string | null; phone: string | null }

// The project directory (23 Nov), on the job's Overview: DBP's team and every outside company and person on the job, with
// the role each plays here. Companies come from the Contractors list (subcontractors, suppliers, consultants, the client's
// team…); one company can have several people on the job. RFIs and submittals are addressed from this list, and the
// external people on it are the ones who can be sent RFIs to answer.
export default function ProjectDirectory({ job, enquiryId }: { job?: Job; enquiryId?: string }) {
  const isJob = !!job
  const ownerId = (job?.id ?? enquiryId) as string
  const owner = { kind: (isJob ? 'job' : 'enquiry') as 'job' | 'enquiry', id: ownerId }
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [orderCompanies, setOrderCompanies] = useState<{ company_id: string; trade: string | null }[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [d, c, p, o] = await Promise.all([
      supabase.from('job_directory').select('*').eq(isJob ? 'job_id' : 'enquiry_id', ownerId),
      supabase.from('companies').select('*').order('name'),
      supabase.from('contacts').select('*').order('name'),
      isJob ? supabase.from('orders').select('company_id, trade').eq('job_id', ownerId) : Promise.resolve({ data: [] as { company_id: string; trade: string | null }[], error: null }),
    ])
    setEntries((d.data ?? []).filter((e) => !(e as DirectoryEntry).client_direct) as DirectoryEntry[])
    setCompanies((c.data ?? []) as Company[])
    setContacts((p.data ?? []) as Contact[])
    setOrderCompanies((o.data ?? []) as { company_id: string; trade: string | null }[])
    if (d.error) setError(d.error.message)
  }, [ownerId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
  }, [load])

  const co = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const ct = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts])
  // outside companies on this job, with the people and the roles they hold here
  const groups = useMemo(() => {
    const m = new Map<string, DirectoryEntry[]>()
    for (const e of entries) if (e.company_id) m.set(e.company_id, [...(m.get(e.company_id) ?? []), e])
    return [...m.entries()].sort((a, b) => (co.get(a[0])?.name ?? '').localeCompare(co.get(b[0])?.name ?? ''))
  }, [entries, co])

  async function remove(e: DirectoryEntry) {
    setError(null)
    try {
      await deleteDirectoryEntry(e.id)
      setEntries((l) => l.filter((x) => x.id !== e.id))
    } catch (x) {
      setError((x as Error).message)
    }
  }
  // every company with an order on this job, if it isn't listed yet
  async function addFromOrders() {
    setError(null)
    setMsg(null)
    const have = new Set(entries.map((e) => e.company_id))
    const todo = orderCompanies.filter((o, i, a) => !have.has(o.company_id) && a.findIndex((x) => x.company_id === o.company_id) === i)
    try {
      const added: DirectoryEntry[] = []
      for (const o of todo) added.push(await addDirectoryEntry({ job_id: ownerId, company_id: o.company_id, contact_id: null, role: o.trade || 'Subcontractor', client_direct: false }))
      setEntries((l) => [...l, ...added])
      setMsg(added.length ? `Added ${added.length} compan${added.length === 1 ? 'y' : 'ies'} from this job's orders. Add their people below.` : "Every company with an order on this job is already in the directory.")
    } catch (x) {
      setError(saveError(x))
    }
  }

  return (
    <section className="card span-all project-directory">
      <div className="pane-head">
        <h2>Project directory</h2>
        <span className="button-row">
          {orderCompanies.length > 0 && (
            <button type="button" className="small-button" onClick={addFromOrders}>
              + Companies from orders
            </button>
          )}
          <button type="button" className="primary" onClick={() => setAdding(!adding)}>
            + Add company / person
          </button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {adding && (
        <AddToDirectory
          owner={owner}
          companies={companies}
          contacts={contacts}
          onCompany={(c) => setCompanies((l) => [...l, c].sort((a, b) => a.name.localeCompare(b.name)))}
          onContact={(c) => setContacts((l) => [...l, c])}
          onAdded={(rows) => {
            setEntries((l) => [...l, ...rows])
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* DBP's own people: the job's team, added and removed here (the job's reminders go to them) */}
      {job && (
        <>
          <h3 className="sub-head">DBP team</h3>
          <JobTeam job={job} embedded />
        </>
      )}

      <h3 className="sub-head">{job ? 'Client, consultants, subcontractors and suppliers' : 'Client team and consultants'}</h3>
      {groups.length === 0 && <p className="muted small">Nobody added yet. Add a company, and as many of its people as work on this job.</p>}
      {groups.map(([companyId, rows]) => {
        const c = co.get(companyId)
        return (
          <div key={companyId} className="dir-company">
            <div className="dir-company-head">
              <strong>{c?.name ?? 'A company'}</strong>
              <small>{[c?.type, c?.trade].filter(Boolean).join(' · ')}</small>
              <Link to={`/contractors?company=${companyId}`} className="link-button small">
                Supply Chain →
              </Link>
            </div>
            <ul className="dir-people">
              {rows.map((e) => {
                const p = e.contact_id ? ct.get(e.contact_id) : null
                return (
                  <li key={e.id}>
                    <strong>{p?.name ?? <span className="muted">No named person</span>}</strong> <span className="dir-role">{e.role}</span>
                    {(p?.email || c?.email) && <a href={`mailto:${p?.email || c?.email}`}>{p?.email || c?.email}</a>}
                    <span className="dir-ext" title="Outside DBP: answers RFIs through a private link, never the app">{isExternalEmail(p?.email || c?.email) || !(p?.email || c?.email) ? 'External' : 'Internal address'}</span>
                    {(p?.phone || c?.phone) && <span className="muted">{p?.phone || c?.phone}</span>}
                    <button type="button" className="small-button" title="Remove from this job" onClick={() => remove(e)}>
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

// pick (or make) a company, tick the people from it who work on this job, give the role
function AddToDirectory({
  owner,
  companies,
  contacts,
  onCompany,
  onContact,
  onAdded,
  onCancel,
}: {
  owner: { kind: 'job' | 'enquiry'; id: string }
  companies: Company[]
  contacts: Contact[]
  onCompany: (c: Company) => void
  onContact: (c: Contact) => void
  onAdded: (rows: DirectoryEntry[]) => void
  onCancel: () => void
}) {
  const [companyId, setCompanyId] = useState('')
  const [coText, setCoText] = useState('') // what is typed in the company box
  const [newCo, setNewCo] = useState<{ name: string; type: CompanyType } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [newPeople, setNewPeople] = useState<{ name: string; email: string; phone: string }[]>([])
  const [role, setRole] = useState('')
  const { roles, add: addRole } = useDirectoryRoles()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mine = contacts.filter((c) => c.company_id === companyId)
  const label = (c: Company) => (c.trade ? `${c.name} (${c.trade})` : c.name)
  const byLabel = new Map(companies.map((c) => [label(c).toLowerCase(), c]))
  // typing narrows the list; choosing a name sets the company; a name that is not there can be added
  function typeCompany(v: string) {
    setCoText(v)
    const hit = byLabel.get(v.trim().toLowerCase()) ?? companies.find((c) => c.name.toLowerCase() === v.trim().toLowerCase())
    setCompanyId(hit?.id ?? '')
    setPicked(new Set())
    if (hit) setNewCo(null)
  }

  async function makeCompany() {
    if (!newCo?.name.trim()) return
    setError(null)
    const r = await supabase.from('companies').insert({ name: newCo.name.trim(), type: newCo.type }).select('*').single()
    if (r.error) return setError(saveError(r.error))
    onCompany(r.data as Company)
    setCompanyId(r.data.id)
    setCoText(r.data.name)
    setNewCo(null)
  }

  async function save() {
    setError(null)
    if (!companyId) return setError('Choose the company first.')
    if (!role.trim()) return setError('Give their role on this job, e.g. Architect or Electrical subcontractor.')
    setBusy(true)
    try {
      const ids = [...picked]
      for (const p of newPeople.filter((x) => x.name.trim())) {
        const r = await supabase
          .from('contacts')
          .insert({ company_id: companyId, name: p.name.trim(), email: p.email.trim() || null, phone: p.phone.trim() || null })
          .select('*')
          .single()
        if (r.error) throw r.error
        onContact(r.data as Contact)
        ids.push(r.data.id)
      }
      const rows: DirectoryEntry[] = []
      // no person ticked: the company on its own
      for (const cid of ids.length ? ids : [null]) {
        const ins = await supabase
          .from('job_directory')
          .insert({ job_id: owner.kind === 'job' ? owner.id : null, enquiry_id: owner.kind === 'enquiry' ? owner.id : null, company_id: companyId, contact_id: cid, role: role.trim(), client_direct: false })
          .select('*')
          .single()
        if (ins.error) throw ins.error
        rows.push(ins.data as DirectoryEntry)
      }
      onAdded(rows)
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="quick-add">
      <div className="form-grid">
        <label className="span-2">
          Company <small className="muted">search the list, or type a new name and add it</small>
          <SuggestInput
            value={coText}
            onChange={typeCompany}
            options={companies.map(label)}
            limit={40}
            placeholder="Search companies…"
            onAdd={(name) => setNewCo({ name, type: 'consultant' })}
          />
        </label>
        {newCo && (
          <div className="span-2 inline-add">
            <input autoFocus value={newCo.name} placeholder="Company name" onChange={(e) => setNewCo({ ...newCo, name: e.target.value })} />
            <select value={newCo.type} onChange={(e) => setNewCo({ ...newCo, type: e.target.value as CompanyType })}>
              <option value="subcontractor">Subcontractor</option>
              <option value="supplier">Supplier</option>
              <option value="consultant">Consultant</option>
              <option value="designer">Designer</option>
              <option value="client">Client</option>
              <option value="other">Other</option>
            </select>
            <button type="button" className="small-button primary" onClick={makeCompany}>
              Add
            </button>
            <button type="button" className="small-button" onClick={() => setNewCo(null)}>
              Cancel
            </button>
          </div>
        )}
        <label className="span-2">
          Role on this job
          <SuggestInput value={role} onChange={setRole} options={roles} limit={80} onAdd={(v) => addRole(v).catch((e: Error) => setError(e.message))} placeholder="e.g. Architect, Electrical subcontractor" />
        </label>
        {companyId && (
          <div className="span-2">
            <strong className="small">People at this company working on the job</strong>
            {mine.length === 0 && newPeople.length === 0 && <p className="muted small">No people on file for this company yet: add one below.</p>}
            {mine.map((c) => (
              <label key={c.id} className="check-row">
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={(e) => setPicked((s) => (e.target.checked ? new Set([...s, c.id]) : new Set([...s].filter((x) => x !== c.id))))}
                />{' '}
                {c.name}
                {c.role ? ` · ${c.role}` : ''}
                {c.email ? ` · ${c.email}` : ' · (no email)'}
              </label>
            ))}
            {newPeople.map((p, i) => (
              <div key={i} className="inline-add">
                <input value={p.name} placeholder="Name" onChange={(e) => setNewPeople(newPeople.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input value={p.email} placeholder="Email" onChange={(e) => setNewPeople(newPeople.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                <input value={p.phone} placeholder="Phone" onChange={(e) => setNewPeople(newPeople.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                <button type="button" className="small-button" onClick={() => setNewPeople(newPeople.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="small-button" onClick={() => setNewPeople([...newPeople, { name: '', email: '', phone: '' }])}>
              + New person at this company
            </button>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="primary" onClick={save} disabled={busy}>
          {busy ? 'Adding…' : 'Add to the directory'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
