// EOT (docs/decisions.md "EOT module"): delay events (VOs with programme days come in
// automatically, script 013), notices of delay and EOT claims on the letterhead, days granted
// moving the completion date, and prolongation at the job's weekly prelims.
// Clause numbers are typed in per job and per event with no defaults; letters won't generate
// until they're filled in (agreed 20 Nov). Claude isn't giving legal advice.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { addDaysIso, todayIso } from './format'
import { downloadBlob, fill, letterDocx, ordinalDate, periodText, type Block } from './letter'
import type { Company, DelayEvent, EotClaim, Job, Profile } from './types'
import type { Contact } from '../components/ContactsEditor'

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

// ---------- what a letter needs before it will generate ----------
const has = (s: string | null | undefined) => !!s?.trim()

export function noticeMissing(job: Job, e: DelayEvent) {
  const m: string[] = []
  if (!has(job.contract_form)) m.push('the form of contract (Edit job details)')
  if (!has(job.notice_clause)) m.push('the notice clause (EOT tab, Contract clauses)')
  if (!has(e.clause)) m.push(`the Relevant Event clause for ${eventRef(e)}`)
  if (!e.days_claimed) m.push(`the days claimed for ${eventRef(e)}`)
  if (!job.pc_date) m.push('the PC date (Edit job details)')
  return m
}

export function claimMissing(job: Job, events: DelayEvent[]) {
  const m: string[] = []
  if (!has(job.contract_form)) m.push('the form of contract (Edit job details)')
  if (!has(job.notice_clause)) m.push('the notice clause')
  if (!has(job.eot_clause)) m.push('the extension of time clause')
  if (!has(job.le_clause)) m.push('the loss and expense clause')
  if (!job.pc_date) m.push('the PC date (Edit job details)')
  if (!events.length) m.push('at least one delay event')
  for (const e of events) if (!has(e.clause)) m.push(`the Relevant Event clause for ${eventRef(e)}`)
  return m
}

function refuse(missing: string[]) {
  if (missing.length) throw new Error(`The letter can't be produced until these are filled in: ${missing.join('; ')}.`)
}

// ---------- letters (DBP's style: The Mall Walthamstow notice, 13.08.2025) ----------
export const NOTICE_DEFAULT = `We write with reference to the above project and the recent discussions. Having reviewed our programme, we wish to record our formal notice of delay to our contracted works because of ongoing and relevant events, as required under clause {{notice_clause}} and as detailed below.

In accordance with clause {{notice_clause}} we anticipate the delay to the progress of our works{{area}} will extend the date of Practical Completion by {{period}} from our current agreed PC date of the {{current_pc}} to the {{new_pc}}.

The Relevant Events under clause {{event_clause}} that have caused delay to our programme, and which in our opinion justify an extension of time, are as follows:

{{events}}

The changes above have impacted on our programme, which will be revised and reissued. Once the full assessment of the delay is made we will provide further substantiation as required to justify in detail the impact on our programme, but we feel this provides adequate justification for an interim extension of time to be granted.

We are continuing to monitor the effect of these changes on the Date for Completion and will advise of any associated costs and/or loss and expense in due course.

As always, we will continue to use our best endeavours to mitigate all delays and costs associated with this notice.

Please do not hesitate to contact us if you have any queries or require any further information in relation to this notice of delay.`

export const CLAIM_DEFAULT = `Further to our notices of delay under clause {{notice_clause}}, we write to apply for an extension of time under clause {{completion_clause}} of {{contract}} for the Relevant Events listed below, which together have delayed the Works by {{period}}.

Our current agreed PC date is the {{completion}}. We request that the date of Practical Completion be fixed at the {{revised_completion}}.

The events, the clauses under which each is a Relevant Event, and our assessment of their effect on the programme are set out below. We reserve our right to recover the loss and expense arising from these delays under clause {{le_clause}}.

Please do not hesitate to contact us if you have any queries or require any further information in relation to this application.`

export interface LetterPeople {
  client: Company | null
  contact: Contact | null
  signer: Profile | null
}

function letterTop(job: Job, people: LetterPeople, ref: string, subject: string): Block[] {
  const { client, contact } = people
  const clientLines = client ? [client.name, ...(client.address ?? '').split(/\n/).map((s) => s.trim()).filter(Boolean), client.postcode ?? ''].filter(Boolean) : ['[Client name]', '[Client address]']
  return [
    { p: ordinalDate(todayIso()), before: 1300, after: 240 },
    { p: clientLines.join('\n'), after: 240 },
    { p: [{ text: `Fao: ${contact?.name ?? '[contact]'}`, bold: true, underline: true }], after: 240 },
    { p: `Our ref: ${ref}`, after: 240 },
    { p: 'Dear Sir,', after: 200 },
    { p: [{ text: `Re: - ${job.name} – ${subject}`, bold: true, underline: true }], after: 200 },
  ]
}

const paragraphs = (text: string): Block[] =>
  text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ p: t, after: 160 }))

function signOff(signer: Profile | null): Block[] {
  return [
    { p: 'Yours sincerely,', before: 200, after: 960, keepNext: true },
    { p: signer?.full_name || '[name]', keepNext: true, after: 0 },
    ...(signer?.job_title ? [{ p: signer.job_title, keepNext: true, after: 0 } as Block] : []),
    { p: 'On behalf of du Boulay Projects Limited', after: 0 },
  ]
}

// the numbered events in the body: bold title, narrative, mitigation, then the recap bullets
function eventBlocks(events: DelayEvent[]): Block[] {
  const IND = 567
  return events.flatMap((e, i) => {
    const recap = (e.timeline ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
    return [
      { p: [{ text: `${i + 1}.\t${e.description}`, bold: true }], indent: IND, hanging: IND, after: 120, keepNext: true },
      ...paragraphs(e.details ?? '').map((b) => ({ ...b, indent: IND })),
      ...paragraphs(e.mitigation ?? '').map((b) => ({ ...b, indent: IND })),
      ...(recap.length
        ? [
            { p: 'A short recap of events:', indent: IND, after: 80, keepNext: true } as Block,
            ...recap.map((r, j): Block => ({ p: `-\t${r}`, indent: IND * 2, hanging: IND, after: j === recap.length - 1 ? 160 : 40 })),
          ]
        : []),
    ]
  })
}

// wording paragraphs, with the {{events}} marker replaced by the numbered events
function bodyWithEvents(text: string, events: DelayEvent[]): Block[] {
  const [before, after = ''] = text.split(/^\s*\{\{events\}\}\s*$/m)
  return [...paragraphs(before), ...(text.includes('{{events}}') ? eventBlocks(events) : []), ...paragraphs(after)]
}

const initials = (signer: Profile | null) => signer?.initials?.trim().toUpperCase() || 'DBP'

export async function noticeLetter(job: Job, people: LetterPeople, e: DelayEvent, allEvents: DelayEvent[], wording: string | null) {
  refuse(noticeMissing(job, e))
  const days = Number(e.days_claimed)
  const current = programme(job, allEvents).revisedPc ?? job.pc_date
  const text = fill(wording?.trim() || NOTICE_DEFAULT, {
    job: job.name,
    contract: job.contract_form!.trim(),
    notice_clause: job.notice_clause!.trim(),
    event_clause: e.clause!.trim(),
    area: e.area?.trim() ? ` on ${e.area.trim()}` : '',
    period: periodText(days),
    current_pc: ordinalDate(current),
    new_pc: current ? ordinalDate(addDaysIso(current, Math.round(days))) : '',
  })
  const no = e.event_no ?? 0
  const ref = `${initials(people.signer)}/DBP/DN/${no}`
  const blob = await letterDocx([...letterTop(job, people, ref, `Delay Notice #${no}`), ...bodyWithEvents(text, [e]), ...signOff(people.signer)])
  downloadBlob(blob, `${job.job_no} ${job.code} - Notice of Delay ${no}.docx`)
}

export async function claimLetter(job: Job, people: LetterPeople, claim: EotClaim, events: DelayEvent[], allEvents: DelayEvent[], wording: string | null) {
  refuse(claimMissing(job, events))
  const days = events.reduce((s, e) => s + Number(e.days_claimed ?? 0), 0)
  const current = programme(job, allEvents).revisedPc ?? job.pc_date
  const text = fill(wording?.trim() || CLAIM_DEFAULT, {
    job: job.name,
    contract: job.contract_form!.trim(),
    notice_clause: job.notice_clause!.trim(),
    completion_clause: job.eot_clause!.trim(),
    le_clause: job.le_clause!.trim(),
    days: String(days),
    period: periodText(days),
    completion: ordinalDate(current),
    revised_completion: current ? ordinalDate(addDaysIso(current, Math.round(days))) : '',
  })
  const ref = `${initials(people.signer)}/DBP/EOT/${claim.claim_no}`
  const table: Block = {
    table: {
      head: ['Ref', 'Relevant Event', 'Clause', 'Date', 'Days'],
      widths: [16, 81, 22, 32, 14],
      right: [4],
      boldLast: true,
      rows: [...events.map((e) => [eventRef(e), e.description, e.clause!.trim(), ordinalDate(e.event_date), String(e.days_claimed ?? '')]), ['', 'Total', '', '', String(days)]],
    },
  }
  // the table sits before the closing paragraph
  const body = paragraphs(text)
  const close = body.length > 1 ? body.splice(-1) : []
  const blob = await letterDocx([...letterTop(job, people, ref, `Extension of Time Claim #${claim.claim_no}`), ...body, table, ...close, ...signOff(people.signer)])
  downloadBlob(blob, `${job.job_no} ${job.code} - EOT Claim ${claim.claim_no}.docx`)
}
