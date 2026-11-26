import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { planSummary, summaryProgrammePdf } from './programmeSummaryPdf'
import type { TLState, TLTask } from './timelineFormat'

const task = (i: number, groupId: string, start: string, duration: number): TLTask => ({
  id: `T${i}`, name: `Task ${i}`, trade: '', contractor: '', start, duration, milestone: false, progress: 0, rag: 'green',
  prereqConfirmed: false, prereqNote: '', predecessors: [], skeleton: false, baselineStart: null, baselineDuration: null, groupId,
})
// a programme with `sections` sections of `each` tasks, one section after another
function programme(sections: number, each: number): TLState {
  const groups = Array.from({ length: sections }, (_, g) => ({ id: `G${g}`, name: `Section ${g + 1}`, collapsed: false }))
  const tasks: TLTask[] = []
  let n = 0
  const day = new Date(2026, 11, 1)
  for (let g = 0; g < sections; g++)
    for (let k = 0; k < each; k++) {
      const d = new Date(day.getTime() + (g * each + k) * 3 * 86400000)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      tasks.push(task(n++, `G${g}`, iso, 5 + k))
    }
  return { schemaVersion: 1, projectName: 'Test', clientLogo: null, projectStart: null, weekStart: null, shutdowns: [], trades: [], tasks, groups }
}

describe('summary programme PDF', () => {
  it('a small job is one page', () => {
    expect(planSummary(programme(5, 4)).pages).toBe(1)
  })
  it('a big programme runs longer but never past four pages', () => {
    const big = planSummary(programme(30, 10)).pages
    expect(big).toBeGreaterThan(1)
    expect(big).toBeLessThanOrEqual(4)
    expect(planSummary(programme(80, 10)).pages).toBeLessThanOrEqual(4)
  })
  it('makes a real PDF with that many pages', async () => {
    const s = programme(12, 8)
    const blob = await summaryProgrammePdf(s, { title: 'Summary programme', subtitle: 'Test – job “1”' })
    const doc = await PDFDocument.load(await blob.arrayBuffer())
    expect(doc.getPageCount()).toBe(planSummary(s).pages)
  })
  it('refuses an empty programme', async () => {
    await expect(summaryProgrammePdf(programme(0, 0), { title: 'x' })).rejects.toThrow()
  })
})
