import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveError } from '../lib/offline'
import { cleanSignature, defaultSignature, fillSignature, loadSignatureSource, type SignatureSource } from '../lib/signature'
import Loading from './Loading'

// Settings › Email signature: one signature for every email that goes outside the company (24 Nov, script 088).
// Edit it here, or copy your signature from Outlook and paste it into the box. It is cleaned on the way in.
export default function EmailSignature() {
  const box = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<SignatureSource | null>(null)
  const [custom, setCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')

  const shown = (html: string) => html.replace(/src="\{\{logo\}\}"/g, 'src="/dbp-logo.png"') // the logo, as the browser can show it
  const stored = (html: string) => html.replace(/src="[^"]*\/dbp-logo\.png"/g, 'src="{{logo}}"')

  useEffect(() => {
    loadSignatureSource().then(
      (s) => {
        setSrc(s)
        setCustom(!!s.template?.trim())
        setPreview(shown(fillSignature(s)))
        requestAnimationFrame(() => {
          if (box.current) box.current.innerHTML = shown(s.template?.trim() || defaultSignature(s.company))
        })
      },
      (e: Error) => setError(e.message),
    )
  }, [])

  const refreshPreview = () => {
    if (!src || !box.current) return
    const html = cleanSignature(stored(box.current.innerHTML))
    setPreview(shown(fillSignature({ ...src, template: html })))
    setSaved(null)
  }

  async function save(reset = false) {
    if (!src || !box.current) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    const html = reset ? null : cleanSignature(stored(box.current.innerHTML)).trim() || null
    const r = await supabase.from('company_settings').update({ email_signature: html }).eq('id', 1)
    setBusy(false)
    if (r.error) return setError(/email_signature|column|schema cache/i.test(r.error.message) ? 'This needs script 088 run in Supabase first (supabase/README.md).' : saveError(r.error))
    const next = { ...src, template: html }
    setSrc(next)
    setCustom(!!html)
    if (reset && box.current) box.current.innerHTML = shown(defaultSignature(src.company))
    setPreview(shown(fillSignature(next)))
    setSaved(reset ? 'Back to the standard signature.' : 'Saved. It goes on every email from now on.')
  }

  function insertPerson() {
    box.current?.focus()
    document.execCommand('insertText', false, '{{person}}')
    refreshPreview()
  }

  if (!src) return error ? <p className="error">{error}</p> : <Loading />
  return (
    <section className="card">
      <h2>Email signature</h2>
      <p className="muted small">
        Added to the foot of every email the app makes for someone outside the company: the Outlook drafts (orders, variations, PQQs, snag lists, tender enquiries, RFI queries) and the emails the app sends itself (minutes, chasers, sign-in codes). Edit it here, or copy your signature out of Outlook and paste it into the box. Two things are filled in for you:{' '}
        <b>{'{{person}}'}</b> becomes the sender’s name, job title and phone (from their profile; left out of emails the app sends itself) and the logo picture is the du Boulay logo. {custom ? 'You are using your own signature.' : 'You are using the standard signature.'}
      </p>
      <div ref={box} className="sig-box" contentEditable suppressContentEditableWarning onInput={refreshPreview} onBlur={refreshPreview} aria-label="Email signature" />
      <div className="form-actions">
        <button type="button" className="primary" onClick={() => save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save signature'}
        </button>
        <button type="button" onClick={insertPerson} disabled={busy} title="Puts {{person}} where the cursor is">
          Insert sender’s name, title and phone
        </button>
        <button type="button" onClick={() => confirm('Go back to the standard signature?') && save(true)} disabled={busy || !custom}>
          Back to the standard signature
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">{saved}</p>}
      <h3 className="sub-head">How it looks on an email you send</h3>
      <div className="sig-preview" dangerouslySetInnerHTML={{ __html: preview }} />
    </section>
  )
}
