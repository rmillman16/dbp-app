// The client and subcontractor programmes (Richard, 23 Nov): the options under each toolbar button,
// then Print / PDF or MS Project / P6, made from a copy of the programme (lib/programmeViews.ts).
// The programme itself is never changed.
import { useMemo, useState } from 'react'
import { ukDate } from '../../lib/format'
import { issueTitle, issueView, programmeSpan, shortenFactor, shortenPreview, type IssueKind } from '../../lib/programmeViews'
import { buildMSProjectXML, buildXER, downloadFile, exportFileName } from '../../lib/timelineExport'
import { printProgramme } from '../../lib/timelinePrint'
import type { TLState } from '../../lib/timelineFormat'

export default function IssueMenu({
  kind,
  state,
  critical,
  revision,
  onDone,
  onError,
}: {
  kind: IssueKind
  state: () => TLState // the programme as it is now (Timeline's layout)
  critical: Set<string>
  revision?: string
  onDone: () => void // close the menu
  onError: (msg: string) => void
}) {
  const [summary, setSummary] = useState(false)
  const [todayLine, setTodayLine] = useState(true)
  // shorten by: a percentage or working days, each showing the other's equivalent
  const [pct, setPct] = useState('')
  const [days, setDays] = useState('')
  const [by, setBy] = useState<'percent' | 'days'>('percent')
  const base = useMemo(state, []) // eslint-disable-line react-hooks/exhaustive-deps
  const span = useMemo(() => programmeSpan(base), [base])
  const factor = useMemo(() => {
    if (kind !== 'subcontractor') return 1
    const n = Number(by === 'percent' ? pct : days)
    if (!n || n <= 0) return 1
    return shortenFactor(base, by === 'percent' ? { percent: n } : { days: n })
  }, [kind, by, pct, days, base])
  const preview = useMemo(() => (factor < 1 ? shortenPreview(base, factor) : null), [factor, base])

  const onPct = (v: string) => {
    setBy('percent')
    setPct(v)
    const n = Number(v)
    setDays(span && n > 0 ? String(Math.round((span.days * Math.min(n, 90)) / 100)) : '')
  }
  const onDays = (v: string) => {
    setBy('days')
    setDays(v)
    const n = Number(v)
    setPct(span && n > 0 ? String(Math.round((Math.min(n, span.days * 0.9) / span.days) * 1000) / 10) : '')
  }

  const title = issueTitle({ kind, summary })
  const view = () => issueView(state(), { kind, summary, factor })
  const empty = () => !base.tasks.length && (onError('Add some tasks before exporting.'), true)
  const fileName = (ext: string) => exportFileName({ projectName: `${base.projectName} - ${title}` }, ext)
  const doPrint = () => {
    if (empty()) return
    onDone()
    printProgramme(view(), {
      logoUrl: '/dbp-logo.png',
      heading: title,
      status: 'For information',
      revision,
      todayLine,
      // the critical path outline on the subcontractor's full programme only
      critical: kind === 'subcontractor' && !summary ? critical : new Set(),
    }).catch((e) => onError((e as Error).message))
  }
  const doFile = (type: 'xml' | 'xer') => {
    if (empty()) return
    onDone()
    if (type === 'xml') downloadFile(fileName(' (MS Project).xml'), buildMSProjectXML(view()), 'application/xml')
    else downloadFile(fileName('.xer'), buildXER(view()), 'application/octet-stream')
  }

  return (
    <div className="tl-issue">
      <div className="tl-legend-title">{kind === 'client' ? 'Client programme' : 'Subcontractor programme'}</div>
      <div className="tl-help">
        {kind === 'client' ? 'Every task by name, in one DBP colour: no subcontractors, trades or trade colours.' : 'Every trade and contractor, in their colours.'} No RAG, notes,
        baselines or comparison. The programme itself isn’t changed.
      </div>
      <label className="tl-legend-item">
        <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} /> Summary programme
      </label>
      <div className="tl-help tl-issue-sub">
        {summary ? 'Each section as one bar (first start to last finish), with the key dates: start on site, completion and every milestone.' : 'Off: the full task list.'}
      </div>
      {kind === 'subcontractor' && (
        <>
          <div className="tl-legend-title">Shorten by</div>
          <div className="tl-issue-shorten">
            <label>
              <input type="number" min={0} max={90} step={0.5} value={pct} onChange={(e) => onPct(e.target.value)} placeholder="0" aria-label="Shorten by percent" /> %
            </label>
            <span className="muted">or</span>
            <label>
              <input type="number" min={0} step={1} value={days} onChange={(e) => onDays(e.target.value)} placeholder="0" aria-label="Shorten by working days" /> working days
            </label>
          </div>
          <div className="tl-help tl-issue-sub">
            {preview
              ? `Finishes ${ukDate(preview.to)} instead of ${ukDate(preview.from)} (${preview.days} working day${preview.days === 1 ? '' : 's'} / ${preview.percent.toFixed(1)}% shorter).`
              : span
                ? `Finishes ${ukDate(span.end)}, as the programme. Every task is brought forward pro rata, so the subcontractor works to earlier dates.`
                : ''}
          </div>
        </>
      )}
      <label className="tl-legend-item">
        <input type="checkbox" checked={todayLine} onChange={(e) => setTodayLine(e.target.checked)} /> Today line (print)
      </label>
      <div className="tl-issue-actions">
        <button className="tl-btn tl-btn-primary" onClick={doPrint}>
          Print / PDF…
        </button>
        <button className="tl-btn" onClick={() => doFile('xml')} title="MS Project XML">
          MS Project
        </button>
        <button className="tl-btn" onClick={() => doFile('xer')} title="Primavera P6 .xer">
          P6
        </button>
      </div>
    </div>
  )
}
