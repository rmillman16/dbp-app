import { useEffect, useMemo, useState } from 'react'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { downloadBlob } from '../lib/letter'
import {
  VAR_FILE_KINDS,
  addVarFile,
  emlDraft,
  escHtml,
  fileBlob,
  loadVarFiles,
  markInstructed,
  openFile,
  variationDocx,
  type VarFile,
} from '../lib/orders'
import { logPqqSent } from '../lib/pqq'
import type { Company, Job, Order, Profile, SubVariation } from '../lib/types'
import type { Contact } from './ContactsEditor'
import MoneyInput from './MoneyInput'
import { folderAccess, orderFolderName, writeInto } from '../lib/orderFolder'
import { orderLabel } from '../lib/subcontracts'
import { removeVarFile } from '../lib/orders'

// Orders › the subcontractor's variations (23 Nov, script 056): fill in the variation, attach their quote / emails (filed
// in a folder for that variation inside the order's own folder), then "Instruct" makes the instruction letter and an
// Outlook draft to the subcontractor with the letter and every file attached. Nothing is sent automatically.
export default function OrderVariations({
  job,
  order,
  company,
  contact,
  toEmail,
  me,
  vars,
  setVars,
  ensureSaved,
  onDirty,
  onMsg,
  onError,
  onOrderChanged,
}: {
  job: Job
  order: Order
  company: Company | null
  contact: Contact | null
  toEmail: string | null
  me: Profile | null
  vars: SubVariation[]
  setVars: (v: SubVariation[]) => void
  ensureSaved: () => Promise<SubVariation[] | null> // saves the order and its variations, returns them with their ids
  onDirty: () => void
  onMsg: (m: string | null) => void
  onError: (m: string | null) => void
  onOrderChanged: () => void
}) {
  const [files, setFiles] = useState<VarFile[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [kind, setKind] = useState<VarFile['kind']>('quote')

  useEffect(() => {
    loadVarFiles(order.id).then(setFiles, () => {})
  }, [order.id, vars.length])

  const setVar = (i: number, patch: Partial<SubVariation>) => (onDirty(), setVars(vars.map((v, j) => (j === i ? { ...v, ...patch } : v))))
  const instructedTotal = useMemo(() => vars.filter((v) => v.instructed).reduce((s, v) => s + Number(v.value ?? 0), 0), [vars])
  const revised = order.order_value != null ? Number(order.order_value) + instructedTotal : null

  async function run(key: string, f: () => Promise<void>) {
    onError(null)
    setBusy(key)
    try {
      await f()
    } catch (e) {
      onError(saveError(e))
    } finally {
      setBusy(null)
    }
  }

  const label = orderLabel(order, company)
  async function upload(i: number, list: File[]) {
    const root = await folderAccess(job.id) // first, while the click's permission prompt is still allowed
    await run('up' + i, async () => {
      const folder = root ? await orderFolderName(root, order.folder_no, company?.name ?? '', label) : label
      const saved = await ensureSaved()
      const v = saved?.find((x) => x.ref === vars[i].ref && x.description === vars[i].description) ?? saved?.[i]
      if (!v?.id) throw new Error('Give the variation a reference or description first.')
      const added: VarFile[] = []
      let where = ''
      for (const f of list) {
        added.push(await addVarFile(order.id, { id: v.id, ref: v.ref }, f, kind))
        if (root) where = await writeInto(root, [folder, 'Variations', v.ref || 'variation'], f.name, f)
      }
      setFiles((l) => [...l, ...added])
      onMsg(
        `Filed ${added.length} file${added.length === 1 ? '' : 's'} under ${v.ref ?? 'the variation'} in this order's folder` +
          (where ? `, and in SharePoint (${where}).` : '. Link the synced SharePoint folder (SharePoint folder, above) to file them there too.'),
      )
    })
  }

  // the instruction: letter + Outlook draft with the letter and everything filed under this variation attached
  async function instruct(i: number) {
    if (!company) return
    const root = await folderAccess(job.id)
    await run('ins' + i, async () => {
      const folder = root ? await orderFolderName(root, order.folder_no, company.name, label) : label
      const saved = await ensureSaved()
      const v = saved?.find((x) => x.ref === vars[i].ref && x.description === vars[i].description) ?? saved?.[i]
      if (!v?.id) throw new Error('Give the variation a reference or description first.')
      if (v.value == null) throw new Error(`${v.ref ?? 'The variation'} needs a value before it can be instructed.`)
      onMsg('Building the instruction and email (fetching the files)…')
      const all = saved!.filter((x) => x.instructed || x.id === v.id).reduce((s, x) => s + Number(x.value ?? 0), 0)
      const revisedValue = order.order_value != null ? Number(order.order_value) + all : null
      const letter = await variationDocx({ job, order, company, contact, v, revisedOrderValue: revisedValue, signer: me })
      const letterName = `${order.order_no ?? 'Order'} ${v.ref ?? 'Variation'} instruction.docx`
      const where = root ? await writeInto(root, [folder, 'Variations', v.ref || 'variation'], letterName, letter) : ''
      // file the instruction itself with the variation's other files
      const letterFile = new File([letter], letterName, { type: letter.type })
      const filed = await addVarFile(order.id, { id: v.id, ref: v.ref }, letterFile, 'instruction', `${v.ref ?? 'Variation'} instruction`)
      const mine = [...files, filed].filter((f) => f.variation_id === v.id)
      const attachments = [{ name: letterName, blob: letter }, ...(await Promise.all(mine.filter((f) => f.id !== filed.id).map(async (f) => ({ name: f.file_name, blob: await fileBlob(f.path) }))))]
      const greeting = contact?.name ? `Dear ${escHtml(contact.name.split(' ')[0])},` : 'Dear Sir or Madam,'
      const html = [
        `<p>${greeting}</p>`,
        `<p>Further to your quotation, please find attached our instruction for variation <b>${escHtml(v.ref ?? '')}</b>${v.description ? ` (${escHtml(v.description)})` : ''} to order <b>${escHtml(order.order_no ?? '')}</b> at ${escHtml(job.name)}, value ${escHtml(money(v.value))} excluding VAT.</p>`,
        revisedValue != null ? `<p>The order value, with all instructed variations, is now ${escHtml(money(revisedValue))} excluding VAT.</p>` : '',
        '<p>Please proceed, and confirm receipt and acceptance by return.</p>',
        '<p>Kind regards,</p>',
        `<p>${escHtml(me?.full_name ?? '')}${me?.job_title ? '<br>' + escHtml(me.job_title) : ''}<br>du Boulay Projects Limited</p>`,
      ].join('')
      const eml = await emlDraft({
        to: toEmail ? [toEmail] : [],
        subject: `${job.job_no} ${job.code} ${job.name}: Variation instruction ${v.ref ?? ''} to order ${order.order_no ?? ''}`,
        html,
        attachments,
      })
      downloadBlob(eml, `${order.order_no ?? 'Order'} ${v.ref ?? 'Variation'} instruction email.eml`)
      await markInstructed(v.id)
      await logPqqSent({ company_id: company.id, order_id: order.id, via: 'order', sent_to: toEmail, documents: attachments.map((a) => a.name), note: `Variation ${v.ref ?? ''} instructed` })
      setVars(saved!.map((x) => (x.id === v.id ? { ...x, instructed: true, instructed_on: new Date().toISOString().slice(0, 10), instruction_emailed_at: new Date().toISOString() } : x)))
      setFiles((l) => [...l, filed])
      onOrderChanged()
      onMsg(
        `Downloaded the ${v.ref ?? 'variation'} email: open it and it opens in Outlook as a new message with ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}, ready to check and send. The instruction is filed with the variation${where ? ` and in SharePoint (${where})` : ''}, and it's marked instructed.` +
          (toEmail ? '' : ' There was no email address for them: add it in Outlook.'),
      )
    })
  }

  return (
    <section className="card">
      <h2>Subcontractor's variations</h2>
      <p className="muted small">
        DBP's list for this order. Attach their quote or emails to a variation and they're filed in a folder for it inside this order's folder. "Instruct" makes the instruction letter
        and an Outlook draft with everything attached. Each application's variations are checked against this list (reference and value).
      </p>
      {vars.length === 0 && <p className="muted small">None yet.</p>}
      {vars.map((v, i) => {
        const mine = files.filter((f) => f.variation_id === v.id)
        return (
          <div key={v.id ?? 'n' + i} className="var-card">
            <div className="var-head">
              <input className="var-ref" value={v.ref ?? ''} placeholder="VA1" aria-label="Ref" onChange={(e) => setVar(i, { ref: e.target.value || null })} />
              <input className="var-desc" value={v.description ?? ''} placeholder="Description" aria-label="Description" onChange={(e) => setVar(i, { description: e.target.value || null })} />
              <MoneyInput value={v.value} onChange={(x) => setVar(i, { value: x })} />
              <label className="small var-instructed">
                <input type="checkbox" checked={v.instructed} onChange={(e) => setVar(i, { instructed: e.target.checked })} /> Instructed
                {v.instructed_on ? ` ${ukDate(v.instructed_on)}` : ''}
              </label>
              <button
                type="button"
                className="small-button"
                title="Remove variation"
                onClick={() => confirm(`Remove ${v.ref ?? 'this variation'}${mine.length ? ' and the files filed under it' : ''}?`) && (onDirty(), setVars(vars.filter((_, j) => j !== i)))}
              >
                ✕
              </button>
            </div>
            <div className="var-files app-controls">
              <span className="muted small">📁 Variations / {v.ref || '…'}</span>
              {mine.map((f) => (
                <span key={f.id} className="var-file">
                  <button type="button" className="link-button small" onClick={() => openFile(f.path).catch((e) => onError((e as Error).message))} title={f.file_name}>
                    {f.kind === 'instruction' ? '✉ ' : ''}
                    {f.name}
                  </button>
                  <button
                    type="button"
                    className="small-button"
                    title="Remove file"
                    onClick={() =>
                      confirm(`Remove ${f.name}?`) &&
                      run('rm' + f.id, async () => {
                        await removeVarFile(f)
                        setFiles((l) => l.filter((x) => x.id !== f.id))
                      })
                    }
                  >
                    ✕
                  </button>
                </span>
              ))}
              <select value={kind} onChange={(e) => setKind(e.target.value as VarFile['kind'])} aria-label="Type of file">
                {VAR_FILE_KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="file-button">
                <input
                  type="file"
                  multiple
                  disabled={!!busy}
                  onChange={(e) => {
                    const list = [...(e.target.files ?? [])]
                    e.target.value = ''
                    if (list.length) upload(i, list)
                  }}
                />
                <span className="button">{busy === 'up' + i ? 'Filing…' : '+ File quote / email…'}</span>
              </label>
              <button type="button" className="primary" disabled={!!busy || !company} onClick={() => instruct(i)}>
                {busy === 'ins' + i ? 'Building…' : v.instructed ? 'Re-send instruction (Outlook draft)' : 'Instruct (Outlook draft)'}
              </button>
            </div>
          </div>
        )
      })}
      <button className="small-button" onClick={() => (onDirty(), setVars([...vars, { ref: `VA${vars.length + 1}`, description: null, value: null, instructed: false }]))}>
        + Add variation
      </button>
      {order.order_value != null && (
        <p className="small">
          Order value {money(order.order_value)}
          {instructedTotal ? ` + instructed variations ${money(instructedTotal)} = ` : ' = '}
          <strong>{money(revised)}</strong> revised.
        </p>
      )}
    </section>
  )
}
