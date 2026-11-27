// Levelling: the scope list numbering and the levelled totals. Worked examples with known answers.
import { describe, expect, it } from 'vitest'
import { levelTotals, numberItems, parseScope, scopeText, type LevelCell, type LevelExtra, type ScopeItem } from './levelling'

const item = (id: string, kind: ScopeItem['kind'] = 'item', description = id): ScopeItem => ({ id, package_id: 'p', sort: 0, kind, description })
const cell = (item_id: string, o: Partial<LevelCell> = {}): LevelCell => ({ id: item_id, invite_id: 'i', item_id, status: 'tbc', their_amount: null, plug_amount: null, note: null, ...o })
const extra = (amount: number): LevelExtra => ({ id: String(amount), invite_id: 'i', description: 'x', amount, note: null })

describe('numbering', () => {
  it('numbers items 1, 2, 3 when there are no headings', () => {
    expect(numberItems([item('a'), item('b'), item('c')])).toEqual(['1', '2', '3'])
  })
  it('numbers under headings 1, 1.1, 1.2, 2, 2.1', () => {
    const l = [item('h1', 'heading'), item('a'), item('b'), item('h2', 'heading'), item('c')]
    expect(numberItems(l)).toEqual(['1', '1.1', '1.2', '2', '2.1'])
  })
})

describe('scope text', () => {
  it('renders a list for the email', () => {
    const t = scopeText([item('h', 'heading', 'Containment'), item('a', 'item', 'Basket tray'), item('d', 'detail', 'To the risers'), item('e', 'detail', 'Painted'), item('b', 'item', 'Trunking')])
    expect(t).toBe('1. CONTAINMENT\n1.1  Basket tray\n      (a) To the risers\n      (b) Painted\n1.2  Trunking')
  })
  it('reads a pasted list: # and trailing colons are headings, numbers and bullets are stripped', () => {
    expect(parseScope('# Power\n1.1 Sockets\n- Lighting\nData:\n  Cat6 points\n\n')).toEqual([
      { kind: 'heading', description: 'Power' },
      { kind: 'item', description: 'Sockets' },
      { kind: 'item', description: 'Lighting' },
      { kind: 'heading', description: 'Data' },
      { kind: 'item', description: 'Cat6 points' },
    ])
  })
})

describe('detail lines', () => {
  it('number (a), (b) under their item and start again under the next', () => {
    expect(numberItems([item('h', 'heading'), item('a'), item('d1', 'detail'), item('d2', 'detail'), item('b'), item('d3', 'detail')])).toEqual(['1', '1.1', '(a)', '(b)', '1.2', '(a)'])
  })
  it('only the left-hand lines are items; everything indented under them is a detail', () => {
    const t = 'S01 Wardrobe\n\tWD-01 frame\n\t\tStone top\nS02 Credenza\n\tST-01 top'
    expect(parseScope(t)).toEqual([
      { kind: 'item', description: 'S01 Wardrobe' },
      { kind: 'detail', description: 'WD-01 frame' },
      { kind: 'detail', description: 'Stone top' },
      { kind: 'item', description: 'S02 Credenza' },
      { kind: 'detail', description: 'ST-01 top' },
    ])
  })
  it('two levels are item and detail; a flat list is all items', () => {
    expect(parseScope('Bar\n  Brass rail\nBack bar').map((x) => x.kind)).toEqual(['item', 'detail', 'item'])
    expect(parseScope('Bar\nBack bar\nPlanters').map((x) => x.kind)).toEqual(['item', 'item', 'item'])
  })
  it('are not levelled', () => {
    const l = [item('a'), item('d', 'detail'), item('b')]
    expect(levelTotals(l, [cell('d', { status: 'excluded', plug_amount: 999 })], [], 100).total).toBe(100)
  })
})

describe('levelTotals', () => {
  const items = [item('h', 'heading'), item('a'), item('b'), item('c')]
  it('is their price plus the plugs for excluded items plus below the line', () => {
    const cells = [cell('a', { status: 'included' }), cell('b', { status: 'excluded', plug_amount: 40000 }), cell('c', { status: 'excluded', plug_amount: 15000.5 })]
    const t = levelTotals(items, cells, [extra(2500), extra(-500)], 200000)
    expect(t.plugs).toBe(55000.5)
    expect(t.extras).toBe(2000)
    expect(t.total).toBe(257000.5)
    expect(t.excluded).toBe(2)
    expect(t.checked).toBe(3)
    expect(t.items).toBe(3)
  })
  it('ignores a plug on an item that is included', () => {
    expect(levelTotals(items, [cell('a', { status: 'included', plug_amount: 999 })], [], 1000).total).toBe(1000)
  })
  it('uses the sum of their item prices when there is no overall quote', () => {
    const t = levelTotals(items, [cell('a', { status: 'included', their_amount: 100 }), cell('b', { status: 'included', their_amount: 50.25 })], [], null)
    expect(t.quoted).toBe(150.25)
    expect(t.total).toBe(150.25)
  })
  it('ignores cells for items no longer in the scope', () => {
    expect(levelTotals(items, [cell('gone', { status: 'excluded', plug_amount: 500 })], [], 1000).total).toBe(1000)
  })
})
