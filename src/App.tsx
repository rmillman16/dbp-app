import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { configError, supabase } from './lib/supabase'
import Layout from './components/Layout'
import { AccessProvider } from './lib/access'
import { RequireAccess as A } from './components/NoAccess'
import JobsTable from './components/JobsTable'
import SignIn from './pages/SignIn'
import Home from './pages/Home'
import JobForm from './pages/JobForm'
import JobLayout from './pages/JobLayout'
import JobOverview from './pages/JobOverview'
import VariationsRegister from './pages/VariationsRegister'
import VariationEditor from './pages/VariationEditor'
import { Contracts } from './pages/Sections'
import ApplicationsTab from './pages/ApplicationsTab'
import ApplicationEditor from './pages/ApplicationEditor'
import SubcontractsTab, { OrderPage } from './pages/Subcontracts'
import PaymentNoticeEditor from './pages/PaymentNoticeEditor'
import Contractors from './pages/Contractors'
import EotTab from './pages/EotTab'
import CashflowTab from './pages/CashflowTab'
import ProgrammeTab from './pages/ProgrammeTab'
import ProgrammeHelp from './pages/ProgrammeHelp'
import SamplingTab from './pages/SamplingTab'
import ProcurementTab from './pages/ProcurementTab'
import CvrTab from './pages/CvrTab'
import CvrEditor from './pages/CvrEditor'
import Estimating, { EnquiryForm, EnquiryPage, EnquiryProgramme } from './pages/Estimating'
import Settings from './pages/Settings'
import MyDetails from './pages/MyDetails'
import Site, { BuyerList, MaterialRequisitionForm, RequisitionPage } from './pages/Site'
import QuotationsRegister from './pages/QuotationsRegister'
import QuotationEditor, { EstimatingQuotationEditor } from './pages/QuotationEditor'

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
        <Routes>
          <Route path="/" element={<Home />} />
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
            <Route path="payment-notices" element={<SubcontractsTab />} />
            <Route path="payment-notices/:orderId" element={<OrderPage />} />
            <Route path="payment-notices/:orderId/:noticeId" element={<PaymentNoticeEditor />} />
            <Route path="programme" element={<ProgrammeTab />} />
            <Route path="cashflow" element={<CashflowTab />} />
            <Route path="procurement" element={<ProcurementTab />} />
            <Route path="sampling" element={<SamplingTab />} />
            <Route path="eot" element={<EotTab />} />
            <Route path="cvr" element={<CvrTab />} />
            <Route path="cvr/:cvrId" element={<CvrEditor />} />
          </Route>
          <Route path="/help/programme" element={<ProgrammeHelp />} />
          <Route
            path="/estimating"
            element={
              <A section="estimating">
                <Estimating />
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
            path="/estimating/e/:enquiryId/programme"
            element={
              <A section="estimating">
                <EnquiryProgramme />
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
      </Layout>
    </AccessProvider>
  )
}
