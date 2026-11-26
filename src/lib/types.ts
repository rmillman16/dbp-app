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
  hub_url?: string | null // the one SharePoint link for outside people (script 078)
  client_company_id: string | null
  weekly_prelims: number | null // EOT prolongation rate per week
  eot_notice_days: number | null // notice of delay due this many days after an event (per contract)
  breeam?: boolean // a BREEAM job: shows the BREEAM tracker (script 071)
  report_frequency_days?: number | null // progress report every N days (064 reminds the team)
  // EOT clauses of this job's contract: typed in on the EOT tab, no defaults (script 014)
  notice_clause: string | null
  eot_clause: string | null
  le_clause: string | null
  client_contact_id: string | null // who letters go "Fao:"
  cvr_ep_pct: number | null // EP / contingency, % of contract sum (script 015)
  cvr_budget_file: string | null
  cvr_budget_total: number | null
  cvr_budget_imported_at: string | null
}

// ---------- CVR ----------
export interface CvrPackage {
  id: string
  job_id: string
  name: string
  kind: 'cost' | 'omit' | 'ep'
  sow_column: string | null
  budget: number | null
  target: number | null // typed cost target
  target_note: string | null
  supplier_note: string | null
  sort: number
  cvr_group: import('./cvrCalc').Group | null // blank = worked out from the name (script 016)
  is_remainder: boolean // the prelims lump that the prelims sections draw down
  cashflow_trade?: string | null // the trade it goes into in the cashflow: null = suggested, '' = its own row (script 021)
}

export interface Cvr {
  id: string
  job_id: string
  period_end: string // cost as at
  cost_import_id: string | null
  prepared_date: string | null
  status: 'draft' | 'final'
  possible_reduction: number
  notes: string | null
  summary: import('./cvrCalc').CvrResult | null // the figures as finalised
}

// ---------- EOT ----------
export type DelayType = 'variation' | 'late_information' | 'client_third_party'
export type EotStatus = 'draft' | 'notified' | 'claimed' | 'granted' | 'rejected'

export const DELAY_TYPE_LABELS: Record<DelayType, string> = {
  variation: 'Variation',
  late_information: 'Late information',
  client_third_party: 'Client / third party',
}

export const EOT_STATUS_LABELS: Record<EotStatus, string> = {
  draft: 'Draft',
  notified: 'Notified',
  claimed: 'Claimed',
  granted: 'Granted',
  rejected: 'Rejected',
}

export interface DelayEvent {
  id: string
  job_id: string
  event_no: number | null
  type: DelayType
  variation_id: string | null
  description: string
  details: string | null
  event_date: string | null
  days_claimed: number | null
  days_granted: number | null
  notice_due: string | null
  notice_sent: string | null
  status: EotStatus
  clause: string | null // Relevant Event clause; letters need it
  area: string | null // works affected, e.g. "the ground floor"
  mitigation: string | null
  timeline: string | null // "A short recap of events", one per line
  programme_slip?: ProgrammeSlip | null // a programme task's slippage, quoted for this event (script 029)
}

// a programme task's slippage against the original programme, as quoted on a delay event (22 Nov)
export interface ProgrammeSlip {
  code: string
  name: string
  compared_with: string // e.g. "Initial issue (original programme)"
  was_start: string
  was_finish: string
  now_start: string
  now_finish: string
  days: number // calendar days later (negative: earlier)
  working_days: number
  quoted_on: string
}

export interface EotClaim {
  id: string
  job_id: string
  claim_no: number
  submitted_date: string | null
  days_claimed: number | null
  days_granted: number | null
  weekly_prelims: number | null
  status: EotStatus
  notes: string | null
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
  cvr_package_id: string | null // CVR package its cost goes to (agreed VOs)
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
  loss_and_expense: number | null // e.g. agreed EOT prolongation
  deposit: number | null // less deposits received
  retention_pct: number | null
  practical_completion: boolean
  final_account?: boolean // this is the final account: the project is finished off (script 087)
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

// ---------- contractors and subcontract payment notices ----------
export type CompanyType = 'client' | 'subcontractor' | 'supplier' | 'consultant' | 'designer' | 'other'

export interface Company {
  id: string
  name: string
  type: CompanyType
  trade: string | null
  address: string | null // lines separated by new lines
  postcode: string | null
  email: string | null
  phone: string | null
  iplicit_code: string | null
  notes: string | null
  // PQQ (054; missing until it's run)
  pqq_status?: PqqStatus
  pqq_sent_on?: string | null
  pqq_received_on?: string | null
  pqq_approved_on?: string | null
  pqq_expires_on?: string | null // approved + 12 months
  pqq_owner?: string | null // who chases it
  pqq_notes?: string | null
  pqq_pack?: PqqPack | null // which form goes to them (055); blank = by type
}

export type PqqPack = 'subcontractor' | 'sole_trader' | 'consultant' | 'supplier'

export type PqqStatus = 'not_sent' | 'sent' | 'received' | 'approved' | 'rejected' | 'not_required'

export interface Order {
  id: string
  job_id: string
  company_id: string
  package_id: string | null // CVR package the order is against
  folder_no: number | null // 3. Orders / NN - Trade - Subcontractor
  trade: string | null
  order_no: string | null // 2611/FISL/02
  po_ref: string | null // POR000986
  order_value: number | null
  order_date: string | null
  retention_pct: number
  notes: string | null
  // 054 (missing until it's run)
  package_name?: string | null // the procurement package (its SoW name)
  scope?: string | null
  delivery_date?: string | null
  delivery_from?: string | null
  contact_id?: string | null
  status?: 'draft' | 'placed'
  placed_on?: string | null
  placed_by?: string | null
  emailed_at?: string | null
  sharepoint_folder_url?: string | null // link to the order's folder in SharePoint
}

export interface SubVariation {
  id?: string
  order_id?: string
  ref: string | null // VA1
  description: string | null
  value: number | null
  instructed: boolean
  instructed_on?: string | null // 056
  instruction_emailed_at?: string | null
}

export type Block = 'measured' | 'materials' | 'variations'

export interface SubApplication {
  id: string
  order_id: string
  app_no: number
  app_date: string | null
  received_date: string | null
  stated_gross: number | null // their gross to date
  stated_previous: number | null // their "previously applied / paid"
  stated_due: number | null // their amount due
  import_checks: unknown
  notes: string | null
}

export interface SubAppLine {
  id?: string
  sub_application_id?: string
  block: Block
  heading: string | null // their section, e.g. "4. Air conditioning systems"
  item_ref: string | null
  description: string | null
  value: number | null
  pct: number | null // 0–1
  amount: number | null // value × % (what we count)
  their_amount: number | null // what they say they claim
  note: string | null // DuB notes
  sort: number
  cert_pct?: number | null // DBP certifies, 0–1 (054); blank = as claimed
  cert_amount?: number | null
}

export interface PaymentNotice {
  id: string
  order_id: string
  notice_no: number
  sub_application_id: string | null
  status: 'draft' | 'issued'
  notice_date: string | null
  valuation_date: string | null
  payment_due_date: string | null
  dbp_payment_date: string | null
  loss_and_expense: number | null
  contra_charges: number | null
  retention_pct: number | null
  previously_paid: number | null
  prev_measured: number | null
  prev_variations: number | null
  prev_materials: number | null
  prev_loss_and_expense: number | null
  prev_contra: number | null
  notes: string | null
  measured_works: number | null // DuB assessment, stored when saved
  variations: number | null
  materials_on_site: number | null
}

export interface Adjustment {
  id?: string
  payment_notice_id?: string
  block: Block
  description: string
  amount: number
  sort: number
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
  main_contract?: string | null // script 068
  sub_contract?: string | null
  summary?: string | null
  proposed_start?: string | null // script 098
  proposed_duration?: string | null
  cdp_items?: string | null
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
  job_title: string | null // signature, e.g. Quantity Surveyor
  phone?: string | null // script 068: the sender's number on tender enquiry emails
  is_admin: boolean
  email_notifications?: boolean // script 041: email me my notifications (My details)
  is_it?: boolean // script 036: the admin login(s) IT uses; access requests go to them
  roles?: string[] // script 035: profile types (src/lib/access.tsx)
  is_operations?: boolean // script 034: sees the requisition buyer's lists (admins tick it in Settings › Users)
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
