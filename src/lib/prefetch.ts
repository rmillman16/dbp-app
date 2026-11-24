// Pre-loads the app's other pages in the background so tabs open instantly, but only where that is cheap: on a desktop, or on a
// phone/tablet whose connection is fast (4g, at least ~5 Mbit/s, data saver off). Where the browser can't say how fast the
// connection is (iPhones/Safari) a phone is treated as slow and the pages load only when opened.
const loaders = import.meta.glob(['../pages/*.tsx', '!../pages/ExternalPages.tsx', '!../pages/SnagExternal.tsx', '!../pages/SignIn.tsx'])

type Conn = { effectiveType?: string; downlink?: number; saveData?: boolean }

export function goodForPrefetch(): boolean {
  const c = (navigator as Navigator & { connection?: Conn }).connection
  if (c?.saveData) return false
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !window.matchMedia('(pointer: fine)').matches)
  if (!c) return !phone
  if (c.effectiveType && c.effectiveType !== '4g') return false
  return phone ? (c.downlink ?? 0) >= 5 : true
}

export function prefetchPages() {
  if (!navigator.onLine || !goodForPrefetch()) return
  const idle = (window as Window & { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500))
  Object.values(loaders).forEach((load, i) => idle(() => void setTimeout(() => load().catch(() => {}), i * 150)))
}
