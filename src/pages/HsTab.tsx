import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useJob } from './JobLayout'
import SiteDiaries from '../components/hs/SiteDiaries'
import DeliveryNotes from '../components/hs/DeliveryNotes'
import InspectionTracker from '../components/hs/InspectionTracker'
import Accidents from '../components/hs/Accidents'

// Job › H&S (24 Nov, script 081): site diaries, delivery notes and H&S inspections for the job. An archived job is read-only.
const VIEWS = [
  ['diaries', 'Site diaries'],
  ['deliveries', 'Delivery notes'],
  ['inspections', 'Inspections'],
  ['accidents', 'Accidents'],
] as const
type View = (typeof VIEWS)[number][0]

export default function HsTab() {
  const { job } = useJob()
  const [params, setParams] = useSearchParams()
  const initial = (params.get('v') as View) || 'diaries'
  const [view, setViewState] = useState<View>(VIEWS.some(([k]) => k === initial) ? initial : 'diaries')
  const setView = (v: View) => {
    setViewState(v)
    setParams({ v }, { replace: true })
  }
  const readOnly = job.status === 'archived'
  return (
    <div className="hs-tab">
      <div className="hs-views" role="tablist">
        {VIEWS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>
      {view === 'diaries' && <SiteDiaries job={job} readOnly={readOnly} />}
      {view === 'deliveries' && <DeliveryNotes job={job} readOnly={readOnly} />}
      {view === 'inspections' && <InspectionTracker job={job} readOnly={readOnly} />}
      {view === 'accidents' && <Accidents job={job} readOnly={readOnly} />}
    </div>
  )
}
