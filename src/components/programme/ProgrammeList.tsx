import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { saveError } from '../../lib/offline'
import { ukDate } from '../../lib/format'

// Every programme made for a job (or an estimate), newest first (26 Nov): see them all, open an older one (it becomes the one in
// use) and delete one that was made in error. The newest is the programme the cashflow, procurement and reports work from.
type Row = { id: string; project_name: string | null; file_name: string | null; start_date: string | null; finish_date: string | null; imported_at: string; tasks: number; revisions: number }
export type ProgrammeOwner = { jobId: string } | { enquiryId: string }

export default function ProgrammeList({ owner, onChanged }: { owner: ProgrammeOwner; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const key = 'jobId' in owner ? owner.jobId : owner.enquiryId

  const load = useCallback(async () => {
    const q = supabase.from('programmes').select('id, project_name, file_name, start_date, finish_date, imported_at').order('imported_at', { ascending: false })
    const r = await ('jobId' in owner ? q.eq('job_id', owner.jobId) : q.eq('enquiry_id', owner.enquiryId).is('job_id', null))
    if (r.error) return setError(r.error.message)
    const base = (r.data ?? []) as Omit<Row, 'tasks' | 'revisions'>[]
    const counted = await Promise.all(
      base.map(async (p) => {
        const [t, v] = await Promise.all([
          supabase.from('programme_tasks').select('id', { count: 'exact', head: true }).eq('programme_id', p.id),
          supabase.from('programme_revisions').select('id', { count: 'exact', head: true }).eq('programme_id', p.id),
        ])
        return { ...p, tasks: t.count ?? 0, revisions: v.count ?? 0 }
      }),
    )
    setRows(counted)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
  }, [load])

  if (rows === null && !error) return null
  if (rows && rows.length === 0) return null

  async function use(p: Row) {
    if (!navigator.onLine) return setError('You are offline: this can only be changed with a connection.')
    setBusy(p.id)
    setError(null)
    // the newest programme is the one in use
    const r = await supabase.from('programmes').update({ imported_at: new Date().toISOString() }).eq('id', p.id)
    setBusy(null)
    if (r.error) return setError(saveError(r.error))
    await load()
    onChanged()
  }
  async function remove(p: Row, current: boolean) {
    if (!navigator.onLine) return setError('You are offline: this can only be changed with a connection.')
    const name = p.project_name || p.file_name || 'this programme'
    const msg = `Delete "${name}" (${p.tasks} task${p.tasks === 1 ? '' : 's'}, ${p.revisions} revision${p.revisions === 1 ? '' : 's'})?\n\nThis permanently removes the programme and its revisions. It cannot be undone.${
      current ? '\n\nIt is the programme in use: the cashflow and procurement work from it, so if there is an older one that becomes the one in use, otherwise they have no programme.' : ''
    }`
    if (!window.confirm(msg)) return
    setBusy(p.id)
    setError(null)
    const r = await supabase.from('programmes').delete().eq('id', p.id).select('id')
    setBusy(null)
    if (r.error) return setError(saveError(r.error))
    if (!r.data?.length) return setError('It was not deleted: you may not have access, or the job is archived.')
    await load()
    onChanged()
  }

  const list = rows ?? []
  return (
    <section className="card programme-list">
      <div className="pane-head">
        <h2>Programmes{list.length ? ` (${list.length})` : ''}</h2>
        <span className="muted small">{list.length > 1 ? 'The newest is the one in use. Open an older one to make it the one in use, or delete one made in error.' : 'The programme in use.'}</span>
      </div>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Programme</th>
            <th>Dates</th>
            <th>Tasks</th>
            <th>Revisions</th>
            <th>Made</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((p, i) => (
            <tr key={p.id}>
              <td>
                <strong>{p.project_name || p.file_name || 'Programme'}</strong> {i === 0 && <span className="tag ok">In use</span>}
                {p.file_name && p.project_name && p.file_name !== p.project_name && <div className="muted small">{p.file_name}</div>}
              </td>
              <td className="nowrap">{p.start_date || p.finish_date ? `${ukDate(p.start_date) || '?'} to ${ukDate(p.finish_date) || '?'}` : '–'}</td>
              <td>{p.tasks}</td>
              <td>{p.revisions}</td>
              <td className="nowrap">{ukDate(p.imported_at.slice(0, 10))}</td>
              <td className="nowrap">
                {i > 0 && (
                  <button type="button" className="small-button" disabled={busy === p.id} onClick={() => use(p)}>
                    Open
                  </button>
                )}{' '}
                <button type="button" className="small-button" disabled={busy === p.id} onClick={() => remove(p, i === 0)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
