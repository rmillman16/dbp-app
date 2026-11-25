import { Link, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'
import { addDaysIso, todayIso, ukDate } from '../lib/format'
import { useAccess } from '../lib/access'
import { jobLabel, loadSites, me } from '../lib/requisitions'
import type { Job } from '../lib/types'
import Loading from '../components/Loading'
import { SiteNav } from './Site'

// Site › Inventory (25 Nov, script 090): stock held in locations (first: Workshop 6). Anyone on Site can look
// and request items to a site; "Inventory - ADMIN" people add items, adjust stock and work the requests.
interface Location {
  id: string
  name: string
  notes: string | null
}
interface Item {
  id: string
  location_id: string
  name: string
  category: string | null
  quantity: number
  unit: string
  notes: string | null
}
type IrStatus = 'new' | 'ready' | 'issued' | 'cancelled'
interface Request {
  id: string
  req_no: number
  job_id: string
  required_by: string | null
  notes: string | null
  status: IrStatus
  requested_by: string | null
  requester_name: string | null
  created_at: string
}
interface Line {
  id: string
  request_id: string
  item_id: string | null
  item_name: string
  unit: string
  quantity: number
}
const IR_LABELS: Record<IrStatus, string> = { new: 'New', ready: 'Ready to collect', issued: 'Issued', cancelled: 'Cancelled' }
const irRef = (r: Pick<Request, 'req_no'>) => `IR${String(r.req_no).padStart(4, '0')}`
const needs090 = (m: string) => (/inventory/i.test(m) && /does not exist|schema cache/i.test(m) ? 'Inventory needs script 090 run in Supabase first (supabase/README.md).' : m)
const num = (v: unknown) => Number(v) || 0

// typical site categories; anything an admin types as a new category joins the list once an item uses it
const STARTER_CATEGORIES = [
  'Welfare – kitchen & drinks',
  'Welfare – toilets & washing',
  'Welfare – drying, changing & seating',
  'First aid & fire',
  'PPE',
  'Signage & barriers',
  'Power & lighting',
  'Access & ladders',
  'Hand tools',
  'Power tools',
  'Cleaning & waste',
  'Temporary protection',
  'Consumables & fixings',
]
const NEW_CATEGORY = '__new__'
const categoryList = (items: Item[]) => [...new Set([...STARTER_CATEGORIES, ...items.map((i) => i.category).filter((c): c is string => !!c)])].sort((a, b) => a.localeCompare(b))

// a dropdown of the categories, with "+ Add a new category…" at the end
function CategorySelect({ value, categories, onChange }: { value: string; categories: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value !== NEW_CATEGORY) return onChange(e.target.value)
        const name = window.prompt('Name of the new category')?.trim()
        if (name) onChange(name)
      }}
    >
      <option value="">— none —</option>
      {value && !categories.includes(value) && <option value={value}>{value}</option>}
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={NEW_CATEGORY}>+ Add a new category…</option>
    </select>
  )
}

export default function Inventory() {
  const { can } = useAccess()
  const admin = can('buyer_inventory')
  const [tab, setTab] = useState<'stock' | 'requests'>('stock')
  const [locs, setLocs] = useState<Location[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loc, setLoc] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const [l, i] = await Promise.all([
        cached('inv-locations', () => must<Location[]>(supabase.from('inventory_locations').select('*').order('name'))),
        cached('inv-items', () => must<Item[]>(supabase.from('inventory_items').select('*').order('name'))),
      ])
      setLocs(l)
      setItems(i)
      setLoc((cur) => cur || l[0]?.id || '')
    } catch (e) {
      setError(needs090((e as Error).message))
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function addLocation() {
    const name = window.prompt('Name of the new location (e.g. Workshop 7, Store container)')?.trim()
    if (!name) return
    const r = await supabase.from('inventory_locations').insert({ name }).select('*').single()
    if (r.error) return setError(saveError(r.error))
    setLocs([...(locs ?? []), r.data as Location])
    setLoc((r.data as Location).id)
  }

  return (
    <>
      <SiteNav />
      <section className="card">
        <div className="pane-head">
          <h2>Inventory</h2>
          <span className="segmented">
            <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>
              Stock
            </button>
            <button className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>
              Requests
            </button>
          </span>
        </div>
        {error && <p className="error">{error}</p>}
        {!locs && !error && <Loading />}
        {locs && tab === 'stock' && (
          <>
            <div className="toolbar">
              <div className="segmented site-filter">
                {locs.map((l) => (
                  <button key={l.id} className={loc === l.id ? 'on' : ''} onClick={() => setLoc(l.id)}>
                    {l.name}
                    <span className="seg-count">{items.filter((i) => i.location_id === l.id).length}</span>
                  </button>
                ))}
              </div>
              {admin && (
                <button className="button small-button" onClick={addLocation}>
                  + Location
                </button>
              )}
            </div>
            {loc && <Stock key={loc} locId={loc} categories={categoryList(items)} items={items.filter((i) => i.location_id === loc)} admin={admin} reload={load} setError={setError} />}
          </>
        )}
        {locs && tab === 'requests' && <Requests admin={admin} items={items} locs={locs} reload={load} />}
      </section>
    </>
  )
}

// ---------- one location's stock, with the request basket ----------
function Stock({ locId, items, categories, admin, reload, setError }: { locId: string; items: Item[]; categories: string[]; admin: boolean; reload: () => void; setError: (m: string | null) => void }) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const shown = items.filter((i) => `${i.name} ${i.category ?? ''}`.toLowerCase().includes(q.toLowerCase()))

  async function saveQty(i: Item, v: string) {
    if (num(v) === i.quantity) return
    const r = await supabase.from('inventory_items').update({ quantity: Math.max(num(v), 0) }).eq('id', i.id)
    if (r.error) setError(saveError(r.error))
    else reload()
  }
  async function saveCategory(i: Item, v: string) {
    const r = await supabase.from('inventory_items').update({ category: v || null }).eq('id', i.id)
    if (r.error) setError(saveError(r.error))
    else reload()
  }
  async function remove(i: Item) {
    if (!window.confirm(`Remove ${i.name} from the inventory?`)) return
    const r = await supabase.from('inventory_items').delete().eq('id', i.id)
    if (r.error) setError(saveError(r.error))
    else reload()
  }

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search this location…" value={q} onChange={(e) => setQ(e.target.value)} />
        {admin && (
          <button className="button primary small-button" onClick={() => setAdding(!adding)}>
            + Item
          </button>
        )}
        <Link to="/site/inventory/request" className="button primary small-button">
          Request items to site
        </Link>
      </div>
      {adding && <AddItem locId={locId} categories={categories} onDone={() => { setAdding(false); reload() }} setError={setError} />}
      {items.length === 0 && <p className="muted">Nothing in this location yet.{admin ? ' Use + Item to add the first.' : ''}</p>}
      {shown.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>In stock</th>
              {admin && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id}>
                <td className="stack-title">
                  <strong>{i.name}</strong>
                  {i.notes && <div className="muted small">{i.notes}</div>}
                </td>
                <td className="stack-sub" data-label="Category">
                  {admin ? <CategorySelect value={i.category ?? ''} categories={categories} onChange={(v) => saveCategory(i, v)} /> : (i.category ?? '')}
                </td>
                <td data-label="In stock" className="nowrap">
                  {admin ? (
                    <input type="number" min="0" step="any" style={{ width: 90 }} defaultValue={i.quantity} onBlur={(e) => saveQty(i, e.target.value)} />
                  ) : (
                    i.quantity
                  )}{' '}
                  {i.unit}
                </td>
                {admin && (
                  <td>
                    <button className="link-button small" onClick={() => remove(i)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function AddItem({ locId, categories, onDone, setError }: { locId: string; categories: string[]; onDone: () => void; setError: (m: string | null) => void }) {
  const [f, setF] = useState({ name: '', category: '', quantity: '1', unit: 'nr', notes: '' })
  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = await supabase.from('inventory_items').insert({
      location_id: locId,
      name: f.name.trim(),
      category: f.category.trim() || null,
      quantity: num(f.quantity),
      unit: f.unit.trim() || 'nr',
      notes: f.notes.trim() || null,
    })
    if (r.error) setError(saveError(r.error))
    else onDone()
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <label className="span-2">
          Item *
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. 110V extension lead 10 m" required />
        </label>
        <label>
          Category
          <CategorySelect value={f.category} categories={categories} onChange={(v) => setF({ ...f, category: v })} />
        </label>
        <label>
          Quantity
          <input type="number" min="0" step="any" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </label>
        <label>
          Unit
          <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="nr, m, box…" />
        </label>
        <label className="span-2">
          Notes
          <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>
      </div>
      <div className="button-row">
        <button className="button primary">Add to inventory</button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------- the request form (its own link, like the material requisition): choose the site, build a shopping list ----------
export function InventoryRequestForm() {
  const [params] = useSearchParams()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [locs, setLocs] = useState<Location[]>([])
  const [f, setF] = useState({ job_id: params.get('job') ?? '', required_by: addDaysIso(todayIso(), 2), notes: '' })
  const [list, setList] = useState<{ id: string; qty: string }[]>([])
  const [pick, setPick] = useState('')
  const [pickQty, setPickQty] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<Request | null>(null)
  useEffect(() => {
    loadSites().then(setJobs, (e: Error) => setError(e.message))
    cached('inv-locations', () => must<Location[]>(supabase.from('inventory_locations').select('*').order('name'))).then(setLocs, (e: Error) => setError(needs090(e.message)))
    cached('inv-items', () => must<Item[]>(supabase.from('inventory_items').select('*').order('name'))).then(setItems, () => {})
  }, [])
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  function addToList() {
    if (!pick || num(pickQty) <= 0) return
    const have = list.find((l) => l.id === pick)
    setList(have ? list.map((l) => (l.id === pick ? { ...l, qty: String(num(l.qty) + num(pickQty)) } : l)) : [...list, { id: pick, qty: pickQty }])
    setPick('')
    setPickQty('1')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!list.length) return setError('Add at least one item to the list.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const user = await me()
      if (!user) throw new Error('Sign in first.')
      const prof = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      const r = await supabase
        .from('inventory_requests')
        .insert({ job_id: f.job_id, required_by: f.required_by || null, notes: f.notes.trim() || null, requested_by: user.id, requester_name: prof.data?.full_name ?? user.email ?? null })
        .select('*')
        .single()
      if (r.error) throw new Error(needs090(r.error.message))
      const req = r.data as Request
      const rows = list.map((l) => ({ request_id: req.id, item_id: l.id, item_name: itemById.get(l.id)?.name ?? '', unit: itemById.get(l.id)?.unit ?? 'nr', quantity: num(l.qty) }))
      const ins = await supabase.from('inventory_request_lines').insert(rows)
      if (ins.error) throw new Error(ins.error.message)
      setSent(req)
      setList([])
      setF({ ...f, notes: '' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(saveError(err))
    }
    setBusy(false)
  }
  const locName = (id: string) => locs.find((l) => l.id === id)?.name ?? ''

  return (
    <>
      <SiteNav />
      {sent && (
        <div className="success-banner" role="status">
          <strong>✓ {irRef(sent)} sent to the stores.</strong> Add another below, or follow it under <Link to="/site/inventory">Inventory › Requests</Link>.
          <button type="button" className="link-button small" onClick={() => setSent(null)} aria-label="Close">
            ✕
          </button>
        </div>
      )}
      <form className="card form req-form" onSubmit={submit}>
        <h2>Inventory request</h2>
        <p className="muted small intro">Choose the site, then build a shopping list from our stock. Your name is added for you.</p>
        <div className="form-grid">
          <label className="span-2">
            Site name *
            <select value={f.job_id} onChange={(e) => setF({ ...f, job_id: e.target.value })} required>
              <option value="">{jobs ? 'Choose the site…' : 'Loading…'}</option>
              {(jobs ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {jobLabel(j)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Needed on site by *
            <input type="date" min={todayIso()} value={f.required_by} onChange={(e) => setF({ ...f, required_by: e.target.value })} required />
          </label>
        </div>

        <h3>Shopping list</h3>
        <div className="form-grid">
          <label className="span-2">
            Item from the inventory
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose an item…</option>
              {locs.map((l) => (
                <optgroup key={l.id} label={l.name}>
                  {items
                    .filter((i) => i.location_id === l.id)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.quantity} {i.unit} in stock)
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input type="number" min="0" step="any" value={pickQty} onChange={(e) => setPickQty(e.target.value)} />
          </label>
          <div>
            <button type="button" className="button" onClick={addToList} disabled={!pick}>
              + Add to list
            </button>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="muted">Nothing on the list yet.</p>
        ) : (
          <table className="table stack">
            <thead>
              <tr>
                <th>Item</th>
                <th>From</th>
                <th>Quantity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((l) => {
                const it = itemById.get(l.id)
                const over = it && num(l.qty) > it.quantity
                return (
                  <tr key={l.id}>
                    <td className="stack-title">
                      <strong>{it?.name}</strong>
                    </td>
                    <td className="stack-sub" data-label="From">
                      {it ? locName(it.location_id) : ''}
                    </td>
                    <td data-label="Quantity" className="nowrap">
                      <input type="number" min="0" step="any" style={{ width: 90 }} value={l.qty} onChange={(e) => setList(list.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))} /> {it?.unit}
                      {over && <div className="muted small">Only {it?.quantity} in stock</div>}
                    </td>
                    <td>
                      <button type="button" className="link-button small" onClick={() => setList(list.filter((x) => x.id !== l.id))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <label>
          Notes
          <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Anything the stores should know" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="button-row">
          <button className="button primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </>
  )
}

// ---------- requests: mine (everyone) or all (inventory admins) ----------
function Requests({ admin, items, locs, reload }: { admin: boolean; items: Item[]; locs: Location[]; reload: () => void }) {
  const [rows, setRows] = useState<Request[] | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs])
  const itemLoc = useMemo(() => new Map(items.map((i) => [i.id, locName.get(i.location_id) ?? ''])), [items, locName])
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])

  const load = async () => {
    const r = await supabase.from('inventory_requests').select('*').order('req_no', { ascending: false })
    if (r.error) return setError(needs090(r.error.message))
    const l = await supabase.from('inventory_request_lines').select('*')
    setRows(r.data as Request[])
    setLines((l.data ?? []) as Line[])
  }
  useEffect(() => {
    load()
    loadSites().then(setJobs, () => {})
  }, [])

  async function setStatus(r: Request, status: IrStatus) {
    const u = await supabase.from('inventory_requests').update({ status }).eq('id', r.id)
    if (u.error) return setError(saveError(u.error))
    await load()
    reload() // issuing changes the stock
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <p className="muted">No inventory requests yet. Tick quantities in the Stock tab to ask for items to site.</p>}
      {rows && rows.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Site</th>
              <th>Items</th>
              <th>Raised by</th>
              <th>Needed by</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="stack-title nowrap">
                  <strong>{irRef(r)}</strong>
                </td>
                <td className="stack-sub">{jobLabel(jobById.get(r.job_id))}</td>
                <td data-label="Items">
                  {lines
                    .filter((l) => l.request_id === r.id)
                    .map((l) => (
                      <div key={l.id}>
                        {l.quantity} {l.unit} · {l.item_name}
                        {l.item_id && itemLoc.get(l.item_id) ? <span className="muted small"> ({itemLoc.get(l.item_id)})</span> : null}
                      </div>
                    ))}
                  {r.notes && <div className="muted small">{r.notes}</div>}
                </td>
                <td data-label="Raised by">{r.requester_name}</td>
                <td className="nowrap" data-label="Needed by">
                  {r.required_by ? ukDate(r.required_by) : ''}
                </td>
                <td data-label="Status">
                  <span className={`tag ir-${r.status}`}>{IR_LABELS[r.status]}</span>
                </td>
                <td>
                  <span className="button-row">
                    {admin && r.status === 'new' && (
                      <button className="button small-button" onClick={() => setStatus(r, 'ready')}>
                        Ready
                      </button>
                    )}
                    {admin && (r.status === 'new' || r.status === 'ready') && (
                      <button className="button small-button primary" onClick={() => setStatus(r, 'issued')}>
                        Issued
                      </button>
                    )}
                    {(r.status === 'new' || (admin && r.status === 'ready')) && (
                      <button className="link-button small" onClick={() => window.confirm(`Cancel ${irRef(r)}?`) && setStatus(r, 'cancelled')}>
                        Cancel
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
