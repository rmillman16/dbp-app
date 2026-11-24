// Excel exports of the H&S records (24 Nov): whatever the list shows, one row each, with the dates as real dates.
import { download, excelDate, fill, newWorkbook, safeName } from './excel'
import { ACCIDENT_KINDS, CONDITIONS, INSPECTION_RESULTS, PERSON_TYPES, RIDDOR, SEVERITIES, accidentRef, failCount, type AccidentReport, type DeliveryNote, type Inspection, type SiteDiary } from './hs'
import type { Job } from './types'

type Cell = string | number | Date | null
async function sheet(job: Job, title: string, cols: [string, number][], rows: Cell[][]) {
  const { wb } = await newWorkbook()
  const ws = wb.addWorksheet(title.slice(0, 30), { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] })
  ws.getCell('A1').value = `${job.job_no} ${job.code} ${job.name}: ${title}, issued ${new Date().toLocaleDateString('en-GB')}`
  ws.getCell('A1').font = { bold: true, size: 13 }
  cols.forEach(([h, w], i) => {
    const c = ws.getCell(2, i + 1)
    c.value = h
    c.font = { bold: true }
    c.alignment = { wrapText: true, vertical: 'middle' }
    fill(c, 'FFDCE6F1')
    ws.getColumn(i + 1).width = w
  })
  rows.forEach((r, k) =>
    r.forEach((v, i) => {
      const c = ws.getCell(3 + k, i + 1)
      c.value = v
      c.alignment = { vertical: 'top', wrapText: true }
      if (v instanceof Date) c.numFmt = 'dd/mm/yyyy'
    }),
  )
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } }
  await download(wb, `${safeName(`${job.job_no} ${job.code} ${title} ${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}`)}.xlsx`)
}

const d = (iso: string | null) => (iso ? excelDate(iso) : null)

export const exportDiaries = (job: Job, rows: SiteDiary[]) =>
  sheet(
    job,
    'Site diaries',
    [['Date', 12], ['Weather', 18], ['Temp', 8], ['Labour on site', 40], ['Total on site', 10], ['Work done', 50], ['Delays', 30], ['Instructions', 30], ['Visitors', 24], ['Deliveries', 24], ['Plant', 22], ['Health and safety', 34], ['Notes', 30]],
    rows.map((r) => [d(r.diary_date), r.weather, r.temperature, r.labour.filter((l) => l.number).map((l) => `${l.trade}${l.company ? ` (${l.company})` : ''}: ${l.number}`).join('\n'), r.labour.reduce((n, l) => n + (Number(l.number) || 0), 0), r.work_done, r.delays, r.instructions, r.visitors, r.deliveries, r.plant, r.safety, r.notes]),
  )

export const exportDeliveries = (job: Job, rows: DeliveryNote[]) =>
  sheet(
    job,
    'Delivery notes',
    [['Date', 12], ['Supplier', 26], ['Delivery note no.', 16], ['Order / PO', 14], ['Description', 44], ['Quantity', 14], ['Received by', 20], ['Condition', 22], ['Notes', 34]],
    rows.map((r) => [d(r.delivered_on), r.supplier, r.note_ref, r.order_ref, r.description, r.quantity, r.received_by, CONDITIONS.find(([k]) => k === r.condition)?.[1] ?? r.condition, r.notes]),
  )

export const exportInspections = (job: Job, rows: Inspection[]) =>
  sheet(
    job,
    'H&S inspections',
    [['Date', 12], ['Type', 24], ['Area', 20], ['Inspector', 20], ['Result', 24], ['Items failed', 10], ['Failed items', 44], ['Actions', 44], ['Actions due', 12], ['Actions closed', 12], ['Notes', 30]],
    rows.map((r) => [d(r.inspected_on), r.kind, r.area, r.inspector, INSPECTION_RESULTS.find(([k]) => k === r.result)?.[1] ?? r.result, failCount(r), r.items.filter((x) => x.result === 'fail').map((x) => `${x.q}${x.note ? `: ${x.note}` : ''}`).join('\n'), r.actions, d(r.actions_due), d(r.actions_closed_on), r.notes]),
  )

export const exportAccidents = (job: Job, rows: AccidentReport[]) =>
  sheet(
    job,
    'Accident reports',
    [['No.', 8], ['Date', 12], ['Time', 8], ['Type', 22], ['Where', 20], ['Person', 22], ['Who', 18], ['Company', 22], ['Trade', 16], ['Seriousness', 22], ['Injury', 34], ['Treatment', 30], ['Hospital', 9], ['Days off', 9], ['What happened', 50], ['Immediate cause', 30], ['Root cause', 30], ['Immediate action', 30], ['RIDDOR', 16], ['RIDDOR reported', 12], ['HSE ref', 14], ['Corrective actions', 40], ['Owner', 16], ['Do by', 12], ['Done on', 12], ['Reported by', 16], ['Investigated by', 16], ['Status', 9]],
    rows.map((r) => [
      accidentRef(r.number), d(r.incident_on), r.incident_time, ACCIDENT_KINDS.find(([k]) => k === r.kind)?.[1] ?? r.kind, r.location, r.person_name, PERSON_TYPES.find(([k]) => k === r.person_type)?.[1] ?? r.person_type, r.person_company, r.person_role,
      SEVERITIES.find(([k]) => k === r.severity)?.[1] ?? r.severity, r.injury, r.treatment, r.hospital ? 'Yes' : '', r.days_lost, r.description, r.immediate_cause, r.root_cause, r.immediate_action,
      RIDDOR.find(([k]) => k === r.riddor)?.[1] ?? r.riddor, d(r.riddor_on), r.riddor_ref, r.corrective, r.corrective_owner, d(r.corrective_due), d(r.corrective_closed_on), r.reported_by, r.investigated_by, r.status === 'open' ? 'Open' : 'Closed',
    ]),
  )