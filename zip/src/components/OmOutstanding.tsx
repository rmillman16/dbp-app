// "O&Ms outstanding" on a payment notice / retention release: the order's O&M documents not yet received
// (scripts 047, 050): lines under the order or its package. For information only: nothing is blocked. Shows nothing when there are none.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ukDate } from '../lib/format'
import { loadOutstandingOm } from '../lib/om'
import '../om.css'

type Item = Awaited<ReturnType<typeof loadOutstandingOm>>[number]

export default function OmOutstanding({ jobId, orderId }: { jobId: string; orderId: string }) {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    let live = true
    if (navigator.onLine)
      loadOutstandingOm(jobId, orderId).then(
        (r) => live && setItems(r),
        () => live && setItems([]),
      )
    return () => {
      live = false
    }
  }, [jobId, orderId])
  if (!items.length) return null
  const late = items.filter((i) => i.overdue).length
  return (
    <details className="warning small om-outstanding">
      <summary>
        <b>O&Ms outstanding: {items.length}</b>
        {late > 0 && <span> (⚠ {late} overdue)</span>}
      </summary>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            {i.name} <span className="muted">· missing</span>
            {i.due_date && <span className={i.overdue ? 'late' : 'muted'}> · {i.overdue ? `⚠ overdue, was due ${ukDate(i.due_date)}` : `due ${ukDate(i.due_date)}`}</span>}
          </li>
        ))}
      </ul>
      <Link to={`/jobs/${jobId}/om`}>Open the O&M tab</Link>
    </details>
  )
}
