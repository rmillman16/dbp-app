import type { TextGroup } from '../lib/types'

// Sub-headed lists, as in a quotation's scope ("Waterproofing — specialist subcontractor"
// then numbered items) and qualifications ("Excluded from this quotation" then bullets).
// One item per line; **double stars** make words bold.
export default function GroupsEditor({
  groups,
  onChange,
  withStyle,
  addLabel,
}: {
  groups: TextGroup[]
  onChange: (g: TextGroup[]) => void
  withStyle?: boolean
  addLabel: string
}) {
  const set = (i: number, g: Partial<TextGroup>) => onChange(groups.map((x, j) => (j === i ? { ...x, ...g } : x)))
  const move = (i: number, by: number) => {
    const next = [...groups]
    const [g] = next.splice(i, 1)
    next.splice(i + by, 0, g)
    onChange(next)
  }

  return (
    <div className="groups">
      {groups.map((g, i) => (
        <div key={i} className="group-card">
          <div className="group-head">
            <input value={g.heading} placeholder="Sub-heading, e.g. Excluded from this quotation" onChange={(e) => set(i, { heading: e.target.value })} />
            {withStyle && (
              <select value={g.style ?? 'numbered'} onChange={(e) => set(i, { style: e.target.value as TextGroup['style'] })}>
                <option value="numbered">1. 2. 3.</option>
                <option value="bullets">▪ bullets</option>
              </select>
            )}
            <div className="group-tools">
              <button type="button" className="small-button" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                ↑
              </button>
              <button type="button" className="small-button" disabled={i === groups.length - 1} onClick={() => move(i, 1)} title="Move down">
                ↓
              </button>
              <button type="button" className="small-button" onClick={() => onChange(groups.filter((_, j) => j !== i))} title="Remove this group">
                ✕
              </button>
            </div>
          </div>
          <textarea
            rows={Math.max(3, g.items.length + 1)}
            value={g.items.join('\n')}
            placeholder="One point per line"
            onChange={(e) => set(i, { items: e.target.value.split('\n') })}
          />
        </div>
      ))}
      <button type="button" className="small-button" onClick={() => onChange([...groups, { heading: '', style: withStyle ? 'numbered' : 'bullets', items: [] }])}>
        + {addLabel}
      </button>
    </div>
  )
}
