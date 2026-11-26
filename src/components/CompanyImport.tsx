import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveError } from '../lib/offline'
import { readWorkbook } from '../lib/samplingImport'
import { CFIELDS, CFIELD_LABELS, buildCompanies, findHeader, guessMapping, normName, type CField, type CMapping, type ImportCompany } from '../lib/companyImport'
import { ukDate } from '../lib/format'
import { PQQ_LABELS } from '../lib/pqq'
import type { Company, CompanyType } from '../lib/types'

type Sheet = { name: string; rows: string[][] }
const TYPES: [CompanyType, string][] = [
  ['subcontractor', 'Subcontractor'],
  ['supplier', 'Supplier'],
  ['client', 'Client'],
  ['consultant', 'Consultant'],
  ['designer', 'Designer'],
  ['other', 'Other'],
]

// A one-off import of the supply chain from Excel (26 Nov): companies, contact details and PQQ dates. Pick the file, check the
// columns the app has matched, see what will be added or filled in, then import.
export default function CompanyImport({ existing, hasPqq, onClose, onDone }: { existing: Company[]; hasPqq: boolean; onClose: () => void; onDone: () => void }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [sheet, setSheet] = useState(0)
  const [header, setHeader] = useState(-1)
  const [map, setMap] = useState<CMapping>({})
  const [defType, setDefType] = useState<CompanyType>('subcontractor')
  const [update, setUpdate] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  function pick(all: Sheet[], i: number) {
    setSheet(i)
    const h = findHeader(all[i].rows)
    setHeader(h)
    setMap(h >= 0 ? guessMapping(all[i].rows[h]) : {})
  }

  const rows = sheets?.[sheet]?.rows ?? []
  const companies = useMemo(() => (sheets && header >= 0 && map.name !== undefined ? buildCompanies(rows, header, map, defType) : []), [sheets, rows, header, map, defType])
  const byNorm = useMemo(() => new Map(existing.map((c) => [normName(c.name), c])), [existing])
  const matched = companies.filter((c) => byNorm.has(normName(c.name)))
  const fresh = companies.length - matched.length
  const warned = companies.filter((c) => c.warnings.length).length

  async function run() {
    setErr(null)
    if (!navigator.onLine) return setErr(saveError(new Error('offline')))
    setBusy(true)
    try {
      let added = 0
      let updated = 0
      let contactsAdded = 0
      const pqqRow = (c: ImportCompany) => (hasPqq && c.pqq_status ? { pqq_status: c.pqq_status, pqq_sent_on: c.pqq_sent_on, pqq_approved_on: c.pqq_approved_on, pqq_expires_on: c.pqq_expires_on } : {})
      // new companies, in batches
      const news = companies.filter((c) => !byNorm.has(normName(c.name)))
      const idOf = new Map<string, string>()
      for (let i = 0; i < news.length; i += 100) {
        const chunk = news.slice(i, i + 100)
        const ins = await supabase
          .from('companies')
          .insert(chunk.map((c) => ({ name: c.name, type: c.type, trade: c.trade, address: c.address, postcode: c.postcode, email: c.email, phone: c.phone, iplicit_code: c.iplicit_code, notes: c.notes, ...pqqRow(c) })))
          .select('id, name')
        if (ins.error) throw ins.error
        for (const r of ins.data ?? []) idOf.set(normName(r.name as string), r.id as string)
        added += ins.data?.length ?? 0
      }
      // companies already in the list: only blanks are filled in (their PQQ is taken from the sheet when it has one)
      const olds = update ? matched : []
      for (const c of olds) {
        const ex = byNorm.get(normName(c.name))!
        const patch: Record<string, unknown> = {}
        for (const k of ['trade', 'address', 'postcode', 'email', 'phone', 'iplicit_code', 'notes'] as const) if (c[k] && !ex[k]) patch[k] = c[k]
        Object.assign(patch, pqqRow(c))
        if (Object.keys(patch).length) {
          const u = await supabase.from('companies').update(patch).eq('id', ex.id).select('pqq_expires_on').single()
          if (u.error) throw u.error
          // changing the approval date makes the database work the expiry out as 12 months on: put the sheet's date back
          if (hasPqq && c.pqq_expires_on && u.data?.pqq_expires_on !== c.pqq_expires_on) {
            const f = await supabase.from('companies').update({ pqq_expires_on: c.pqq_expires_on }).eq('id', ex.id)
            if (f.error) throw f.error
          }
          updated++
        }
      }
      // contacts: those not already there (same email, else same name)
      const targets = [...companies.filter((c) => idOf.has(normName(c.name))).map((c) => [c, idOf.get(normName(c.name))!] as const), ...olds.map((c) => [c, byNorm.get(normName(c.name))!.id] as const)]
      const have = new Map<string, { name: string; email: string | null }[]>()
      const oldIds = olds.map((c) => byNorm.get(normName(c.name))!.id)
      for (let i = 0; i < oldIds.length; i += 100) {
        const r = await supabase.from('contacts').select('company_id, name, email').in('company_id', oldIds.slice(i, i + 100))
        if (r.error) throw r.error
        for (const x of r.data ?? []) have.set(x.company_id as string, [...(have.get(x.company_id as string) ?? []), { name: x.name as string, email: x.email as string | null }])
      }
      const contactRows: { company_id: string; name: string; role: string | null; email: string | null; phone: string | null }[] = []
      for (const [c, id] of targets)
        for (const p of c.contacts) {
          const dupe = (have.get(id) ?? []).some((h) => (p.email && h.email?.toLowerCase() === p.email.toLowerCase()) || h.name.toLowerCase() === p.name.toLowerCase())
          if (!dupe) contactRows.push({ company_id: id, name: p.name, role: p.role, email: p.email, phone: p.phone })
        }
      for (let i = 0; i < contactRows.length; i += 200) {
        const r = await supabase.from('contacts').insert(contactRows.slice(i, i + 200))
        if (r.error) throw r.error
        contactsAdded += Math.min(200, contactRows.length - i)
      }
      setResult(`Added ${added} compan${added === 1 ? 'y' : 'ies'}, filled in ${updated} that were already there, and added ${contactsAdded} contact${contactsAdded === 1 ? '' : 's'}.`)
      onDone()
    } catch (e) {
      setErr(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="proc-panel-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="proc-panel wide" role="dialog" aria-label="Import the supply chain">
        <div className="proc-panel-head">
          <h2>Import the supply chain from Excel</h2>
          <button className="link-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted small">
          One-off: your list in Excel, any layout, with company names, contact details and PQQ dates. The app matches the columns by their headings; check them, look at the preview, then import. A company already in the list is not
          duplicated: only what it is missing is filled in. Old .xls files: save as .xlsx first.
        </p>
        {!hasPqq && <p className="pqq-warning">PQQ tracking needs script 054 run in Supabase first, so the PQQ columns will be left out of this import.</p>}
        {err && <p className="error">{err}</p>}
        {result && <p className="saved">{result}</p>}
        <label className="file-button">
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setErr(null)
              setResult(null)
              try {
                const all = await readWorkbook(f)
                if (!all.length) throw new Error('That file has no filled-in sheets.')
                setSheets(all)
                let best = 0
                all.forEach((s, i) => findHeader(s.rows) >= 0 && findHeader(all[best].rows) < 0 && (best = i))
                pick(all, best)
              } catch (x) {
                setErr((x as Error).message)
              }
            }}
          />
          <span className="button">{sheets ? 'Choose another file…' : 'Choose the Excel file…'}</span>
        </label>

        {sheets && (
          <>
            <div className="form-grid">
              {sheets.length > 1 && (
                <label>
                  Sheet
                  <select value={sheet} onChange={(e) => pick(sheets, Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Header row
                <input type="number" min={1} value={header + 1 || ''} onChange={(e) => (setHeader(Math.max(0, Number(e.target.value) - 1)), setMap(guessMapping(rows[Math.max(0, Number(e.target.value) - 1)] ?? [])))} />
              </label>
              <label>
                If the sheet doesn’t say, they are
                <select value={defType} onChange={(e) => setDefType(e.target.value as CompanyType)}>
                  {TYPES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {header < 0 && <p className="warning">I couldn’t find a header row with a company name column. Type its row number above, then choose the columns.</p>}
            {header >= 0 && (
              <>
                <h3 className="sub-head">Columns</h3>
                <div className="form-grid">
                  {CFIELDS.filter((f) => hasPqq || !f.startsWith('pqq')).map((f: CField) => (
                    <label key={f}>
                      {CFIELD_LABELS[f]}
                      <select value={map[f] ?? ''} onChange={(e) => setMap({ ...map, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                        <option value="">(none)</option>
                        {(rows[header] ?? []).map((h, i) => (
                          <option key={i} value={i}>
                            {String(h).trim() || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}
            {companies.length > 0 && (
              <>
                <h3 className="sub-head">
                  Preview: {companies.length} companies ({fresh} new, {matched.length} already in the list)
                  {warned > 0 && <span className="late"> · {warned} to check</span>}
                </h3>
                <label className="check">
                  <span>
                    <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} /> Fill in blanks and PQQ dates on companies already in the list
                  </span>
                </label>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th />
                      <th>Type</th>
                      <th>Trade</th>
                      {hasPqq && <th>PQQ</th>}
                      {hasPqq && <th>Expires</th>}
                      <th className="num">Contacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.slice(0, 200).map((c) => (
                      <tr key={c.row}>
                        <td>
                          {c.name}
                          {c.warnings.map((w, i) => (
                            <div key={i} className="late small">
                              {w}
                            </div>
                          ))}
                        </td>
                        <td className="small muted">{byNorm.has(normName(c.name)) ? (update ? 'exists: fill in' : 'exists: skip') : 'new'}</td>
                        <td className="small">{TYPES.find(([k]) => k === c.type)?.[1]}</td>
                        <td className="small">{c.trade}</td>
                        {hasPqq && <td className="small">{c.pqq_status ? PQQ_LABELS[c.pqq_status] : ''}</td>}
                        {hasPqq && <td className="small nowrap">{c.pqq_expires_on ? ukDate(c.pqq_expires_on) : ''}</td>}
                        <td className="num">{c.contacts.length || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {companies.length > 200 && <p className="muted small">The first 200 are shown; all {companies.length} are imported.</p>}
                <div className="button-row">
                  <button className="primary" disabled={busy || !!result} onClick={run}>
                    {busy ? 'Importing…' : `Import ${companies.length} companies`}
                  </button>
                  <button onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
