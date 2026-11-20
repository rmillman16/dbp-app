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

// ---------- priced SoW and client applications ----------
export interface SowRevision {
  id: string
  job_id: string
  revision: string // R5
  kind: 'office' | 'client'
  file_name: string | null
  total: number | null
  imported_at: string
  is_current: boolean
}

export interface SowLine {
  id: string
  revision_id: string
  kind: 'section' | 'item'
  section: string | null // section number, e.g. "2"
  item_ref: string | null // 2.01
  description: string | null
  qty: number | null
  unit: string | null
  rate: number | null
  total: number | null
  total_text: string | null // FOC, Excl, incl below, Client Direct
  below_line: boolean
  sort: number
}

export type AppStatus = 'draft' | 'submitted' | 'assessed' | 'paid'

export const APP_STATUS_LABELS: Record<AppStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  assessed: 'Assessed',
  paid: 'Paid',
}

export interface Application {
  id: string
  job_id: string
  app_no: number
  revision: number // R1, R2…
  status: AppStatus
  valuation_date: string | null
  submitted_date: string | null
  sow_revision_id: string | null
  psum_adjustment: number
  materials_on_site: number | null
  deposit: number | null // less deposits received
  retention_pct: number | null
  practical_completion: boolean
  previously_paid: number | null
  vat_pct: number
  client_certified: number | null
  paid_amount: number | null
  paid_date: string | null
  notes: string | null
}

export interface ApplicationLine {
  id?: string
  application_id?: string
  sow_line_id: string | null
  variation_id: string | null
  pct_claimed: number | null // 0–1, cumulative
  amount_claimed: number | null
  client_pct: number | null // "Client Assessment"
  client_amount: number | null
  comment: string | null
  client_comment: string | null
}

// ---------- estimating ----------
export type EnquiryStatus = 'enquiry' | 'pricing' | 'submitted' | 'won' | 'lost'

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  enquiry: 'New enquiry',
  pricing: 'Pricing',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
}

export interface Enquiry {
  id: string
  enquiry_no: number
  name: string
  site_address: string | null
  client_name: string | null
  client_contact: string | null
  client_email: string | null
  client_phone: string | null
  received_date: string | null
  due_date: string | null
  status: EnquiryStatus
  estimator: string | null
  notes: string | null
  job_id: string | null
}

// ---------- quotations ----------
export type QuoteStatus = 'draft' | 'issued' | 'accepted' | 'rejected' | 'withdrawn'

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export interface TextGroup {
  heading: string
  style?: 'numbered' | 'bullets'
  items: string[]
}

export interface Quotation {
  id: string
  job_id: string | null // null = Estimating (belongs to an enquiry)
  enquiry_id: string | null
  project_name: string | null // used when there's no job
  variation_id: string | null
  quote_no: number
  subject: string
  ref: string // "QU001 – Waterproofing" (database works it out)
  status: QuoteStatus
  scope: string | null // intro paragraph
  scope_groups: TextGroup[]
  qualification_groups: TextGroup[]
  summary: string | null
  client_name: string | null
  client_contact: string | null
  client_address: string | null
  prepared_by: string | null
  site: string | null
  issued_date: string | null
  valid_until: string | null
  validity_note: string | null
  accepted_date: string | null
  accepted_by: string | null
  appendices: string | null
  include_terms: boolean
  notes: string | null
}

export interface QuotationLine {
  id?: string
  quotation_id?: string
  item: string | null
  heading: string | null
  description: string
  qty: number | null
  unit: string | null
  rate: number | null
  total: number | null
  sort: number
}

export interface QuotationClause {
  quotation_id?: string
  clause_id: string
  title: string
  body: string
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
