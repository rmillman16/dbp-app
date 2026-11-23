import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useIsAdmin } from '../lib/admin'
import RecordList from '../components/RecordList'

// Standard wording and lists for the company-wide areas (agreed 20 Nov): Estimating's
// quotation wording and clause library, Contracts (EOT), and Settings (insurances, O&M
// standard documents). Readable by everyone; only admins can change them (the database
// enforces it too).

// Standard wording for one kind of document (text_templates.category).
export function Wording({ category, empty, readOnly }: { category: string; empty: string; readOnly: boolean }) {
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

export function ClauseLibrary({ readOnly }: { readOnly: boolean }) {
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

// ---------- Settings › O&M standard documents (admins only) ----------
// The company-wide list each job's O&M tracker starts from (the tracker itself is a job tab).
// Standard documents by trade, from the O&M scope in docs/decisions.md.
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

export function OmStandardDocuments() {
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
    <section className="card">
      <h2>O&M standard documents</h2>
      <p className="muted small intro">
        The O&M documents asked of each trade; each job's O&M tab starts from this list. Project-specific items (Reg 38
        pack, BREEAM evidence, client requirements) are added in the job.
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
        emptyText="No standard documents yet."
        extraActions={<button onClick={addStarter}>Add starter list (electrical, mechanical, joinery)</button>}
        fields={[
          { key: 'trade', label: 'Trade', required: true, hint: 'e.g. Electrical' },
          { key: 'name', label: 'Document', required: true },
        ]}
      />
      {msg && <p className="error">{msg}</p>}
    </section>
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
