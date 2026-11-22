// a workbook's sheets as rows of cell text, read straight from the file (22 Nov). The Excel library
// failed on a designer's schedule ("Cannot read properties…"), and schedules are full of pictures,
// shapes and pictures-in-cells that only need skipping, so this reads just the text: shared strings,
// typed-in text and the values Excel saved for formulas. Merged cells give their text to the first cell.
const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENT[e.toLowerCase()],
  )
// all the text in a string item: plain <t>, or the runs of rich text (phonetic hints left out)
const textOf = (xml: string) =>
  unxml([...xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1]).join(''))
const colIndex = (ref: string) => {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export async function readSheets(data: ArrayBuffer | Uint8Array) {
  const JSZip = (await import('jszip')).default
  let zip: InstanceType<typeof JSZip>
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error("That isn't an Excel file the app can read (.xlsx or .xlsm). An old .xls: open it in Excel, Save As .xlsx, then import that.")
  }
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? null
  const workbook = await read('xl/workbook.xml')
  if (!workbook) throw new Error("That isn't an Excel workbook the app can read.")
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? ''
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/\bId="([^"]+)"/.exec(m[0])?.[1] ?? '', /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '']))
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]))
  const sheets: { name: string; rows: string[][] }[] = []
  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)) {
    const name = unxml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet')
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? /\bid="([^"]+)"/.exec(m[0])?.[1] ?? ''
    let path = target.get(rid) ?? ''
    if (!path) continue
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`
    const xml = await read(path)
    if (!xml) continue // a chart sheet, or a sheet that's missing
    const rows: string[][] = []
    for (const r of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const rowNo = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1
      const cells: string[] = []
      let next = 0
      for (const c of r[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = c[1]
        const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1]
        const col = ref ? colIndex(ref) : next
        next = col + 1
        const inner = c[2] ?? ''
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
        const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1]
        let text = ''
        if (type === 's') text = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') text = textOf(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner)?.[1] ?? '')
        else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
        else if (type === 'e')
          text = '' // an error, or a picture in a cell (#VALUE! behind it)
        else text = v != null ? unxml(v) : ''
        cells[col] = text.trim()
      }
      rows[rowNo] = Array.from(cells, (x) => x ?? '')
    }
    // a merged cell's text is in its first cell: nothing more to do for reading items
    sheets.push({ name, rows: Array.from(rows, (r) => r ?? []) })
  }
  return sheets.filter((s) => s.rows.some((r) => r.some(Boolean)))
}
