import { useMemo } from 'react'
import ProgrammeEditor from '../components/programme/ProgrammeEditor'
import { useJob } from './JobLayout'

// Job › Programme: DBP Timeline built into the app (21–22 Nov). The cashflow and procurement work from
// this programme as it's edited; an estimate's programme moves here when the enquiry is won.
export default function ProgrammeTab() {
  const { job } = useJob()
  const owner = useMemo(() => ({ jobId: job.id }), [job.id])
  return <ProgrammeEditor owner={owner} ownerName={`${job.job_no} ${job.name}`} job={job} defaults={{ start: job.start_date, pc: job.pc_date }} />
}
