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

// The scope as a PDF to send with the enquiry, made for each contractor: the dbp logo top right, "Prepared for" their name, each scope
// item in bold with a box on the right for their price (the PDF is a fillable form: they type in it and send it back), its detail
// lines indented under it, a total and a box for qualifications at the end. Every page after the first has the project and package
// in its header, and every page has a footer with the logo, who it is from, and the page number.
export async function scopePdf(args: {
  enquiry: string
  address: string
  pkg: string
  items: Pick<ScopeItem, 'kind' | 'description'>[]
  returnBy: string
  contractor?: string
  sender?: string
  phone?: string
  email?: string
  logo?: Uint8Array // tests only: normally fetched from /dbp-logo.png
}): Promise<Blob> {
  const { PDFDocument, StandardFonts, TextAlignment, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const form = pdf.getForm()
  const safe = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ]/g, '?')
  const W = 595
  const H = 842
  const M = 50
  const navy = rgb(0.17, 0.13, 0.34)
  const ink = rgb(0.1, 0.1, 0.12)
  const grey = rgb(0.3, 0.3, 0.35)
  const faint = rgb(0.7, 0.7, 0.78)
  const REF = 28 // width of the number column
  const SUB = 24 // width of the (a) column
  const PRICE = 88 // the price boxes down the right
  const R = W - M - PRICE - 12 // where the wording stops, clear of them
  const BOTTOM = 64 // above the footer
  let page = pdf.addPage([W, H])
  let y = H - M

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try {
    let bytes = args.logo
    if (!bytes) {
      const r = await fetch('/dbp-logo.png')
      if (!r.ok) throw new Error('no logo')
      bytes = new Uint8Array(await r.arrayBuffer())
    }
    logo = await pdf.embedPng(bytes)
  } catch {
    /* no logo: carry on */
  }

  const width = (t: string, f: typeof font, size: number) => f.widthOfTextAtSize(safe(t), size)
  const fit = (t: string, f: typeof font, size: number, max: number) => {
    const full = safe(t)
    let s = full
    while (s.length > 4 && f.widthOfTextAtSize(s, size) > max) s = s.slice(0, -2)
    return s === full ? s : s.trimEnd() + '...'
  }
  const wrap = (text: string, f: typeof font, size: number, w: number) => {
    const lines: string[] = []
    for (const para of safe(text).split('\n')) {
      let line = ''
      for (const word of para.split(' ')) {
        if (f.widthOfTextAtSize(line ? line + ' ' + word : word, size) > w && line) {
          lines.push(line)
          line = word
        } else line = line ? line + ' ' + word : word
      }
      lines.push(line)
    }
    return lines
  }
  const colHead = () => {
    const t = 'Your price (£)'
    page.drawText(safe(t), { x: W - M - PRICE + (PRICE - width(t, bold, 8.5)) / 2, y: y - 9, size: 8.5, font: bold, color: navy })
    y -= 16
  }
  const newPage = () => {
    page = pdf.addPage([W, H])
    // after the first page: the project and the package at the head of every page
    page.drawText(fit(args.enquiry, bold, 8.5, W - 2 * M - 150), { x: M, y: H - 34, size: 8.5, font: bold, color: grey })
    const pk = fit(args.pkg, bold, 8.5, 140)
    page.drawText(pk, { x: W - M - width(pk, bold, 8.5), y: H - 34, size: 8.5, font: bold, color: navy })
    page.drawLine({ start: { x: M, y: H - 42 }, end: { x: W - M, y: H - 42 }, thickness: 0.6, color: faint })
    y = H - 56
    colHead()
  }
  const need = (h: number) => {
    if (y - h < BOTTOM) newPage()
  }
  // text from x across to `right`, with the lines after the first lined up under the first
  const put = (text: string, f: typeof font, size: number, color = ink, x = M, right = R, lead = 1.4) => {
    for (const l of wrap(text, f, size, right - x)) {
      need(size * lead)
      if (l) page.drawText(l, { x, y: y - size, size, font: f, color })
      y -= size * lead
    }
  }
  const ref = (t: string, f: typeof font, size: number, x: number, color = ink) => page.drawText(safe(t), { x, y: y - size, size, font: f, color })
  let n = 0
  const box = (name: string, p: typeof page, x: number, yy: number, w: number, h: number, opts: { multi?: boolean; bold?: boolean } = {}) => {
    const tf = form.createTextField(name)
    if (opts.multi) tf.enableMultiline()
    else tf.setAlignment(TextAlignment.Right)
    tf.addToPage(p, { x, y: yy, width: w, height: h, borderWidth: 0.7, borderColor: rgb(0.55, 0.58, 0.72), backgroundColor: rgb(0.95, 0.96, 1), textColor: ink, font: opts.bold ? bold : font })
    tf.setFontSize(opts.multi ? 9 : 10) // after it is on the page, which is what gives it its default appearance
  }

  // ---------- first page ----------
  const head = W - M - (logo ? 134 : 0) // keep the title clear of the logo
  if (logo) {
    const lw = 120
    page.drawImage(logo, { x: W - M - lw, y: H - 30 - (logo.height * lw) / logo.width, width: lw, height: (logo.height * lw) / logo.width })
  }
  put('Scope of works', bold, 20, navy, M, head)
  y -= 4
  put(args.pkg, bold, 13, ink, M, head)
  put(args.enquiry, font, 11, grey, M, head)
  if (args.address) put(args.address, font, 10, grey, M, head)
  if (args.returnBy) put(`Tender return: ${args.returnBy}`, font, 10, grey, M, head)
  if (args.contractor) {
    y -= 4
    put(`Prepared for: ${args.contractor}`, bold, 11, navy, M, head)
  }
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: navy })
  y -= 8
  put('Please enter your price for each item in the boxes on the right (this PDF can be filled in on screen), add the total at the end, and return it with your tender.', font, 8.5, grey, M, W - M)
  y -= 4
  colHead()

  // ---------- the list ----------
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
      put(x.text, font, 10, ink, M + REF + SUB, R, 1.4)
      y -= 1
    } else {
      y -= first ? 4 : 12 // the space that sets one scope item apart from the last
      need(52) // an item is not left alone at the foot of a page
      n++
      box(`price_${n}`, page, W - M - PRICE, y - 15, PRICE, 17) // the contractor's price for this item, level with its first line
      ref(refs[i], bold, 11, M, navy)
      put(x.text, bold, 11, ink, M + REF, R, 1.35)
      y -= 2
    }
    first = false
  })

  // ---------- the total and anything they have left out ----------
  y -= 22
  need(130)
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: faint })
  y -= 12
  box('total', page, W - M - PRICE, y - 17, PRICE, 18, { bold: true })
  put('Total for the package (£)', bold, 11, ink, M, R)
  y -= 14
  put('Qualifications, exclusions and anything you have allowed for that is not listed above:', font, 9.5, grey, M, W - M)
  y -= 4
  box('qualifications', page, M, y - 62, W - 2 * M, 62, { multi: true })
  y -= 70

  // ---------- the footer, on every page ----------
  const pages = pdf.getPages()
  const org = 'du Boulay Projects Limited'
  const who = [args.sender, args.email, args.phone].filter(Boolean).join('  ·  ')
  const lw = 52
  const lh = logo ? (logo.height * lw) / logo.width : 0
  pages.forEach((p, k) => {
    p.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.6, color: faint })
    let tx = M
    if (logo) {
      p.drawImage(logo, { x: M, y: 34 - lh / 2 + 2, width: lw, height: lh })
      tx = M + lw + 12
    }
    p.drawText(org, { x: tx, y: 36, size: 8, font: bold, color: grey })
    if (who) p.drawText(fit(who, font, 8, W - M - 90 - tx), { x: tx, y: 26, size: 8, font, color: grey })
    const t = `Page ${k + 1} of ${pages.length}`
    p.drawText(t, { x: W - M - width(t, font, 8), y: 36, size: 8, font, color: grey })
    const s = fit(args.pkg, font, 8, 120)
    p.drawText(s, { x: W - M - width(s, font, 8), y: 26, size: 8, font, color: faint })
  })
  form.updateFieldAppearances(font)
  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
