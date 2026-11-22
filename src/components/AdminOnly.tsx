import type { ReactNode } from 'react'
import { useIsAdmin } from '../lib/admin'
import { NoAccess } from './NoAccess'

export default function AdminOnly({ children, what = 'Settings' }: { children: ReactNode; what?: string }) {
  const admin = useIsAdmin()
  if (admin === null) return <p className="muted">Loading…</p>
  if (!admin) return <NoAccess what={what} />
  return <>{children}</>
}
