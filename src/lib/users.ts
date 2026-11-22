// Adding, resetting and switching off logins from Settings › Users (22 Nov). The work is done by the
// manage-users Edge Function, which holds Supabase's server key; the app never sees it. Admins only (the
// function checks).
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface LoginStatus {
  last_sign_in_at: string | null
  disabled: boolean
}

const NOT_DEPLOYED =
  'Can’t reach the manage-users function. If it isn’t deployed yet: Supabase › Edge Functions › deploy it (supabase/README.md). If it is: open it in Supabase and turn Verify JWT off (the function checks admins itself).'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine) throw new Error('You’re offline: this needs a connection.')
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status
      if (status === 404) throw new Error(NOT_DEPLOYED)
      const j = await error.context.json?.().catch(() => null)
      throw new Error(j?.detail ?? `The server said no (${status}).`)
    }
    throw new Error(/fetch|network|failed to send/i.test(error.message) ? NOT_DEPLOYED : error.message)
  }
  if (!data?.ok) throw new Error(data?.detail ?? 'Something went wrong.')
  return data as T
}

export const listLogins = () => call<{ users: Record<string, LoginStatus> }>({ action: 'list' }).then((r) => r.users)
export const createLogin = (email: string, full_name: string, roles: string[]) =>
  call<{ user_id: string; password: string; warning?: string }>({ action: 'create', email, full_name, roles })
export const resetPassword = (user_id: string) => call<{ password: string }>({ action: 'reset_password', user_id }).then((r) => r.password)
export const setLoginOn = (user_id: string, on: boolean) => call<{ ok: true }>({ action: on ? 'enable' : 'disable', user_id })

// a draft email to the new person (drafts only: nothing is sent from the app)
export function welcomeEmail(to: string, name: string, password: string) {
  const app = location.origin
  const body = [
    `Hi ${name.split(' ')[0] || ''},`,
    '',
    'You now have a login for the DBP app.',
    '',
    `Address: ${app}`,
    `Email: ${to}`,
    `Temporary password: ${password}`,
    '',
    'Please change your password after signing in (My details).',
    '',
    'If any part says you don’t have access, use the Request access button and IT will sort it.',
  ].join('\n')
  return `mailto:${to}?subject=${encodeURIComponent('Your DBP app login')}&body=${encodeURIComponent(body)}`
}
