import type { ReactNode } from 'react'
import { useIsAdmin } from '../lib/admin'

export default function AdminOnly({ children }: { children: ReactNode }) {
  const admin = useIsAdmin()
  if (admin === null) return <p className="muted">Loading…</p>
  if (!admin)
    return (
      <section className="card">
        <h2>Admins only</h2>
        <p className="muted">This area is for admins. Ask an admin if something here needs changing.</p>
      </section>
    )
  return <>{children}</>
}
