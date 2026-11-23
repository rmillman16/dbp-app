// Reading a subcontractor's application from Excel (23 Nov), the same result as reading their PDF: lines in three
// blocks (contract works / materials on site / variations) with value, their % and £ claimed, and their stated totals.
// No AI and nothing sent anywhere: it finds the header row, works out which column is which from the headings, picks up
// section headings, and takes the totals from the summary rows. Layouts vary, so anything doubtful is reported
// ("Check them against their file") rather than guessed silently.
import { readSheets } from './xlsxText'
import type { AppPdfResult } from './readPdf'

type Line = AppPdfResult['lines'][number]
interface Cols {
  ref: number | null
  desc: number
  value: number | null
  pct: number | null
  amount: number | null
}

// "1,200.00", "£1200", "(200)", "40%" → number (and whether it was written as a %)
function num(s: string | undefined): { n: number; pct: boolean } | null {
  if (s == null) return null
  let t = s.replace(/[£,\s]/g, '')
  if (!t) return null
  const pct = t.endsWith('%')
  if (pct) t = t.slice(0, -1)
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1)
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null
  return { n: Number(t), pct }
}
const lc = (s: string | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// which column is which, from one row of headings
function classify(row: string[]): { cols: Cols; score: number } | null {
  const pcts: number[] = []
  const amounts: number[] = []
  const values: number[] = []
  let ref: number | null = null
  let desc: number | null = null
  row.forEach((cell, i) => {
    const t = lc(cell)
    if (!t) return
    if (/%|percent|\bpct\b|complete/.test(t)) pcts.push(i)
    else if (/to date|cumul|gross|claim|valuation|amount|£|this (app|period|month)|certif|total/.test(t) && !/contract|order value|budget/.test(t)) amounts.push(i)
    else if (/contract|order|budget|price|value|sum|quot|agreed|tender/.test(t)) values.push(i)
    else if (/^(ref|item|no\.?|nr|number|code|line)\b/.test(t) && ref == null) ref = i
    else if (/desc|detail|works?|element|trade|particulars/.test(t) && desc == null) desc = i
  })
  // when "total" headings and a plain value heading share the sheet, the value is the plain one
  const best = (list: number[], prefer: RegExp) => list.find((i) => prefer.test(lc(row[i]))) ?? (list.length ? list[list.length - 1] : null)
  const pct = best(pcts, /to date|cumul|total|current|overall/)
  const amount = best(amounts, /to date|cumul|gross|total|claim|valuation/)
  const value = values[0] ?? null
  const score = Number(pct != null) + Number(amount != null) + Number(value != null) + Number(desc != null || ref != null)
  if (score < 3 || (pct == null && amount == null)) return null
  const text = desc ?? (ref != null ? ref + 1 : 0)
  return { cols: { ref, desc: text === ref ? text + 1 : text, value, pct, amount }, score }
}

const TOTAL_LABEL = /^(sub-?totals?|totals?|grand total|carried|brought)\b/
const isGross = (t: string) => /\b(gross|total (claimed|valuation|to date|application)|valuation to date|gross valuation)\b/.test(t)
const isPrevious = (t: string) => /\b(previous|prev\.?|less (previous|paid|payments?)|paid to date|previously)\b/.test(t)
const isDue = (t: string) => /\b(amount due|net (amount|payable|due)|total (due|payable)|due (this|now)|payable|balance due|now due)\b/.test(t)
const isIgnoredSummary = (t: string) => /^(retention|less retention|vat|cis|discount|add vat|total (excl|incl)|net of)\b/.test(t)

export async function readApplicationXlsx(file: File): Promise<AppPdfResult> {
  const sheets = await readSheets(await file.arrayBuffer())
  // the sheet with a recognisable header row and the most lines under it
  let pick: { sheet: string; rows: string[][]; at: number; cols: Cols; lines: number } | null = null
  for (const s of sheets) {
    for (let r = 0; r < Math.min(s.rows.length, 60); r++) {
      const c = classify(s.rows[r] ?? [])
      if (!c) continue
      const lines = s.rows.slice(r + 1).filter((row) => num(row[c.cols.amount ?? c.cols.value ?? -1]) != null).length
      if (!pick || lines > pick.lines) pick = { sheet: s.name, rows: s.rows, at: r, cols: c.cols, lines }
      break
    }
  }
  if (!pick || pick.lines === 0)
    throw new Error("Couldn't find their application's lines in that Excel file (no heading row with value, % and amount columns). Use \"Paste rows from Excel\" under each block, or send the PDF.")

  const { cols } = pick
  const out: Line[] = []
  const warnings: string[] = []
  let block: Line['block'] = 'measured'
  let heading: string | null = null
  let gross: number | null = null
  let previous: number | null = null
  let due: number | null = null
  let date: string | null = null

  // the date, if one sits above the heading row ("Application date: 30/10/2026" / "30.10.2026")
  for (const row of pick.rows.slice(0, pick.at)) {
    const text = row.join(' ')
    const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(text)
    if (m && /date|application|valuation/i.test(text)) {
      date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
      break
    }
  }

  for (const row of pick.rows.slice(pick.at + 1)) {
    const ref = cols.ref != null ? (row[cols.ref] ?? '').trim() : ''
    const desc = (row[cols.desc] ?? '').trim()
    const label = lc(desc || ref)
    const value = cols.value != null ? num(row[cols.value]) : null
    const pct = cols.pct != null ? num(row[cols.pct]) : null
    const amount = cols.amount != null ? num(row[cols.amount]) : null
    const figures = value != null || pct != null || amount != null
    if (!label && !figures) continue

    // summary rows: their stated totals (the label may be in any column, so look at the whole row's text)
    const rowText = lc(row.filter((c) => c && num(c) == null).join(' '))
    const money = amount?.n ?? value?.n ?? null
    if (money != null && (isGross(rowText) || isPrevious(rowText) || isDue(rowText))) {
      if (isDue(rowText)) due = money
      else if (isPrevious(rowText)) previous = Math.abs(money)
      else if (isGross(rowText)) gross = money
      continue
    }
    if (isIgnoredSummary(label) || TOTAL_LABEL.test(label)) continue

    if (!figures) {
      // a section heading; some switch the block
      heading = [ref, desc].filter(Boolean).join(' ') || heading
      const h = heading ?? ''
      if (/variation/i.test(h)) block = 'variations'
      else if (/materials?.*(site|stored|off)|\bmos\b|stored material/i.test(h)) block = 'materials'
      else if (/contract works|main (contract|works)|measured|schedule of (works|rates)|\bsow\b|\bboq\b/i.test(h)) block = 'measured'
      continue
    }
    // a line with figures but nothing to say what it is
    if (!label) continue

    let p = pct == null ? null : pct.pct || pct.n > 1 ? pct.n / 100 : pct.n
    const v = value?.n ?? null
    let theirs = amount?.n ?? null
    if (theirs == null && v != null && p != null) theirs = Math.round(v * p * 100) / 100
    if (p == null && v && theirs != null) p = Math.round((theirs / v) * 10000) / 10000
    const isVar = block === 'variations' || /^(va|vo|v)\s?-?\d+$/i.test(ref)
    out.push({
      block: block === 'materials' ? 'materials' : isVar ? 'variations' : 'measured',
      heading,
      item_ref: ref || null,
      description: desc || ref,
      value: v,
      pct: p,
      their_amount: theirs,
      note: null,
    })
  }
  if (!out.length) throw new Error('That Excel file has the headings but no lines with figures under them.')
  if (cols.value == null) warnings.push('No value / contract sum column found: their values are blank.')
  if (cols.pct == null) warnings.push('No % column found: percentages worked out from value and amount.')
  if (cols.amount == null) warnings.push('No amount column found: amounts worked out from value × %.')
  if (gross == null && due == null) warnings.push("Their stated totals weren't found: the gross / previous / due check boxes are blank.")
  warnings.unshift(`Read from the sheet "${pick.sheet}": check the % and £ columns are the ones to date (not just this month).`)
  return { app_date: date, stated_gross: gross, stated_previous: previous, stated_due: due, lines: out, warnings }
}
