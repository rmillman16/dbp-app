import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { enquiryRef } from '../lib/quotations'
import type { Enquiry } from '../lib/types'
import { loadTracker, statusPatch, updateInvite, INVITE_LABEL, type TenderInvite, type TenderPackage } from '../lib/tender'
import {
  addExtra,
  addScopeItems,
  deleteExtra,
  deleteScopeItem,
  loadActivity,
  loadLevelling,
  loadScope,
  levelTotals,
  numberItems,
  parseScope,
  saveCell,
  syncScopeText,
  updateExtra,
  updateScopeItem,
  type ActivityRow,
  type CellStatus,
  type LevelCell,
  type LevelExtra,
  type ScopeItem,
} from '../lib/levelling'
import MoneyInput from '../components/MoneyInput'
import Loading from '../components/Loading'
import { KIND_LABEL, NEXT_KIND, indentKey } from '../components/ScopeListEditor'
import RichLine, { RichToolbar } from '../components/RichLine'
import { escapeText, plainOf, sanitizeRich } from '../lib/scopeRich'

// Scope & levelling for one tender package (script 094). The scope is a list of items; each contractor's price is levelled
// against it: included in their price, or excluded (with a plug £ and the reason), plus items added below the line.
// Everyone signed in can edit; every change is logged (who, when, what it was before) and the log can't be edited.

// a £ box that saves when you leave it (MoneyInput reports every keystroke)
function CommitMoney({ value, onCommit, placeholder }: { value: number | null; onCommit: (v: number | null) => void; placeholder?: string }) {
  const draft = useRef(value)
  return (
    <div
      onBlur={() => {
        if (draft.current !== value) onCommit(draft.current)
      }}
    >
      <MoneyInput className="small-input" value={value} placeholder={placeholder ?? '£'} onChange={(v) => (draft.current = v)} />
    </div>
  )
}

const STATUS_LABEL: Record<CellStatus, string> = { tbc: '–', included: 'Included', excluded: 'Excluded' }

export default function TenderLevelling() {
  const { enquiryId, packageId } = useParams()
  const [pkg, setPkg] = useState<TenderPackage | null>(null)
  const [enq, setEnq] = useState<Enquiry | null>(null)
  const [invites, setInvites] = useState<TenderInvite[]>([])
  const [items, setItems] = useState<ScopeItem[]>([])
  const [cells, setCells] = useState<LevelCell[]>([])
  const [extras, setExtras] = useState<LevelExtra[]>([])
  const [activity, setActivity] = useState<(ActivityRow & { who: string })[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [paste, setPaste] = useState('')
  const [exInvite, setExInvite] = useState('')
  const [exDesc, setExDesc] = useState('')
  const [exAmount, setExAmount] = useState<number | null>(null)
  const [exNote, setExNote] = useState('')

  async function load() {
    try {
      const d = await loadTracker()
      const p = d.packages.find((x) => x.id === packageId) ?? null
      setPkg(p)
      const inv = d.invites.filter((i) => i.package_id === packageId)
      setInvites(inv)
      const si = await loadScope([packageId!])
      setItems(si)
      const l = await loadLevelling(inv.map((i) => i.id))
      setCells(l.cells)
      setExtras(l.extras)
      setActivity(await loadActivity(packageId!).catch(() => []))
    } catch (e) {
      setError(saveError(e))
    }
    setLoaded(true)
  }
  useEffect(() => {
    load()
    supabase.from('enquiries').select('*').eq('id', enquiryId!).single().then((r) => setEnq((r.data ?? null) as Enquiry | null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // run a change, keep the package's email text in step with the list, and show what the database now holds
  async function run(fn: () => Promise<unknown>, scopeChanged = false) {
    setError(null)
    try {
      await fn()
      if (scopeChanged) await syncScopeText(packageId!)
      await load()
    } catch (e) {
      setError(saveError(e))
    }
  }

  const refs = useMemo(() => numberItems(items), [items])
  const cols = invites.filter((i) => i.status !== 'declined')
  const cellOf = (inv: string, item: string) => cells.find((c) => c.invite_id === inv && c.item_id === item)
  const nextSort = items.length ? Math.max(...items.map((x) => x.sort)) + 1 : 0
  const realItems = items.filter((x) => x.kind === 'item')
  const totals = new Map(cols.map((i) => [i.id, levelTotals(items, cells.filter((c) => c.invite_id === i.id), extras.filter((x) => x.invite_id === i.id), i.quote_amount)]))
  const lowest = Math.min(...cols.filter((i) => (totals.get(i.id)?.total ?? 0) > 0).map((i) => totals.get(i.id)!.total))

  async function swap(i: number, d: number) {
    const a = items[i]
    const b = items[i + d]
    if (!a || !b) return
    await run(async () => {
      await updateScopeItem(a.id, { sort: b.sort })
      await updateScopeItem(b.id, { sort: a.sort })
    }, true)
  }

  if (!loaded) return <Loading />
  if (!pkg) return <section className="card"><p className="muted">That package isn't there any more.</p></section>

  return (
    <section className="card tt-wide level-page">
      <div className="pane-head">
        <h2>
          {pkg.package} <span className="tag">{enq ? `${enquiryRef(enq)} · ${enq.name}` : 'Enquiry'}</span>
        </h2>
        <Link className="button" to={`/estimating/e/${enquiryId}`}>
          ← Back to the enquiry
        </Link>
      </div>
      <p className="muted small">
        Scope and levelling. List what the package covers, then for each contractor mark each item as included in their price or excluded; for an excluded item enter what you allow to plug the gap and why. Items they added go
        below the line. The levelled total is their price plus the plugs plus the below-the-line items. Everything here is logged.
      </p>
      {error && <p className="error">{error}</p>}

      <h3 className="sub-head">1. Scope of works</h3>
      <p className="muted small">The same list goes out to the contractors in the email. Changing it here does not re-send anything: tell the contractors if you change the scope after sending.</p>
      <div className="scope-list">
        <RichToolbar />
        {items.length === 0 && <p className="muted small">No scope items yet. Add them below, one at a time or by pasting a list.</p>}
        {items.map((x, i) => (
          <div key={x.id} className={'scope-row' + (x.kind === 'heading' ? ' scope-heading' : x.kind === 'detail' ? ' scope-detail' : '')}>
            <span className="scope-ref">{refs[i]}</span>
            <RichLine key={x.id} html={x.description} label={`Scope item ${refs[i]}`} onCommit={(h) => run(() => updateScopeItem(x.id, { description: h }), true)} />
            <button type="button" className="small-button" title="Click to change: heading, item (priced and levelled), detail (a point under an item)" onClick={() => run(() => updateScopeItem(x.id, { kind: NEXT_KIND[x.kind] }), true)}>
              {KIND_LABEL[x.kind]}
            </button>
            <button type="button" className="small-button" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, -1)}>
              ↑
            </button>
            <button type="button" className="small-button" aria-label="Move down" disabled={i === items.length - 1} onClick={() => swap(i, 1)}>
              ↓
            </button>
            <button
              type="button"
              className="small-button"
              aria-label="Remove"
              onClick={() => {
                const used = cells.filter((c) => c.item_id === x.id && c.status !== 'tbc').length
                if (confirm(used ? `Remove "${plainOf(x.description)}"? Its levelling for ${used} contractor${used === 1 ? '' : 's'} goes with it (the log keeps a record).` : `Remove "${plainOf(x.description)}"?`)) run(() => deleteScopeItem(x.id), true)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="scope-add">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a scope item and press Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                e.preventDefault()
                const d = text.trim()
                setText('')
                run(() => addScopeItems(packageId!, [{ kind: 'item', description: escapeText(d) }], nextSort), true)
              }
            }}
          />
          <button
            type="button"
            className="small-button"
            disabled={!text.trim()}
            onClick={() => {
              const d = text.trim()
              setText('')
              run(() => addScopeItems(packageId!, [{ kind: 'heading', description: escapeText(d) }], nextSort), true)
            }}
          >
            + Heading
          </button>
          <button
            type="button"
            className="small-button"
            disabled={!text.trim()}
            title="A point under the item above: goes in the email, not priced separately"
            onClick={() => {
              const d = text.trim()
              setText('')
              run(() => addScopeItems(packageId!, [{ kind: 'detail', description: escapeText(d) }], nextSort), true)
            }}
          >
            + Detail
          </button>
          <button type="button" className="small-button" onClick={() => setPasting(!pasting)}>
            Paste a list
          </button>
        </div>
        {pasting && (
          <div className="scope-paste">
            <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => indentKey(e, setPaste)} placeholder={'One line per entry. Press Tab to indent a line (Shift+Tab to take it back): three levels are heading / item / detail, two are item / detail. Or start a line with # (or end it with a colon) to make a heading.'} />
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={!paste.trim()}
                onClick={() => {
                  const list = parseScope(paste).map((x) => ({ ...x, description: escapeText(x.description) }))
                  setPaste('')
                  setPasting(false)
                  run(() => addScopeItems(packageId!, list, nextSort), true)
                }}
              >
                Add these to the list
              </button>
              <button type="button" onClick={() => setPasting(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <h3 className="sub-head">2. Level each contractor against it</h3>
      {cols.length === 0 && <p className="muted small">No contractors on this package yet. Add them from the tracker (+ Add contractor).</p>}
      {cols.length > 0 && realItems.length === 0 && <p className="muted small">Add the scope items above first (details under an item are not levelled separately).</p>}
      {cols.length > 0 && realItems.length > 0 && (
        <div className="level-scroll">
          <table className="table level-grid">
            <thead>
              <tr>
                <th>Scope item</th>
                {cols.map((i) => (
                  <th key={i.id} className={i.status === 'used' ? 'lv-used' : ''}>
                    {i.name}
                    <div className="muted small">{INVITE_LABEL[i.status]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x, n) =>
                x.kind === 'detail' ? null : x.kind === 'heading' ? (
                  <tr key={x.id} className="lv-heading">
                    <td colSpan={cols.length + 1}>
                      {refs[n]}. <span dangerouslySetInnerHTML={{ __html: sanitizeRich(x.description) }} />
                    </td>
                  </tr>
                ) : (
                  <tr key={x.id}>
                    <td className="lv-item">
                      <span className="scope-ref">{refs[n]}</span> <span dangerouslySetInnerHTML={{ __html: sanitizeRich(x.description) }} />
                      {(() => {
                        const det: ScopeItem[] = []
                        for (let k = n + 1; k < items.length && items[k].kind === 'detail'; k++) det.push(items[k])
                        return det.length ? (
                          <ul className="lv-details">
                            {det.map((d) => (
                              <li key={d.id} dangerouslySetInnerHTML={{ __html: sanitizeRich(d.description) }} />
                            ))}
                          </ul>
                        ) : null
                      })()}
                    </td>
                    {cols.map((i) => {
                      const c = cellOf(i.id, x.id)
                      const st: CellStatus = c?.status ?? 'tbc'
                      return (
                        <td key={i.id} className={'lv-cell lv-' + st}>
                          <select value={st} onChange={(e) => run(() => saveCell(i.id, x.id, { status: e.target.value as CellStatus }))}>
                            {(['tbc', 'included', 'excluded'] as CellStatus[]).map((k) => (
                              <option key={k} value={k}>
                                {k === 'tbc' ? 'Not checked' : STATUS_LABEL[k]}
                              </option>
                            ))}
                          </select>
                          {st === 'included' && <CommitMoney key={(c?.id ?? '') + (c?.their_amount ?? '')} value={c?.their_amount ?? null} placeholder="Their £ (optional)" onCommit={(v) => run(() => saveCell(i.id, x.id, { their_amount: v }))} />}
                          {st === 'excluded' && <CommitMoney key={(c?.id ?? '') + (c?.plug_amount ?? '')} value={c?.plug_amount ?? null} placeholder="Plug £" onCommit={(v) => run(() => saveCell(i.id, x.id, { plug_amount: v }))} />}
                          {st !== 'tbc' && (
                            <input
                              className="lv-note"
                              key={(c?.id ?? '') + (c?.note ?? '')}
                              defaultValue={c?.note ?? ''}
                              placeholder={st === 'excluded' ? 'Why this plug' : 'Note'}
                              onBlur={(e) => e.target.value !== (c?.note ?? '') && run(() => saveCell(i.id, x.id, { note: e.target.value.trim() || null }))}
                            />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="sub-head">3. Below the line: what they added</h3>
      <p className="muted small">Items a contractor has added that are not in your scope: provisional sums, extras, qualifications. Use a minus figure for a deduction.</p>
      {extras.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Contractor</th>
              <th>Item</th>
              <th>£</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {extras.map((x) => (
              <tr key={x.id}>
                <td>{invites.find((i) => i.id === x.invite_id)?.name ?? ''}</td>
                <td>
                  <input key={x.id + x.description} defaultValue={x.description} onBlur={(e) => e.target.value.trim() && e.target.value !== x.description && run(() => updateExtra(x.id, { description: e.target.value.trim() }))} />
                </td>
                <td>
                  <CommitMoney key={x.id + x.amount} value={Number(x.amount)} onCommit={(v) => run(() => updateExtra(x.id, { amount: v ?? 0 }))} />
                </td>
                <td>
                  <input key={x.id + (x.note ?? '')} defaultValue={x.note ?? ''} onBlur={(e) => e.target.value !== (x.note ?? '') && run(() => updateExtra(x.id, { note: e.target.value.trim() || null }))} />
                </td>
                <td>
                  <button type="button" className="small-button" aria-label="Remove" onClick={() => confirm(`Remove "${x.description}"?`) && run(() => deleteExtra(x.id))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cols.length > 0 && (
        <div className="tt-manual-other lv-extra-add">
          <select value={exInvite} onChange={(e) => setExInvite(e.target.value)}>
            <option value="">Contractor…</option>
            {cols.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input placeholder="What they added" value={exDesc} onChange={(e) => setExDesc(e.target.value)} />
          <MoneyInput className="small-input" value={exAmount} placeholder="£" onChange={setExAmount} />
          <input placeholder="Note (optional)" value={exNote} onChange={(e) => setExNote(e.target.value)} />
          <button
            type="button"
            className="small-button"
            disabled={!exInvite || !exDesc.trim() || exAmount == null}
            onClick={() => {
              const [i, d, a, n] = [exInvite, exDesc.trim(), exAmount ?? 0, exNote.trim() || null]
              setExDesc('')
              setExAmount(null)
              setExNote('')
              run(() => addExtra(i, d, a, n))
            }}
          >
            + Add
          </button>
        </div>
      )}

      {cols.length > 0 && (
        <>
          <h3 className="sub-head">4. Levelled totals</h3>
          <div className="level-scroll">
            <table className="table level-totals">
              <thead>
                <tr>
                  <th />
                  {cols.map((i) => (
                    <th key={i.id} className={i.status === 'used' ? 'lv-used' : ''}>
                      {i.name}
                      {i.status === 'used' && <span className="tt-used-tag">Price used</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Their price</td>
                  {cols.map((i) => (
                    <td key={i.id}>
                      <CommitMoney
                        key={i.id + (i.quote_amount ?? '')}
                        value={i.quote_amount == null ? null : Number(i.quote_amount)}
                        onCommit={(v) => run(() => updateInvite(i.id, { quote_amount: v, ...(v != null && i.status !== 'quoted' && !['used', 'appointed', 'unsuccessful'].includes(i.status) ? statusPatch('quoted', i) : {}) }))}
                      />
                      {i.quote_amount == null && totals.get(i.id)!.itemPrices > 0 && <div className="muted small">items add to {money(totals.get(i.id)!.itemPrices)}</div>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>+ Plugs for excluded items</td>
                  {cols.map((i) => (
                    <td key={i.id}>{money(totals.get(i.id)!.plugs)}</td>
                  ))}
                </tr>
                <tr>
                  <td>+ Below the line</td>
                  {cols.map((i) => (
                    <td key={i.id}>{money(totals.get(i.id)!.extras)}</td>
                  ))}
                </tr>
                <tr className="lv-total">
                  <td>Levelled total</td>
                  {cols.map((i) => {
                    const t = totals.get(i.id)!
                    return (
                      <td key={i.id} className={t.total > 0 && t.total === lowest ? 'lv-low' : ''}>
                        {money(t.total)}
                        {t.total > 0 && t.total === lowest && <div className="muted small">lowest</div>}
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td className="muted small">Items checked</td>
                  {cols.map((i) => {
                    const t = totals.get(i.id)!
                    return (
                      <td key={i.id} className="muted small">
                        {t.checked} of {t.items}
                        {t.excluded > 0 && ` · ${t.excluded} excluded`}
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td className="muted small">Mark the one the estimate used</td>
                  {cols.map((i) => (
                    <td key={i.id}>
                      <button type="button" className="small-button" disabled={i.status === 'used'} onClick={() => run(() => updateInvite(i.id, statusPatch('used', i)))}>
                        {i.status === 'used' ? 'Price used' : 'Use this price'}
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="sub-head">Activity</h3>
      <p className="muted small">Every change to the scope, the levelling, the below-the-line items and the contractors' prices, with who made it and what it was before.</p>
      {activity.length === 0 ? (
        <p className="muted small">Nothing yet.</p>
      ) : (
        <table className="table lv-activity">
          <tbody>
            {activity.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">
                  {ukDate(a.at.slice(0, 10))} {new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="nowrap">{a.who}</td>
                <td className="nowrap muted small">{a.action}</td>
                <td>{plainOf(a.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
