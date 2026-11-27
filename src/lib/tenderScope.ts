import { supabase } from './supabase'
import { uploadFile } from './orders'
import { numberItems, type ScopeItem } from './levelling'
import { plainOf } from './scopeRich'

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

// the scope as a PDF to attach: the dbp logo top right, each scope item in bold with a gap above it, its detail lines indented
// under it as (a), (b)..., and who issued it at the end
export async function scopePdf(args: {
  enquiry: string
  address: string
  pkg: string
  items: Pick<ScopeItem, 'kind' | 'description'>[]
  returnBy: string
  sender?: string
  phone?: string
  logo?: Uint8Array // tests only: normally fetched from /dbp-logo.png
}): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const safe = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ]/g, '?')
  const W = 595
  const H = 842
  const M = 50
  const navy = rgb(0.17, 0.13, 0.34)
  const ink = rgb(0.1, 0.1, 0.12)
  const grey = rgb(0.3, 0.3, 0.35)
  const REF = 28 // width of the number column
  const SUB = 24 // width of the (a) column
  let page = pdf.addPage([W, H])
  let y = H - M
  const need = (h: number) => {
    if (y - h < M + 20) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }
  const wrap = (text: string, f: typeof font, size: number, width: number) => {
    const lines: string[] = []
    for (const para of safe(text).split('\n')) {
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
  // text from x across to the right margin (or `right`), with the lines after the first lined up under the first
  const put = (text: string, f: typeof font, size: number, color = ink, x = M, right = W - M, lead = 1.4) => {
    for (const l of wrap(text, f, size, right - x)) {
      need(size * lead)
      if (l) page.drawText(l, { x, y: y - size, size, font: f, color })
      y -= size * lead
    }
  }
  const ref = (t: string, f: typeof font, size: number, x: number, color = ink) => page.drawText(safe(t), { x, y: y - size, size, font: f, color })

  let logoW = 0
  try {
    let bytes = args.logo
    if (!bytes) {
      const r = await fetch('/dbp-logo.png')
      if (!r.ok) throw new Error('no logo')
      bytes = new Uint8Array(await r.arrayBuffer())
    }
    const img = await pdf.embedPng(bytes)
    logoW = 120
    const h = (img.height * logoW) / img.width
    page.drawImage(img, { x: W - M - logoW, y: H - 30 - h, width: logoW, height: h })
  } catch {
    /* no logo: carry on */
  }
  const head = W - M - (logoW ? logoW + 14 : 0) // keep the title clear of the logo
  put('Scope of works', bold, 20, navy, M, head)
  y -= 4
  put(args.pkg, bold, 13, ink, M, head)
  put(args.enquiry, font, 11, grey, M, head)
  if (args.address) put(args.address, font, 10, grey, M, head)
  if (args.returnBy) put(`Tender return: ${args.returnBy}`, font, 10, grey, M, head)
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: navy })
  y -= 10

  const items = args.items.map((i) => ({ kind: i.kind, text: plainOf(i.description) }))
  const refs = numberItems(args.items)
  let first = true
  items.forEach((x, i) => {
    if (!x.text) return
    if (x.kind === 'heading') {
      y -= first ? 4 : 16
      need(40)
      ref(refs[i], bold, 12, M, navy)
      put(x.text, bold, 12, navy, M + REF, W - M, 1.35)
    } else if (x.kind === 'detail') {
      need(15)
      ref(refs[i], font, 10, M + REF)
      put(x.text, font, 10, ink, M + REF + SUB, W - M, 1.4)
      y -= 1
    } else {
      y -= first ? 4 : 12 // the space that sets one scope item apart from the last
      need(52) // an item is not left alone at the foot of a page
      ref(refs[i], bold, 11, M, navy)
      put(x.text, bold, 11, ink, M + REF, W - M, 1.35)
      y -= 2
    }
    first = false
  })

  if (args.sender || args.phone) {
    y -= 22
    need(70)
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.78) })
    y -= 10
    put('Enquiry issued by', font, 9, grey)
    if (args.sender) put(args.sender, bold, 11)
    if (args.phone) put(args.phone, font, 10.5)
    put('du Boulay Projects Limited', font, 10, grey)
  }
  const pages = pdf.getPages()
  pages.forEach((p, n) => {
    const t = `Page ${n + 1} of ${pages.length}`
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 8.5), y: 26, size: 8.5, font, color: grey })
  })
  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
