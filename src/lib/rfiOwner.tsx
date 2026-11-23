import { createContext, useContext, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { JobContext } from '../pages/JobLayout'

// An RFI belongs to a job or to an Estimating enquiry (tender RFIs); the same screens serve both. A job's tab gets its owner
// from the job; an enquiry's pages provide it (RfiOwnerProvider).
export interface RfiOwner {
  kind: 'job' | 'enquiry'
  id: string
  ref: string // "2611 FISL" or "E012"
  name: string
  base: string // the RFI list's address
}
export const ownerKeys = (o: Pick<RfiOwner, 'kind' | 'id'>) => ({ job_id: o.kind === 'job' ? o.id : null, enquiry_id: o.kind === 'enquiry' ? o.id : null })

const Ctx = createContext<RfiOwner | null>(null)
export const RfiOwnerProvider = Ctx.Provider

export function useRfiOwner(): RfiOwner {
  const given = useContext(Ctx)
  const jobCtx = useOutletContext<JobContext | undefined>()
  const job = jobCtx?.job
  return useMemo(() => {
    if (given) return given
    if (!job) throw new Error('RFIs need a job or an enquiry.')
    return { kind: 'job' as const, id: job.id, ref: `${job.job_no} ${job.code}`, name: job.name, base: `/jobs/${job.id}/rfis` }
  }, [given, job])
}
