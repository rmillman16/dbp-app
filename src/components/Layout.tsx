import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { NotificationsProvider } from '../lib/notifications'
import { clearOfflineCopy, useOnline } from '../lib/offline'
import { useIsAdmin } from '../lib/admin'
import Bell from './Bell'
import { useAccess, type Section } from '../lib/access'
import { PageErrorBoundary } from './NoAccess'
import { trackPage } from '../lib/usage'
import { startOutbox } from '../lib/outbox'
import OutboxPill from './OutboxPill'

// Company-wide areas (agreed 20 Nov). Each job's modules are tabs inside the job (see JobLayout).
const NAV: { to: string; label: string; icon: string; soon?: boolean; admin?: boolean; section?: Section }[] = [
  { to: '/', label: 'Home', icon: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z' },
  { to: '/tasks', label: 'Tasks', icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9' },
  { to: '/dashboard', label: 'Dashboard', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', section: 'dashboard', admin: true },
  { to: '/jobs', label: 'Jobs', icon: 'M4 7h16v13H4zM9 7V4h6v3', section: 'jobs' },
  {
    to: '/estimating',
    label: 'Estimating',
    icon: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 7h6M9 11h2M13 11h2M9 15h2M13 15h2',
    section: 'estimating',
  },
  { to: '/contracts', label: 'Contracts', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7', section: 'contracts' },
  { to: '/site', label: 'Site', icon: 'M4 6h10M4 12h16M4 18h7M17 4v4M20 10v4M14 16v4', section: 'site' },
  {
    to: '/contractors',
    label: 'Supply Chain',
    icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 3-5 6-5s6 2 6 5m0-5c1-.6 2-1 3-1 3 0 5 2 5 5',
    section: 'contractors',
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
    admin: true,
  },
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
  const { can } = useAccess()

  // close the phone menu whenever you move to another page
  useEffect(() => setMenuOpen(false), [pathname])
  // count the page for Settings › Usage
  useEffect(() => trackPage(pathname), [pathname])
  // send whatever was saved on this device with no signal (snags, site diaries, photos…)
  useEffect(() => startOutbox(), [])

  // areas you can't open stay in the menu, greyed with a padlock: clicking one explains and lets you request access (from IT)
  const navItems = NAV.filter((n) => !n.admin || isAdmin).map((n) =>
    n.soon ? (
      <span key={n.to} className="nav-item disabled" title="Coming soon">
        <NavIcon d={n.icon} />
        {n.label}
        <span className="soon">soon</span>
      </span>
    ) : (
      <NavLink key={n.to} to={n.to} end={n.to === '/'} className={'nav-item' + (n.section && !can(n.section) ? ' locked' : '')} title={n.section && !can(n.section) ? 'You don’t have access to this yet: open it to request access' : undefined}>
        <NavIcon d={n.icon} />
        {n.label}
      </NavLink>
    ),
  )
  // the guide, below Settings: opens in its own tab so it can stay beside the work
  navItems.push(
    <a key="help" href="/help" target="_blank" rel="noopener" className="nav-item" title="A guide to using the app (opens in a new tab)">
      <NavIcon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
      Help
    </a>,
  )
  const offlinePill = (
    <>
      {!online && <span className="offline-pill">Offline · showing the last saved copy</span>}
      <OutboxPill />
    </>
  )

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
              <NavLink to="/me" className="muted small ellipsis" onClick={() => setMenuOpen(false)} title="My details">
                {email}
              </NavLink>
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
            <NavLink to="/me" className="muted small ellipsis" title="My details (name and job title for letters)">
              {email}
            </NavLink>
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
          <main className="page">
            <PageErrorBoundary resetKey={pathname}>{children}</PageErrorBoundary>
          </main>
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
