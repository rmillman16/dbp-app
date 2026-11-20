// Word letters built inside the real letterhead (public/templates/letterhead.docx, a copy of
// reference/templates/dbp Letterhead - Template.docx): its headers, footers, logo and page set-up
// are kept exactly; only the body is replaced (agreed 20 Nov).
import JSZip from 'jszip'

export type Run = { text: string; bold?: boolean }
export type Block =
  | { p: string | Run[]; bold?: boolean; before?: number; after?: number; align?: 'left' | 'right' | 'center' }
  | { table: { head: string[]; rows: string[][]; widths: number[]; right?: number[]; boldLast?: boolean } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function runXml(r: Run) {
  return `<w:r>${r.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`
}

function paraXml(runs: Run[], o: { before?: number; after?: number; align?: string } = {}) {
  const ppr = `<w:pPr><w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 160}"/>${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>`
  return `<w:p>${ppr}${runs.map(runXml).join('')}</w:p>`
}

// widths in mm; the letterhead's text width is 165 mm
function tableXml(t: { head: string[]; rows: string[][]; widths: number[]; right?: number[]; boldLast?: boolean }) {
  const tw = (mm: number) => Math.round(mm * 56.6929)
  const border = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders>'
  const cell = (text: string, i: number, bold: boolean, shade: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${tw(t.widths[i])}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EAF2FA"/>' : ''}</w:tcPr>${paraXml([{ text, bold }], { after: 40, before: 40, align: t.right?.includes(i) ? 'right' : undefined })}</w:tc>`
  const row = (cells: string[], bold: boolean, shade: boolean) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.map((c, i) => cell(c, i, bold, shade)).join('')}</w:tr>`
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${tw(t.widths.reduce((s, w) => s + w, 0))}" w:type="dxa"/>${border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${t.widths.map((w) => `<w:gridCol w:w="${tw(w)}"/>`).join('')}</w:tblGrid>` +
    row(t.head, true, true) +
    t.rows.map((r, i) => row(r, !!t.boldLast && i === t.rows.length - 1, false)).join('') +
    `</w:tbl>${paraXml([{ text: '' }], { after: 120 })}`
  )
}

export async function letterDocx(blocks: Block[]): Promise<Blob> {
  const res = await fetch('/templates/letterhead.docx')
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  const doc = await zip.file('word/document.xml')!.async('string')
  const bodyStart = doc.indexOf('<w:body>') + '<w:body>'.length
  const sect = doc.lastIndexOf('<w:sectPr')
  const body = blocks
    .map((b) => {
      if ('table' in b) return tableXml(b.table)
      // a line break in plain text starts a new paragraph with no gap between
      if (typeof b.p === 'string') {
        const lines = b.p.split('\n')
        return lines.map((line, i) => paraXml([{ text: line, bold: b.bold }], { before: i === 0 ? b.before : 0, after: i === lines.length - 1 ? b.after : 0, align: b.align })).join('')
      }
      return paraXml(b.p, { before: b.before, after: b.after, align: b.align })
    })
    .join('')
  zip.file('word/document.xml', doc.slice(0, bodyStart) + body + doc.slice(sect))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.replace(/[\\/:*?"<>|]/g, '')
  a.click()
  URL.revokeObjectURL(a.href)
}

// {{placeholders}} in template wording
export function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m)
}

export const longDate = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
