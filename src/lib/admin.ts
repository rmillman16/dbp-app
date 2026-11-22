import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { cached, must } from './offline'
import type { Profile } from './types'

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

// the signed-in person's own profile (name, initials, job title for letters)
export async function loadMe(): Promise<Profile | null> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) return null
  return cached('me-profile', () => must<Profile>(supabase.from('profiles').select('*').eq('id', id).single()))
}

export function useIsAdmin(): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null)
  useEffect(() => {
    loadIsAdmin().then(setAdmin)
  }, [])
  return admin
}

// Operations (script 034): an Operations login or an admin. Sees Site's buyer's lists; the database enforces it too.
let opsPending: Promise<boolean> | null = null
export function loadIsOperations(): Promise<boolean> {
  opsPending ??= (async () => {
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    if (!id) return false
    const row = await cached('me-ops', () => must<Profile>(supabase.from('profiles').select('*').eq('id', id).single()))
    return !!(row.is_admin || row.is_operations)
  })().catch(() => false)
  return opsPending
}
export function useIsOperations(): boolean | null {
  const [ops, setOps] = useState<boolean | null>(null)
  useEffect(() => {
    loadIsOperations().then(setOps)
  }, [])
  return ops
}
