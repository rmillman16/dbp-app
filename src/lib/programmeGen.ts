// A simple programme made from the SoW, for jobs with no programme yet (Richard, 21 Nov: "if there
// is not one made, can you generate a simple one based on the uploaded SoW for procurement and
// cashflow to be made from"). One or two activities per trade in the SoW, placed on a typical
// fit-out sequence between start on site and PC (as a share of the working days): strip out and
// structure first, M&E first fix and dry lining, then joinery, finishes and M&E second fix, then
// commissioning, snags and cleans. Each activity is named after its trade, so the cashflow and
// procurement pick it up for that trade. Importing the real programme replaces it.
import { addWorkingDays } from './cashflowCalc'
import type { ParsedProgramme, ProgrammeTask } from './programme'

export const GENERATED_FILE = 'Simple programme from the SoW'

type Part = { suffix: string; from: number; to: number } // share of the site period
const TEMPLATE: [RegExp, Part[]][] = [
  [/strip|demoli/i, [{ suffix: '', from: 0, to: 0.15 }]],
  [/structur|steel|builders|diamond|drill|bwic/i, [{ suffix: '', from: 0.05, to: 0.25 }]],
  [/fire\s*stop/i, [{ suffix: '', from: 0.45, to: 0.7 }]],
  [
    /mechanical|hvac|ventilat|air\s*con/i,
    [
      { suffix: ' – first fix', from: 0.12, to: 0.45 },
      { suffix: ' – second fix', from: 0.62, to: 0.9 },
    ],
  ],
  [
    /electric|lighting/i,
    [
      { suffix: ' – first fix', from: 0.12, to: 0.45 },
      { suffix: ' – second fix', from: 0.62, to: 0.9 },
    ],
  ],
  [
    /plumb|drain|sprinkler/i,
    [
      { suffix: ' – first fix', from: 0.12, to: 0.42 },
      { suffix: ' – second fix', from: 0.65, to: 0.9 },
    ],
  ],
  [/dry\s*lin|partition|ceiling|plaster/i, [{ suffix: '', from: 0.22, to: 0.6 }]],
  [/screed/i, [{ suffix: '', from: 0.25, to: 0.35 }]],
  [/sanitary/i, [{ suffix: ' – installation', from: 0.75, to: 0.92 }]],
  [/joinery|banquette|fitted|millwork|cabinet/i, [{ suffix: ' – installation', from: 0.55, to: 0.9 }]],
  [/door|ironmongery/i, [{ suffix: ' – installation', from: 0.6, to: 0.85 }]],
  [/tile|tiling/i, [{ suffix: '', from: 0.55, to: 0.8 }]],
  [/marble|stone|terrazzo/i, [{ suffix: '', from: 0.6, to: 0.85 }]],
  [/floor|carpet|vinyl|microcement/i, [{ suffix: '', from: 0.6, to: 0.85 }]],
  [/decorat|paint|wall\s*finish|specialist finish/i, [{ suffix: '', from: 0.65, to: 0.95 }]],
  [/glass|glazing|mirror|screen/i, [{ suffix: ' – installation', from: 0.65, to: 0.9 }]],
  [/metalwork|balustrade|handrail/i, [{ suffix: ' – installation', from: 0.55, to: 0.85 }]],
  [/\blift\b/i, [{ suffix: ' – installation', from: 0.35, to: 0.85 }]],
  [/sign/i, [{ suffix: ' – installation', from: 0.85, to: 0.95 }]],
  [/external|landscap/i, [{ suffix: '', from: 0.7, to: 0.95 }]],
]
const DEFAULT: Part[] = [{ suffix: '', from: 0.3, to: 0.8 }]
// not trades on a programme: prelims, DBP's own labour / materials, skips, sums and adjustments
const NOT_A_TRADE = /prelim|^(dub\s+)?labour$|^(dub\s+)?materials$|skip|provision|prov\s*sum|^ep$|contingency|omission|difference|adjust|oh&p|ohp/i

const sectionOf = (from: number) => (from < 0.1 ? 'Enabling & structure' : from < 0.5 ? 'First fix' : from < 0.86 ? 'Finishes & second fix' : 'Completion')

// working days (Mon–Fri) from start to finish
function workingDays(start: string, finish: string) {
  let n = 0
  const d = new Date(`${start}T00:00:00Z`)
  const end = new Date(`${finish}T00:00:00Z`)
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++
  return n
}

export function simpleProgramme(trades: string[], start: string, pc: string, projectName: string): ParsedProgramme {
  if (!start || !pc || pc <= start) throw new Error('A simple programme needs a start on site date and a PC date after it.')
  const days = Math.max(1, workingDays(start, pc) - 1)
  const at = (share: number) => addWorkingDays(start, Math.round(share * days))
  const tasks: ProgrammeTask[] = []
  const add = (name: string, from: number, to: number, trade: string | null, milestone = false) =>
    tasks.push({ code: '', name, section: sectionOf(from), trade, start_date: at(from), finish_date: milestone ? at(from) : at(to), milestone })

  add('Start on site', 0, 0, null, true)
  add('Site set-up & mobilisation', 0, 0.04, null)
  const seen = new Set<string>()
  for (const t of trades) {
    const name = t.trim()
    if (!name || NOT_A_TRADE.test(name) || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    for (const p of TEMPLATE.find(([re]) => re.test(name))?.[1] ?? DEFAULT) add(`${name}${p.suffix}`, p.from, p.to, name)
  }
  add('Testing & commissioning', 0.88, 0.97, null)
  add('Snagging & cleans', 0.93, 1, null)
  add('Practical Completion', 1, 1, null, true)

  // in date order, numbered as a P6 programme would be (G1010, G1020…)
  tasks.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.finish_date.localeCompare(b.finish_date))
  tasks.forEach((t, i) => (t.code = `G${1010 + i * 10}`))
  return { project_name: `${projectName} (simple programme from the SoW)`, start_date: start, finish_date: pc, tasks }
}
