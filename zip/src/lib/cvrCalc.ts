// The CVR sums (docs/decisions.md "CVR: built"). Kept free of the database so it can be tested
// on its own. For each cost package:
//   target   = typed target, else the orders placed against it (order value + instructed
//              subcontract variations), else EP at a % of the contract sum, else the SoW budget;
//              plus the cost of agreed VOs allocated to it
//   cost     = iPlicit Final Total Costs of the suppliers allocated to it (by share)
//   forecast = the month's typed forecast, else the larger of target and cost: an overspend
//              shows and reduces the margin (agreed 20 Nov; the KOSH sheet let it go negative)
// OH&P, DuB management and DuB design are shown and omitted (forecast 0). Nothing is dropped:
// costs not yet allocated, and agreed VOs not given a package, still count in the total cost.
// Value = the SoW total + agreed VOs (agreed only, 20 Nov) + possible reduction / negotiations.
// The SoW total, not the contract sum typed on the job (Richard, 21 Nov), which is only flagged
// when it differs.
// Preliminaries (agreed 20 Nov): the SoW prices prelims as one lump, kept as a "remainder"
// package ("Preliminaries – not yet split"). The prelims sections (packages in the same group
// with no budget of their own) draw it down: the lump's target is its budget less the sections'
// forecasts, and an overspend shows once the group passes the whole prelims budget. A section
// with a typed target is its own budget and flags its own overspend.

export type Kind = 'cost' | 'omit' | 'ep'
export type Group = 'labour_materials' | 'subcontract' | 'prelims' | 'other'

export const GROUP_LABELS: Record<Group, string> = {
  labour_materials: 'Labour & materials',
  subcontract: 'Subcontractors',
  prelims: 'Preliminaries',
  other: 'Other',
}
export const GROUP_ORDER: Group[] = ['labour_materials', 'subcontract', 'prelims', 'other']

// a typed group, else from the package's type and name
export function groupOf(p: { kind: Kind; name: string; cvr_group?: Group | null }): Group {
  if (p.cvr_group) return p.cvr_group
  const n = p.name.toLowerCase()
  // DuB management and design are prelims items, even though they're shown and omitted
  if (p.kind === 'omit' && /management|design/.test(n)) return 'prelims'
  if (p.kind !== 'cost' || /provision|prov sum|contingency/.test(n)) return 'other'
  if (/^subbie/.test(n)) return 'subcontract'
  if (/^(dub )?(labour|materials)$|builderswork/.test(n)) return 'labour_materials'
  if (/prelim|project manager|site manager|labourer|consumable|skip|plant|cleaning|expenses|welfare|mess|ppe|health & safety|protection|temporary|sundries|waste|management|coordination|it\/|office/.test(n))
    return 'prelims'
  return 'subcontract'
}

export const byGroupThenName = (a: { group: Group; name: string }, b: { group: Group; name: string }) =>
  GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.name.localeCompare(b.name, 'en-GB', { numeric: true, sensitivity: 'base' })

export interface CalcPackage {
  id: string
  name: string
  kind: Kind
  budget: number | null
  target: number | null // typed
  target_note: string | null
  supplier_note: string | null
  sort: number
  cvr_group?: Group | null
  is_remainder?: boolean
}
export interface CalcOrder {
  package_id: string | null
  label: string // "Logik Ceilings Ltd (Drylining)"
  order_value: number | null
  instructed_variations: number // instructed subcontract variations
}
export interface CalcVo {
  id: string
  label: string // "VO 3 – Extra joinery"
  value: number // what it adds to the final account
  cost: number // build-up before OH&P and prelims
  package_id: string | null
}
export interface CalcCost {
  supplier_code: string
  supplier_name: string
  total_cost: number
  last_reported: number | null
}
export interface Allocation {
  supplier_code: string
  supplier_name: string
  package_id: string
  share: number
  amount?: number | null // set = split by £ (fixed), else by share (script 017)
}
export interface Forecast {
  package_id: string
  forecast: number | null
  note: string | null
}

export interface CalcInput {
  contractSum: number // the SoW total (Richard, 21 Nov: "always on the SoW plus agreed variations")
  budgetTotal: number | null // office SoW total the budgets came from
  enteredContractSum?: number | null // the contract sum typed on the job, only to flag a difference
  epPct: number
  packages: CalcPackage[]
  orders: CalcOrder[]
  vos: CalcVo[] // agreed VOs only
  allocations: Allocation[]
  costs: CalcCost[] // this month's job costing report
  previousCosts: CalcCost[] | null // last CVR's report (null if this is the first)
  forecasts: Forecast[]
  possibleReduction: number
  certified: { gross: number; retention: number; label: string } | null
  programme: { start: string | null; originalPc: string | null; revisedPc: string | null }
}

export type TargetSource = 'typed' | 'order' | 'ep' | 'budget' | 'omitted' | 'drawdown' | 'remainder'

export interface PackageRow {
  id: string
  name: string
  kind: Kind
  group: Group
  budget: number
  source: TargetSource
  sourceNote: string // "Logik Ceilings Ltd order", "4% of contract sum", the typed note…
  voCost: number
  target: number
  cost: number
  forecast: number
  forecastNote: string | null
  forecastTyped: boolean
  stillToCome: number
  overrun: number // forecast above target
  suppliers: string[]
  supplierNote: string | null
}

export interface SupplierRow {
  key: string // code|name
  code: string
  name: string
  total: number
  previous: number | null
  movement: number | null // this month less last (positive = cost went up)
  packages: { id: string; name: string; share: number; amount?: number | null }[] // amount set = split by £
  unallocated: number // the part not allocated to a package (minus if a £ split is more than the cost)
}

export interface CvrResult {
  packages: PackageRow[]
  unallocatedVos: { label: string; cost: number }[]
  suppliers: SupplierRow[]
  unallocatedCost: number
  totals: { budget: number; target: number; cost: number; forecast: number; stillToCome: number; overrun: number }
  jcTotal: number
  movement: number | null
  tender: { contractSum: number; ohp: number; ohpPct: number; omitted: number }
  value: { contractSum: number; agreedVos: number; possibleReduction: number; afv: number }
  totalCost: number
  margin: number
  marginPct: number
  certified: CalcInput['certified']
  programme: { start: string | null; originalPc: string | null; originalWeeks: number | null; revisedPc: string | null; weeksDelay: number | null }
  warnings: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
export const supplierKey = (c: Pick<CalcCost, 'supplier_code' | 'supplier_name'>) => `${c.supplier_code.trim()}|${c.supplier_name.trim()}`
const weeks = (from: string | null, to: string | null) =>
  from && to ? Math.round(((Date.parse(to) - Date.parse(from)) / 86400000 / 7) * 100) / 100 : null
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function computeCvr(i: CalcInput): CvrResult {
  const warnings: string[] = []
  const byId = new Map(i.packages.map((p) => [p.id, p]))

  // ---- costs to packages ----
  const prev = i.previousCosts ? new Map(i.previousCosts.map((c) => [supplierKey(c), c.total_cost])) : null
  const costOf = new Map<string, number>()
  const suppliersOf = new Map<string, string[]>()
  let unallocatedCost = 0
  const suppliers: SupplierRow[] = i.costs.map((c) => {
    const key = supplierKey(c)
    const mine = i.allocations.filter((a) => supplierKey(a) === key && byId.has(a.package_id))
    // split by £ (fixed amounts) or by share of whatever the cost is this month
    const byAmount = mine.some((a) => a.amount != null)
    const part = (a: Allocation) => (byAmount ? Number(a.amount ?? 0) : c.total_cost * a.share)
    let unallocated: number
    if (byAmount) {
      const split = r2(mine.reduce((s, a) => s + Number(a.amount ?? 0), 0))
      unallocated = r2(c.total_cost - split)
      if (unallocated < -0.005) warnings.push(`${c.supplier_name}'s split by £ (${gbp(split)}) is more than its cost (${gbp(c.total_cost)}): update its split.`)
      else if (unallocated > 0.005) warnings.push(`${c.supplier_name}'s cost (${gbp(c.total_cost)}) has moved on from its split by £ (${gbp(split)}): ${gbp(unallocated)} isn't allocated. Update its split.`)
    } else {
      const shares = mine.reduce((s, a) => s + a.share, 0)
      if (shares > 1.0001) warnings.push(`${c.supplier_name} is allocated ${Math.round(shares * 100)}% (more than 100%): check its split.`)
      unallocated = r2(c.total_cost * Math.max(0, 1 - shares))
    }
    for (const a of mine) {
      costOf.set(a.package_id, (costOf.get(a.package_id) ?? 0) + part(a))
      const label = byAmount ? (mine.length > 1 ? `${c.supplier_name} (${gbp(part(a))})` : c.supplier_name) : a.share < 1 ? `${c.supplier_name} (${Math.round(a.share * 100)}%)` : c.supplier_name
      suppliersOf.set(a.package_id, [...(suppliersOf.get(a.package_id) ?? []), label])
    }
    unallocatedCost += unallocated
    const previous = prev ? (prev.get(key) ?? 0) : c.last_reported
    return {
      key,
      code: c.supplier_code,
      name: c.supplier_name,
      total: c.total_cost,
      previous,
      movement: previous == null ? null : r2(c.total_cost - previous),
      packages: mine.map((a) => ({ id: a.package_id, name: byId.get(a.package_id)!.name, share: a.share, amount: byAmount ? Number(a.amount ?? 0) : null })),
      unallocated,
    }
  })
  // a supplier on last month's report but not this month's (shouldn't happen: costs don't disappear)
  if (i.previousCosts)
    for (const c of i.previousCosts)
      if (c.total_cost && !i.costs.some((x) => supplierKey(x) === supplierKey(c))) warnings.push(`${c.supplier_name} (${gbp(c.total_cost)} last month) isn't on this month's report.`)
  // (a £ split that no longer adds up has its own warning above)
  const notAllocated = suppliers.filter((s) => s.unallocated && !s.packages.some((p) => p.amount != null))
  if (notAllocated.length)
    warnings.push(
      `${notAllocated.length} supplier${notAllocated.length === 1 ? '' : 's'} not allocated to a package yet (${gbp(r2(notAllocated.reduce((s, x) => s + x.unallocated, 0)))}): counted in the total cost, but allocate them so each package is right.`,
    )

  // ---- agreed VOs ----
  const voCostOf = new Map<string, number>()
  const unallocatedVos: CvrResult['unallocatedVos'] = []
  for (const v of i.vos) {
    if (v.package_id && byId.has(v.package_id)) voCostOf.set(v.package_id, (voCostOf.get(v.package_id) ?? 0) + v.cost)
    else unallocatedVos.push({ label: v.label, cost: v.cost })
  }
  if (unallocatedVos.length) warnings.push(`${unallocatedVos.length} agreed VO${unallocatedVos.length === 1 ? '' : 's'} not given a package: their cost is counted on its own line.`)

  // ---- packages ----
  const forecastOf = new Map(i.forecasts.filter((f) => f.forecast != null).map((f) => [f.package_id, f]))
  const remainderGroups = new Set(i.packages.filter((p) => p.is_remainder && p.kind === 'cost').map((p) => groupOf(p)))
  // a prelims section: no budget or order of its own, in a group whose lump it draws down
  const drawsDown = (p: CalcPackage) =>
    !p.is_remainder && p.kind === 'cost' && !Number(p.budget ?? 0) && remainderGroups.has(groupOf(p)) && !i.orders.some((o) => o.package_id === p.id)

  const row = (p: CalcPackage, drawn = 0): PackageRow => {
    const cost = r2(costOf.get(p.id) ?? 0)
    const voCost = r2(voCostOf.get(p.id) ?? 0)
    const budget = Number(p.budget ?? 0)
    let source: TargetSource
    let sourceNote = ''
    let base: number
    const drawing = drawsDown(p) && p.target == null
    if (p.is_remainder && p.target == null) {
      source = 'remainder'
      base = Math.max(0, budget - drawn)
      sourceNote = drawn ? `${gbp(budget)} prelims budget less ${gbp(r2(drawn))} drawn by the sections` : `${gbp(budget)} prelims budget (sections draw on it)`
    } else if (drawing) {
      source = 'drawdown'
      base = 0
      sourceNote = 'Draws on the prelims budget'
    } else if (p.kind === 'omit') {
      source = 'omitted'
      base = 0
      sourceNote = 'Shown and omitted'
      if (cost) warnings.push(`${gbp(cost)} is allocated to ${p.name}, which is omitted from the budget (it's in the margin): the cost still counts, so it reduces the margin.`)
    } else if (p.target != null) {
      source = 'typed'
      base = Number(p.target)
      sourceNote = p.target_note || 'Typed target'
    } else {
      const orders = i.orders.filter((o) => o.package_id === p.id)
      if (orders.length) {
        source = 'order'
        base = orders.reduce((s, o) => s + Number(o.order_value ?? 0) + o.instructed_variations, 0)
        sourceNote = orders.map((o) => `${o.label}${o.instructed_variations ? ` incl. ${gbp(o.instructed_variations)} variations` : ''}`).join('; ')
      } else if (p.kind === 'ep') {
        source = 'ep'
        base = r2((i.contractSum * i.epPct) / 100)
        sourceNote = `${i.epPct}% of the contract sum`
      } else {
        source = 'budget'
        base = budget
        sourceNote = 'SoW budget'
      }
    }
    const target = r2(base + voCost)
    const typed = forecastOf.get(p.id)
    const forecast = typed ? Number(typed.forecast) : p.kind === 'omit' ? cost : Math.max(target, cost)
    if (typed && forecast < cost) warnings.push(`${p.name}: the forecast (${gbp(forecast)}) is below the cost to date (${gbp(cost)}).`)
    // sections drawing down and the lump itself: the overspend is judged on the whole prelims group
    const ownOverrun = !drawing && !(p.is_remainder && p.target == null) && p.kind !== 'omit'
    if (!typed && cost > target && ownOverrun) warnings.push(`${p.name} is over its target by ${gbp(r2(cost - target))}.`)
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      group: groupOf(p),
      budget,
      source,
      sourceNote,
      voCost,
      target,
      cost,
      forecast: r2(forecast),
      forecastNote: typed?.note ?? null,
      forecastTyped: !!typed,
      stillToCome: r2(forecast - cost),
      overrun: ownOverrun ? r2(Math.max(0, forecast - target)) : 0,
      suppliers: suppliersOf.get(p.id) ?? [],
      supplierNote: p.supplier_note,
    }
  }

  // sections first, then each lump less what its sections have drawn
  const ordered = [...i.packages].sort((a, b) => a.sort - b.sort)
  const rows = new Map(ordered.filter((p) => !p.is_remainder).map((p) => [p.id, row(p)]))
  for (const lump of ordered.filter((p) => p.is_remainder)) {
    const g = groupOf(lump)
    const sections = ordered.filter((p) => drawsDown(p) && groupOf(p) === g).map((p) => rows.get(p.id)!)
    const drawn = sections.reduce((s, x) => s + x.forecast - x.overrun, 0)
    const r = lump.target != null ? row(lump) : row(lump, drawn)
    // the group's overspend (beyond sections' own typed targets) shows on the lump
    const excess = r2(drawn + r.forecast - (r.budget + r.voCost))
    if (lump.target == null && excess > 0.005) {
      r.overrun = excess
      warnings.push(`${GROUP_LABELS[g]} are over the prelims budget (${gbp(r.budget + r.voCost)}) by ${gbp(excess)}.`)
    }
    rows.set(lump.id, r)
  }
  // by group (Labour & materials, Subcontractors, Preliminaries, Other), then alphabetically
  const packages: PackageRow[] = ordered.map((p) => rows.get(p.id)!).sort(byGroupThenName)

  const sum = (f: (p: PackageRow) => number) => r2(packages.reduce((s, p) => s + f(p), 0))
  const voUnallocatedCost = r2(unallocatedVos.reduce((s, v) => s + v.cost, 0))
  const totalCost = r2(sum((p) => p.forecast) + voUnallocatedCost + unallocatedCost)
  const jcTotal = r2(i.costs.reduce((s, c) => s + c.total_cost, 0))

  // ---- value and margin ----
  const agreedVos = r2(i.vos.reduce((s, v) => s + v.value, 0))
  const afv = r2(i.contractSum + agreedVos + i.possibleReduction)
  const margin = r2(afv - totalCost)
  const ohp = sum((p) => (p.kind === 'omit' && /^(oh&p|ohp|overh)/i.test(p.name) ? p.budget : 0))

  if (i.budgetTotal != null && Math.abs(i.budgetTotal - i.contractSum) > 1)
    warnings.push(`The SoW total (${gbp(i.contractSum)}) isn't the office SoW total the budgets came from (${gbp(i.budgetTotal)}): the budgets may be from a different revision.`)
  if (i.enteredContractSum != null && Math.abs(i.enteredContractSum - i.contractSum) > 1)
    warnings.push(
      `The contract sum entered on the job (${gbp(i.enteredContractSum)}) isn't the SoW total (${gbp(i.contractSum)}): the CVR uses the SoW total plus agreed variations. Check the job's contract sum.`,
    )
  if (!i.packages.length) warnings.push('No budgets yet: import the office SoW first.')

  return {
    packages,
    unallocatedVos,
    suppliers,
    unallocatedCost: r2(unallocatedCost),
    totals: {
      budget: sum((p) => p.budget),
      target: sum((p) => p.target),
      cost: sum((p) => p.cost),
      forecast: sum((p) => p.forecast),
      stillToCome: sum((p) => p.stillToCome),
      overrun: sum((p) => p.overrun),
    },
    jcTotal,
    movement: suppliers.some((s) => s.movement != null) ? r2(suppliers.reduce((s, x) => s + (x.movement ?? 0), 0)) : null,
    tender: { contractSum: i.contractSum, ohp, ohpPct: i.contractSum ? ohp / i.contractSum : 0, omitted: sum((p) => (p.kind === 'omit' ? p.budget : 0)) },
    value: { contractSum: i.contractSum, agreedVos, possibleReduction: i.possibleReduction, afv },
    totalCost,
    margin,
    marginPct: afv ? margin / afv : 0,
    certified: i.certified,
    programme: {
      start: i.programme.start,
      originalPc: i.programme.originalPc,
      originalWeeks: weeks(i.programme.start, i.programme.originalPc),
      revisedPc: i.programme.revisedPc,
      weeksDelay: weeks(i.programme.originalPc, i.programme.revisedPc ?? i.programme.originalPc),
    },
    warnings,
  }
}
