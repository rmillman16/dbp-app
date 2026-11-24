// Filing into the synced SharePoint "3. Orders" folder (23 Nov). The app can't write into SharePoint itself (that needs IT's
// Microsoft app, docs/questions-for-IT.md §2), but DBP's SharePoint is synced to the PC, so the browser can write straight
// into the synced folder and OneDrive uploads it. The folder is chosen once per job on each computer (Edge / Chrome) and
// remembered; the browser asks again each session to confirm. Order files go in "NN - Trade - Subcontractor/", a variation's
// in "NN - Trade - Subcontractor/Variations/VA1/".
import { del, get, set } from 'idb-keyval'

type Dir = FileSystemDirectoryHandle
type PermissionDir = Dir & { queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>; requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState> }

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window
// scope: which synced folder this is for a job ('orders' = 3. Orders; 'breeam' = EXTERNAL / 08. BREEAM)
const key = (jobId: string, scope = 'orders') => (scope === 'orders' ? `orders-folder:${jobId}` : `${scope}-folder:${jobId}`)
export const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'folder'

export async function linkedFolderName(jobId: string, scope = 'orders'): Promise<string | null> {
  try {
    return ((await get(key(jobId, scope))) as Dir | undefined)?.name ?? null
  } catch {
    return null
  }
}
export async function chooseFolder(jobId: string, scope = 'orders'): Promise<string> {
  const h = await (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<Dir> }).showDirectoryPicker({ mode: 'readwrite', id: `dbp-${scope}` })
  await set(key(jobId, scope), h)
  return h.name
}
export async function unlinkFolder(jobId: string, scope = 'orders') {
  await del(key(jobId, scope))
}

// the linked folder, with permission to write (must be called straight from a click: the browser's prompt needs one).
// null = not linked, not supported, or permission refused
export async function folderAccess(jobId: string, scope = 'orders'): Promise<Dir | null> {
  if (!folderSupported()) return null
  try {
    const h = (await get(key(jobId, scope))) as PermissionDir | undefined
    if (!h) return null
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted' ? h : null
  } catch {
    return null
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export async function subfolders(d: Dir) {
  const out: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, h] of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) if (h.kind === 'directory') out.push(name)
  return out
}
// an existing folder with the same name (ignoring capitals and punctuation) is used rather than making a twin
async function dive(root: Dir, path: string[]) {
  let d = root
  for (const p of path) {
    const want = clean(p)
    const have = (await subfolders(d)).find((n) => norm(n) === norm(want))
    d = await d.getDirectoryHandle(have ?? want, { create: true })
  }
  return d
}

// The order's folder in "3. Orders" may already exist under its own name ("1. Mechanical - Mercury", "01 - Electrical - Lumen"):
// find it by the company's name, else by its folder number, else make "NN - Trade - Subcontractor".
export async function orderFolderName(root: Dir, folderNo: number | null, companyName: string, label: string) {
  const names = await subfolders(root)
  const firstWords = norm(companyName).split(' ').filter((w) => w.length > 2 && !['ltd', 'limited', 'the', 'and', 'plc', 'llp'].includes(w)).slice(0, 2).join(' ')
  const byCompany = firstWords ? names.find((n) => norm(n).includes(firstWords)) : undefined
  if (byCompany) return byCompany
  const byNo = folderNo != null ? names.find((n) => new RegExp(`^0*${folderNo}(\\D|$)`).test(n.trim())) : undefined
  return byNo ?? label
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
