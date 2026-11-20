// EOT (docs/decisions.md "EOT module"): delay events (VOs with programme days come in
// automatically, script 013), notices of delay and EOT claims on the letterhead, days granted
// moving the completion date, and prolongation at the job's weekly prelims.
// Wording must follow each job's contract; Claude isn't giving legal advice.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { addDaysIso } from './format'
import { downloadBlob, fill, letterDocx, longDate, type Block } from './letter'
import type { Company, DelayEvent, EotClaim, Job } from './types'

export const eventRef = (e: Pick<DelayEvent, 'event_no'>) => `DE${String(e.event_no ?? 0).padStart(2, '0')}`

export function loadEot(jobId: string) {
  return cached(`eot:${jobId}`, async () => ({
    events: await must<DelayEvent[]>(supabase.from('delay_events').select('*').eq('job_id', jobId).order('event_no')),
    claims: await must<EotClaim[]>(supabase.from('eot_claims').select('*').eq('job_id', jobId).order('claim_no')),
    links: await must<{ claim_id: string; event_id: string }[]>(supabase.from('eot_claim_events').select('claim_id, event_id, eot_claims!inner(job_id)').eq('eot_claims.job_id', jobId)),
  }))
}

// Completion: the contract PC date plus every day granted so far (calendar days).
export function programme(job: Job, events: DelayEvent[]) {
  const granted = events.reduce((s, e) => s + Number(e.days_granted ?? 0), 0)
  const claimed = events.filter((e) => e.status !== 'rejected').reduce((s, e) => s + Number(e.days_claimed ?? 0), 0)
  return {
    contractPc: job.pc_date,
    granted,
    claimed,
    revisedPc: job.pc_date ? addDaysIso(job.pc_date, Math.round(granted)) : null,
    weeksDelay: Math.round((granted / 7) * 10) / 10,
  }
}

export const prolongation = (days: number, weeklyPrelims: number | null) => Math.round((days / 7) * Number(weeklyPrelims ?? 0) * 100) / 100

// ---------- letters ----------
export const NOTICE_DEFAULT = `We write to give notice under {{contract}} that the progress of the Works is being, or is likely to be, delayed by the following event:

{{event}}

The event occurred on {{event_date}}. Our current estimate of its effect on the Completion Date is {{days}} days. We consider this to be a Relevant Event, and we will provide further particulars and an updated estimate of the delay as soon as they are available.

Please treat this letter as notice under the Contract.`

export const CLAIM_DEFAULT = `Further to our notices of delay, we write to apply for an extension of time under {{contract}} for the delay events listed below, which together have delayed the Works by {{days}} days.

The Completion Date is currently {{completion}}. We request that it be fixed at {{revised_completion}}.

The events and our assessment of their effect on the programme are set out below. We reserve our right to recover the loss and expense arising from these delays.`

function letterTop(job: Job, client: Company | null, ref: string, subject: string): Block[] {
  const clientLines = client ? [client.name, ...(client.address ?? '').split(/\n/).map((s) => s.trim()).filter(Boolean), client.postcode ?? ''].filter(Boolean) : ['[Client name]', '[Client address]']
  return [
    { p: longDate(new Date().toISOString().slice(0, 10)), before: 1300, after: 240 },
    { p: clientLines.join('\n'), after: 240 },
    { p: `Our ref: ${ref}`, after: 240 },
    { p: 'Dear Sirs,', after: 200 },
    { p: `Re: ${job.name}${job.site_address ? `, ${job.site_address.split(/\n|,/)[0].trim()}` : ''}: ${subject}`, bold: true, after: 200 },
  ]
}

const paragraphs = (text: string): Block[] => text.split(/\n\s*\n/).map((t) => ({ p: t.trim(), after: 160 }))
const signOff: Block[] = [
  { p: 'Yours faithfully,', before: 200, after: 720 },
  { p: 'du Boulay Projects Ltd', bold: true },
]

export async function noticeLetter(job: Job, client: Company | null, e: DelayEvent, wording: string | null) {
  const text = fill(wording?.trim() || NOTICE_DEFAULT, {
    job: job.name,
    contract: job.contract_form || 'the Contract',
    event: [e.description, e.details].filter(Boolean).join('. '),
    event_date: longDate(e.event_date),
    days: String(e.days_claimed ?? 'TBC'),
    ref: eventRef(e),
  })
  const ref = `${job.job_no} ${job.code}/EOT/${eventRef(e)}`
  const blob = await letterDocx([...letterTop(job, client, ref, `Notice of Delay (${eventRef(e)})`), ...paragraphs(text), ...signOff])
  downloadBlob(blob, `${job.job_no} ${job.code} - Notice of Delay ${eventRef(e)}.docx`)
}

export async function claimLetter(job: Job, client: Company | null, claim: EotClaim, events: DelayEvent[], allEvents: DelayEvent[], wording: string | null) {
  const days = events.reduce((s, e) => s + Number(e.days_claimed ?? 0), 0)
  const { revisedPc } = programme(job, allEvents)
  const current = revisedPc ?? job.pc_date
  const text = fill(wording?.trim() || CLAIM_DEFAULT, {
    job: job.name,
    contract: job.contract_form || 'the Contract',
    days: String(days),
    completion: longDate(current),
    revised_completion: current ? longDate(addDaysIso(current, Math.round(days))) : '[date]',
  })
  const ref = `${job.job_no} ${job.code}/EOT/Claim ${claim.claim_no}`
  const table: Block = {
    table: {
      head: ['Ref', 'Delay event', 'Date', 'Days'],
      widths: [18, 97, 36, 14],
      right: [3],
      boldLast: true,
      rows: [...events.map((e) => [eventRef(e), [e.description, e.details].filter(Boolean).join('. '), longDate(e.event_date), String(e.days_claimed ?? '')]), ['', 'Total', '', String(days)]],
    },
  }
  const blob = await letterDocx([...letterTop(job, client, ref, `Extension of Time, Claim ${claim.claim_no}`), ...paragraphs(text), table, ...signOff])
  downloadBlob(blob, `${job.job_no} ${job.code} - EOT Claim ${claim.claim_no}.docx`)
}
