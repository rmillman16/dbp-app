// Opens an Excel file for reading. Drop-down lists (data validations) are removed first: the
// iPlicit job costing report has them over whole columns, which ExcelJS expands cell by cell
// until it fails ("Too many properties to enumerate", found 20 Nov). Nothing we read uses them.
// It also refuses a file that has never been calculated (below).
import JSZip from 'jszip'
import type { Workbook } from 'exceljs'

export async function loadXlsx(data: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const zip = await JSZip.loadAsync(data)
  let formulas = 0
  let unsaved = 0
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    // The app reads the value Excel saves with each formula. A file produced by another program and
    // never opened and saved in Excel has formulas with no value saved at all (the Corsham enabling
    // works SoW: 2,730 of 2,785, found 21 Nov), so every total would read as blank. Excel-saved
    // files have none (a formula that works out to "" still has an empty value saved).
    for (const m of xml.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
      if (!m[1].includes('<f')) continue
      formulas++
      if (!/<v[\s>/]/.test(m[1])) unsaved++
    }
    if (!xml.includes('dataValidation')) continue
    zip.file(name, xml.replace(/<(\w+:)?dataValidations\b[\s\S]*?<\/(\w+:)?dataValidations>/g, '').replace(/<(\w+:)?dataValidations\b[^>]*\/>/g, ''))
  }
  if (formulas >= 20 && unsaved / formulas > 0.2)
    throw new Error(
      'This file has never been calculated in Excel: its formulas have no values saved, so every total would read as blank. Open it in Excel, save it (Ctrl+S), then import it again.',
    )
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await zip.generateAsync({ type: 'arraybuffer' }))
  return wb
}
