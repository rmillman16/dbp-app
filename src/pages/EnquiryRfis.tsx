import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { enquiryRef } from '../lib/quotations'
import { RfiOwnerProvider, type RfiOwner } from '../lib/rfiOwner'
import type { Enquiry } from '../lib/types'
import { loadEnquiry } from './Estimating'

// Estimating › enquiry › RFIs (23 Nov, script 059): tender RFIs, the same screens as a job's. When the enquiry is won and
// set up as a job, its RFIs become the job's.
export default function EnquiryRfis({ children }: { children: ReactNode }) {
  const { enquiryId } = useParams()
  const [e, setE] = useState<Enquiry | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadEnquiry(enquiryId!).then(setE, (err: Error) => setError(err.message))
  }, [enquiryId])
  const owner = useMemo<RfiOwner | null>(() => (e ? { kind: 'enquiry', id: e.id, ref: enquiryRef(e), name: e.name, base: `/estimating/e/${e.id}/rfis`, client: { name: e.client_name, contact: e.client_contact, email: e.client_email } } : null), [e])
  if (error) return <p className="error">{error}</p>
  if (!e || !owner) return <p className="muted">Loading…</p>
  return (
    <>
      <div className="job-head">
        <div>
          <Link to={`/estimating/e/${e.id}`} className="link-button small">
            ← {enquiryRef(e)} · {e.name}
          </Link>
          <h1>Tender RFIs</h1>
        </div>
        {e.job_id && (
          <Link to={`/jobs/${e.job_id}/rfis`} className="button primary">
            This enquiry is now a job: open its RFIs →
          </Link>
        )}
      </div>
      {e.job_id ? <p className="muted">This enquiry was won; its RFIs are now in the job's RFIs tab.</p> : <RfiOwnerProvider value={owner}>{children}</RfiOwnerProvider>}
    </>
  )
}
