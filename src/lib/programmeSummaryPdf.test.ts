import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { paginate, summaryItems, summaryProgrammePdf } from './programmeSummaryPdf'
import type { TLState, TLTask } from './timelineFormat'

const task = (i: number, groupId: string, start: string, duration: number, milestone = false): TLTask => ({
  id: `T${i}`, name: `Task ${i}`, trade: '', contractor: '', start, duration, milestone, progress: 0, rag: 'green',
  prereqConfirmed: false, prereqNote: '', predecessors: [], skeleton: false, baselineStart: null, baselineDuration: null, groupId,
})
// a programme with `sections` sections of `each` tasks, one section after another (the last of each section a milestone)
function programme(sections: number, each: number): TLState {
  const groups = Array.from({ length: sections }, (_, g) => ({ id: `G${g}`, name: `Section ${g + 1}`, collapsed: false }))
  const tasks: TLTask[] = []
  let n = 0
  for (let g = 0; g < sections; g++)
    for (let k = 0; k < each; k++) {
      const d = new Date(2026, 11, 1 + (g * each + k) * 3)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      tasks.push(task(n++, `G${g}`, iso, 5 + k, k === each - 1))
    }
  return { schemaVersion: 1, projectName: 'Test', clientLogo: null, projectStart: null, weekStart: null, shutdowns: [], trades: [], tasks, groups }
}
const pagesOf = (s: TLState) => paginate(summaryItems(s).items).length

describe('summary programme PDF', () => {
  it('a small job is one page and lists every task', () => {
    const r = summaryItems(programme(3, 5))
    expect(paginate(r.items).length).toBe(1)
    expect(r.items.filter((i) => i.kind !== 'band').length).toBeGreaterThanOrEqual(15)
    expect(r.trimmed).toBe(false)
  })
  it('a medium programme takes two or three pages', () => {
    const p = pagesOf(programme(8, 8))
    expect(p).toBeGreaterThan(1)
    expect(p).toBeLessThanOrEqual(4)
  })
  it('a huge programme is cut to its main tasks, never more than four pages, and keeps every milestone', () => {
    const s = programme(12, 30)
    const r = summaryItems(s)
    expect(r.trimmed).toBe(true)
    expect(pagesOf(s)).toBeLessThanOrEqual(4)
    expect(r.items.filter((i) => i.kind === 'ms').length).toBeGreaterThan(0)
  })
  it('a section carried over a page gets its band again, and no band is left alone at the foot', () => {
    const pages = paginate(summaryItems(programme(8, 8)).items)
    pages.forEach((p) => expect(p[p.length - 1].kind).not.toBe('band'))
    expect(pages[1][0].kind).toBe('band')
  })
  it('makes a real PDF with that many pages', async () => {
    const s = programme(12, 8)
    const blob = await summaryProgrammePdf(s, { title: 'Corsham Street – L9 “B4”', revision: 'Initial issue', status: 'Draft', by: 'a@b.co' })
    const doc = await PDFDocument.load(await blob.arrayBuffer())
    expect(doc.getPageCount()).toBe(pagesOf(s))
  })
  it('even an absurdly large programme comes out as four pages at most', async () => {
    const blob = await summaryProgrammePdf(programme(60, 20), { title: 'Huge' })
    expect((await PDFDocument.load(await blob.arrayBuffer())).getPageCount()).toBeLessThanOrEqual(4)
  })
  it('refuses an empty programme', async () => {
    await expect(summaryProgrammePdf(programme(0, 0), { title: 'x' })).rejects.toThrow()
  })
})
