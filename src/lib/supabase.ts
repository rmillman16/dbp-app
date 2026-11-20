import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Shown on screen instead of a blank page if .env.local hasn't been filled in.
export const configError =
  !url || !anonKey || url.includes('YOUR-PROJECT') || anonKey.startsWith('your-')
    ? 'The Supabase Project URL and publishable key are missing. Copy .env.example to .env.local, paste them in, then restart npm run dev.'
    : null

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing')
