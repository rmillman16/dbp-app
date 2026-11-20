import RecordList from '../components/RecordList'
import type { CompanyType } from '../lib/types'

// The company list: subcontractors, suppliers, clients, consultants. Used for orders and
// payment notices (name and address printed on the notice) and later the CVR (iPlicit code).
export const COMPANY_TYPES: [CompanyType, string][] = [
  ['subcontractor', 'Subcontractor'],
  ['supplier', 'Supplier'],
  ['client', 'Client'],
  ['consultant', 'Consultant'],
  ['designer', 'Designer'],
  ['other', 'Other'],
]

export default function Contractors() {
  const label = (t: unknown) => COMPANY_TYPES.find(([v]) => v === t)?.[1] ?? String(t)
  return (
    <>
      <h1>Contractors</h1>
      <section className="card">
        <p className="muted small intro">
          Subcontractors, suppliers, clients and consultants. The name and address here are what print on payment notices, so keep them
          current; the iPlicit code links costs in the CVR later.
        </p>
        <RecordList
          table="companies"
          orderBy={['name']}
          title={(r) => String(r.name)}
          subtitle={(r) => [label(r.type), r.trade, r.postcode].filter(Boolean).join(' · ')}
          newRow={{ name: '', type: 'subcontractor' }}
          addLabel="Add company"
          canDelete
          emptyText="No companies yet."
          fields={[
            { key: 'name', label: 'Company name', required: true, wide: true, hint: 'Full legal name, as it should print, e.g. Lumen Fit Out Ltd' },
            { key: 'type', label: 'Type', type: 'select', options: COMPANY_TYPES },
            { key: 'trade', label: 'Trade', hint: 'e.g. Electrical, Mechanical, Joinery' },
            { key: 'address', label: 'Address (one line per line, without the postcode)', type: 'textarea', rows: 3 },
            { key: 'postcode', label: 'Postcode' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'iplicit_code', label: 'iPlicit supplier code' },
            { key: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
          ]}
        />
      </section>
    </>
  )
}
