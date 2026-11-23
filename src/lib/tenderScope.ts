import { supabase } from './supabase'
import { uploadFile } from './orders'

// Drawings and the scope of works for a tender package. The drawings go to storage (the "orders" bucket, tender/ folder),
// the "tender-scope" Edge Function reads them and drafts a scope for the estimator to edit, and the finished scope can go
// out with each email as a PDF.
export async function uploadDrawings(enquiryId: string, files: File[]): Promise<string[]> {
  const paths: string[] = []
  for (const f of files) paths.push(await uploadFile(`tender/${enquiryId}`, f))
  return paths
}

export async function draftScope(args: { paths: string[]; package: string; job: string; address: string; summary: string; notes: string; existing: string }): Promise<string> {
  const r = await supabase.functions.invoke('tender-scope', { body: args })
  // a non-2xx answer comes back as an error whose context holds the response, with our message in it
  if (r.error) {
    let msg = ''
    try {
      const ctx = (r.error as { context?: Response }).context
      const j = ctx ? await ctx.json() : null
      msg = j?.error ?? ''
    } catch {
      /* no body */
    }
    if (msg) throw new Error(msg)
    throw new Error(/not found|404|fetch/i.test(r.error.message) ? "The scope writer isn't deployed yet: deploy the tender-scope function in Supabase." : r.error.message)
  }
  const d = r.data as { ok: boolean; scope?: string; error?: string }
  if (!d?.ok || !d.scope) throw new Error(d?.error ?? 'Nothing came back. Please try again.')
  return d.scope
}

// the scope as a simple PDF to attach
export async function scopePdf(args: { enquiry: string; address: string; pkg: string; scope: string; returnBy: string }): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const safe = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ]/g, '?')
  const W = 595
  const H = 842
  const M = 50
  const navy = rgb(0.17, 0.13, 0.34)
  let page = pdf.addPage([W, H])
  let y = H - M
  const need = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }
  const wrap = (text: string, f: typeof font, size: number, width: number) => {
    const lines: string[] = []
    for (const para of safe(text).split('\n')) {
      if (!para.trim()) {
        lines.push('')
        continue
      }
      let line = ''
      for (const w of para.split(' ')) {
        if (f.widthOfTextAtSize(line ? line + ' ' + w : w, size) > width && line) {
          lines.push(line)
          line = w
        } else line = line ? line + ' ' + w : w
      }
      lines.push(line)
    }
    return lines
  }
  const put = (text: string, f: typeof font, size: number, color = rgb(0.1, 0.1, 0.12), indent = 0) => {
    for (const l of wrap(text, f, size, W - 2 * M - indent)) {
      need(size * 1.45)
      if (l) page.drawText(l, { x: M + indent, y: y - size, size, font: f, color })
      y -= size * 1.45
    }
  }
  put('Scope of works', bold, 20, navy)
  y -= 4
  put(`${args.pkg}`, bold, 13)
  put(args.enquiry, font, 11, rgb(0.3, 0.3, 0.35))
  if (args.address) put(args.address, font, 10, rgb(0.3, 0.3, 0.35))
  if (args.returnBy) put(`Tender return: ${args.returnBy}`, font, 10, rgb(0.3, 0.3, 0.35))
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: navy })
  y -= 14
  for (const line of args.scope.split('\n')) {
    const t = line.trimEnd()
    if (!t.trim()) {
      y -= 6
      continue
    }
    const heading = t === t.toUpperCase() && /[A-Z]/.test(t) && t.length < 80 && !t.startsWith('-')
    if (heading) {
      y -= 6
      put(t, bold, 11, navy)
    } else if (t.startsWith('- ')) {
      need(14)
      page.drawText('-', { x: M + 4, y: y - 10.5, size: 10.5, font, color: navy })
      put(t.slice(2), font, 10.5, rgb(0.1, 0.1, 0.12), 16)
    } else put(t, font, 10.5)
  }
  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
