import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { configError, supabase } from './lib/supabase'
import Layout from './components/Layout'
import { AccessProvider } from './lib/access'
import { prefetchPages } from './lib/prefetch'
import { RequireAccess as A } from './components/NoAccess'
import JobsTable from './components/JobsTable'
import SignIn from './pages/SignIn'
import Home from './pages/Home'

// Pages load when first opened (a smaller first download), not all at once.
const JobForm = lazy(() => import('./pages/JobForm'))
const JobLayout = lazy(() => import('./pages/JobLayout'))
const JobOverview = lazy(() => import('./pages/JobOverview'))
const VariationsRegister = lazy(() => import('./pages/VariationsRegister'))
const VariationEditor = lazy(() => import('./pages/VariationEditor'))
const Contracts = lazy(() => import('./pages/Sections').then((m) => ({ default: m.Contracts })))
const ApplicationsTab = lazy(() => import('./pages/ApplicationsTab'))
const ApplicationEditor = lazy(() => import('./pages/ApplicationEditor'))
const SubcontractsTab = lazy(() => import('./pages/Subcontracts'))
const OldOrdersLink = lazy(() => import('./pages/Subcontracts').then((m) => ({ default: m.OldOrdersLink })))
const OrderPage = lazy(() => import('./pages/Subcontracts').then((m) => ({ default: m.OrderPage })))
const PaymentNoticeEditor = lazy(() => import('./pages/PaymentNoticeEditor'))
const Contractors = lazy(() => import('./pages/Contractors'))
const EotTab = lazy(() => import('./pages/EotTab'))
const CashflowTab = lazy(() => import('./pages/CashflowTab'))
const ProgrammeTab = lazy(() => import('./pages/ProgrammeTab'))
const ProgrammeHelp = lazy(() => import('./pages/ProgrammeHelp'))
const SamplingTab = lazy(() => import('./pages/SamplingTab'))
const ProcurementTab = lazy(() => import('./pages/ProcurementTab'))
const CvrTab = lazy(() => import('./pages/CvrTab'))
const CvrEditor = lazy(() => import('./pages/CvrEditor'))
const OmTab = lazy(() => import('./pages/OmTab'))
const RfiTab = lazy(() => import('./pages/RfiTab'))
const RfiPage = lazy(() => import('./pages/RfiPage'))
const ProgressReportsTab = lazy(() => import('./pages/ProgressReportsTab'))
const ProgressReportPage = lazy(() => import('./pages/ProgressReportPage'))
const SubmittalsTab = lazy(() => import('./pages/SubmittalsTab'))
const SubmittalPage = lazy(() => import('./pages/SubmittalPage'))
const EnquiryRfis = lazy(() => import('./pages/EnquiryRfis'))
const TenderEnquiry = lazy(() => import('./pages/TenderEnquiry'))
const ExternalRoutes = lazy(() => import('./pages/ExternalPages'))
const SnagExternal = lazy(() => import('./pages/SnagExternal'))
const SnaggingTab = lazy(() => import('./pages/SnaggingTab'))
const BreeamTab = lazy(() => import('./pages/BreeamTab'))
const SnagDetail = lazy(() => import('./pages/SnagPage').then((m) => ({ default: m.SnagDetail })))
const SnagNew = lazy(() => import('./pages/SnagPage').then((m) => ({ default: m.SnagNew })))
const Estimating = lazy(() => import('./pages/Estimating'))
const EnquiryForm = lazy(() => import('./pages/Estimating').then((m) => ({ default: m.EnquiryForm })))
const EnquiryPage = lazy(() => import('./pages/Estimating').then((m) => ({ default: m.EnquiryPage })))
const EnquiryProgramme = lazy(() => import('./pages/Estimating').then((m) => ({ default: m.EnquiryProgramme })))
const EnquiryReturn = lazy(() => import('./pages/Estimating').then((m) => ({ default: m.EnquiryReturn })))
const EnquiryTender = lazy(() => import('./pages/Estimating').then((m) => ({ default: m.EnquiryTender })))
const Settings = lazy(() => import('./pages/Settings'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MyDetails = lazy(() => import('./pages/MyDetails'))
const Site = lazy(() => import('./pages/Site'))
const BuyerList = lazy(() => import('./pages/Site').then((m) => ({ default: m.BuyerList })))
const HireRequisitionForm = lazy(() => import('./pages/Site').then((m) => ({ default: m.HireRequisitionForm })))
const MaterialRequisitionForm = lazy(() => import('./pages/Site').then((m) => ({ default: m.MaterialRequisitionForm })))
const RequisitionPage = lazy(() => import('./pages/Site').then((m) => ({ default: m.RequisitionPage })))
const QuotationsRegister = lazy(() => import('./pages/QuotationsRegister'))
const QuotationEditor = lazy(() => import('./pages/QuotationEditor'))
const EstimatingQuotationEditor = lazy(() => import('./pages/QuotationEditor').then((m) => ({ default: m.EstimatingQuotationEditor })))
const MinutesEnquiry = lazy(() => import('./pages/Minutes').then((m) => ({ default: m.MinutesEnquiry })))
const MinutesTab = lazy(() => import('./pages/Minutes').then((m) => ({ default: m.MinutesTab })))
const MyTasks = lazy(() => import('./pages/MyTasks'))

// The sign-in Supabase keeps on the device (cleared on sign-out).
function storedSignInEmail(): string | null {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k))
    return key ? (JSON.parse(localStorage.getItem(key)!)?.user?.email ?? null) : null
  } catch {
    return null
  }
}

export default function App() {
  // undefined = still checking whether someone is signed in
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (configError) return
    supabase.auth.getSession().then(
      ({ data }) => setSession(data.session),
      () => setSession(null),
    )
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // once signed in, fetch the other pages quietly (desktop or a fast connection only)
  const signedIn = !!session
  useEffect(() => {
    if (signedIn) prefetchPages()
  }, [signedIn])

  // outside people's pages (/r/<link> and /external): no sign-in, and none of the app around them (script 061)
  const { pathname } = useLocation()
  // a trades person's snag list (/s/<link>): the same, no sign-in (script 070)
  if (pathname.startsWith('/s/')) return <Suspense fallback={<div className="centre-page muted">Loading…</div>}><SnagExternal /></Suspense>
  if (pathname.startsWith('/r/') || pathname === '/external' || pathname.startsWith('/external/')) return <Suspense fallback={<div className="centre-page muted">Loading…</div>}><ExternalRoutes /></Suspense>

  if (configError) {
    return (
      <div className="centre-page">
        <div className="card narrow">
          <h1>Set-up needed</h1>
          <p>{configError}</p>
        </div>
      </div>
    )
  }

  if (session === undefined) return <div className="centre-page muted">Loading…</div>
  // Offline, Supabase can't refresh an expired sign-in; anyone already signed in on
  // this device carries on with the saved copy until the connection returns.
  const email = session?.user.email ?? (!navigator.onLine ? storedSignInEmail() : null)
  if (email == null) return <SignIn />

  return (
    <AccessProvider>
      <Layout email={email}>
        <Suspense fallback={<p className="muted">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/dashboard"
            element={
              <A section="dashboard">
                <Dashboard />
              </A>
            }
          />
          <Route
            path="/jobs"
            element={
              <A section="jobs">
                <JobsTable title="All jobs" />
              </A>
            }
          />
          <Route
            path="/jobs/new"
            element={
              <A section="jobs">
                <JobForm />
              </A>
            }
          />
          <Route
            path="/jobs/:id/edit"
            element={
              <A section="jobs">
                <JobForm />
              </A>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <A section="jobs">
                <JobLayout />
              </A>
            }
          >
            <Route index element={<JobOverview />} />
            <Route path="variations" element={<VariationsRegister />} />
            <Route path="variations/:voId" element={<VariationEditor />} />
            <Route path="quotations" element={<QuotationsRegister />} />
            <Route path="quotations/:quoteId" element={<QuotationEditor />} />
            <Route path="applications" element={<ApplicationsTab />} />
            <Route path="applications/:appId" element={<ApplicationEditor />} />
            <Route path="orders" element={<SubcontractsTab />} />
            <Route path="orders/:orderId" element={<OrderPage />} />
            <Route path="orders/:orderId/:noticeId" element={<PaymentNoticeEditor />} />
            <Route path="payment-notices/*" element={<OldOrdersLink />} />
            <Route path="programme" element={<ProgrammeTab />} />
            <Route path="minutes/:meetingId?" element={<MinutesTab />} />
            <Route path="cashflow" element={<CashflowTab />} />
            <Route path="procurement" element={<ProcurementTab />} />
            <Route path="sampling" element={<SamplingTab />} />
            <Route path="eot" element={<EotTab />} />
            <Route path="cvr" element={<CvrTab />} />
            <Route path="cvr/:cvrId" element={<CvrEditor />} />
            <Route path="om" element={<OmTab />} />
            <Route path="progress" element={<ProgressReportsTab />} />
            <Route path="progress/:reportId" element={<ProgressReportPage />} />
            <Route path="rfis" element={<RfiTab />} />
            <Route path="submittals" element={<SubmittalsTab />} />
            <Route path="submittals/:submittalId" element={<SubmittalPage />} />
            <Route path="rfis/:rfiId" element={<RfiPage />} />
            <Route path="breeam" element={<BreeamTab />} />
            <Route path="snagging" element={<SnaggingTab />} />
            <Route path="snagging/new" element={<SnagNew />} />
            <Route path="snagging/:snagId" element={<SnagDetail />} />
          </Route>
          <Route path="/help/programme" element={<ProgrammeHelp />} />
          <Route path="/tasks" element={<MyTasks />} />
          <Route path="/my-tasks" element={<Navigate to="/tasks" replace />} />
          <Route
            path="/estimating"
            element={
              <A section="estimating">
                <Estimating />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/tender/new"
            element={
              <A section="estimating">
                <TenderEnquiry />
              </A>
            }
          />
          <Route
            path="/estimating/new"
            element={
              <A section="estimating">
                <EnquiryForm />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId"
            element={
              <A section="estimating">
                <EnquiryPage />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/edit"
            element={
              <A section="estimating">
                <EnquiryForm />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/tender"
            element={
              <A section="estimating">
                <EnquiryTender />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/return"
            element={
              <A section="estimating">
                <EnquiryReturn />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/programme"
            element={
              <A section="estimating">
                <EnquiryProgramme />
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/rfis"
            element={
              <A section="estimating">
                <EnquiryRfis>
                  <RfiTab />
                </EnquiryRfis>
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/rfis/:rfiId"
            element={
              <A section="estimating">
                <EnquiryRfis>
                  <RfiPage />
                </EnquiryRfis>
              </A>
            }
          />
          <Route
            path="/estimating/e/:enquiryId/minutes/:meetingId?"
            element={
              <A section="estimating">
                <MinutesEnquiry />
              </A>
            }
          />
          <Route
            path="/estimating/q/:quoteId"
            element={
              <A section="estimating">
                <EstimatingQuotationEditor />
              </A>
            }
          />
          <Route
            path="/estimating/:tab"
            element={
              <A section="estimating">
                <Estimating />
              </A>
            }
          />
          <Route
            path="/contracts"
            element={
              <A section="contracts">
                <Contracts />
              </A>
            }
          />
          <Route
            path="/contractors"
            element={
              <A section="contractors">
                <Contractors />
              </A>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="/me" element={<MyDetails />} />
          <Route
            path="/site"
            element={
              <A section="site">
                <Site />
              </A>
            }
          />
          <Route path="/site/buyer" element={<Navigate to="/site/buyer/material" replace />} />
          <Route path="/site/buyer/:kind" element={<BuyerList />} />
          <Route
            path="/site/requisitions/new"
            element={
              <A section="site" what="the requisition forms">
                <MaterialRequisitionForm />
              </A>
            }
          />
          <Route
            path="/site/requisitions/hire/new"
            element={
              <A section="site" what="the requisition forms">
                <HireRequisitionForm />
              </A>
            }
          />
          <Route
            path="/site/requisitions/:reqId"
            element={
              <A section="site" what="requisitions">
                <RequisitionPage />
              </A>
            }
          />
          <Route path="/project-management" element={<Navigate to="/site" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Layout>
    </AccessProvider>
  )
}
