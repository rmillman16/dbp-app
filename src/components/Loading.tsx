// "Loading…" with a bit of site humour (24 Nov): a different line each time, changing every couple of seconds if it takes a while.
import { useEffect, useState } from 'react'

const LINES = [
  'Pouring the concrete…',
  'Checking the drawings…',
  'Waiting for the kettle…',
  'Counting the bricks…',
  'Measuring twice, cutting once…',
  'Chasing the plasterer…',
  'Reading the small print…',
  'Putting the hard hats on…',
  'Sweeping the site…',
  'Booking the crane…',
  'Signing in at the gate…',
  'Levelling the floor…',
  'Hanging the doors…',
  'Waiting for the delivery…',
  'Ordering more tea bags…',
]
const pick = (not?: string) => {
  let l = LINES[Math.floor(Math.random() * LINES.length)]
  if (l === not) l = LINES[(LINES.indexOf(l) + 1) % LINES.length]
  return l
}

export default function Loading() {
  const [line, setLine] = useState(() => pick())
  useEffect(() => {
    const t = window.setInterval(() => setLine((l) => pick(l)), 2500)
    return () => window.clearInterval(t)
  }, [])
  return (
    <p className="muted loading-line" role="status">
      {line}
    </p>
  )
}
