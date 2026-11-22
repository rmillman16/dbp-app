// Reading a designer's finishes schedule from Excel into sampling items (22 Nov). Any designer's
// layout: the header row is found by its words, each column's meaning is guessed from its heading
// (and can be changed before importing), and an item on several levels (e.g. M-S101 on L00 and
// L01) becomes one sample with all its locations (decided 19 Nov). Kept free of the screen so it can
// be tested on its own. PDF schedules wait for the PDF-reading step (with IT).
import { MATERIAL_GROUPS, type ScheduleItem } from './sampling'

export type Field = 'code' | 'designer_ref' | 'group' | 'location' | 'description' | 'manufacturer' | 'product' | 'finish' | 'specification' | 'quantity'
export const FIELD_LABELS: Record<Field, string> = {
  code: 'Code',
  designer_ref: 'Designer ref',
  group: 'Category / material',
  location: 'Location / level',
  description: 'Description',
  manufacturer: 'Manufacturer / supplier',
  product: 'Product / range',
  finish: 'Finish / colour',
  specification: 'Specification',
  quantity: 'Quantity',
}
export type Mapping = Partial<Record<Field, number>> // field → column index

const TESTS: [Field, RegExp][] = [
  ['quantity', /\b(qty|quantity|quant)\b/i],
  ['location', /\b(location|level|floor|area|room|zone)\b/i],
  ['manufacturer', /\b(manufacturer|supplier|company|maker|brand|vendor)\b/i],
  ['product', /\b(product|range|model|collection|name)\b/i],
  ['group', /\b(category|material|group|type|trade)\b/i],
  ['designer_ref', /\b(sff|designer'?s? ref|spec(ification)? ref|drawing ref|ref(erence)?\.?)\b/i],
  ['code', /\b(code|item no|item number|item ref|tag|mark|key)\b/i],
  ['finish', /\b(finish|colou?r|texture)\b/i],
  ['specification', /\b(spec|specification|notes?)\b/i],
  ['description', /\b(description|item|element|component|use)\b/i],
]
const words = (v: unknown) => String(v ?? '').trim()

// the header row: the first of the top 40 rows naming at least three of the fields
export function findHeader(rows: unknown[][]) {
  let best = -1
  let bestScore = 0
  rows.slice(0, 40).forEach((r, i) => {
    const score = new Set(r.flatMap((c) => TESTS.filter(([, re]) => re.test(words(c))).map(([f]) => f))).size
    if (score > bestScore) ((best = i), (bestScore = score))
  })
  return bestScore >= 2 ? best : -1
}
// each field to the column whose heading fits it best (first match wins, one column per field)
export function guessMapping(headers: unknown[]): Mapping {
  const m: Mapping = {}
  const used = new Set<number>()
  for (const [field, re] of TESTS)
    headers.forEach((h, i) => {
      if (m[field] === undefined && !used.has(i) && re.test(words(h))) {
        m[field] = i
        used.add(i)
      }
    })
  // no code column but a designer ref: the ref is the code
  if (m.code === undefined && m.designer_ref !== undefined) ((m.code = m.designer_ref), delete m.designer_ref)
  return m
}

// the material group from the schedule's category, else from the code and description
const GROUP_WORDS: [string, RegExp][] = [
  ['Fabrics', /fabric|textile|upholster|leather|curtain|blind|drape|carpet tile|felt|vinyl fabric/i],
  ['Glass & mirrors', /glass|mirror|glazing|acrylic/i],
  ['Laminates & metal', /laminate|metal|brass|steel|stainless|bronze|alumin|chrome|nickel|copper|powder ?coat|hpl|formica/i],
  ['Paints', /paint|lacquer|stain|eggshell|emulsion|coating|ral\b|ncs\b|farrow|dulux/i],
  ['Stone, ceramic & composite', /stone|marble|granite|terrazzo|ceramic|porcelain|tile|quartz|corian|composite|limestone|slate|concrete|solid surface/i],
  ['Timber & veneers', /timber|wood|veneer|oak|walnut|ash|maple|plywood|mdf|parquet/i],
  ['Wall coverings', /wall ?covering|wallpaper|panelling|wall panel/i],
  ['Flooring', /floor|carpet|rug|lvt|vinyl|resin|screed|matting/i],
  ['Ironmongery & fittings', /ironmongery|handle|hinge|lock|pull|knob|fitting|hardware/i],
  ['Lighting & electrical', /light|lamp|luminaire|socket|switch|electrical/i],
]
export function guessGroup(...texts: (string | null | undefined)[]) {
  const t = texts.filter(Boolean).join(' ')
  const direct = MATERIAL_GROUPS.find((g) => g.toLowerCase() === t.trim().toLowerCase())
  if (direct) return direct
  return GROUP_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'Other'
}

// the items: one per code, its locations gathered from every row it's on
// a heading row in the schedule (22 Nov: "FABRIC" came in as a sample): words in the code column with no
// number, and nothing else filled in. It names the group for the items under it.
export function isHeading(code: string, others: string[]) {
  return !!code && !/\d/.test(code) && others.every((o) => !o)
}
// a heading as a material group: a standard one if it matches ("FABRIC" → Fabrics), else its own name
export function headingGroup(text: string) {
  const g = guessGroup(text)
  if (g !== 'Other') return g
  const t = text.trim().toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// the items: one per code, its locations gathered from every row it's on
export function buildItems(rows: unknown[][], m: Mapping): ScheduleItem[] {
  const get = (r: unknown[], f: Field) => (m[f] === undefined ? '' : words(r[m[f]!]))
  const out = new Map<string, ScheduleItem>()
  let heading: string | null = null
  for (const r of rows) {
    const code = get(r, 'code')
    if (!code || code.length > 40) continue
    const others = (['designer_ref', 'description', 'location', 'manufacturer', 'product', 'finish', 'specification', 'quantity'] as Field[]).map((f) => get(r, f))
    if (isHeading(code, others)) {
      heading = headingGroup(code)
      continue
    }
    const key = code.toUpperCase()
    const loc = get(r, 'location')
    const it = out.get(key)
    if (it) {
      if (loc && !it.locations.includes(loc)) it.locations.push(loc)
      continue
    }
    const spec = [get(r, 'manufacturer'), get(r, 'product'), get(r, 'finish'), get(r, 'specification')].filter(Boolean).join(' · ')
    const description = get(r, 'description') || null
    const fromColumn = guessGroup(get(r, 'group'))
    out.set(key, {
      code,
      designer_ref: m.designer_ref !== undefined ? get(r, 'designer_ref') || null : null,
      // the schedule's own category, then the heading it's under, then the description, then the code and specification
      material_group: fromColumn !== 'Other' ? fromColumn : (heading ?? [description, `${code} ${spec}`].map((t) => guessGroup(t)).find((g) => g !== 'Other') ?? 'Other'),
      locations: loc ? [loc] : [],
      description,
      specification: spec || null,
      quantity: get(r, 'quantity') || null,
    })
  }
  return [...out.values()]
}

// the workbook's sheets as rows of cell text: read straight from the file (xlsxText.ts), not through the
// Excel library, which failed on a designer's schedule (22 Nov: "Cannot read properties…")
export async function readWorkbook(file: File) {
  const { readSheets } = await import('./xlsxText')
  return readSheets(await file.arrayBuffer())
}
