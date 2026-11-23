// "What changed" between two revisions of a programme, in DBP Timeline's wording
// (reference/timeline-app-2026-11-21.html: diffProgrammeData). Both sides are in Timeline's layout.
import type { TLState } from './timelineFormat'
import { fmtUKShort, fromISO } from './timelineDates'

const fmtD = (iso: string | null | undefined) => (iso ? fmtUKShort(fromISO(iso)) : '?')

/** one line per change; prev missing = the initial issue */
export function diffProgrammeData(prev: TLState | null | undefined, cur: TLState): string[] {
  if (!prev) return ['Initial issue: ' + (cur.tasks || []).length + ' tasks.']
  const lines: string[] = []
  const pm = new Map((prev.tasks || []).map((t) => [t.id, t]))
  const cm = new Map((cur.tasks || []).map((t) => [t.id, t]))
  if (prev.projectName !== cur.projectName) lines.push(`Programme renamed: “${prev.projectName}” → “${cur.projectName}”`)
  if ((prev.projectStart || null) !== (cur.projectStart || null)) lines.push(`Programme start: ${fmtD(prev.projectStart)} → ${fmtD(cur.projectStart)}`)
  if ((prev.weekStart || null) !== (cur.weekStart || null))
    lines.push(`Week 1 date: ${prev.weekStart ? fmtD(prev.weekStart) : 'automatic'} → ${cur.weekStart ? fmtD(cur.weekStart) : 'automatic'}`)
  const shut = (d: TLState) => (d.shutdowns || []).map((s) => `${s.name || 'Shutdown'} ${fmtD(s.start)}–${fmtD(s.end)}`).join(', ') || 'none'
  if (shut(prev) !== shut(cur)) lines.push(`Shutdowns: ${shut(prev)} → ${shut(cur)}`)
  ;(cur.tasks || []).forEach((t) => {
    const p = pm.get(t.id)
    if (!p) {
      lines.push(`+ Added “${t.name}” (${fmtD(t.start)}, ${t.milestone ? 'milestone' : t.duration + 'd'})`)
      return
    }
    const ch: string[] = []
    if (p.name !== t.name) ch.push(`renamed from “${p.name}”`)
    if (p.start !== t.start) ch.push(`start ${fmtD(p.start)} → ${fmtD(t.start)}`)
    if (!t.milestone && p.duration !== t.duration) ch.push(`duration ${p.duration}d → ${t.duration}d`)
    if ((p.progress || 0) !== (t.progress || 0)) ch.push(`progress ${p.progress || 0}% → ${t.progress || 0}%`)
    if (p.rag !== t.rag) ch.push(`RAG ${p.rag} → ${t.rag}`)
    if (p.trade !== t.trade) ch.push(`trade ${p.trade} → ${t.trade}`)
    if ((p.contractor || '') !== (t.contractor || '')) ch.push(`contractor ${p.contractor || 'none'} → ${t.contractor || 'none'}`)
    if (JSON.stringify(p.predecessors || []) !== JSON.stringify(t.predecessors || [])) ch.push('links changed')
    if (!!p.skeleton !== !!t.skeleton) ch.push(t.skeleton ? 'now skeleton crew' : 'no longer skeleton crew')
    if (ch.length) lines.push(`${t.name}: ${ch.join('; ')}`)
  })
  ;(prev.tasks || []).forEach((p) => {
    if (!cm.has(p.id)) lines.push(`− Removed “${p.name}”`)
  })
  return lines.length ? lines : ['No changes to tasks or settings.']
}
