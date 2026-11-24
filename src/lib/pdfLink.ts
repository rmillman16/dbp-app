// A clickable link in a pdf-lib page (24 Nov): draws nothing itself, it lays a link over the rectangle (x, y from the page's bottom left),
// so draw the words (and an underline) yourself.
import type { PDFDocument, PDFPage } from 'pdf-lib'

export async function addPdfLink(doc: PDFDocument, page: PDFPage, url: string, x: number, y: number, w: number, h: number) {
  const { PDFString } = await import('pdf-lib')
  const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } })
  page.node.addAnnot(doc.context.register(annot))
}

export const HUB_LABEL = 'Project hub: drawings and project documents'
