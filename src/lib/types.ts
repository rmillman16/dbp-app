// Shapes of the database rows the app uses (see supabase/001_dbp_app_schema.sql).

export type JobStatus = 'tender' | 'live' | 'complete' | 'archived'

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  tender: 'Tender',
  live: 'Live',
  complete: 'Complete',
  archived: 'Archived',
}

export interface Job {
  id: string
  job_no: number
  code: string
  name: string
  site_address: string | null
  status: JobStatus
  contract_form: string | null
  contract_sum: number | null
  start_date: string | null
  pc_date: string | null
  retention_pct: number
  ohp_pct: number
  prelims_pct: number
  sharepoint_site_url: string | null
}

export type VoStatus = 'not_issued' | 'issued' | 'agreed' | 'rejected'

export const VO_STATUS_LABELS: Record<VoStatus, string> = {
  not_issued: 'Not issued',
  issued: 'Issued',
  agreed: 'Agreed',
  rejected: 'Rejected',
}

export interface Variation {
  id: string
  job_id: string
  vo_no: number
  title: string
  description: string | null
  status: VoStatus
  vo_date: string
  budget_value: number | null
  ohp_pct: number | null
  prelims_pct: number | null
  programme_days: number | null
  instruction_ref: string | null
  date_issued: string | null
  date_agreed: string | null
  notes: string | null
}

export type VoSection = 'omit' | 'add'

export interface VariationLine {
  id?: string
  variation_id?: string
  section: VoSection
  description: string
  qty: number | null
  unit: string | null
  rate: number | null
  total: number | null
  sort: number
}

// ---------- company and templates (admin) ----------
export interface CompanySettings {
  id: number
  legal_name: string
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  default_retention_pct: number
  default_ohp_pct: number
  default_prelims_pct: number
}

export interface Insurance {
  id: string
  cover: string
  insurer: string | null
  policy_no: string | null
  limit_text: string | null
  limit_amount: number | null
  excess: number | null
  start_date: string | null
  end_date: string
  certificate_url: string | null
}

export interface TextTemplate {
  key: string
  title: string
  category: string | null
  body: string
  notes: string | null
  sort: number
  updated_at: string
}

export interface Clause {
  id: string
  title: string
  body: string
  category: string | null
  approved: boolean
}

export interface OmDocType {
  id: string
  trade: string
  name: string
  standard: boolean
  job_id: string | null
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  initials: string | null
  is_admin: boolean
}

export type Severity = 'overdue' | 'due_soon' | 'info'

export interface Notification {
  id: string
  job_id: string | null
  kind: string
  title: string
  detail: string | null
  due_date: string | null
  link: string | null
  source_table: string | null
  source_id: string | null
  severity: Severity
}
