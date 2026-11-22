import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import { cached, must, saveError } from '../lib/offline'
import { JOB_STATUS_LABELS, type Company, type Enquiry, type Job, type JobStatus } from '../lib/types'
import { loadCompanies } from '../lib/subcontracts'
import { enquiryRef, moveEnquiryToJob } from '../lib/quotations'
import { moveEnquiryProgramme } from '../lib/programme'
import { loadEnquiry } from './Estimating'

// Every input is held as text while editing and converted on save.
interface FormState {
  job_no: string
  code: string
  name: string
  site_address: string
  status: JobStatus
  contract_form: string
  contract_sum: string
  start_date: string
  pc_date: string
  sharepoint_site_url: string
  ohp_pct: string
  prelims_pct: string
  retention_pct: string
  client_company_id: string
  weekly_prelims: string
  eot_notice_days: string
}

const EMPTY: FormState = {
  job_no: '',
  code: '',
  name: '',
  site_address: '',
  status: 'live',
  contract_form: '',
  contract_sum: '',
  start_date: '',
  pc_date: '',
  sharepoint_site_url: '',
  ohp_pct: '15',
  prelims_pct: '9',
  retention_pct: '5',
  client_company_id: '',
  weekly_prelims: '',
  eot_notice_days: '',
}

function fromJob(j: Job): FormState {
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    job_no: s(j.job_no),
    code: j.code,
    name: j.name,
    site_address: s(j.site_address),
    status: j.status,
    contract_form: s(j.contract_form),
    contract_sum: s(j.contract_sum),
    start_date: s(j.start_date),
    pc_date: s(j.pc_date),
    sharepoint_site_url: s(j.sharepoint_site_url),
    ohp_pct: s(j.ohp_pct),
    prelims_pct: s(j.prelims_pct),
    retention_pct: s(j.retention_pct),
    client_company_id: s(j.client_company_id),
    weekly_prelims: s(j.weekly_prelims),
    eot_notice_days: s(j.eot_notice_days),
  }
}

export default function JobForm() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  // set up from a won Estimating enquiry: details filled in, its quotations move into the job
  const [params] = useSearchParams()
  const enquiryId = isNew ? params.get('enquiry') : null
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [carLimit, setCarLimit] = useState<number | null>(null)
  const [clients, setClients] = useState<Company[]>([])
  useEffect(() => {
    loadCompanies().then(
      (cs) => setClients(cs.filter((c) => c.type === 'client')),
      () => {},
    )
  }, [])
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    cached('car-limit', () =>
      must<{ limit_amount: number }[]>(
        supabase.from('company_insurances').select('limit_amount, end_date').eq('cover', 'Contractors all risks').order('end_date', { ascending: false }).limit(1),
      ),
    ).then(
      (data) => setCarLimit(data[0]?.limit_amount ?? null),
      () => {},
    )

    if (isNew) {
      // new jobs start with the company defaults
      cached('company-defaults', () =>
        must<{ default_ohp_pct: number; default_prelims_pct: number; default_retention_pct: number }>(
          supabase.from('company_settings').select('default_ohp_pct, default_prelims_pct, default_retention_pct').single(),
        ),
      ).then(
        (data) =>
          setForm((f) => ({
            ...f,
            ohp_pct: String(data.default_ohp_pct),
            prelims_pct: String(data.default_prelims_pct),
            retention_pct: String(data.default_retention_pct),
          })),
        () => {},
      )
      if (enquiryId)
        loadEnquiry(enquiryId).then(
          (e) => {
            setEnquiry(e)
            setForm((f) => ({ ...f, name: e.name, site_address: e.site_address ?? '' }))
          },
          () => {},
        )
    } else {
      cached(`job:${id}`, () => must<Job>(supabase.from('jobs').select('*').eq('id', id).single())).then(
        (data) => {
          setForm(fromJob(data))
          setLoading(false)
        },
        (e: Error) => {
          setError(e.message)
          setLoading(false)
        },
      )
    }
  }, [id, isNew, enquiryId])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const contractSum = form.contract_sum === '' ? null : Number(form.contract_sum)
  const overCar = carLimit != null && contractSum != null && contractSum > carLimit

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))

    if (!/^\d{4}$/.test(form.job_no)) return setError('Job no. should be four digits, year then number, e.g. 2611.')
    if (!/^[A-Z0-9]{2,8}$/.test(form.code)) return setError('Job code should be 2–8 capital letters, e.g. FISL.')

    const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim())
    const row = {
      job_no: Number(form.job_no),
      code: form.code,
      name: form.name.trim(),
      site_address: blankToNull(form.site_address),
      status: form.status,
      contract_form: blankToNull(form.contract_form),
      contract_sum: contractSum,
      start_date: blankToNull(form.start_date),
      pc_date: blankToNull(form.pc_date),
      sharepoint_site_url: blankToNull(form.sharepoint_site_url),
      ohp_pct: Number(form.ohp_pct),
      prelims_pct: Number(form.prelims_pct),
      retention_pct: Number(form.retention_pct),
      client_company_id: form.client_company_id || null,
      weekly_prelims: blankToNull(form.weekly_prelims) == null ? null : Number(form.weekly_prelims),
      eot_notice_days: blankToNull(form.eot_notice_days) == null ? null : Number(form.eot_notice_days),
    }

    setBusy(true)
    let result
    if (isNew) {
      const { data: s } = await supabase.auth.getSession()
      result = await supabase
        .from('jobs')
        .insert({ ...row, created_by: s.session?.user.id })
        .select('id')
        .single()
    } else {
      result = await supabase.from('jobs').update(row).eq('id', id).select('id').single()
    }
    setBusy(false)

    if (result.error) {
      setError(result.error.code === '23505' ? `Job ${row.job_no} ${row.code} already exists.` : saveError(result.error))
      return
    }
    if (enquiry) {
      try {
        await moveEnquiryToJob(enquiry.id, result.data.id)
      } catch (e) {
        // the job exists; say what didn't move rather than losing it
        return setError(`Job created, but the enquiry's quotations couldn't be moved: ${saveError(e)}`)
      }
      // and its programme (from Estimating) becomes the job's
      try {
        await moveEnquiryProgramme(enquiry.id, result.data.id)
      } catch (e) {
        return setError(`Job created, but the enquiry's programme couldn't be moved: ${saveError(e)}`)
      }
    }
    navigate(`/jobs/${result.data.id}`)
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <form className="card form" onSubmit={save}>
      <div className="pane-head">
        <h2>{isNew ? (enquiry ? `Set up ${enquiryRef(enquiry)} as a job` : 'Add job') : `${form.job_no} ${form.code}`}</h2>
        <Link to={isNew ? '/' : `/jobs/${id}`} className="link-button">
          {isNew ? 'Back to jobs' : 'Back to job'}
        </Link>
      </div>

      <div className="form-grid">
        <label>
          Job no.
          <input inputMode="numeric" placeholder="2611" maxLength={4} value={form.job_no} onChange={(e) => set('job_no', e.target.value.replace(/\D/g, ''))} required />
        </label>
        <label>
          Job code
          <input placeholder="FISL" maxLength={8} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} required />
        </label>
        <label className="span-2">
          Job name
          <input placeholder="Micro by The Fix" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="span-2">
          Site address
          <textarea rows={2} value={form.site_address} onChange={(e) => set('site_address', e.target.value)} />
        </label>
        <label>
          Status
          <select value={form.status} onChange={(e) => set('status', e.target.value as JobStatus)}>
            {(Object.keys(JOB_STATUS_LABELS) as JobStatus[])
              .filter((s) => s !== 'archived' || form.status === 'archived')
              .map((s) => (
                <option key={s} value={s}>
                  {JOB_STATUS_LABELS[s]}
                </option>
              ))}
          </select>
        </label>
        <label>
          Form of contract
          <input placeholder="JCT D&B 2024" value={form.contract_form} onChange={(e) => set('contract_form', e.target.value)} />
        </label>
        <label>
          Contract sum (£, excl. VAT)
          <input type="number" step="0.01" min="0" value={form.contract_sum} onChange={(e) => set('contract_sum', e.target.value)} />
          {contractSum != null && <span className="hint">{money(contractSum)}</span>}
        </label>
        <label>
          Client
          <select value={form.client_company_id} onChange={(e) => set('client_company_id', e.target.value)}>
            <option value="">Not set</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="hint">
            Letters are addressed to them. Add clients under <Link to="/contractors">Contractors</Link> (type Client).
          </span>
        </label>
        <label>
          Start on site
          <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </label>
        <label>
          PC date
          <input type="date" value={form.pc_date} onChange={(e) => set('pc_date', e.target.value)} />
        </label>
        <label className="span-2">
          SharePoint site
          <input
            type="url"
            placeholder="https://duboulay.sharepoint.com/sites/2611microbythefix"
            value={form.sharepoint_site_url}
            onChange={(e) => set('sharepoint_site_url', e.target.value)}
          />
          <span className="hint">Paste the job site's address for now; picking from a list comes with the SharePoint link.</span>
        </label>
        <label>
          OHP %
          <input type="number" step="0.01" min="0" value={form.ohp_pct} onChange={(e) => set('ohp_pct', e.target.value)} required />
        </label>
        <label>
          Prelims %
          <input type="number" step="0.01" min="0" value={form.prelims_pct} onChange={(e) => set('prelims_pct', e.target.value)} required />
        </label>
        <label>
          Retention %
          <input type="number" step="0.01" min="0" value={form.retention_pct} onChange={(e) => set('retention_pct', e.target.value)} required />
        </label>
        <label>
          Weekly prelims £ (EOT prolongation)
          <input type="number" step="0.01" min="0" value={form.weekly_prelims} onChange={(e) => set('weekly_prelims', e.target.value)} />
        </label>
        <label>
          Notice of delay due (days after an event)
          <input type="number" step="1" min="0" value={form.eot_notice_days} onChange={(e) => set('eot_notice_days', e.target.value)} />
          <span className="hint">As the contract requires; leave blank if none set.</span>
        </label>
      </div>

      {overCar && (
        <p className="warning">
          This contract sum is over the {money(carLimit)} contractors all risks limit (any one contract). Extend cover before starting; a reminder will be added to notifications
          when you save.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : isNew ? 'Add job' : 'Save changes'}
        </button>
        <Link to={isNew ? '/' : `/jobs/${id}`} className="button">
          Cancel
        </Link>
      </div>
    </form>
  )
}
