// For a job with no programme yet: a simple one made from the SoW's trades (see programmeGen.ts),
// checked before it's used, then saved as the job's programme until the real one is imported.
import { Fragment, useState } from 'react'
import { ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { saveProgramme, type ParsedProgramme } from '../lib/programme'
import { GENERATED_FILE, simpleProgramme } from '../lib/programmeGen'
import type { Job } from '../lib/types'

export default function GenerateProgramme({ job, trades, onSaved }: { job: Job; trades: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(job.start_date ?? '')
  const [pc, setPc] = useState(job.pc_date ?? '')
  const [preview, setPreview] = useState<ParsedProgramme | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open)
    return (
      <button onClick={() => setOpen(true)} disabled={!trades.length} title={trades.length ? '' : 'Import the office SoW first: the programme is made from its trades'}>
        Make a simple programme from the SoW…
      </button>
    )

  const make = () => {
    setError(null)
    try {
      setPreview(simpleProgramme(trades, start, pc, job.name))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const use = async () => {
    if (!preview) return
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      await saveProgramme(job.id, preview, GENERATED_FILE)
      setOpen(false)
      setPreview(null)
      onSaved()
    } catch (e) {
      setError(saveError(e))
    } finally {
      setBusy(false)
    }
  }
  const sections = preview ? [...new Set(preview.tasks.map((t) => t.section ?? ''))] : []

  return (
    <div className="import-box">
      <p className="muted small">
        One or two activities per trade in the SoW, on a typical fit-out sequence between start on site and PC: strip out and structure, M&E first fix and dry lining, then joinery,
        finishes and M&E second fix, then commissioning, snags and cleans. The cashflow and procurement work from it until the real programme is imported (which replaces it).
      </p>
      <div className="form-grid">
        <label>
          Start on site
          <input type="date" value={start} onChange={(e) => (setStart(e.target.value), setPreview(null))} />
        </label>
        <label>
          Practical completion
          <input type="date" value={pc} onChange={(e) => (setPc(e.target.value), setPreview(null))} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {preview && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Start</th>
              <th>Finish</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <Fragment key={s}>
                <tr className="group-head">
                  <td colSpan={3}>{s}</td>
                </tr>
                {preview.tasks
                  .filter((t) => t.section === s)
                  .map((t) => (
                    <tr key={t.code}>
                      <td className="stack-title">
                        <span className="muted">{t.code}</span> {t.milestone ? '◆ ' : ''}
                        {t.name}
                      </td>
                      <td data-label="Start">{ukDate(t.start_date)}</td>
                      <td data-label="Finish">{ukDate(t.finish_date)}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <div className="form-actions">
        {!preview ? (
          <button className="primary" onClick={make} disabled={!start || !pc}>
            Show the programme
          </button>
        ) : (
          <button className="primary" onClick={use} disabled={busy}>
            {busy ? 'Saving…' : `Use this programme (${preview.tasks.length} activities)`}
          </button>
        )}
        <button onClick={() => (setOpen(false), setPreview(null))}>Cancel</button>
      </div>
    </div>
  )
}
