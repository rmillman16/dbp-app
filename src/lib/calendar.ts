// Monthly valuation dates for a job, as an Outlook / iPhone calendar file (.ics).
// Same dates as the app's reminders (supabase/010): one week before each month end,
// moved back to the Friday at weekends, from the start date (or today) to the PC date
// (or 12 months ahead). Each appointment has a stable ID, so opening an updated file
// again changes the existing appointments rather than adding duplicates.
import { todayIso } from './format'
import type { Job } from './types'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function valuationDates(job: Pick<Job, 'start_date' | 'pc_date'>) {
  const today = todayIso()
  const from = [job.start_date ?? today, today].sort()[1]
  const toIso = job.pc_date ?? iso(new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1))
  const out: { due: string; monthEnd: string; month: string }[] = []
  let m = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1)
  const last = new Date(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, 1)
  while (m <= last) {
    const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0)
    const d = new Date(monthEnd)
    d.setDate(d.getDate() - 7)
    if (d.getDay() === 6) d.setDate(d.getDate() - 1) // Saturday → Friday
    if (d.getDay() === 0) d.setDate(d.getDate() - 2) // Sunday → Friday
    if (iso(d) >= today) out.push({ due: iso(d), monthEnd: iso(monthEnd), month: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) })
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
  }
  return out
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const ukDate = (isoDate: string) => isoDate.split('-').reverse().join('/')

export function downloadValuationCalendar(job: Job) {
  const dates = valuationDates(job)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const link = `${location.origin}/jobs/${job.id}/applications`
  const events = dates.map(({ due, monthEnd, month }) => {
    const day = due.replace(/-/g, '')
    return [
      'BEGIN:VEVENT',
      `UID:valuation-${job.id}-${day.slice(0, 6)}@dbp-app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T090000`, // 09:00 local time
      `DTEND:${day}T093000`,
      `SUMMARY:${icsText(`${job.job_no} ${job.code} valuation: ${month}`)}`,
      `DESCRIPTION:${icsText(`${job.name}\nPrepare the client application for month end (${ukDate(monthEnd)}).\n${link}`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`${job.job_no} ${job.code} valuation due`)}`,
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n')
  })
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//du Boulay Projects//DBP app//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  a.download = `${job.job_no} ${job.code} valuation dates.ics`
  a.click()
  URL.revokeObjectURL(a.href)
  return dates.length
}
