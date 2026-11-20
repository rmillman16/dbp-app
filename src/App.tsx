import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { configError, supabase } from './lib/supabase'
import Layout from './components/Layout'
import JobsTable from './components/JobsTable'
import SignIn from './pages/SignIn'
import Home from './pages/Home'
import JobForm from './pages/JobForm'
import JobLayout from './pages/JobLayout'
import JobOverview from './pages/JobOverview'
import VariationsRegister from './pages/VariationsRegister'
import VariationEditor from './pages/VariationEditor'
import { Commercial, Contracts, OandM } from './pages/Sections'
import Settings from './pages/Settings'
import QuotationsRegister from './pages/QuotationsRegister'
import QuotationEditor from './pages/QuotationEditor'

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
    <Layout email={email}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/jobs" element={<JobsTable title="All jobs" />} />
        <Route path="/jobs/new" element={<JobForm />} />
        <Route path="/jobs/:id/edit" element={<JobForm />} />
        <Route path="/jobs/:id" element={<JobLayout />}>
          <Route index element={<JobOverview />} />
          <Route path="variations" element={<VariationsRegister />} />
          <Route path="variations/:voId" element={<VariationEditor />} />
          <Route path="quotations" element={<QuotationsRegister />} />
          <Route path="quotations/:quoteId" element={<QuotationEditor />} />
        </Route>
        <Route path="/commercial" element={<Navigate to="/commercial/quotations" replace />} />
        <Route path="/commercial/:doc" element={<Commercial />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/om" element={<OandM />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
