import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { NotificationsProvider } from '../lib/notifications'
import { clearOfflineCopy, useOnline } from '../lib/offline'
import { useIsAdmin } from '../lib/admin'
import Bell from './Bell'

// Company-wide areas (agreed 20 Nov). Each job's modules are tabs inside the job (see JobLayout).
const NAV: { to: string; label: string; icon: string; soon?: boolean; admin?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z' },
  { to: '/jobs', label: 'Jobs', icon: 'M4 7h16v13H4zM9 7V4h6v3' },
  { to: '/commercial', label: 'Commercial', icon: 'M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3.2 5 1.5 5 3.6-2.2 3.2-5 3.2-5-1.2-5-3.2' },
  { to: '/contracts', label: 'Contracts', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7' },
  { to: '/om', label: 'O&M', icon: 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z' },
  { to: '/project-management', label: 'Project management', icon: 'M4 6h10M4 12h16M4 18h7M17 4v4M20 10v4M14 16v4', soon: true },
  { to: '/contractors', label: 'Contractors', icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 3-5 6-5s6 2 6 5m0-5c1-.6 2-1 3-1 3 0 5 2 5 5', soon: true },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z', admin: true },
]

// Name of the area you're in, for the phone header.
function pageTitle(path: string) {
  const match = NAV.filter((n) => n.to !== '/' && path.startsWith(n.to))[0]
  return match?.label ?? 'Home'
}

// Sign-out also wipes the device's saved copy, so the next person on a shared device can't see it.
async function signOut() {
  await clearOfflineCopy()
  await supabase.auth.signOut()
  location.assign('/')
}

export default function Layout({ email, children }: { email: string; children: ReactNode }) {
  const online = useOnline()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const isAdmin = useIsAdmin()

  // close the phone menu whenever you move to another page
  useEffect(() => setMenuOpen(false), [pathname])

  const navItems = NAV.filter((n) => !n.admin || isAdmin).map((n) =>
    n.soon ? (
      <span key={n.to} className="nav-item disabled" title="Coming soon">
        <NavIcon d={n.icon} />
        {n.label}
        <span className="soon">soon</span>
      </span>
    ) : (
      <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-item">
        <NavIcon d={n.icon} />
        {n.label}
      </NavLink>
    ),
  )
  const offlinePill = !online && <span className="offline-pill">Offline · showing the last saved copy</span>

  return (
    <NotificationsProvider>
      {/* phones: one bar with logo, page title, bell and ☰ menu */}
      <header className="mobile-bar">
        <NavLink to="/" className="mobile-logo">
          <img src="/dbp-logo.svg" alt="du Boulay Projects" />
        </NavLink>
        <span className="mobile-title">{pageTitle(pathname)}</span>
        <Bell />
        <button className="icon-button burger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" aria-expanded={menuOpen}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <path d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {menuOpen && (
        <>
          <div className="mobile-scrim" onClick={() => setMenuOpen(false)} />
          <nav className="mobile-menu">
            {navItems}
            <div className="mobile-menu-foot">
              <span className="muted small ellipsis">{email}</span>
              <button className="link-button small" onClick={signOut}>
                Sign out
              </button>
            </div>
          </nav>
        </>
      )}
      {offlinePill && <div className="mobile-offline">{offlinePill}</div>}

      <div className="shell">
        <aside className="sidebar">
          <NavLink to="/" className="sidebar-logo">
            <img src="/dbp-logo.svg" alt="du Boulay Projects" />
          </NavLink>
          <nav>{navItems}</nav>
          <div className="sidebar-foot">
            <div className="muted small ellipsis" title={email}>
              {email}
            </div>
            <button className="link-button small" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div>{offlinePill}</div>
            <Bell />
          </header>
          <main className="page">{children}</main>
        </div>
      </div>
    </NotificationsProvider>
  )
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
