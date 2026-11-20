import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import AdminOnly from '../components/AdminOnly'
import RecordList from '../components/RecordList'

// Templates (admins only): things every export and letter draws on.
const SECTIONS = [
  { to: '', label: 'Wording' },
  { to: 'clauses', label: 'Clause library' },
  { to: 'insurances', label: 'Insurances' },
  { to: 'om', label: 'O&M documents' },
]

export default function Templates() {
  return (
    <AdminOnly>
      <h1>Templates</h1>
      <nav className="tabs">
        {SECTIONS.map((s) => (
          <NavLink key={s.label} to={s.to} end={s.to === ''} className="tab">
            {s.label}
          </NavLink>
        ))}
      </nav>
      <section className="card">
        <Outlet />
      </section>
    </AdminOnly>
  )
}

export function WordingTemplates() {
  return (
    <>
      <p className="muted small intro">Standard wording the app puts into quotations and letters. Changes apply to everything produced after you save.</p>
      <RecordList
        table="text_templates"
        idKey="key"
        orderBy={['sort']}
        groupBy="category"
        title={(r) => String(r.title)}
        subtitle={(r) => (String(r.body ?? '').trim() ? `Last changed ${ukDate(String(r.updated_at))}` : 'Not written yet')}
        fields={[
          { key: 'title', label: 'Name', required: true, wide: true },
          { key: 'body', label: 'Wording', type: 'textarea', rows: 14 },
          { key: 'notes', label: 'Notes for admins', type: 'textarea', rows: 3 },
        ]}
      />
    </>
  )
}

export function ClauseLibrary() {
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

export function Insurances() {
  return (
    <>
      <p className="muted small intro">
        Company insurance covers. Renewal reminders appear on the home page 60, 30 and 7 days before each end date and are
        rebuilt automatically when you change a date. A job over the Contractors all risks limit is flagged when it's set
        up. Certificate upload is coming with file storage.
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
    </>
  )
}

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

export function OmDocuments() {
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
      <p className="muted small intro">
        The standard O&M documents asked of each trade. Project-specific items (Reg 38 pack, BREEAM evidence, client
        requirements) are added per job in the O&M module.
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
    </>
  )
}
