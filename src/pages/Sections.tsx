import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useIsAdmin } from '../lib/admin'
import { createQuotation, fullRef, loadQuotations } from '../lib/quotations'
import { QUOTE_STATUS_LABELS, type Quotation } from '../lib/types'
import RecordList from '../components/RecordList'

// Company-wide areas in the left-hand menu (agreed 20 Nov): Estimating, Contracts, O&M,
// Project management (coming soon). Standard wording and lists are readable by everyone;
// only admins can change them (the database enforces it too).

// Standard wording for one kind of document (text_templates.category).
function Wording({ category, empty, readOnly }: { category: string; empty: string; readOnly: boolean }) {
  return (
    <RecordList
      table="text_templates"
      idKey="key"
      match={['category', category]}
      orderBy={['sort']}
      title={(r) => String(r.title)}
      subtitle={(r) => (String(r.body ?? '').trim() ? `Last changed ${ukDate(String(r.updated_at))}` : 'Not written yet')}
      emptyText={empty}
      readOnly={readOnly}
      fields={[
        { key: 'title', label: 'Name', required: true, wide: true },
        { key: 'body', label: 'Wording', type: 'textarea', rows: 14 },
        { key: 'notes', label: 'Notes for admins', type: 'textarea', rows: 3 },
      ]}
    />
  )
}

// ---------- Estimating ----------
// Quotations not linked to a job (small works, new enquiries), plus the standard
// quotation wording and clause library that every quotation (job or not) uses.
export function Estimating() {
  const { tab } = useParams()
  const readOnly = !useIsAdmin()
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<{ q: Quotation; total: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tab) loadQuotations(null).then(setQuotes, (e: Error) => setError(e.message))
  }, [tab])

  async function create() {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      navigate(`/estimating/q/${await createQuotation(null)}`)
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Estimating</h1>
      <nav className="pills">
        <NavLink to="/estimating" end className="pill">
          Quotations
        </NavLink>
        <NavLink to="/estimating/wording" className="pill">
          Standard wording & clauses
        </NavLink>
      </nav>
      {!tab && (
        <section className="card">
          <div className="pane-head">
            <h2>Quotations without a job</h2>
            <button className="primary" onClick={create} disabled={busy}>
              + New quotation
            </button>
          </div>
          <p className="muted small intro">Small works and new enquiries. Quotations for live jobs are in each job's Quotations tab.</p>
          {error && <p className="error">{error}</p>}
          {quotes === null && !error && <p className="muted">Loading…</p>}
          {quotes?.length === 0 && <p className="muted">No quotations yet.</p>}
          {quotes && quotes.length > 0 && (
            <table className="table stack">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th className="num">Total excl. VAT</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(({ q, total }) => (
                  <tr key={q.id} className="clickable" onClick={() => navigate(`/estimating/q/${q.id}`)}>
                    <td className="stack-title">
                      <strong>{fullRef(null, q)}</strong>
                    </td>
                    <td className="stack-sub">{q.project_name}</td>
                    <td className={q.client_name ? '' : 'stack-hide'} data-label="Client">
                      {q.client_name}
                    </td>
                    <td data-label="Status">
                      <span className={`q-status ${q.status}`}>{QUOTE_STATUS_LABELS[q.status]}</span>
                    </td>
                    <td className="num" data-label="Total excl. VAT">
                      {money(total)}
                    </td>
                    <td className="nowrap" data-label="Date">
                      {ukDate(q.issued_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {tab === 'wording' && (
        <section className="card">
          <h3 className="sub-head">Quotation wording</h3>
          <p className="muted small intro">Standard wording on every quotation (jobs and estimating). Changes apply to quotations exported after saving.</p>
          <Wording category="Quotations" empty="No quotation wording yet." readOnly={readOnly} />
          <h3 className="sub-head">Clause library</h3>
          <ClauseLibrary readOnly={readOnly} />
        </section>
      )}
    </>
  )
}

function ClauseLibrary({ readOnly }: { readOnly: boolean }) {
  return (
    <>
      <p className="muted small intro">
        Extra clauses that can be added to a quotation on top of the standard T&Cs (e.g. bespoke joinery deposits, samples
        and approvals, natural material variation, lead times, specialist guarantees). Only clauses ticked as legally
        reviewed are offered on quotations.
      </p>
      <RecordList
        table="tc_clauses"
        orderBy={['category', 'title']}
        groupBy="category"
        title={(r) => String(r.title)}
        subtitle={(r) => (r.approved ? 'Legally reviewed' : 'Not yet reviewed')}
        newRow={{ title: '', body: '', category: '', approved: false }}
        addLabel="Add clause"
        canDelete
        readOnly={readOnly}
        emptyText="No clauses yet."
        fields={[
          { key: 'title', label: 'Clause title', required: true },
          { key: 'category', label: 'Group', hint: 'e.g. Joinery, Samples, Programme' },
          { key: 'body', label: 'Clause wording', type: 'textarea', rows: 8, required: true },
          { key: 'approved', label: 'Legally reviewed: OK to use on quotations', type: 'checkbox' },
        ]}
      />
    </>
  )
}

// ---------- Contracts ----------
export function Contracts() {
  const readOnly = !useIsAdmin()
  return (
    <>
      <h1>Contracts</h1>
      <section className="card">
        <h3 className="sub-head">EOT</h3>
        <p className="muted small intro">Letters for delay events and extension of time claims. Wording must follow each job's contract (e.g. JCT D&B 2024).</p>
        <Wording category="EOT" empty="No EOT wording yet." readOnly={readOnly} />
      </section>
    </>
  )
}

// ---------- O&M ----------
// standard documents by trade, from the O&M scope in docs/decisions.md
const STARTER_OM: [string, string][] = [
  ['Electrical', 'Installation and test certificates'],
  ['Electrical', 'Emergency lighting certificate'],
  ['Electrical', 'Fire alarm certificate'],
  ['Electrical', 'As-built drawings'],
  ['Electrical', 'O&M manual'],
  ['Mechanical', 'Commissioning certificates'],
  ['Mechanical', 'Flow-rate certificates'],
  ['Mechanical', 'As-built drawings'],
  ['Mechanical', 'Maintenance schedule'],
  ['Joinery', 'Finishes data'],
  ['Joinery', 'Care guide'],
  ['Joinery', 'Warranty'],
]

export function OandM() {
  const readOnly = !useIsAdmin()
  const [reload, setReload] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)

  async function addStarter() {
    const { error } = await supabase.from('om_doc_types').insert(STARTER_OM.map(([trade, name]) => ({ trade, name, standard: true })))
    if (error) setMsg(saveError(error))
    else {
      setMsg(null)
      setReload((k) => k + 1)
    }
  }

  return (
    <>
      <h1>O&M</h1>
      <section className="card">
        <h3 className="sub-head">Standard documents by trade</h3>
        <p className="muted small intro">
          The O&M documents asked of each trade. Project-specific items (Reg 38 pack, BREEAM evidence, client requirements)
          are added per job in the O&M module.
        </p>
        <RecordList
          key={reload}
          table="om_doc_types"
          onlyEmpty="job_id"
          orderBy={['trade', 'name']}
          groupBy="trade"
          title={(r) => String(r.name)}
          newRow={{ trade: '', name: '', standard: true }}
          addLabel="Add document"
          canDelete
          readOnly={readOnly}
          emptyText="No standard documents yet."
          extraActions={<button onClick={addStarter}>Add starter list (electrical, mechanical, joinery)</button>}
          fields={[
            { key: 'trade', label: 'Trade', required: true, hint: 'e.g. Electrical' },
            { key: 'name', label: 'Document', required: true },
          ]}
        />
        {msg && <p className="error">{msg}</p>}
      </section>
    </>
  )
}

// ---------- Settings › Insurances (admins only) ----------
export function Insurances() {
  return (
    <section className="card">
      <h2>Insurances</h2>
      <p className="muted small intro">
        Company insurance covers (certificates are kept on OneDrive). Renewal reminders appear on the home page 60, 30 and 7
        days before each end date and are rebuilt automatically when you change a date. A job over the Contractors all
        risks limit is flagged when it's set up.
      </p>
      <RecordList
        table="company_insurances"
        orderBy={['end_date', 'cover']}
        title={(r) => String(r.cover)}
        subtitle={(r) => `${r.insurer ?? ''} · ${r.limit_text ?? (r.limit_amount != null ? money(Number(r.limit_amount)) : '')} · ends ${ukDate(String(r.end_date))}`}
        newRow={{ cover: '', end_date: '' }}
        addLabel="Add cover"
        canDelete
        fields={[
          { key: 'cover', label: 'Cover', required: true, wide: true },
          { key: 'insurer', label: 'Insurer' },
          { key: 'policy_no', label: 'Policy no.' },
          { key: 'limit_text', label: 'Limit (as worded)', wide: true, hint: 'e.g. £5,000,000 each and every claim' },
          { key: 'limit_amount', label: 'Limit £ (number)', type: 'number', hint: 'Used for checks, e.g. CAR limit per contract' },
          { key: 'excess', label: 'Excess £', type: 'number' },
          { key: 'start_date', label: 'Start date', type: 'date' },
          { key: 'end_date', label: 'End date', type: 'date', required: true },
        ]}
      />
    </section>
  )
}
