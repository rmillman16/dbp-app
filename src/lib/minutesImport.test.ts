import { describe, expect, it } from 'vitest'
import { parseAsWritten } from './minutesImport'

describe('parseAsWritten', () => {
  const people = [{ initials: 'RM' }, { initials: 'JB' }]
  it('splits headings, notes and actions and keeps the wording', () => {
    const p = parseAsWritten('PROGRAMME\n• The works start on 5 January.\nAction: JB to confirm the crane by 12/12/2026\n2. Design\nAOB:', people)
    expect(p.map((x) => x.type)).toEqual(['heading', 'note', 'note', 'heading', 'heading'])
    expect(p[1].text).toBe('The works start on 5 January.')
    expect(p[2]).toMatchObject({ action: true, owner: 'JB', due: '2026-12-12' })
  })
})
