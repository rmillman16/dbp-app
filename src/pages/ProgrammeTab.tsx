import { useMemo, useState } from 'react'
import ProgrammeEditor from '../components/programme/ProgrammeEditor'
import ProgrammeList from '../components/programme/ProgrammeList'
import { useJob } from './JobLayout'

// Job › Programme: DBP Timeline built into the app (21–22 Nov). The cashflow and procurement work from
// this programme as it's edited; an estimate's programme moves here when the enquiry is won.
// Every programme made for the job is listed above it (26 Nov): open an older one, or delete one made in error.
export default function ProgrammeTab() {
  const { job } = useJob()
  const owner = useMemo(() => ({ jobId: job.id }), [job.id])
  const [version, setVersion] = useState(0)
  return (
    <>
      <ProgrammeList owner={owner} onChanged={() => setVersion((v) => v + 1)} />
      <ProgrammeEditor key={version} owner={owner} ownerName={`${job.job_no} ${job.name}`} job={job} defaults={{ start: job.start_date, pc: job.pc_date }} />
    </>
  )
}
