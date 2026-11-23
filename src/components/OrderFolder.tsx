import { useEffect, useState } from 'react'
import { chooseFolder, folderSupported, linkedFolderName, unlinkFolder } from '../lib/orderFolder'

// Orders › the order's SharePoint folder (23 Nov): a link to open it, and the synced "3. Orders" folder on this computer so
// the order, its appendices, variation quotes / emails and instructions are filed into the right subfolders (OneDrive then
// uploads them to SharePoint).
export default function OrderFolder({
  jobId,
  url,
  onUrl,
  folderLabel,
  onSavePack,
  busy,
}: {
  jobId: string
  url: string | null | undefined
  onUrl: (v: string | null) => void
  folderLabel: string
  onSavePack: () => void
  busy: boolean
}) {
  const [linked, setLinked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    linkedFolderName(jobId).then(setLinked)
  }, [jobId])
  return (
    <section className="card">
      <h2>SharePoint folder</h2>
      <div className="form-grid">
        <label className="span-2">
          Link to this order's folder in SharePoint
          <span className="inline-add">
            <input value={url ?? ''} placeholder="Paste the folder's SharePoint link" onChange={(e) => onUrl(e.target.value.trim() || null)} />
            {url && (
              <a className="button small-button" href={url} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            )}
          </span>
        </label>
      </div>
      {folderSupported() ? (
        <p className="small app-controls">
          {linked ? (
            <>
              Filing into the synced folder <strong>{linked}</strong> on this computer, in <em>{folderLabel}</em>.{' '}
              <button type="button" className="link-button small" onClick={() => chooseFolder(jobId).then(setLinked, (e: Error) => e.name !== 'AbortError' && setError(e.message))}>
                Change
              </button>{' '}
              <button type="button" className="link-button small" onClick={() => unlinkFolder(jobId).then(() => setLinked(null))}>
                Unlink
              </button>{' '}
              <button type="button" onClick={onSavePack} disabled={busy}>
                Save the order and appendices to the folder
              </button>
            </>
          ) : (
            <>
              <button type="button" className="primary" onClick={() => chooseFolder(jobId).then(setLinked, (e: Error) => e.name !== 'AbortError' && setError(e.message))}>
                Link the synced "3. Orders" folder…
              </button>{' '}
              <span className="muted">
                Pick the job's "3. Orders" folder (the SharePoint folder synced to this PC). Variation quotes, emails and instructions, and the order, are then also filed in it, in <em>{folderLabel}/Variations/VA1</em>{' '}
                and so on. Asked once per job on each computer.
              </span>
            </>
          )}
        </p>
      ) : (
        <p className="muted small">Filing into the synced folder needs Microsoft Edge or Google Chrome on a PC. Files are still kept in the app, and attach to the emails.</p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
