// Settings › Suggestions and issues (25 Nov, script 089): admins log what is wrong or could be better, with photos.
import { supabase } from './supabase'
import { shrinkImage } from './image'

export type SuggestionKind = 'issue' | 'idea'
export type SuggestionStatus = 'new' | 'planned' | 'done' | 'declined'
export const KIND_LABELS: Record<SuggestionKind, string> = { issue: 'Something wrong', idea: 'An idea' }
export const STATUS_LABELS: Record<SuggestionStatus, string> = { new: 'New', planned: 'Planned', done: 'Done', declined: 'Won’t do' }

export interface Suggestion {
  id: string
  kind: SuggestionKind
  title: string
  details: string | null
  page: string | null
  status: SuggestionStatus
  note: string | null
  created_by: string | null
  created_at: string
}
export interface SuggestionFile {
  id: string
  suggestion_id: string
  name: string
  path: string
  created_at: string
}

const needs089 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'Suggestions need script 089 run in Supabase first (supabase/README.md).' : m)

export async function loadSuggestions() {
  const [s, f] = await Promise.all([
    supabase.from('app_suggestions').select('*').order('created_at', { ascending: false }),
    supabase.from('app_suggestion_files').select('*').order('created_at'),
  ])
  if (s.error) throw new Error(needs089(s.error.message))
  const files = new Map<string, SuggestionFile[]>()
  for (const x of (f.data ?? []) as SuggestionFile[]) files.set(x.suggestion_id, [...(files.get(x.suggestion_id) ?? []), x])
  return { items: s.data as Suggestion[], files }
}

export async function addSuggestion(v: { kind: SuggestionKind; title: string; details: string; page: string }, photos: File[]) {
  const r = await supabase
    .from('app_suggestions')
    .insert({ kind: v.kind, title: v.title.trim(), details: v.details.trim() || null, page: v.page.trim() || null })
    .select('*')
    .single()
  if (r.error) throw new Error(needs089(r.error.message))
  for (const p of photos) await addSuggestionPhoto((r.data as Suggestion).id, p)
  return r.data as Suggestion
}
export async function updateSuggestion(id: string, patch: Partial<Pick<Suggestion, 'status' | 'note' | 'title' | 'details' | 'page' | 'kind'>>) {
  const r = await supabase.from('app_suggestions').update(patch).eq('id', id)
  if (r.error) throw new Error(needs089(r.error.message))
}
export async function deleteSuggestion(id: string, files: SuggestionFile[]) {
  const r = await supabase.from('app_suggestions').delete().eq('id', id)
  if (r.error) throw new Error(r.error.message)
  if (files.length) await supabase.storage.from('suggestions').remove(files.map((f) => f.path))
}
export async function addSuggestionPhoto(suggestionId: string, file: File) {
  const small = await shrinkImage(file)
  const safe = small.name.replace(/[^\w.\- ()]+/g, '_')
  const path = `${suggestionId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`
  const up = await supabase.storage.from('suggestions').upload(path, small, { contentType: small.type || undefined })
  if (up.error) throw new Error(up.error.message)
  const r = await supabase.from('app_suggestion_files').insert({ suggestion_id: suggestionId, name: small.name, path }).select('*').single()
  if (r.error) {
    await supabase.storage.from('suggestions').remove([path])
    throw new Error(r.error.message)
  }
  return r.data as SuggestionFile
}
export async function removeSuggestionPhoto(f: SuggestionFile) {
  const r = await supabase.from('app_suggestion_files').delete().eq('id', f.id)
  if (r.error) throw new Error(r.error.message)
  await supabase.storage.from('suggestions').remove([f.path])
}
export async function suggestionPhotoUrl(path: string) {
  const r = await supabase.storage.from('suggestions').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'Picture not found')
  return r.data.signedUrl
}
