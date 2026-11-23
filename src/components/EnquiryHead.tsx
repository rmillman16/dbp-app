import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ukDate } from '../lib/format'
import { enquiryRef } from '../lib/quotations'
import { fireConfetti } from '../lib/confetti'
import { ENQUIRY_STATUS_LABELS, type Enquiry } from '../lib/types'

// The top of every page inside an enquiry, laid out like a job's: the enquiry on one line, then its sections across the top
// so you can switch between them. (Overview, Programme, Minutes, RFIs, Tender enquiries, Tender return.)
export default function EnquiryHead({ e }: { e: Enquiry }) {
  const navigate = useNavigate()
  const base = `/estimating/e/${e.id}`
  const tabs: [string, string, boolean][] = [
    ['Overview', base, true],
    ['Programme', `${base}/programme`, false],
    ['Minutes', `${base}/minutes`, false],
    ['RFIs', `${base}/rfis`, false],
    ['Tender enquiries', `${base}/tender`, false],
    ['Tender return', `${base}/return`, false],
  ]
  return (
    <>
      <div className="job-head job-head-line">
        <Link to="/estimating" className="job-back" title="All enquiries" aria-label="All enquiries">
          ←
        </Link>
        <span className={`tag enq-${e.status}`}>{ENQUIRY_STATUS_LABELS[e.status]}</span>
        <h1>
          {enquiryRef(e)} · {e.name}
        </h1>
        <span className="job-meta muted">
          {e.client_name && <span>{e.client_name}</span>}
          {e.due_date && <span>Due {ukDate(e.due_date)}</span>}
        </span>
        <Link to={`${base}/edit`} className="button small-button job-edit">
          Edit enquiry
        </Link>
        {e.job_id ? (
          <Link to={`/jobs/${e.job_id}`} className="button primary small-button">
            Open the job →
          </Link>
        ) : (
          e.status !== 'lost' && (
            <Link
              to={`/jobs/new?enquiry=${e.id}`}
              className="button primary small-button"
              title="Create the job from this enquiry and move its quotations into it"
              onClick={(ev) => {
                // a win deserves confetti: let it fly for a moment, then on to setting up the job
                if (fireConfetti()) {
                  ev.preventDefault()
                  window.setTimeout(() => navigate(`/jobs/new?enquiry=${e.id}`), 1400)
                }
              }}
            >
              Won: set up as job
            </Link>
          )
        )}
      </div>
      <nav className="tabs">
        {tabs.map(([label, to, end]) => (
          <NavLink key={label} to={to} end={end} className="tab">
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
