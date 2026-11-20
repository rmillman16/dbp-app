// Opens an Excel file for reading. Drop-down lists (data validations) are removed first: the
// iPlicit job costing report has them over whole columns, which ExcelJS expands cell by cell
// until it fails ("Too many properties to enumerate", found 20 Nov). Nothing we read uses them.
import JSZip from 'jszip'
import type { Workbook } from 'exceljs'

export async function loadXlsx(data: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const zip = await JSZip.loadAsync(data)
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    if (!xml.includes('dataValidation')) continue
    zip.file(name, xml.replace(/<(\w+:)?dataValidations\b[\s\S]*?<\/(\w+:)?dataValidations>/g, '').replace(/<(\w+:)?dataValidations\b[^>]*\/>/g, ''))
  }
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await zip.generateAsync({ type: 'arraybuffer' }))
  return wb
}
