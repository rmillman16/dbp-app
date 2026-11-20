import { supabase } from './supabase'
import { cached, must } from './offline'
import type { Job, Variation, VariationLine } from './types'

// VO build-up, as on the VO sheet:
//   OMIT lines (negative) + ADD lines = sub-total
//   + OHP % of sub-total               = marked-up sub-total
//   + prelims % of marked-up sub-total = variation total
// Matches the variation_totals view in the database.

export function lineTotal(l: Pick<VariationLine, 'qty' | 'rate'>): number {
  return Math.round((l.qty ?? 1) * (l.rate ?? 0) * 100) / 100
}

export interface BuildUp {
  omitSubtotal: number // negative or zero
  addSubtotal: number
  subtotal: number
  ohpPct: number
  ohp: number
  markedUp: number
  prelimsPct: number
  prelims: number
  total: number
  priced: boolean // a firm price exists once there is at least one line
}

export function buildUp(lines: VariationLine[], v: Pick<Variation, 'ohp_pct' | 'prelims_pct'>, job: Pick<Job, 'ohp_pct' | 'prelims_pct'>): BuildUp {
  const omitSubtotal = -lines.filter((l) => l.section === 'omit').reduce((s, l) => s + lineTotal(l), 0)
  const addSubtotal = lines.filter((l) => l.section === 'add').reduce((s, l) => s + lineTotal(l), 0)
  const subtotal = omitSubtotal + addSubtotal
  const ohpPct = Number(v.ohp_pct ?? job.ohp_pct)
  const prelimsPct = Number(v.prelims_pct ?? job.prelims_pct)
  const ohp = (subtotal * ohpPct) / 100
  const markedUp = subtotal + ohp
  const prelims = (markedUp * prelimsPct) / 100
  return {
    omitSubtotal,
    addSubtotal,
    subtotal,
    ohpPct,
    ohp,
    markedUp,
    prelimsPct,
    prelims,
    total: markedUp + prelims,
    priced: lines.length > 0,
  }
}

// What a VO adds to the final account: firm price once priced, budget until then, nothing if rejected.
export function projectedValue(v: Variation, b: BuildUp): number {
  if (v.status === 'rejected') return 0
  return b.priced ? b.total : Number(v.budget_value ?? 0)
}

export interface VoWithLines {
  vo: Variation
  lines: VariationLine[]
  build: BuildUp
}

export async function loadJobVariations(job: Job): Promise<VoWithLines[]> {
  const { vos, lines } = await cached(`vos:${job.id}`, async () => {
    const vos = await must<Variation[]>(supabase.from('variations').select('*').eq('job_id', job.id).order('vo_no'))
    const ids = vos.map((v) => v.id)
    const lines = ids.length ? await must<VariationLine[]>(supabase.from('variation_lines').select('*').in('variation_id', ids).order('sort')) : []
    return { vos, lines }
  })
  return vos.map((vo) => {
    const own = lines.filter((l) => l.variation_id === vo.id)
    return { vo, lines: own, build: buildUp(own, vo, job) }
  })
}
