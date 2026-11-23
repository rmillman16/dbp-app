// A contractor chosen by typing (Richard, 21 Nov): click into the box for the contractor list, type
// to narrow it and complete the name. A name that isn't on the list can be added to it there and then.
import { useEffect, useId, useState } from 'react'
import type { Company } from '../lib/types'

export default function ContractorPicker({
  companies,
  value,
  onChange,
  onAdd,
  placeholder = 'Type or choose a contractor',
}: {
  companies: Company[]
  value: string | null // company id
  onChange: (id: string | null) => void
  onAdd?: (name: string) => Promise<Company> // add a typed name to the contractor list
  placeholder?: string
}) {
  const listId = useId()
  const current = companies.find((c) => c.id === value)
  const [text, setText] = useState(current?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(companies.find((c) => c.id === value)?.name ?? ''), [value, companies])

  const match = (t: string) => companies.find((c) => c.name.trim().toLowerCase() === t.trim().toLowerCase())
  const typed = text.trim()
  const unknown = typed && !match(typed)
  // subcontractors and suppliers first, then everyone else
  const sorted = [...companies].sort(
    (a, b) => Number(b.type === 'subcontractor' || b.type === 'supplier') - Number(a.type === 'subcontractor' || a.type === 'supplier') || a.name.localeCompare(b.name, 'en-GB'),
  )

  return (
    <span className="contractor-picker">
      <input
        list={listId}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
          const c = match(e.target.value)
          onChange(c ? c.id : null)
        }}
        aria-label="Contractor"
      />
      <datalist id={listId}>
        {sorted.map((c) => (
          <option key={c.id} value={c.name} label={c.trade ?? undefined} />
        ))}
      </datalist>
      {unknown && onAdd && (
        <button
          type="button"
          className="small-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const c = await onAdd(typed)
              onChange(c.id)
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Adding…' : `Add “${typed}” to the contractor list`}
        </button>
      )}
      {unknown && !onAdd && <span className="hint">Not on the contractor list</span>}
      {error && <span className="error small">{error}</span>}
    </span>
  )
}
