// Snag lists as PDFs (24 Nov): one compiled list for the job, or one per trade to send to each. Each snag has its number, name,
// location, description, who it is with, its status, a tick box for the site, and its first photo. Built in the browser with
// pdf-lib (nothing is uploaded). A4 portrait, helvetica (these go to trades, so plain and quick).
import type { Job } from './types'
import type { Snag } from './snags'
import { stateOf, STATE_LABEL } from './snags'
import { todayIso, ukDate } from './format'

const W = 595.28
const H = 841.89
const M = 40
const CW = W - 2 * M
const NAVY = '#1f1246'
const BLUE = '#007abe'
const INK = '#1d1d24'
const MUTED = '#6b6b78'
const LINE = '#d9d9e0'
const SHADE = '#eef3fa'
const SPECIAL = new Map<number, string>([[0x2013, '-'], [0x2014, '-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0x2022, '-']])
function winAnsi(s: string) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || c === 10) out += ch
    else out += c === 9 ? ' ' : (SPECIAL.get(c) ?? '?')
  }
  return out
}

export interface SnagListArgs {
  job: Job
  title: string // "Snag list" / "Snag list: Smith Joinery"
  snags: Snag[]
  who: (s: Snag) => string // the assignee, as it should read
  photos: Map<string, Blob | null> // a snag's first photo, if any
  showWho: boolean // the compiled list shows who each is with; a trade's own list doesn't need to
}

export async function buildSnagListPdf(a: SnagListArgs): Promise<Blob> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const hex = (h: string) => {
    const x = h.replace('#', '')
    return rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255)
  }
  doc.setTitle(`${a.job.job_no} ${a.job.code} ${a.title}`)
  doc.setCreator('DBP app')
  const pages: ReturnType<typeof doc.addPage>[] = []
  let page = doc.addPage([W, H])
  pages.push(page)
  let y = H - M
  const wrap = (t: string, width: number, size: number, f = regular) => {
    const out: string[] = []
    for (const para of winAnsi(t).split('\n')) {
      let line = ''
      for (const w of para.split(' ')) {
        const x = line ? `${line} ${w}` : w
        if (f.widthOfTextAtSize(x, size) <= width) line = x
        else {
          if (line) out.push(line)
          line = w
        }
      }
      out.push(line)
    }
    return out
  }

  // header: logo, title, the job, and the counts
  try {
    const r = await fetch('/dbp-logo.png')
    if (r.ok) {
      const logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()))
      const s = 120 / logo.width
      page.drawImage(logo, { x: W - M - 120, y: H - M - logo.height * s + 6, width: 120, height: logo.height * s })
    }
  } catch {
    /* no logo: carry on */
  }
  page.drawText(winAnsi(a.title), { x: M, y: y - 18, size: 20, font: bold, color: hex(NAVY) })
  y -= 40
  page.drawText(winAnsi(`${a.job.job_no} ${a.job.code} - ${a.job.name}`), { x: M, y, size: 11, font: bold, color: hex(INK) })
  y -= 15
  if (a.job.site_address) {
    page.drawText(winAnsi(a.job.site_address.replace(/\n/g, ', ').slice(0, 110)), { x: M, y, size: 9, font: regular, color: hex(MUTED) })
    y -= 13
  }
  const count = (s: 'todo' | 'check' | 'complete') => a.snags.filter((x) => stateOf(x) === s).length
  page.drawText(winAnsi(`${ukDate(todayIso())}  ·  ${a.snags.length} snag${a.snags.length === 1 ? '' : 's'}: ${count('todo')} to do, ${count('check')} done and waiting to be checked, ${count('complete')} complete`), { x: M, y, size: 9, font: regular, color: hex(MUTED) })
  y -= 10
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: hex(BLUE) })
  y -= 12

  const thumbW = 118
  const thumbH = 88
  for (const s of a.snags) {
    const textW = CW - 56 - thumbW - 28
    const lines: { t: string; f: typeof regular; size: number; color: string }[] = []
    for (const l of wrap(s.title, textW, 10.5, bold)) lines.push({ t: l, f: bold, size: 10.5, color: INK })
    if (s.location) for (const l of wrap(`Location: ${s.location}`, textW, 9)) lines.push({ t: l, f: regular, size: 9, color: MUTED })
    if (s.description) for (const l of wrap(s.description, textW, 9)) lines.push({ t: l, f: regular, size: 9, color: INK })
    if (a.showWho) for (const l of wrap(`With: ${a.who(s) || 'not assigned'}`, textW, 9)) lines.push({ t: l, f: regular, size: 9, color: NAVY })
    if (s.done_note && stateOf(s) === 'check') for (const l of wrap(`They say: ${s.done_note}`, textW, 9)) lines.push({ t: l, f: regular, size: 9, color: MUTED })
    const photo = a.photos.get(s.id) ?? null
    const textH = lines.reduce((h, l) => h + l.size + 3.5, 0)
    const boxH = Math.max(textH + 14, photo ? thumbH + 14 : 44)
    if (y - boxH < M + 20) {
      page = doc.addPage([W, H])
      pages.push(page)
      y = H - M
    }
    const top = y
    page.drawRectangle({ x: M, y: top - boxH, width: CW, height: boxH, borderColor: hex(LINE), borderWidth: 0.7 })
    // the number, in a shaded strip down the left
    page.drawRectangle({ x: M, y: top - boxH, width: 50, height: boxH, color: hex(SHADE) })
    const num = String(s.number)
    page.drawText(num, { x: M + 25 - bold.widthOfTextAtSize(num, 14) / 2, y: top - 22, size: 14, font: bold, color: hex(NAVY) })
    const st = STATE_LABEL[stateOf(s)]
    page.drawText(st, { x: M + 25 - regular.widthOfTextAtSize(st, 7) / 2, y: top - 34, size: 7, font: regular, color: hex(MUTED) })
    // text
    let ty = top - 8
    for (const l of lines) {
      ty -= l.size
      page.drawText(l.t, { x: M + 58, y: ty, size: l.size, font: l.f, color: hex(l.color) })
      ty -= 3.5
    }
    // a box to tick on site
    page.drawRectangle({ x: W - M - thumbW - 22, y: top - 20, width: 12, height: 12, borderColor: hex(MUTED), borderWidth: 1 })
    // its photo
    if (photo) {
      try {
        const bytes = new Uint8Array(await photo.arrayBuffer())
        const img = photo.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        const sc = Math.min(thumbW / img.width, thumbH / img.height)
        page.drawImage(img, { x: W - M - 7 - img.width * sc, y: top - 7 - img.height * sc, width: img.width * sc, height: img.height * sc })
      } catch {
        /* not a picture a PDF can hold: left out */
      }
    }
    y = top - boxH - 6
  }
  if (!a.snags.length) page.drawText('No snags.', { x: M, y: y - 14, size: 11, font: regular, color: hex(MUTED) })
  pages.forEach((p, i) => {
    const t = `du Boulay Projects Limited  -  Page ${i + 1} of ${pages.length}`
    p.drawText(t, { x: W / 2 - regular.widthOfTextAtSize(t, 8) / 2, y: 20, size: 8, font: regular, color: hex(MUTED) })
  })
  return new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' })
}

export const snagFileName = (job: Pick<Job, 'job_no' | 'code'>, label: string) => `${job.job_no} ${job.code} - Snag list - ${label} ${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}.pdf`
