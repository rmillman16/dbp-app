// Filing into the synced SharePoint "3. Orders" folder (23 Nov). The app can't write into SharePoint itself (that needs IT's
// Microsoft app, docs/questions-for-IT.md §2), but DBP's SharePoint is synced to the PC, so the browser can write straight
// into the synced folder and OneDrive uploads it. The folder is chosen once per job on each computer (Edge / Chrome) and
// remembered; the browser asks again each session to confirm. Order files go in "NN - Trade - Subcontractor/", a variation's
// in "NN - Trade - Subcontractor/Variations/VA1/".
import { del, get, set } from 'idb-keyval'

type Dir = FileSystemDirectoryHandle
type PermissionDir = Dir & { queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>; requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState> }

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window
const key = (jobId: string) => `orders-folder:${jobId}`
export const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'folder'

export async function linkedFolderName(jobId: string): Promise<string | null> {
  try {
    return ((await get(key(jobId))) as Dir | undefined)?.name ?? null
  } catch {
    return null
  }
}
export async function chooseFolder(jobId: string): Promise<string> {
  const h = await (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<Dir> }).showDirectoryPicker({ mode: 'readwrite', id: 'dbp-orders' })
  await set(key(jobId), h)
  return h.name
}
export async function unlinkFolder(jobId: string) {
  await del(key(jobId))
}

// the linked folder, with permission to write (must be called straight from a click: the browser's prompt needs one).
// null = not linked, not supported, or permission refused
export async function folderAccess(jobId: string): Promise<Dir | null> {
  if (!folderSupported()) return null
  try {
    const h = (await get(key(jobId))) as PermissionDir | undefined
    if (!h) return null
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted' ? h : null
  } catch {
    return null
  }
}

async function dive(root: Dir, path: string[]) {
  let d = root
  for (const p of path) d = await d.getDirectoryHandle(clean(p), { create: true })
  return d
}
// writes a file at root/path/name (replacing one of the same name); returns the path shown to people
export async function writeInto(root: Dir, path: string[], name: string, data: Blob) {
  const dir = await dive(root, path)
  const fh = await dir.getFileHandle(clean(name), { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
  return [root.name, ...path.map(clean), clean(name)].join(' / ')
}
