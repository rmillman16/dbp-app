// Settings › Usage (24 Nov, script 080): what the team uses most. Page views by area and tab, by person, and by day, over the last 7, 30
// or 90 days. Page views only: nothing typed into the app is recorded.
import { useEffect, useState } from 'react'
import { loadUsage, type UsageArea, type UsageDay, type UsagePerson } from '../lib/usage'

const AREA: Record<string, string> = {
  home: 'Home', tasks: 'Tasks', dashboard: 'Dashboard', jobs: 'Jobs', estimating: 'Estimating', contracts: 'Contracts', site: 'Site (requisitions)',
  contractors: 'Supply Chain', settings: 'Settings', me: 'My details', help: 'Help',
}
const TAB: Record<string, string> = { rfis: 'RFIs', om: 'O&M', eot: 'EOT', cvr: 'CVR', hs: 'H&S', breeam: 'BREEAM', overview: 'Overview', snagging: 'Snagging', minutes: 'Minutes' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')
const areaName = (a: string) => AREA[a] ?? cap(a)
const tabName = (t: string) => TAB[t] ?? cap(t)
const label = (a: string, t: string) => (t ? `${areaName(a)} › ${tabName(t)}` : areaName(a))
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}
const ukDay = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/')

export default function UsagePanel() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<{ areas: UsageArea[]; people: UsagePerson[]; byDay: UsageDay[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    loadUsage(days).then(
      ([areas, people, byDay]) => live && setData({ areas, people, byDay }),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [days])

  const totalViews = data?.areas.reduce((n, a) => n + a.views, 0) ?? 0
  const maxArea = Math.max(1, ...(data?.areas.map((a) => a.views) ?? [1]))
  const maxDay = Math.max(1, ...(data?.byDay.map((d) => d.views) ?? [1]))
  // by main area too (all the tabs of a job added together)
  const byMain = new Map<string, { views: number; people: number }>()
  for (const a of data?.areas ?? []) {
    const m = byMain.get(a.area) ?? { views: 0, people: 0 }
    m.views += a.views
    m.people = Math.max(m.people, a.people)
    byMain.set(a.area, m)
  }
  const mains = [...byMain.entries()].sort((a, b) => b[1].views - a[1].views)
  const shownAreas = more ? (data?.areas ?? []) : (data?.areas ?? []).slice(0, 12)

  return (
    <section className="card usage-panel">
      <div className="pane-head">
        <h2>Usage</h2>
        <div className="usage-range" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <p className="muted small intro">What the team opens most. This counts page views by area and tab; nothing typed into the app is recorded.</p>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && totalViews === 0 && <p className="muted">Nothing recorded yet. Usage is counted from the day script 080 was run.</p>}
      {data && totalViews > 0 && (
        <>
          <div className="usage-tiles">
            <div>
              <strong>{totalViews.toLocaleString('en-GB')}</strong>
              <span>page views</span>
            </div>
            <div>
              <strong>{data.people.length}</strong>
              <span>people active</span>
            </div>
            <div>
              <strong>{mains[0] ? areaName(mains[0][0]) : '–'}</strong>
              <span>most used area</span>
            </div>
            <div>
              <strong>{data.areas[0] ? label(data.areas[0].area, data.areas[0].tab) : '–'}</strong>
              <span>most used page</span>
            </div>
          </div>

          <h3 className="sub-head">By day</h3>
          <div className="usage-days" title="Page views each day">
            {data.byDay.map((d) => (
              <span key={d.day} className="usage-day" title={`${ukDay(d.day)}: ${d.views} views, ${d.people} ${d.people === 1 ? 'person' : 'people'}`}>
                <i style={{ height: `${Math.max(4, (d.views / maxDay) * 100)}%` }} />
              </span>
            ))}
          </div>

          <div className="usage-cols">
            <div>
              <h3 className="sub-head">By area</h3>
              <table className="table usage-table">
                <tbody>
                  {mains.map(([a, m]) => (
                    <tr key={a}>
                      <td>{areaName(a)}</td>
                      <td className="usage-bar">
                        <i style={{ width: `${(m.views / (mains[0]?.[1].views || 1)) * 100}%` }} />
                      </td>
                      <td className="num">{m.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="sub-head">By page / tab</h3>
              <table className="table usage-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th></th>
                    <th className="num">Views</th>
                    <th className="num">People</th>
                    <th>Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {shownAreas.map((a) => (
                    <tr key={a.area + a.tab}>
                      <td>{label(a.area, a.tab)}</td>
                      <td className="usage-bar">
                        <i style={{ width: `${(a.views / maxArea) * 100}%` }} />
                      </td>
                      <td className="num">{a.views}</td>
                      <td className="num">{a.people}</td>
                      <td className="muted small">{ago(a.last_used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.areas.length > 12 && (
                <button type="button" className="link-button small" onClick={() => setMore(!more)}>
                  {more ? 'Show fewer' : `Show all ${data.areas.length}`}
                </button>
              )}
            </div>
          </div>

          <h3 className="sub-head">By person</h3>
          <table className="table usage-table">
            <thead>
              <tr>
                <th>Person</th>
                <th className="num">Views</th>
                <th className="num">Days active</th>
                <th>Uses most</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.profile_id}>
                  <td>{p.full_name || p.email}</td>
                  <td className="num">{p.views}</td>
                  <td className="num">{p.days_active}</td>
                  <td>{p.top_area ? p.top_area.split(' › ').map((x, i) => (i === 0 ? areaName(x) : tabName(x))).join(' › ') : ''}</td>
                  <td className="muted small">{ago(p.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
