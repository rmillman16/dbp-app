// Photos and documents on a diary, delivery note or inspection (24 Nov, script 081): take a photo on a phone, or add from the gallery.
import { useEffect, useRef, useState } from 'react'
import { addFile, fileUrl, loadFiles, removeFile, type HsFile } from '../../lib/hs'

export default function HsFiles({ jobId, kind, recordId, readOnly }: { jobId: string; kind: HsFile['record_kind']; recordId: string; readOnly?: boolean }) {
  const [files, setFiles] = useState<HsFile[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadFiles(kind, recordId).then(setFiles, (e: Error) => setError(e.message))
  }, [kind, recordId])
  useEffect(() => {
    let live = true
    Promise.all(files.filter((f) => !urls[f.id]).map(async (f) => [f.id, await fileUrl(f.path).catch(() => '')] as const)).then((pairs) => {
      if (live && pairs.length) setUrls((u) => ({ ...u, ...Object.fromEntries(pairs) }))
    })
    return () => {
      live = false
    }
  }, [files]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(list: File[]) {
    if (!list.length) return
    if (!navigator.onLine) return setError('You are offline: photos can only be added with a connection.')
    setBusy(true)
    setError(null)
    try {
      for (const f of list) {
        const added = await addFile(jobId, kind, recordId, f)
        setFiles((l) => [...l, added])
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])]
    e.target.value = ''
    void add(list)
  }
  const isImage = (n: string) => /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(n)

  return (
    <div className="rfi-field hs-files">
      <span className="label">Photos and documents</span>
      {files.length > 0 && (
        <div className="snag-thumbs">
          {files.map((f) => (
            <span key={f.id} className="snag-thumb big">
              {urls[f.id] ? (
                <a href={urls[f.id]} target="_blank" rel="noreferrer" title={f.name}>
                  {isImage(f.name) ? <img src={urls[f.id]} alt={f.name} /> : <span className="hs-doc">{f.name}</span>}
                </a>
              ) : (
                <span className="muted small">…</span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={async () => {
                    if (!confirm(`Remove ${f.name}?`)) return
                    try {
                      await removeFile(f)
                      setFiles((l) => l.filter((x) => x.id !== f.id))
                    } catch (e) {
                      setError((e as Error).message)
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {files.length === 0 && <p className="muted small">None yet.</p>}
      {!readOnly && (
        <div className="snag-photo-btns">
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <input ref={gal} type="file" accept="image/*,application/pdf" multiple hidden onChange={pick} />
          <button type="button" className="snag-camera" disabled={busy} onClick={() => cam.current?.click()}>
            <span aria-hidden>📷</span> Take photo
          </button>
          <button type="button" disabled={busy} onClick={() => gal.current?.click()}>
            {busy ? 'Adding…' : 'Add from gallery / files'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
