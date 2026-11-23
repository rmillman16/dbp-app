import { useEffect, useRef, useState } from 'react'
import { saveError } from '../lib/offline'
import { addLibraryDoc, archiveLibraryDoc, loadLibrary, openFile, replaceLibraryFile, updateLibraryDoc, type StandardDoc } from '../lib/orders'

// Settings › Standard documents (23 Nov, script 054): the appendices every order can carry (any file type: Word, PDF,
// Excel…) and the PQQ pack that goes to a subcontractor / supplier who isn't approved. A standard appendix ticked
// "on every new order" is added to each new order automatically; orders already made keep what they went out with.
export default function StandardDocuments() {
  const [docs, setDocs] = useState<StandardDoc[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => loadLibrary().then(setDocs, (e: Error) => (setError(e.message), setDocs([])))
  useEffect(() => {
    load()
  }, [])

  async function run(f: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await f()
      await load()
    } catch (e) {
      setError(saveError(e))
    } finally {
      setBusy(false)
    }
  }

  const appendices = (docs ?? []).filter((d) => d.kind === 'appendix')
  const pqq = (docs ?? []).filter((d) => d.kind === 'pqq')
  const hasTerms = appendices.some((d) => /payment|application/i.test(d.name))

  return (
    <section className="card" id="standard-documents">
      <h2>Standard documents</h2>
      <p className="muted small intro">
        The appendices an order can carry, and the PQQ pack for anyone not yet approved. Any file type. Replacing a file here changes it for new orders only; orders already
        made keep the version they went out with.
      </p>
      {error && <p className="error">{error}</p>}
      {docs && !hasTerms && (
        <p className="pqq-warning">
          Still to add: the <strong>standard payment and application dates</strong> appendix (when applications are due, when notices and payments follow). Upload it below and tick
          "On every new order" so every order carries it.
        </p>
      )}
      <Group
        title="Appendices"
        kind="appendix"
        docs={appendices}
        busy={busy}
        hint="e.g. Appendix A: payment and application dates; Appendix B: DBP's general terms; Appendix C: health and safety requirements"
        run={run}
      />
      <Group title="PQQ pack" kind="pqq" docs={pqq} busy={busy} hint="e.g. the PQQ form, the insurance requirements, the health and safety questionnaire. All of these attach to the PQQ email." run={run} />
    </section>
  )
}

function Group({
  title,
  kind,
  docs,
  busy,
  hint,
  run,
}: {
  title: string
  kind: StandardDoc['kind']
  docs: StandardDoc[]
  busy: boolean
  hint: string
  run: (f: () => Promise<void>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [defaultOn, setDefaultOn] = useState(true)
  const picker = useRef<HTMLInputElement>(null)
  return (
    <div className="std-group">
      <h3 className="sub-head">{title}</h3>
      {docs.length === 0 ? (
        <p className="muted small">None yet. {hint}</p>
      ) : (
        <ul className="std-list">
          {docs.map((d) => (
            <li key={d.id}>
              <input defaultValue={d.name} aria-label="Name" onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && run(() => updateLibraryDoc(d.id, { name: e.target.value.trim() }))} />
              <button type="button" className="link-button small" onClick={() => openFile(d.path).catch(() => {})} title="Open">
                {d.file_name}
              </button>
              {kind === 'appendix' && (
                <label className="small">
                  <input type="checkbox" checked={d.default_on} onChange={(e) => run(() => updateLibraryDoc(d.id, { default_on: e.target.checked }))} /> On every new order
                </label>
              )}
              <label className="file-button">
                <input
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) run(() => replaceLibraryFile(d, f))
                  }}
                />
                <span className="button small-button">Replace file</span>
              </label>
              <button type="button" className="small-button" disabled={busy} title="Remove from the library" onClick={() => confirm(`Remove "${d.name}" from the library? Orders that already used it keep it.`) && run(() => archiveLibraryDoc(d.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="std-add app-controls">
        <input value={name} placeholder="Name" onChange={(e) => setName(e.target.value)} />
        <label className="file-button">
          <input ref={picker} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="button">{file ? file.name : 'Choose file…'}</span>
        </label>
        {kind === 'appendix' && (
          <label className="small">
            <input type="checkbox" checked={defaultOn} onChange={(e) => setDefaultOn(e.target.checked)} /> On every new order
          </label>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !file}
          onClick={() =>
            file &&
            run(async () => {
              await addLibraryDoc(kind, name, file, defaultOn)
              setName('')
              setFile(null)
              if (picker.current) picker.current.value = ''
            })
          }
        >
          + Add
        </button>
      </div>
    </div>
  )
}
