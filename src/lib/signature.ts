// The du Boulay email signature (24 Nov). One company signature, kept in Settings › Email signature, goes at the foot of every
// email the app makes for someone outside the company: the Outlook drafts (orders, variations, PQQs, snag lists, tender
// enquiries, RFI queries) and the ones the server sends (minutes, RFI and action chasers, sign-in codes).
// It is HTML with two placeholders: {{person}} (the sender's name, job title and phone, from their profile; left out of
// the emails the server sends) and {{logo}} (the DBP logo). Blank = the standard signature below.
import { supabase } from './supabase'
import { cached } from './offline'
import type { CompanySettings, Profile } from './types'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// the standard signature, from the company details in Settings
export function defaultSignature(c?: Pick<CompanySettings, 'address' | 'phone' | 'email' | 'website'> | null) {
  const address = (c?.address ?? 'Studio 7, Royal Victoria Patriotic Building, John Archer Way, London SW18 3SX').split(/\n/).map((s) => s.trim()).filter(Boolean).join(', ')
  const web = (c?.website ?? 'duboulay.co.uk').replace(/^https?:\/\//, '')
  const line = [c?.phone ?? '020 8877 0266', c?.email ?? 'office@duboulay.co.uk', `<a href="https://${esc(web)}" style="color:#007abe;text-decoration:none">${esc(web)}</a>`]
    .map((x, i) => (i < 2 ? esc(x) : x))
    .join(' &nbsp;|&nbsp; ')
  return (
    `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:10pt;color:#1d1d24">` +
    `{{person}}` +
    `<img src="{{logo}}" alt="du Boulay Projects" width="170" style="display:block;border:0;margin:0 0 8px">` +
    `<div style="color:#007abe">${esc(address)}<br>${line}</div>` +
    `<div style="font-size:8pt;color:#6b6b78;margin-top:6px">du Boulay Projects Limited is a limited company registered in England No. 08431815 &nbsp;|&nbsp; VAT No: 461 246 603</div>` +
    `</div>`
  )
}

// ---------- cleaning what's pasted in (an Outlook signature brings a lot with it) ----------
const TAGS = new Set(['div', 'p', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'img', 'font', 'ul', 'ol', 'li', 'hr', 'sup', 'sub'])
const ATTRS = new Set(['style', 'href', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border', 'align', 'valign', 'color', 'face', 'size', 'bgcolor'])
const okStyle = (s: string) =>
  s
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/url\s*\(|expression|javascript|behavior|position\s*:|@import/i.test(d))
    .join(';')

export function cleanSignature(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('script, style, iframe, object, embed, form, link, meta, title, head').forEach((n) => n.remove())
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase()
      if (!TAGS.has(tag)) {
        walk(child)
        child.replaceWith(...child.childNodes)
        continue
      }
      for (const a of [...child.attributes]) {
        const v = a.value.trim()
        let keep = ATTRS.has(a.name)
        if (a.name === 'href') keep = /^(https?:|mailto:|tel:)/i.test(v)
        if (a.name === 'src') keep = tag === 'img' && (/^https:/i.test(v) || /^data:image\/(png|jpe?g|gif);base64,/i.test(v) || v === '{{logo}}')
        if (!keep) child.removeAttribute(a.name)
        else if (a.name === 'style') {
          const s = okStyle(v)
          if (s) child.setAttribute('style', s)
          else child.removeAttribute('style')
        }
      }
      if (tag === 'img' && !child.getAttribute('src')) child.remove()
      else walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

// ---------- what goes into a particular email ----------
export interface SignatureSource {
  template: string | null
  company: Pick<CompanySettings, 'address' | 'phone' | 'email' | 'website'> | null
  person: Pick<Profile, 'full_name' | 'job_title' | 'phone'> | null
}
export const personHtml = (p: SignatureSource['person']) =>
  p && p.full_name
    ? `<p style="margin:0 0 10px"><b>${esc(p.full_name)}</b>${p.job_title ? `<br>${esc(p.job_title)}` : ''}${p.phone ? `<br>T: ${esc(p.phone)}` : ''}</p>`
    : ''
export const fillSignature = (src: SignatureSource) => (src.template?.trim() || defaultSignature(src.company)).replace(/\{\{person\}\}/g, personHtml(src.person))

export async function loadSignatureSource(): Promise<SignatureSource> {
  const [cs, me] = await Promise.all([
    cached('company-settings', async () => {
      const r = await supabase.from('company_settings').select('*').eq('id', 1).single()
      if (r.error) throw new Error(r.error.message)
      return r.data as CompanySettings & { email_signature?: string | null }
    }).catch(() => null),
    supabase.auth.getUser().then(async (u) => {
      const id = u.data.user?.id
      if (!id) return null
      const r = await supabase.from('profiles').select('full_name, job_title, phone').eq('id', id).single()
      return (r.data as SignatureSource['person']) ?? null
    }),
  ])
  return { template: (cs as { email_signature?: string | null } | null)?.email_signature ?? null, company: cs, person: me }
}

// pictures in the signature become attachments the email shows inline: {{logo}} is the DBP logo, a pasted one is its own picture
export interface InlineImage {
  cid: string
  type: string
  blob: Blob
}
export async function inlineImages(html: string): Promise<{ html: string; images: InlineImage[] }> {
  const images: InlineImage[] = []
  const found = new Map<string, string>()
  let n = 0
  const srcs = [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)].map((m) => m[1])
  for (const src of srcs) {
    if (found.has(src)) continue
    try {
      let blob: Blob | null = null
      if (src === '{{logo}}') {
        const r = await fetch('/dbp-logo.png')
        if (r.ok) blob = await r.blob()
      } else if (src.startsWith('data:')) {
        blob = await (await fetch(src)).blob()
      }
      if (blob) {
        const cid = `sig${++n}@dbp`
        images.push({ cid, type: blob.type || 'image/png', blob })
        found.set(src, `cid:${cid}`)
      }
    } catch {
      /* the picture is left out */
    }
  }
  let out = html
  for (const [src, cid] of found) out = out.split(`src="${src}"`).join(`src="${cid}"`)
  // a picture we couldn't fetch would show as broken: drop it
  out = out.replace(/<img\b[^>]*?\ssrc="(\{\{logo\}\}|data:[^"]*)"[^>]*>/gi, '')
  return { html: out, images }
}

// the emails used to end with "name / title / du Boulay Projects Limited" typed in: that is now the signature's job
export function dropOldSignoff(html: string): string {
  const m = /<p>((?:(?!<\/p>).)*?)<\/p>\s*$/s.exec(html)
  if (!m || !/du Boulay Projects Limited\s*$/.test(m[1])) return html
  const head = m[1].split('<br>')[0].trim()
  const keep = /^(kind )?regards,?$/i.test(head) ? `<p>${head}</p>` : ''
  return html.slice(0, m.index) + keep
}

export const sentWithSignature = (html: string, sigHtml: string) => `${dropOldSignoff(html)}<br>${sigHtml}`
