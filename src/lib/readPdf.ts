// Reading a pricing PDF through the Supabase Edge Function "read-pricing-pdf" (Claude).
// Any failure (not switched on, no Anthropic credit, offline, unreadable) becomes a plain
// message that ends by asking for the Excel version instead (agreed 20 Nov).
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface PdfLine {
  section: string | null
  heading: string | null
  description: string
  qty: number | null
  unit: string | null
  rate: number | null
  total: number | null
  note: string | null
}

export interface PdfResult {
  document_type: string
  supplier: string | null
  lines: PdfLine[]
  document_total: number | null
  warnings: string[]
}

const EXCEL = 'Please upload the Excel version instead.'
const MESSAGES: Record<string, string> = {
  not_configured: `PDF reading isn't switched on yet. ${EXCEL}`,
  no_credit: `PDF reading has run out of credit (tell an admin to top up the Anthropic account). ${EXCEL}`,
  busy: `PDF reading is busy just now: try again in a minute, or ${EXCEL.toLowerCase()}`,
  too_large: `That PDF is too large to read. ${EXCEL}`,
  unreadable: `The pricing couldn't be read from that PDF. ${EXCEL}`,
  failed: `Something went wrong reading that PDF. ${EXCEL}`,
}

export class PdfReadError extends Error {}

async function toBase64(file: File) {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  return url.slice(url.indexOf(',') + 1)
}

export async function readPricingPdf(file: File): Promise<PdfResult> {
  if (!navigator.onLine) throw new PdfReadError(`You're offline, so the PDF can't be read. ${EXCEL}`)
  const { data, error } = await supabase.functions.invoke('read-pricing-pdf', { body: { pdf: await toBase64(file) } })
  if (error) {
    // a 404 means the function hasn't been put on Supabase yet
    if (error instanceof FunctionsHttpError && error.context?.status === 404) throw new PdfReadError(MESSAGES.not_configured)
    let reason = 'failed'
    try {
      reason = (await (error as FunctionsHttpError).context.json()).reason ?? 'failed'
    } catch {
      /* no readable reason in the reply */
    }
    throw new PdfReadError(MESSAGES[reason] ?? MESSAGES.failed)
  }
  if (!data?.ok) throw new PdfReadError(MESSAGES[data?.reason] ?? MESSAGES.failed)
  return data as PdfResult
}
