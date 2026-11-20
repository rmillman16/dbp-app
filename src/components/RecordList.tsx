import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'

// A list of records from one table that an admin can open, edit, save, add and delete.
// Used by the Templates pages (clauses, insurances, wording, O&M documents).

export interface Field {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'date' | 'checkbox'
  wide?: boolean
  rows?: number
  required?: boolean
  hint?: string
}

type Row = Record<string, unknown>

interface Props {
  table: string
  idKey?: string
  fields: Field[]
  orderBy: string[]
  title: (r: Row) => ReactNode
  subtitle?: (r: Row) => ReactNode
  groupBy?: string
  newRow?: Row // defaults for "Add"; omit to hide the Add button
  addLabel?: string
  canDelete?: boolean
  onlyEmpty?: string // only rows where this column is empty, e.g. company-wide items have no job_id
  emptyText?: string
  extraActions?: ReactNode
}

export default function RecordList(p: Props) {
  const idKey = p.idKey ?? 'id'
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    cached(`tpl:${p.table}`, () => {
      let q = supabase.from(p.table).select('*')
      if (p.onlyEmpty) q = q.is(p.onlyEmpty, null)
      for (const o of p.orderBy) q = q.order(o)
      return must<Row[]>(q)
    }).then(setRows, (e: Error) => setError(e.message))
  }, [p.table, p.onlyEmpty, p.orderBy.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load])

  function open(r: Row | null) {
    setError(null)
    if (r === null || openId === String(r[idKey])) {
      setOpenId(null)
      setDraft(null)
    } else {
      setOpenId(String(r[idKey]))
      setDraft({ ...r })
    }
  }

  function add() {
    setError(null)
    setOpenId('new')
    setDraft({ ...p.newRow })
  }

  async function save() {
    if (!draft) return
    for (const f of p.fields) if (f.required && (draft[f.key] == null || String(draft[f.key]).trim() === '')) return setError(`${f.label} is needed.`)
    setBusy(true)
    const values: Row = {}
    for (const f of p.fields) {
      const v = draft[f.key]
      values[f.key] = f.type === 'number' ? (v === '' || v == null ? null : Number(v)) : f.type === 'checkbox' ? !!v : v === '' ? null : v
    }
    const res =
      openId === 'new'
        ? await supabase.from(p.table).insert({ ...p.newRow, ...values })
        : await supabase.from(p.table).update(values).eq(idKey, openId!)
    setBusy(false)
    if (res.error) return setError(saveError(res.error))
    setOpenId(null)
    setDraft(null)
    load()
  }

  async function remove() {
    if (!openId || openId === 'new' || !confirm('Delete this for good? This cannot be undone.')) return
    setBusy(true)
    const { error } = await supabase.from(p.table).delete().eq(idKey, openId)
    setBusy(false)
    if (error) return setError(saveError(error))
    setOpenId(null)
    setDraft(null)
    load()
  }

  const editor = (
    <div className="record-editor">
      <div className="form-grid">
        {p.fields.map((f) => (
          <label key={f.key} className={f.wide || f.type === 'textarea' ? 'span-2' : f.type === 'checkbox' ? 'check' : ''}>
            {f.type === 'checkbox' ? (
              <span>
                <input type="checkbox" checked={!!draft?.[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} /> {f.label}
              </span>
            ) : (
              f.label
            )}
            {f.type === 'textarea' ? (
              <textarea rows={f.rows ?? 6} value={String(draft?.[f.key] ?? '')} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            ) : f.type === 'checkbox' ? null : (
              <input
                type={f.type ?? 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={String(draft?.[f.key] ?? '')}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            )}
            {f.hint && <span className="hint">{f.hint}</span>}
          </label>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => open(null)}>Cancel</button>
        {p.canDelete && openId !== 'new' && (
          <button className="danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </div>
  )

  const item = (r: Row) => {
    const id = String(r[idKey])
    return (
      <li key={id} className={`record ${openId === id ? 'open' : ''}`}>
        <button className="record-head" onClick={() => open(r)} aria-expanded={openId === id}>
          <span className="record-title">{p.title(r)}</span>
          {p.subtitle && <span className="muted small">{p.subtitle(r)}</span>}
        </button>
        {openId === id && editor}
      </li>
    )
  }

  const groups = p.groupBy
    ? [...new Set((rows ?? []).map((r) => String(r[p.groupBy!] ?? '')))].map((g) => ({ g, items: (rows ?? []).filter((r) => String(r[p.groupBy!] ?? '') === g) }))
    : [{ g: '', items: rows ?? [] }]

  return (
    <div>
      <div className="button-row record-actions">
        {p.newRow && (
          <button className="primary" onClick={add} disabled={openId === 'new'}>
            + {p.addLabel ?? 'Add'}
          </button>
        )}
        {p.extraActions}
      </div>
      {openId === 'new' && (
        <div className="record open">
          <div className="record-head static">
            <span className="record-title">New</span>
          </div>
          {editor}
        </div>
      )}
      {error && !openId && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">{p.emptyText ?? 'Nothing here yet.'}</p>}
      {groups.map(({ g, items }) => (
        <div key={g}>
          {g && <h3 className="sub-head">{g}</h3>}
          <ul className="record-list">{items.map(item)}</ul>
        </div>
      ))}
    </div>
  )
}
