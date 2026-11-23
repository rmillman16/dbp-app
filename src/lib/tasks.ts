// Tasks (23 Nov, script 052): a task for yourself or any DBP team member, optionally on a job, with a due date.
// It goes on that person's bell (the database does it); done closes it and tells whoever set it.
import { supabase } from './supabase'

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
}

const needs052 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'Tasks need script 052 run in Supabase first (supabase/README.md).' : m)

// tasks given to me, and tasks I've set for others (open ones, plus the last fortnight's done ones)
export async function loadTasks(): Promise<Task[]> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  const r = await supabase.from('tasks').select('*').or(`done.eq.false,done_at.gte.${since}`).order('due_date', { ascending: true, nullsFirst: false }).order('created_at')
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
