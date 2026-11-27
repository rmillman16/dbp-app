// Tasks (23 Nov, script 052): a task for yourself or any DBP team member, optionally on a job, with a due date.
// It goes on that person's bell (the database does it); done closes it and tells whoever set it.
// Task details (23 Nov, script 053), as in Microsoft To Do: important (star), steps, My Day, remind me on a date,
// repeat, files. The database sets up the next repeating task and the reminder on the bell.
import { supabase } from './supabase'
import { addDaysIso, todayIso } from './format'

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export const REPEAT_LABELS: Record<Repeat, string> = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }

export interface Step {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  notes: string | null
  job_id: string | null
  assigned_to: string
  created_by: string | null
  due_date: string | null
  done: boolean
  done_at: string | null
  created_at: string
  // 053 (missing until it's run)
  important?: boolean
  steps?: Step[]
  my_day?: string | null
  remind_on?: string | null
  repeat?: Repeat | null
  repeated_to?: string | null // the next one, once a repeating task is done
  mentioned?: string[] // others named with @ in it, who can see it (script 104)
}

export interface TaskFile {
  id: string
  task_id: string
  path: string
  name: string
  uploaded_by: string | null
  created_at: string
}

const needs052 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'Tasks need script 052 run in Supabase first (supabase/README.md).' : m)
const needs053 = (m: string) =>
  /important|steps|my_day|remind_on|repeat|task_files|bucket/i.test(m) && /schema cache|does not exist|not found|column/i.test(m)
    ? 'This needs script 053 run in Supabase first (supabase/README.md).'
    : needs052(m)

// on My Day today (it clears itself the next day, as in To Do)
export const onMyDay = (t: Pick<Task, 'my_day'>) => t.my_day === todayIso()
export const stepCount = (t: Pick<Task, 'steps'>) => {
  const s = t.steps ?? []
  return s.length ? `${s.filter((x) => x.done).length} of ${s.length}` : null
}
// To Do's "Next week": the coming Monday
export function nextMonday(from = todayIso()) {
  const d = new Date(from + 'T00:00:00').getDay() // 0 Sunday … 6 Saturday
  return addDaysIso(from, (8 - d) % 7 || 7)
}

// tasks given to me, and tasks I've set for others (open ones, plus the last fortnight's done ones)
export async function loadTasks(): Promise<Task[]> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  // Only mine: given to me or set by me. (The database lets an admin read everyone's tasks; this list is still just the admin's own.)
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  const run = (withMentions: boolean) => {
    let q = supabase.from('tasks').select('*').or(`done.eq.false,done_at.gte.${since}`)
    if (uid) q = q.or(withMentions ? `assigned_to.eq.${uid},created_by.eq.${uid},mentioned.cs.{${uid}}` : `assigned_to.eq.${uid},created_by.eq.${uid}`)
    return q.order('due_date', { ascending: true, nullsFirst: false }).order('created_at')
  }
  let r = await run(true)
  if (r.error) r = await run(false) // before script 104 there is no "mentioned" column
  if (r.error) throw new Error(needs052(r.error.message))
  return r.data as Task[]
}
export async function loadTask(id: string): Promise<Task | null> {
  const r = await supabase.from('tasks').select('*').eq('id', id).maybeSingle()
  if (r.error) throw new Error(needs052(r.error.message))
  return r.data as Task | null
}

// My Day on Home: my open tasks added to My Day today, or due today
export async function loadMyDay(uid: string): Promise<Task[]> {
  const today = todayIso()
  let r = await supabase.from('tasks').select('*').eq('assigned_to', uid).eq('done', false).or(`my_day.eq.${today},due_date.eq.${today}`).order('created_at')
  if (r.error) r = await supabase.from('tasks').select('*').eq('assigned_to', uid).eq('done', false).eq('due_date', today).order('created_at') // before 053
  if (r.error) throw new Error(needs052(r.error.message))
  return r.data as Task[]
}

export async function addTask(t: { title: string; notes: string | null; job_id: string | null; assigned_to: string; due_date: string | null }) {
  const { data } = await supabase.auth.getSession()
  const r = await supabase
    .from('tasks')
    .insert({ ...t, created_by: data.session?.user.id })
    .select('*')
    .single()
  if (r.error) throw new Error(needs052(r.error.message))
  return r.data as Task
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'notes' | 'job_id' | 'assigned_to' | 'due_date' | 'important' | 'steps' | 'my_day' | 'remind_on' | 'repeat'>>
export async function updateTask(id: string, patch: TaskPatch) {
  const r = await supabase.from('tasks').update(patch).eq('id', id).select('*').single()
  if (r.error) throw new Error(needs053(r.error.message))
  return r.data as Task
}

export async function setTaskDone(id: string, done: boolean) {
  const r = await supabase
    .from('tasks')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id)
  if (r.error) throw new Error(needs052(r.error.message))
}

export async function deleteTask(id: string) {
  const r = await supabase.from('tasks').delete().eq('id', id)
  if (r.error) throw new Error(needs052(r.error.message))
}

// ---------- files (private storage area "tasks", 053) ----------
export async function loadTaskFiles(taskId: string): Promise<TaskFile[]> {
  const r = await supabase.from('task_files').select('*').eq('task_id', taskId).order('created_at')
  if (r.error) throw new Error(needs053(r.error.message))
  return r.data as TaskFile[]
}
export async function addTaskFile(taskId: string, file: File) {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_')
  const path = `${taskId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('tasks').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(needs053(up.error.message))
  const r = await supabase.from('task_files').insert({ task_id: taskId, path, name: file.name }).select('*').single()
  if (r.error) {
    await supabase.storage.from('tasks').remove([path])
    throw new Error(needs053(r.error.message))
  }
  return r.data as TaskFile
}
export async function removeTaskFile(f: TaskFile) {
  const s = await supabase.storage.from('tasks').remove([f.path])
  if (s.error) throw new Error(s.error.message)
  const r = await supabase.from('task_files').delete().eq('id', f.id)
  if (r.error) throw new Error(r.error.message)
}
export async function taskFileUrl(path: string) {
  const r = await supabase.storage.from('tasks').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  return r.data.signedUrl
}
