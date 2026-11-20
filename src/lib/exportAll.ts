// "Export all data": every table in the database as one Excel workbook, a tab per
// table plus a cover tab with the date and row counts. A safety copy until
// Supabase's paid plan (daily backups) is switched on, and handy for audits.
import { supabase } from './supabase'
import { todayIso, ukDate } from './format'

// Every table in public, in the order of supabase/001 (+ later scripts). Add new tables here.
export const ALL_TABLES = [
  'profiles', 'company_settings', 'company_insurances', 'text_templates', 'companies', 'contacts',
  'enquiries', 'jobs', 'job_team', 'job_directory', 'sow_revisions', 'packages', 'sow_lines',
  'variations', 'variation_lines', 'tc_clauses', 'quotations', 'quotation_lines', 'quotation_clauses',
  'applications', 'application_lines', 'orders', 'sub_variations', 'sub_applications', 'sub_application_lines',
  'payment_notices', 'payment_notice_adjustments', 'cashflow_issues', 'cost_imports', 'cost_lines',
  'cvrs', 'cvr_vo_allocations', 'supplier_packages', 'cvr_package_forecasts', 'cvr_budget_lines', 'delay_events', 'eot_claims', 'eot_claim_events', 'procurement_items',
  'finish_schedules', 'samples', 'om_doc_types', 'om_requirements', 'progress_reports', 'notifications',
]

const PAGE = 1000

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data as Record<string, unknown>[]))
    if (data.length < PAGE) return rows
  }
}

export async function exportAllData(onProgress: (msg: string) => void) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'du Boulay Projects'
  const cover = wb.addWorksheet('Export')
  cover.columns = [
    { header: 'Table', key: 'table', width: 30 },
    { header: 'Rows', key: 'rows', width: 10 },
    { header: 'Note', key: 'note', width: 60 },
  ]
  cover.getRow(1).font = { bold: true }

  let total = 0
  for (const [i, table] of ALL_TABLES.entries()) {
    onProgress(`Reading ${table} (${i + 1} of ${ALL_TABLES.length})…`)
    let rows: Record<string, unknown>[]
    try {
      rows = await fetchAll(table)
    } catch (e) {
      cover.addRow({ table, rows: '', note: `Not exported: ${(e as Error).message}` })
      continue
    }
    total += rows.length
    cover.addRow({ table, rows: rows.length, note: '' })
    const ws = wb.addWorksheet(table.slice(0, 31))
    const cols = rows.length ? Object.keys(rows[0]) : []
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 2)) }))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    for (const r of rows) {
      // lists and objects (e.g. package costs) are kept as text so nothing is lost
      ws.addRow(Object.fromEntries(cols.map((c) => [c, r[c] != null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]])))
    }
  }

  cover.insertRow(1, [`du Boulay Projects app · all data exported ${ukDate(todayIso())} ${new Date().toLocaleTimeString('en-GB')} · ${total} rows`])
  cover.getRow(1).font = { bold: true, size: 13 }
  cover.insertRow(2, [])

  onProgress('Building the file…')
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `DBP app data export ${todayIso()}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
  return total
}
