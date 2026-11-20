import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { cached, must } from './offline'

// Is the signed-in person an admin? (profiles.is_admin, set in Supabase's SQL Editor.)
// The database enforces it too: non-admins can read templates but not change them.
let pending: Promise<boolean> | null = null

function loadIsAdmin(): Promise<boolean> {
  pending ??= (async () => {
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    if (!id) return false
    const row = await cached('me', () => must<{ is_admin: boolean }>(supabase.from('profiles').select('is_admin').eq('id', id).single()))
    return row.is_admin
  })().catch(() => false)
  return pending
}

export function useIsAdmin(): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null)
  useEffect(() => {
    loadIsAdmin().then(setAdmin)
  }, [])
  return admin
}
