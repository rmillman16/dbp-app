import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { createNotice, loadCompanies, loadOrder, loadOrders, orderLabel } from '../lib/subcontracts'
import {
  DELIVERY_FROM,
  addAppendixFile,
  addOrderPackage,
  addStandardAppendices,
  emlDraft,
  escHtml,
  fileBlob,
  loadAppendices,
  loadLibrary,
  loadOrderPackages,
  markEmailed,
  needs054,
  nextOrderNo,
  openFile,
  orderDocx,
  orderFileName,
  placeOrder,
  removeAppendix,
  updateAppendix,
  type Appendix,
  type OrderPackage,
  type StandardDoc,
} from '../lib/orders'
import { STATE_LABELS, loadPqqPack, logPqqSent, needsPqq, pqqParagraph, pqqPackFiles, pqqState, pqqWentOut, stateClass } from '../lib/pqq'
import { downloadBlob } from '../lib/letter'
import { loadContacts, type Contact } from '../components/ContactsEditor'
import type { Company, Order, PaymentNotice, SubVariation } from '../lib/types'
import { useJob } from './JobLayout'
import OmOutstanding from '../components/OmOutstanding'

// old links (bell, bookmarks) to the tab's old name
export function OldOrdersLink() {
  const { '*': rest } = useParams()
  const { job } = useJob()
  return <Navigate to={`/jobs/${job.id}/orders${rest ? '/' + rest : ''}`} replace />
}

export function PqqChip({ company }: { company: Company | null | undefined }) {
  if (!company || company.pqq_status === undefined) return null
  const s = pqqState(company)
  return (
    <span className={`pqq-chip ${stateClass(s)}`} title={company.pqq_expires_on ? `PQQ approved until ${ukDate(company.pqq_expires_on)}` : 'PQQ'}>
      PQQ: {STATE_LABELS[s]}
    </span>
  )
}

// Job › Orders (was Payment notices, 23 Nov): the job's subcontract and supply orders.
export default function SubcontractsTab() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [packages, setPackages] = useState<OrderPackage[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOrders(job.id).then(setOrders, (e: Error) => setError(e.message))
    loadCompanies().then(setCompanies, () => {})
    loadOrderPackages(job).then(setPackages, () => {})
  }, [job])

  const byId = new Map(companies.map((c) => [c.id, c]))
  const pkgLabel = (o: Order) => packages.find((p) => p.name === o.package_name)?.label ?? o.trade ?? '–'
  return (
    <section className="card">
      <div className="pane-head">
        <h2>Orders</h2>
        <button className="primary" onClick={() => setAdding(!adding)}>
          + New order
        </button>
      </div>
      {adding && (
        <NewOrder
          companies={companies}
          orders={orders ?? []}
          packages={packages}
          onPackages={setPackages}
          onCancel={() => setAdding(false)}
          onCompanyAdded={(c) => setCompanies((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}
      {error && <p className="error">{error}</p>}
      {orders?.length === 0 && !adding && <p className="muted">No orders yet. Add one to place it, then take applications and payment notices against it.</p>}
      {orders && orders.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Order no.</th>
              <th>Package</th>
              <th>Subcontractor / supplier</th>
              <th className="num">Order value</th>
              <th>Delivery / start</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => navigate(o.id)}>
                <td className="stack-title">
                  <strong>{o.order_no ?? <span className="late">none</span>}</strong>
                </td>
                <td data-label="Package">{pkgLabel(o)}</td>
                <td data-label="Subcontractor">
                  {byId.get(o.company_id)?.name ?? '–'} <PqqChip company={byId.get(o.company_id)} />
                </td>
                <td className="num" data-label="Order value">
                  {money(o.order_value)}
                </td>
                <td data-label="Delivery / start">{o.delivery_date ? ukDate(o.delivery_date) : <span className="muted">–</span>}</td>
                <td data-label="Status">
                  {o.status === 'draft' ? <span className="q-status issued">Draft</span> : <span className="q-status accepted">Placed {o.placed_on ? ukDate(o.placed_on) : ''}</span>}
                  {o.emailed_at && <span className="muted small"> · emailed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// Add a subcontractor or supplier without leaving the job: saved to Contractors, with their main contact.
function QuickAddCompany({ onAdded, onCancel }: { onAdded: (c: Company) => void; onCancel: () => void }) {
  const [c, setC] = useState({ name: '', type: 'subcontractor', trade: '', address: '', postcode: '', email: '', phone: '', contact: '', contactRole: '', contactPhone: '', contactEmail: '' })
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
        type: c.type,
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
      <h3 className="sub-head">New subcontractor or supplier (added to Contractors)</h3>
      <div className="form-grid">
        {input('name', 'Company name (as it should print)', 'text', true)}
        <label>
          Type
          <select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}>
            <option value="subcontractor">Subcontractor</option>
            <option value="supplier">Supplier</option>
          </select>
        </label>
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
      <p className="muted small">New companies start with no PQQ: the order email will include the PQQ pack.</p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="primary" onClick={save} disabled={busy}>
          {busy ? 'Adding…' : 'Add company'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// The package dropdown: the procurement schedule's packages (from the SoW), or "+ Add a package"
function PackagePicker({ value, packages, onChange, onPackages }: { value: string; packages: OrderPackage[]; onChange: (p: OrderPackage | null) => void; onPackages: (p: OrderPackage[]) => void }) {
  const { job } = useJob()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const groups = [...new Set(packages.map((p) => p.group))]

  async function add() {
    if (!name.trim()) return
    setError(null)
    try {
      await addOrderPackage(job.id, name)
      const ps = await loadOrderPackages(job)
      onPackages(ps)
      onChange(ps.find((p) => p.name === name.trim()) ?? null)
      setAdding(false)
      setName('')
    } catch (e) {
      setError(saveError(e))
    }
  }

  return (
    <>
      <select
        value={adding ? '+' : value}
        onChange={(e) => {
          if (e.target.value === '+') return setAdding(true)
          setAdding(false)
          onChange(packages.find((p) => p.name === e.target.value) ?? null)
        }}
      >
        <option value="">Choose the package…</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {packages
              .filter((p) => p.group === g)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}
                  {p.budget ? ` (budget ${money(p.budget)})` : ''}
                  {p.ordered ? ' · ordered' : ''}
                </option>
              ))}
          </optgroup>
        ))}
        <option value="+">+ Add a package…</option>
      </select>
      {adding && (
        <span className="inline-add">
          <input autoFocus value={name} placeholder="New package, e.g. Mirrors" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <button type="button" className="small-button primary" onClick={add}>
            Add
          </button>
          <button type="button" className="small-button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </span>
      )}
      {error && <span className="error small">{error}</span>}
      {packages.length === 0 && !adding && <span className="hint">No packages yet: import the SoW, or add one here (it's added to the procurement schedule too).</span>}
    </>
  )
}

function NewOrder({
  companies,
  orders,
  packages,
  onPackages,
  onCancel,
  onCompanyAdded,
}: {
  companies: Company[]
  orders: Order[]
  packages: OrderPackage[]
  onPackages: (p: OrderPackage[]) => void
  onCancel: () => void
  onCompanyAdded: (c: Company) => void
}) {
  const [quickAdd, setQuickAdd] = useState(false)
  const { job } = useJob()
  const navigate = useNavigate()
  const [f, setF] = useState({
    package_name: '',
    trade: '',
    company_id: '',
    contact_id: '',
    order_no: nextOrderNo(job, orders),
    po_ref: '',
    order_value: '',
    order_date: todayIso(),
    delivery_date: '',
    delivery_from: '',
    retention_pct: String(job.retention_pct),
    scope: '',
  })
  const [contacts, setContacts] = useState<Contact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const subs = companies.filter((c) => c.type === 'subcontractor' || c.type === 'supplier')
  const company = companies.find((c) => c.id === f.company_id)

  useEffect(() => {
    if (!f.company_id) return setContacts([])
    loadContacts(f.company_id).then(
      (cs) => {
        setContacts(cs)
        setF((cur) => ({ ...cur, contact_id: cs.find((c) => c.email)?.id ?? cs[0]?.id ?? '' }))
      },
      () => setContacts([]),
    )
  }, [f.company_id])

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!f.package_name) return setError('Choose the package (or add one with "+ Add a package").')
    if (!f.company_id) return setError('Choose the subcontractor or supplier, or add a new one.')
    setBusy(true)
    const ins = await supabase
      .from('orders')
      .insert({
        job_id: job.id,
        company_id: f.company_id,
        contact_id: f.contact_id || null,
        package_name: f.package_name,
        trade: f.trade.trim() || company?.trade || null,
        folder_no: Math.max(0, ...orders.map((o) => o.folder_no ?? 0)) + 1,
        order_no: f.order_no.trim() || null,
        po_ref: f.po_ref.trim() || null,
        order_value: f.order_value ? Number(f.order_value) : null,
        order_date: f.order_date || null,
        delivery_date: f.delivery_date || null,
        delivery_from: f.delivery_from || null,
        retention_pct: Number(f.retention_pct || 5),
        scope: f.scope.trim() || null,
        status: 'draft',
      })
      .select('id')
      .single()
    if (ins.error) {
      setBusy(false)
      return setError(needs054(saveError(ins.error)))
    }
    // the library's standard appendices go on every new order (untick on the order to drop one)
    try {
      const lib = await loadLibrary('appendix')
      await addStandardAppendices(ins.data.id, lib.filter((d) => d.default_on), 0)
    } catch {
      /* no library yet: the order still opens */
    }
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
          Package
          <PackagePicker
            value={f.package_name}
            packages={packages}
            onPackages={onPackages}
            onChange={(p) =>
              setF((cur) => ({
                ...cur,
                package_name: p?.name ?? '',
                trade: p?.label ?? '',
                delivery_date: p?.delivery ?? cur.delivery_date,
                delivery_from: p?.delivery ? (p.deliveryFrom ?? '') : cur.delivery_from,
              }))
            }
          />
        </label>
        <label className="span-2">
          Subcontractor / supplier
          <select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}>
            <option value="">Choose…</option>
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.trade ? ` (${c.trade})` : ''}
                {c.pqq_status !== undefined ? ` · PQQ ${STATE_LABELS[pqqState(c)].toLowerCase()}` : ''}
              </option>
            ))}
          </select>
          {!quickAdd && (
            <button type="button" className="small-button quick-add-btn" onClick={() => setQuickAdd(true)}>
              + New subcontractor / supplier
            </button>
          )}
          {company && needsPqq(company) && company.pqq_status !== undefined && (
            <span className="hint">Not PQQ-approved ({STATE_LABELS[pqqState(company)].toLowerCase()}): the order email will include the PQQ pack.</span>
          )}
        </label>
        {quickAdd && (
          <div className="span-2">
            <QuickAddCompany
              onCancel={() => setQuickAdd(false)}
              onAdded={(co) => {
                onCompanyAdded(co)
                setF((cur) => ({ ...cur, company_id: co.id }))
                setQuickAdd(false)
              }}
            />
          </div>
        )}
        {contacts.length > 0 && (
          <label>
            Order to (contact)
            <select value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}>
              <option value="">The company's own email</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` <${c.email}>` : ' (no email)'}
                </option>
              ))}
            </select>
          </label>
        )}
        {input('order_no', 'Order no.', 'text', 'e.g. 2611_FISL_001')}
        {input('order_value', 'Order value £ (excl. VAT)', 'number')}
        {input('order_date', 'Order date', 'date')}
        <label>
          Delivery / start on site
          <input type="date" value={f.delivery_date} onChange={(e) => setF({ ...f, delivery_date: e.target.value, delivery_from: 'typed_here' })} />
          <span className="hint">{f.delivery_from && f.delivery_from !== 'typed_here' ? DELIVERY_FROM[f.delivery_from] : f.package_name && !f.delivery_date ? 'Not in the procurement schedule or programme yet: type it' : ' '}</span>
        </label>
        {input('retention_pct', 'Retention %', 'number')}
        {input('po_ref', 'PO ref (iPlicit)', 'text', 'e.g. POR000986')}
        <label className="span-2">
          Scope (printed on the order)
          <textarea rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="e.g. Supply and install the electrical installation as the specification and drawings listed in the appendices." />
        </label>
      </div>
      <p className="muted small">The order starts as a draft. The standard appendices are added; you can add more on the next page, then place it and make the email.</p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add order'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Job › Orders › one order: details, appendices, place and email; applications and payment notices; their variations.
export function OrderPage() {
  const { job } = useJob()
  const { me } = useAccess()
  const { orderId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<{ order: Order; vars: SubVariation[]; notices: PaymentNotice[] } | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [vars, setVars] = useState<SubVariation[]>([])
  const [packages, setPackages] = useState<OrderPackage[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [appendices, setAppendices] = useState<Appendix[] | null>(null)
  const [library, setLibrary] = useState<StandardDoc[]>([])
  const [pqqPack, setPqqPack] = useState<StandardDoc[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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
        loadContacts(d.order.company_id).then(setContacts, () => {})
      },
      (e: Error) => setError(e.message),
    )
    loadAppendices(orderId!).then(setAppendices, (e: Error) => (setAppendices([]), setError(e.message)))
    loadLibrary('appendix').then(setLibrary, () => {})
    loadPqqPack().then(setPqqPack, () => {})
    loadOrderPackages(job).then(setPackages, () => {})
  }, [orderId, job])

  const pkg = useMemo(() => packages.find((p) => p.name === order?.package_name) ?? null, [packages, order?.package_name])

  if (error && !data) return <p className="error">{error}</p>
  if (!data || !order) return <p className="muted">Loading…</p>

  const setO = <K extends keyof Order>(k: K, v: Order[K]) => (setMsg(null), setOrder({ ...order, [k]: v }))
  const contact = contacts.find((c) => c.id === order.contact_id) ?? null
  const toEmail = contact?.email || company?.email || null
  const packageLabel = pkg?.label ?? order.trade ?? 'works'
  const withPqq = !!company && company.pqq_status !== undefined && needsPqq(company)
  const placed = order.status !== 'draft'
  const hasPaymentTerms = library.some((d) => /payment|application/i.test(d.name))

  async function save(quiet = false) {
    if (!order) return false
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline'))), false
    setBusy('save')
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
        setBusy(null)
        setError(needs054(saveError(r.error)))
        return false
      }
    }
    setBusy(null)
    if (!quiet) setMsg('Saved.')
    return true
  }

  async function place() {
    if (!order) return
    if (!order.package_name) return setError('Choose the package first: placing the order marks it Ordered on the procurement schedule.')
    if (!confirm(`Place order ${order.order_no ?? ''}? The procurement schedule's ${packageLabel} row will show ${company?.name ?? 'them'}, ${money(order.order_value)}, Ordered.`)) return
    if (!(await save(true))) return
    try {
      setOrder(await placeOrder(order, me?.id ?? null))
      setMsg('Order placed. The procurement schedule is updated. Make the email next.')
    } catch (e) {
      setError(saveError(e))
    }
  }

  async function wordOrder() {
    if (!order || !company) return
    setError(null)
    setBusy('word')
    try {
      downloadBlob(await orderDocx({ job, order, company, contact, packageLabel, appendices: appendices ?? [], signer: me }), orderFileName(job, order, company))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // the email to them, as an Outlook draft: the order, every appendix, and the PQQ pack if they're not approved
  async function email() {
    if (!order || !company) return
    setError(null)
    if (!placed && !confirm('This order is still a draft. Place it now and make the email?')) return
    if (!placed) {
      if (!order.package_name) return setError('Choose the package first.')
      if (!(await save(true))) return
      try {
        setOrder(await placeOrder(order, me?.id ?? null))
      } catch (e) {
        return setError(saveError(e))
      }
    } else if (!(await save(true))) return
    setBusy('email')
    setMsg('Building the email (fetching the files)…')
    try {
      const list = appendices ?? []
      const files = [
        { name: orderFileName(job, order, company), blob: await orderDocx({ job, order, company, contact, packageLabel, appendices: list, signer: me }) },
        ...(await Promise.all(list.map(async (a) => ({ name: a.file_name, blob: await fileBlob(a.path) })))),
      ]
      const pqqFiles = withPqq ? await pqqPackFiles(pqqPack) : []
      const greeting = contact?.name ? `Dear ${escHtml(contact.name.split(' ')[0])},` : 'Dear Sir or Madam,'
      const html = [
        `<p>${greeting}</p>`,
        `<p>Please find attached our order <b>${escHtml(order.order_no ?? '')}</b> for the ${escHtml(packageLabel)} package at ${escHtml(job.name)}, value ${escHtml(money(order.order_value))} excluding VAT${order.delivery_date ? `, for delivery / start on site on ${escHtml(ukDate(order.delivery_date))}` : ''}.</p>`,
        list.length ? `<p>The appendices form part of the order:</p><ol>${list.map((a) => `<li>${escHtml(a.name)}</li>`).join('')}</ol>` : '',
        withPqq && pqqFiles.length ? `<p>${escHtml(pqqParagraph(company))}</p>` : '',
        '<p>Please sign and return a copy of the order within 7 days to confirm your acceptance.</p>',
        '<p>Kind regards,</p>',
        `<p>${escHtml(me?.full_name ?? '')}${me?.job_title ? '<br>' + escHtml(me.job_title) : ''}<br>du Boulay Projects Limited</p>`,
      ].join('')
      const eml = await emlDraft({
        to: toEmail ? [toEmail] : [],
        subject: `${job.job_no} ${job.code} ${job.name}: Order ${order.order_no ?? ''} – ${packageLabel}`,
        html,
        attachments: [...files, ...pqqFiles],
      })
      downloadBlob(eml, `${order.order_no ?? 'Order'} email.eml`)
      await markEmailed(order.id)
      const documents = [...files.map((f) => f.name), ...pqqFiles.map((f) => f.name)]
      if (withPqq && pqqFiles.length) setCompany(await pqqWentOut(company, toEmail, documents, order.id))
      else await logPqqSent({ company_id: company.id, order_id: order.id, via: 'order', sent_to: toEmail, documents })
      setOrder((o) => (o ? { ...o, emailed_at: new Date().toISOString() } : o))
      setMsg(
        `Downloaded "${order.order_no ?? 'Order'} email.eml": open it and it opens in Outlook as a new email with ${files.length + pqqFiles.length} attachments, ready to check and send.` +
          (withPqq && !pqqFiles.length ? ' No PQQ pack in the library yet (Settings › Standard documents), so none was attached.' : '') +
          (toEmail ? '' : ' There was no email address for them: add it in Outlook.'),
      )
    } catch (e) {
      setMsg(null)
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
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
          <Link to={`/jobs/${job.id}/orders`} className="link-button small">
            ← All orders
          </Link>
          <h2>
            {order.order_no ?? 'Order'} · {packageLabel} · {company?.name ?? ''}
          </h2>
          {placed ? <span className="q-status accepted">Placed {order.placed_on ? ukDate(order.placed_on) : ''}</span> : <span className="q-status issued">Draft</span>}
          <PqqChip company={company} />
          {order.emailed_at && <span className="muted small">Email made {ukDate(order.emailed_at.slice(0, 10))}</span>}
        </div>
        <div className="button-row">
          <button onClick={wordOrder} disabled={!!busy}>
            {busy === 'word' ? 'Making…' : 'Order (Word)'}
          </button>
          {!placed && (
            <button onClick={place} disabled={!!busy}>
              Place order
            </button>
          )}
          <button onClick={email} disabled={!!busy}>
            {busy === 'email' ? 'Building…' : 'Email (Outlook draft)'}
          </button>
          <button className="primary" onClick={() => save()} disabled={!!busy}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {withPqq && (
        <p className="pqq-warning">
          {company!.name} isn't PQQ-approved ({STATE_LABELS[pqqState(company!)].toLowerCase()}). The email will include the PQQ pack
          {pqqPack.length ? ` (${pqqPack.length} document${pqqPack.length === 1 ? '' : 's'})` : ', once it is added in Settings › Standard documents'}.{' '}
          <Link to={`/contractors?company=${company!.id}`}>PQQ in Contractors</Link>
        </p>
      )}
      <OmOutstanding jobId={job.id} orderId={order.id} />

      <section className="card">
        <h2>Order</h2>
        <div className="form-grid three">
          <label className="span-2">
            Package
            <PackagePicker
              value={order.package_name ?? ''}
              packages={packages}
              onPackages={setPackages}
              onChange={(p) => (setMsg(null), setOrder({ ...order, package_name: p?.name ?? null, trade: p?.label ?? order.trade, delivery_date: order.delivery_date ?? p?.delivery ?? null, delivery_from: order.delivery_date ? order.delivery_from : (p?.deliveryFrom ?? null) }))}
            />
          </label>
          <label>
            Order no.
            <input value={order.order_no ?? ''} onChange={(e) => setO('order_no', e.target.value || null)} />
          </label>
          <label>
            Order to (contact)
            <select value={order.contact_id ?? ''} onChange={(e) => setO('contact_id', e.target.value || null)}>
              <option value="">{company?.email ? `The company (${company.email})` : 'The company'}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` <${c.email}>` : ' (no email)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order value £
            <input type="number" step="any" value={order.order_value ?? ''} onChange={(e) => setO('order_value', num(e.target.value))} />
          </label>
          <label>
            Order date
            <input type="date" value={order.order_date ?? ''} onChange={(e) => setO('order_date', e.target.value || null)} />
          </label>
          <label>
            Delivery / start on site
            <input type="date" value={order.delivery_date ?? ''} onChange={(e) => (setMsg(null), setOrder({ ...order, delivery_date: e.target.value || null, delivery_from: 'typed_here' }))} />
            <span className="hint">
              {order.delivery_from && DELIVERY_FROM[order.delivery_from]
                ? DELIVERY_FROM[order.delivery_from]
                : pkg?.delivery && pkg.delivery !== order.delivery_date
                  ? `Procurement / programme now says ${ukDate(pkg.delivery)}`
                  : ' '}
            </span>
          </label>
          <label>
            Retention %
            <input type="number" step="any" value={order.retention_pct} onChange={(e) => setO('retention_pct', Number(e.target.value || 0))} />
          </label>
          <label>
            PO ref (iPlicit)
            <input value={order.po_ref ?? ''} onChange={(e) => setO('po_ref', e.target.value || null)} />
          </label>
          <label>
            Folder no.
            <input type="number" value={order.folder_no ?? ''} onChange={(e) => setO('folder_no', num(e.target.value))} />
            <span className="hint">3. Orders / NN - Trade - Subcontractor</span>
          </label>
          <label className="span-3">
            Scope (printed on the order)
            <textarea rows={3} value={order.scope ?? ''} onChange={(e) => setO('scope', e.target.value || null)} />
          </label>
          <label className="span-3">
            Notes (internal)
            <textarea rows={2} value={order.notes ?? ''} onChange={(e) => setO('notes', e.target.value || null)} />
          </label>
        </div>
        {company && (
          <p className="muted small">
            Prints as: {company.name}
            {company.address ? `, ${company.address.replace(/\n/g, ', ')}` : ''}
            {company.postcode ? ` ${company.postcode}` : ''} · <Link to={`/contractors?company=${company.id}`}>edit in Contractors</Link> · {orderLabel(order, company)}
          </p>
        )}
      </section>

      <Appendices order={order} appendices={appendices} setAppendices={setAppendices} library={library} hasPaymentTerms={hasPaymentTerms} onError={setError} />

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

// the order's appendices: from the standard library, or any file for this order only
function Appendices({
  order,
  appendices,
  setAppendices,
  library,
  hasPaymentTerms,
  onError,
}: {
  order: Order
  appendices: Appendix[] | null
  setAppendices: (a: Appendix[]) => void
  library: StandardDoc[]
  hasPaymentTerms: boolean
  onError: (m: string | null) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const list = appendices ?? []
  const unused = library.filter((d) => !list.some((a) => a.standard_id === d.id))

  async function run(f: () => Promise<void>) {
    onError(null)
    setBusy(true)
    try {
      await f()
    } catch (e) {
      onError(saveError(e))
    } finally {
      setBusy(false)
    }
  }
  const nextSort = () => Math.max(-1, ...list.map((a) => a.sort)) + 1

  return (
    <section className="card">
      <div className="pane-head">
        <h2>Appendices</h2>
        <Link to="/settings#standard-documents" className="link-button small">
          Standard library →
        </Link>
      </div>
      <p className="muted small">Listed on the order and attached to the email, in this order. Any file type.</p>
      {!hasPaymentTerms && <p className="pqq-warning small">The standard payment and application dates appendix isn't in the library yet. Once it's written, add it in Settings › Standard documents and it goes on every new order.</p>}
      {appendices === null ? (
        <p className="muted small">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted small">None yet.</p>
      ) : (
        <ol className="appendix-list">
          {list.map((a, i) => (
            <li key={a.id}>
              <input
                value={a.name}
                aria-label="Appendix name"
                onChange={(e) => setAppendices(list.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
                onBlur={(e) => run(() => updateAppendix(a.id, { name: e.target.value }))}
              />
              <button type="button" className="link-button small" onClick={() => run(() => openFile(a.path))} title={a.file_name}>
                {a.file_name}
              </button>
              {a.standard_id && <span className="muted small">standard</span>}
              <span className="appendix-buttons">
                <button
                  type="button"
                  className="small-button"
                  disabled={i === 0 || busy}
                  title="Move up"
                  onClick={() =>
                    run(async () => {
                      const prev = list[i - 1]
                      await updateAppendix(a.id, { sort: prev.sort })
                      await updateAppendix(prev.id, { sort: a.sort })
                      const next = list.map((x) => (x.id === a.id ? { ...x, sort: prev.sort } : x.id === prev.id ? { ...x, sort: a.sort } : x))
                      setAppendices(next.sort((x, y) => x.sort - y.sort))
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="small-button"
                  title="Remove from this order"
                  onClick={() =>
                    run(async () => {
                      await removeAppendix(a)
                      setAppendices(list.filter((x) => x.id !== a.id))
                    })
                  }
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="appendix-add">
        {unused.length > 0 && (
          <select
            value=""
            disabled={busy}
            onChange={(e) => {
              const d = library.find((x) => x.id === e.target.value)
              if (d) run(async () => setAppendices([...list, ...(await addStandardAppendices(order.id, [d], nextSort()))]))
            }}
          >
            <option value="">+ From the standard library…</option>
            {unused.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <input value={name} placeholder="Name (e.g. Appendix C: drawings)" onChange={(e) => setName(e.target.value)} />
        <label className="file-button">
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (!files.length) return
              run(async () => {
                const added: Appendix[] = []
                let s = nextSort()
                for (const f of files) added.push(await addAppendixFile(order.id, f, files.length === 1 ? name : '', s++))
                setAppendices([...list, ...added])
                setName('')
              })
            }}
          />
          <span className="button">{busy ? 'Uploading…' : '+ Upload file(s)'}</span>
        </label>
      </div>
    </section>
  )
}
