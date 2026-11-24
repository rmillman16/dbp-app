// The issue record of a meeting's minutes (24 Nov, script 085): which revision is out, who it went to and when, a copy of exactly
// what was issued, and the lock. An issued meeting is read-only until someone amends it, which starts the next revision.
import { useState } from 'react'
import { buildMinutesPdf, minutesFilename } from '../lib/exportMinutes'
import { downloadBlob } from '../lib/letter'
import { loadIssues, revLetter, type IssueRecord, type Meeting } from '../lib/minutes'
import { ukDate } from '../lib/format'

export default function MinutesIssueBar({ meeting, archived, hubUrl, onAmend, onToast }: { meeting: Meeting; archived: boolean; hubUrl: string | null; onAmend: () => void; onToast: (msg: string, danger?: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [issues, setIssues] = useState<IssueRecord[] | null>(null)
  const rev = meeting.rev ?? 0
  if (!rev) return null

  async function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    try {
      setIssues(await loadIssues(meeting.id))
    } catch (e) {
      setIssues([])
      onToast(e instanceof Error ? e.message : String(e), true)
    }
  }
  async function download(i: IssueRecord) {
    try {
      downloadBlob(await buildMinutesPdf(i.snapshot, hubUrl), minutesFilename(i.snapshot, 'pdf'))
    } catch {
      onToast('Couldn’t build that PDF.', true)
    }
  }

  return (
    <div className={'issue-bar' + (meeting.locked ? ' is-locked' : ' is-amending')}>
      <div className="issue-bar-row">
        <span>
          {meeting.locked ? (
            <>
              <b>Issued as Rev {revLetter(rev)}</b>: these minutes are locked, so what was sent cannot change. Actions ticked off on the project hub still update here.
            </>
          ) : (
            <>
              <b>Amending Rev {revLetter(rev)}</b>: issue it again to send Rev {revLetter(rev + 1)}.
            </>
          )}
        </span>
        <span className="issue-bar-btns">
          {meeting.locked && !archived && (
            <button type="button" className="btn btn-small" onClick={onAmend}>
              Amend (becomes Rev {revLetter(rev + 1)})
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={toggle}>
            {open ? 'Hide issue history' : 'Issue history'}
          </button>
        </span>
      </div>
      {open && (
        <div className="issue-history">
          {issues === null && <p className="muted">Loading…</p>}
          {issues && issues.length === 0 && <p className="muted">Nothing found.</p>}
          {issues && issues.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Rev</th>
                  <th>Issued</th>
                  <th>By</th>
                  <th>Sent to</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{revLetter(i.rev)}</b>
                    </td>
                    <td>{ukDate(i.issuedAt)}</td>
                    <td>{i.issuedBy}</td>
                    <td title={i.sentTo.map((p) => `${p.name} <${p.email}>`).join('\n')}>{i.sentTo.length ? `${i.sentTo.length} ${i.sentTo.length === 1 ? 'person' : 'people'}` : 'Not emailed'}</td>
                    <td>
                      <button type="button" className="link-button small" onClick={() => download(i)}>
                        PDF of this issue
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
