// Bringing in minutes somebody else took (the client's, a consultant's): read a Word, PDF or text file into plain text,
// then split it into headings, points and actions without rewriting a word (26 Nov).
import type { DraftPoint } from '../components/MinutesDraft'

export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const xml = await zip.file('word/document.xml')?.async('string')
    if (!xml) throw new Error('That Word file could not be read.')
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  }
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const out: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent()
      let line = ''
      let y: number | null = null
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (typeof it.str !== 'string') continue
        const ny = it.transform ? Math.round(it.transform[5]) : null
        if (y !== null && ny !== null && Math.abs(ny - y) > 3) {
          out.push(line)
          line = ''
        }
        line += it.str
        if (ny !== null) y = ny
      }
      out.push(line)
    }
    return out.join('\n')
  }
  if (name.endsWith('.doc')) throw new Error('Old .doc files cannot be read: save it as .docx or PDF first.')
  return await file.text()
}

const toISO = (s: string) => {
  const m = s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/)
  if (!m) return null
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// keep their wording: only split into headings and points, and spot lines marked as actions
export function parseAsWritten(text: string, attendees: { initials: string }[]): DraftPoint[] {
  const out: DraftPoint[] = []
  const initials = new Set(attendees.map((a) => a.initials.toUpperCase()))
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').trim()
    if (!line || /^page \d+( of \d+)?$/i.test(line)) continue
    line = line.replace(/^[•▪●○◦\-–*]\s+/, '')
    const numbered = line.match(/^(\d{1,2})[.)]?\s+(?=\S)/)
    const body = numbered ? line.slice(numbered[0].length) : line
    const letters = body.replace(/[^A-Za-z]/g, '')
    const allCaps = letters.length >= 3 && body === body.toUpperCase()
    const colon = /:$/.test(body) && body.length < 70
    const shortTitle = !!numbered && body.length < 60 && !/[.!?]$/.test(body) && !/\b(action|by)\b/i.test(body)
    if (body.length < 80 && (allCaps || colon || shortTitle)) {
      out.push({ type: 'heading', text: body.replace(/:$/, ''), action: false, owner: null, due: null, urgent: false })
      continue
    }
    const action = /^action\b[:\s-]*/i.test(body) || /\baction (by|for|owner)\b/i.test(body) || /\b(to action|actions?:)/i.test(body)
    let owner: string | null = null
    if (action) {
      const tokens = body.match(/\b[A-Z]{2,3}\b/g) ?? []
      owner = tokens.reverse().find((t) => initials.has(t)) ?? null
    }
    out.push({ type: 'note', text: body.replace(/^action\b[:\s-]*/i, '').trim() || body, action, owner, due: action ? toISO(body) : null, urgent: /\burgent\b/i.test(body) })
  }
  return out
}
