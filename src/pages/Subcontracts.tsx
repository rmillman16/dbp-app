import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { createNotice, loadCompanies, loadOrder, loadOrders, orderLabel } from '../lib/subcontracts'
import type { Company, Order, PaymentNotice, SubVariation } from '../lib/types'
import { useJob } from './JobLayout'
import OmOutstanding from '../components/OmOutstanding'

// Job › Payment notices: the job's subcontract orders (3. Orders / NN - Trade - Subcontractor).
export default function SubcontractsTab() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOrders(job.id).then(setOrders, (e: Error) => setError(e.message))
    loadCompanies().then(setCompanies, () => {})
  }, [job])

  const byId = new Map(companies.map((c) => [c.id, c]))
  return (
    <section className="card">
      <div className="pane-head">
        <h2>Subcontract orders</h2>
        <button className="primary" onClick={() => setAdding(!adding)}>
          + New order
        </button>
      </div>
      {adding && (
        <NewOrder
          companies={companies}
          orders={orders ?? []}
          onCancel={() => setAdding(false)}
          onCompanyAdded={(c) => setCompanies((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}
      {error && <p className="error">{error}</p>}
      {orders?.length === 0 && !adding && <p className="muted">No subcontract orders yet. Add one to start taking applications.</p>}
      {orders && orders.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Order</th>
              <th>Order no.</th>
              <th className="num">Order value</th>
              <th className="num">Retention</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => navigate(o.id)}>
                <td className="stack-title">
                  <strong>{orderLabel(o, byId.get(o.company_id))}</strong>
                </td>
                <td data-label="Order no.">{o.order_no ?? <span className="late">none</span>}</td>
                <td className="num" data-label="Order value">
                  {money(o.order_value)}
                </td>
                <td className="num" data-label="Retention">
                  {o.retention_pct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// Add a subcontractor without leaving the job: saved to the main Contractors list,
// with their main contact, and picked for this order.
function QuickAddCompany({ onAdded, onCancel }: { onAdded: (c: Company) => void; onCancel: () => void }) {
  const [c, setC] = useState({ name: '', trade: '', address: '', postcode: '', email: '', phone: '', contact: '', contactRole: '', contactPhone: '', contactEmail: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setError(null)
    if (!c.name.trim()) return setError('The company name is needed.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    const ins = await supabase
      .from('companies')
      .insert({
        name: c.name.trim(),
        type: 'subcontractor',
        trade: c.trade.trim() || null,
        address: c.address.trim() || null,
        postcode: c.postcode.trim() || null,
        email: c.email.trim() || null,
        phone: c.phone.trim() || null,
      })
      .select('*')
      .single()
    if (ins.error) {
      setBusy(false)
      return setError(saveError(ins.error))
    }
    if (c.contact.trim()) {
      const ct = await supabase
        .from('contacts')
        .insert({ company_id: ins.data.id, name: c.contact.trim(), role: c.contactRole.trim() || null, phone: c.contactPhone.trim() || null, email: c.contactEmail.trim() || null })
      if (ct.error) setError(`Company added, but the contact wasn't: ${saveError(ct.error)}`)
    }
    setBusy(false)
    onAdded(ins.data as Company)
  }

  const input = (k: keyof typeof c, label: string, type = 'text', wide = false) => (
    <label className={wide ? 'span-2' : ''}>
      {label}
      <input type={type} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </label>
  )

  return (
    <div className="quick-add">
      <h3 className="sub-head">New subcontractor (added to Contractors)</h3>
      <div className="form-grid">
        {input('name', 'Company name (as it should print)', 'text', true)}
        {input('trade', 'Trade')}
        {input('postcode', 'Postcode')}
        <label className="span-2">
          Address (one line per line, without the postcode)
          <textarea rows={2} value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} />
        </label>
        {input('phone', 'Office phone', 'tel')}
        {input('email', 'Office email', 'email')}
        {input('contact', 'Main contact name')}
        {input('contactRole', 'Their role')}
        {input('contactPhone', 'Contact phone', 'tel')}
        {input('contactEmail', 'Contact email', 'email')}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="primary" onClick={save} disabled={busy}>
          {busy ? 'Adding…' : 'Add subcontractor'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function NewOrder({ companies, orders, onCancel, onCompanyAdded }: { companies: Company[]; orders: Order[]; onCancel: () => void; onCompanyAdded: (c: Company) => void }) {
  const [quickAdd, setQuickAdd] = useState(false)
  const { job } = useJob()
  const navigate = useNavigate()
  const folder = Math.max(0, ...orders.map((o) => o.folder_no ?? 0)) + 1
  const [f, setF] = useState({
    company_id: '',
    folder_no: String(folder),
    trade: '',
    order_no: `${job.job_no}/${job.code}/${String(folder).padStart(2, '0')}`,
    po_ref: '',
    order_value: '',
    order_date: todayIso(),
    retention_pct: String(job.retention_pct),
  })
  const [error, setError] = useState<string | null>(null)
  const subs = companies.filter((c) => c.type === 'subcontractor' || c.type === 'supplier')

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!f.company_id) return setError('Choose the subcontractor, or add a new one with "+ New subcontractor".')
    const ins = await supabase
      .from('orders')
      .insert({
        job_id: job.id,
        company_id: f.company_id,
        folder_no: f.folder_no ? Number(f.folder_no) : null,
        trade: f.trade.trim() || companies.find((c) => c.id === f.company_id)?.trade || null,
        order_no: f.order_no.trim() || null,
        po_ref: f.po_ref.trim() || null,
        order_value: f.order_value ? Number(f.order_value) : null,
        order_date: f.order_date || null,
        retention_pct: Number(f.retention_pct || 5),
      })
      .select('id')
      .single()
    if (ins.error) return setError(saveError(ins.error))
    navigate(ins.data.id)
  }

  const input = (k: keyof typeof f, label: string, type = 'text', hint?: string) => (
    <label>
      {label}
      <input type={type} step={type === 'number' ? 'any' : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )

  return (
    <form className="new-panel-form" onSubmit={save}>
      <div className="form-grid">
        <label className="span-2">
          Subcontractor
          <select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value, trade: f.trade || companies.find((c) => c.id === e.target.value)?.trade || '' })}>
            <option value="">Choose…</option>
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.trade ? ` (${c.trade})` : ''}
              </option>
            ))}
          </select>
          {!quickAdd && (
            <button type="button" className="small-button quick-add-btn" onClick={() => setQuickAdd(true)}>
              + New subcontractor
            </button>
          )}
        </label>
        {quickAdd && (
          <div className="span-2">
            <QuickAddCompany
              onCancel={() => setQuickAdd(false)}
              onAdded={(co) => {
                onCompanyAdded(co)
                setF((cur) => ({ ...cur, company_id: co.id, trade: cur.trade || co.trade || '' }))
                setQuickAdd(false)
              }}
            />
          </div>
        )}
        {input('folder_no', 'Folder no.', 'number', '3. Orders / NN - Trade - Subcontractor')}
        {input('trade', 'Trade', 'text', 'e.g. Electrical')}
        {input('order_no', 'Order no.')}
        {input('po_ref', 'PO ref (iPlicit)', 'text', 'e.g. POR000986')}
        {input('order_value', 'Order value £ (excl. VAT)', 'number')}
        {input('order_date', 'Order date', 'date')}
        {input('retention_pct', 'Retention %', 'number')}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="primary">Add order</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Job › Payment notices › one order: details, the subcontractor's variations, applications.
export function OrderPage() {
  const { job } = useJob()
  const { orderId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<{ order: Order; vars: SubVariation[]; notices: PaymentNotice[] } | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [vars, setVars] = useState<SubVariation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadOrder(orderId!).then(
      (d) => {
        setData(d)
        setOrder(d.order)
        setVars(d.vars)
        loadCompanies().then(
          (cs) => setCompany(cs.find((c) => c.id === d.order.company_id) ?? null),
          () => {},
        )
      },
      (e: Error) => setError(e.message),
    )
  }, [orderId])

  if (error && !data) return <p className="error">{error}</p>
  if (!data || !order) return <p className="muted">Loading…</p>

  const setO = <K extends keyof Order>(k: K, v: Order[K]) => (setMsg(null), setOrder({ ...order, [k]: v }))

  async function save() {
    if (!order) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    const { id, ...rest } = order
    const steps = [
      () => supabase.from('orders').update(rest).eq('id', id),
      () => supabase.from('sub_variations').delete().eq('order_id', id),
      () =>
        vars.filter((v) => v.ref || v.description).length
          ? supabase.from('sub_variations').insert(vars.filter((v) => v.ref || v.description).map(({ id: _i, ...v }) => ({ ...v, order_id: id }))) // eslint-disable-line @typescript-eslint/no-unused-vars
          : null,
    ]
    for (const s of steps) {
      const r = await s()
      if (r && r.error) {
        setBusy(false)
        return setError(saveError(r.error))
      }
    }
    setBusy(false)
    setMsg('Saved.')
  }

  async function newApplication() {
    if (!data || !order) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    try {
      navigate(await createNotice(order, data.notices))
    } catch (e) {
      setError(saveError(e))
    }
  }

  const setVar = (i: number, patch: Partial<SubVariation>) => (setMsg(null), setVars(vars.map((v, j) => (j === i ? { ...v, ...patch } : v))))
  const num = (v: string) => (v === '' ? null : Number(v))

  return (
    <div className="quote-editor">
      <div className="sub-bar">
        <div>
          <Link to={`/jobs/${job.id}/payment-notices`} className="link-button small">
            ← All orders
          </Link>
          <h2>{orderLabel(order, company)}</h2>
        </div>
        <div className="button-row">
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      <OmOutstanding jobId={job.id} orderId={order.id} />

      <section className="card">
        <div className="pane-head">
          <h2>Applications and payment notices</h2>
          <button className="primary" onClick={newApplication}>
            + New application
          </button>
        </div>
        {data.notices.length === 0 ? (
          <p className="muted small">None yet. If earlier notices were made outside the app (e.g. Payment Notice 1), you can enter their figures on the first one made here.</p>
        ) : (
          <ul className="quote-list">
            {[...data.notices].reverse().map((n) => (
              <li key={n.id}>
                <Link to={n.id}>
                  Application {n.notice_no} → Payment Notice {n.notice_no}
                </Link>
                <span className="muted small">
                  {n.status === 'issued' ? 'Issued' : 'Draft'} · valuation {ukDate(n.valuation_date)}
                  {n.measured_works != null && ` · assessed ${money(Number(n.measured_works) + Number(n.variations ?? 0) + Number(n.materials_on_site ?? 0))} gross`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Order</h2>
        <div className="form-grid three">
          <label>
            Folder no.
            <input type="number" value={order.folder_no ?? ''} onChange={(e) => setO('folder_no', num(e.target.value))} />
          </label>
          <label>
            Trade
            <input value={order.trade ?? ''} onChange={(e) => setO('trade', e.target.value || null)} />
          </label>
          <label>
            Order no.
            <input value={order.order_no ?? ''} onChange={(e) => setO('order_no', e.target.value || null)} />
          </label>
          <label>
            PO ref (iPlicit)
            <input value={order.po_ref ?? ''} onChange={(e) => setO('po_ref', e.target.value || null)} />
          </label>
          <label>
            Order value £
            <input type="number" step="any" value={order.order_value ?? ''} onChange={(e) => setO('order_value', num(e.target.value))} />
          </label>
          <label>
            Retention %
            <input type="number" step="any" value={order.retention_pct} onChange={(e) => setO('retention_pct', Number(e.target.value || 0))} />
          </label>
          <label className="span-3">
            Notes
            <textarea rows={2} value={order.notes ?? ''} onChange={(e) => setO('notes', e.target.value || null)} />
          </label>
        </div>
        {company && (
          <p className="muted small">
            Prints as: {company.name}
            {company.address ? `, ${company.address.replace(/\n/g, ', ')}` : ''}
            {company.postcode ? ` ${company.postcode}` : ''} · <Link to="/contractors">edit in Contractors</Link>
          </p>
        )}
      </section>

      <section className="card">
        <h2>Subcontractor's variations</h2>
        <p className="muted small">DBP's list for this order. Each application's variations are checked against it (reference and value).</p>
        <table className="table stack sub-vars">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th className="num">Value £</th>
              <th>Instructed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vars.map((v, i) => (
              <tr key={i}>
                <td data-label="Ref">
                  <input value={v.ref ?? ''} placeholder="VA1" onChange={(e) => setVar(i, { ref: e.target.value || null })} />
                </td>
                <td data-label="Description">
                  <input value={v.description ?? ''} onChange={(e) => setVar(i, { description: e.target.value || null })} />
                </td>
                <td data-label="Value £">
                  <input type="number" step="any" value={v.value ?? ''} onChange={(e) => setVar(i, { value: num(e.target.value) })} />
                </td>
                <td data-label="Instructed">
                  <input type="checkbox" checked={v.instructed} onChange={(e) => setVar(i, { instructed: e.target.checked })} />
                </td>
                <td>
                  <button className="small-button" onClick={() => (setMsg(null), setVars(vars.filter((_, j) => j !== i)))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="small-button" onClick={() => setVars([...vars, { ref: null, description: null, value: null, instructed: false }])}>
          + Add variation
        </button>
      </section>
    </div>
  )
}
