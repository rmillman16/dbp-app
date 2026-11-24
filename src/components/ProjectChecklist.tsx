import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayIso, ukDate } from '../lib/format'
import type { Job } from '../lib/types'

// Project checklist on the job Overview (24 Nov, script 076): health & safety and compliance items for the job, F10 first.
// The standard items are added the first time the job's checklist is opened; each can be ticked, marked not applicable,
// dated and noted, and people can add their own.
interface Item {
  id: string
  job_id: string
  key: string
  category: string
  title: string
  done: boolean
  na: boolean
  done_on: string | null
  note: string | null
  sort: number
  custom: boolean
}
const HS = 'Health and safety'
const COMP = 'Compliance'
const STANDARD: { key: string; category: string; title: string }[] = [
  { key: 'f10', category: HS, title: 'F10 notification sent to the HSE (if the job is notifiable)' },
  { key: 'pci', category: HS, title: 'Pre-construction information received' },
  { key: 'pd', category: HS, title: 'Principal Designer appointed' },
  { key: 'pc', category: HS, title: 'Principal Contractor appointed' },
  { key: 'cpp', category: HS, title: 'Construction phase plan prepared' },
  { key: 'rams', category: HS, title: 'RAMS reviewed and approved for the works' },
  { key: 'induct', category: HS, title: 'Site induction in place' },
  { key: 'welfare', category: HS, title: 'Welfare facilities arranged' },
  { key: 'fire', category: HS, title: 'Fire plan and emergency procedures in place' },
  { key: 'asbestos', category: HS, title: 'Asbestos survey seen (refurbishment / demolition)' },
  { key: 'hsfile', category: HS, title: 'Health and safety file started' },
  { key: 'bc', category: COMP, title: 'Building Control approval in place' },
  { key: 'pw', category: COMP, title: 'Party wall awards agreed' },
  { key: 'insurance', category: COMP, title: 'Insurances in place (CAR, public and employers liability)' },
  { key: 'permits', category: COMP, title: 'Licences and permits (highways, hoarding, skips)' },
  { key: 'noise', category: COMP, title: 'Noise and working-hours consents (s61)' },
  { key: 'waste', category: COMP, title: 'Site waste management plan' },
  { key: 'competence', category: COMP, title: 'Operative competence and CSCS checks' },
]

export default function ProjectChecklist({ job }: { job: Job }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let live = true
    ;(async () => {
      const r = await supabase.from('job_checklist').select('*').eq('job_id', job.id).order('sort')
      if (r.error) {
        if (live) setError(/job_checklist/i.test(r.error.message) ? 'The project checklist needs script 076 run in Supabase first (supabase/README.md).' : r.error.message)
        return
      }
      let rows = r.data as Item[]
      const have = new Set(rows.map((x) => x.key))
      const missing = STANDARD.map((s, i) => ({ ...s, sort: i })).filter((s) => !have.has(s.key))
      if (missing.length && navigator.onLine) {
        const ins = await supabase.from('job_checklist').insert(missing.map((m) => ({ job_id: job.id, ...m }))).select('*')
        if (!ins.error) rows = [...rows, ...(ins.data as Item[])].sort((a, b) => a.sort - b.sort)
      }
      if (live) setItems(rows)
    })()
    return () => {
      live = false
    }
  }, [job.id])

  async function change(it: Item, patch: Partial<Item>) {
    if (!navigator.onLine) return setError('You are offline: the checklist can only be changed with a connection.')
    setError(null)
    const next = { ...it, ...patch }
    setItems((l) => (l ?? []).map((x) => (x.id === it.id ? next : x)))
    const r = await supabase.from('job_checklist').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', it.id)
    if (r.error) {
      setItems((l) => (l ?? []).map((x) => (x.id === it.id ? it : x)))
      setError(r.error.message)
    }
  }
  const tick = (it: Item, done: boolean) => change(it, { done, na: false, done_on: done ? (it.done_on ?? todayIso()) : null })
  async function addOwn(category: string, title: string) {
    if (!title.trim()) return
    const sort = Math.max(100, ...(items ?? []).map((x) => x.sort + 1))
    const r = await supabase.from('job_checklist').insert({ job_id: job.id, key: `custom-${Date.now()}`, category, title: title.trim(), sort, custom: true }).select('*').single()
    if (r.error) return setError(r.error.message)
    setItems((l) => [...(l ?? []), r.data as Item])
    setAdding(null)
  }
  async function remove(it: Item) {
    if (!confirm(`Remove "${it.title}" from this checklist?`)) return
    const r = await supabase.from('job_checklist').delete().eq('id', it.id)
    if (r.error) return setError(r.error.message)
    setItems((l) => (l ?? []).filter((x) => x.id !== it.id))
  }

  const f10 = items?.find((x) => x.key === 'f10')
  const counted = (items ?? []).filter((x) => !x.na)
  const doneCount = counted.filter((x) => x.done).length
  const cats = [...new Set((items ?? []).map((x) => x.category))]

  return (
    <section className="card span-all checklist-card">
      <div className="pane-head">
        <h2>Project checklist</h2>
        <div className="checklist-head">
          {items && (
            <>
              <span className={`tag ${f10 && !f10.done && !f10.na ? 'late-tag' : ''}`} title="F10">
                {f10 ? (f10.na ? 'F10: not applicable' : f10.done ? `F10 done${f10.done_on ? ' ' + ukDate(f10.done_on) : ''}` : 'F10 not done') : 'F10'}
              </span>
              <span className="muted small">
                {doneCount} of {counted.length} done
              </span>
            </>
          )}
          <button type="button" className="link-button small" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {open && items && (
        <div className="checklist-cols">
          {cats.map((cat) => (
            <div key={cat} className="checklist-cat">
              <h3 className="sub-head">{cat}</h3>
              <ul className="checklist">
                {items
                  .filter((x) => x.category === cat)
                  .map((it) => (
                    <li key={it.id} className={it.na ? 'na' : it.done ? 'done' : ''}>
                      <label className="checklist-main">
                        <input type="checkbox" checked={it.done} disabled={it.na} onChange={(e) => tick(it, e.target.checked)} />
                        <span className="checklist-title">{it.title}</span>
                      </label>
                      <div className="checklist-meta">
                        {it.done && (
                          <input type="date" className="small-input" value={it.done_on ?? ''} onChange={(e) => change(it, { done_on: e.target.value || null })} title="Date done" />
                        )}
                        <input
                          className="checklist-note"
                          placeholder={it.key === 'f10' ? 'HSE reference / note' : 'Note'}
                          defaultValue={it.note ?? ''}
                          onBlur={(e) => e.target.value !== (it.note ?? '') && change(it, { note: e.target.value.trim() || null })}
                        />
                        <button type="button" className={`link-button small ${it.na ? '' : 'muted'}`} onClick={() => change(it, { na: !it.na, done: false, done_on: null })} title="Not applicable on this job">
                          {it.na ? 'N/A ✓' : 'N/A'}
                        </button>
                        {it.custom && (
                          <button type="button" className="link-button small muted" onClick={() => remove(it)} aria-label="Remove">
                            ✕
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
              {adding === cat ? (
                <form
                  className="checklist-add"
                  onSubmit={(e) => {
                    e.preventDefault()
                    addOwn(cat, new FormData(e.currentTarget).get('t') as string)
                  }}
                >
                  <input name="t" autoFocus placeholder="New checklist item" />
                  <button className="primary small">Add</button>
                  <button type="button" className="link-button small" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button type="button" className="link-button small" onClick={() => setAdding(cat)}>
                  + Add item
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
