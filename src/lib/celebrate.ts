// Milestone moments (24 Nov): a burst of confetti and a banner when something worth a cheer is finished (a snag list cleared, all of a
// meeting's actions done, My Day emptied). Plain DOM, no library, and it removes itself; nothing happens for people who ask their
// device for reduced motion.
const COLOURS = ['#007abe', '#1f1246', '#f2a900', '#2e9e5b', '#d6336c']

export function celebrate(message: string, sub?: string) {
  if (typeof document === 'undefined') return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const wrap = document.createElement('div')
  wrap.className = 'celebrate'
  wrap.setAttribute('role', 'status')
  const banner = document.createElement('div')
  banner.className = 'celebrate-banner'
  const h = document.createElement('strong')
  h.textContent = message
  banner.appendChild(h)
  if (sub) {
    const s = document.createElement('span')
    s.textContent = sub
    banner.appendChild(s)
  }
  wrap.appendChild(banner)
  if (!reduce) {
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i')
      p.className = 'confetti'
      p.style.left = Math.random() * 100 + 'vw'
      p.style.background = COLOURS[i % COLOURS.length]
      p.style.animationDelay = Math.random() * 0.6 + 's'
      p.style.animationDuration = 1.8 + Math.random() * 1.6 + 's'
      p.style.transform = `rotate(${Math.floor(Math.random() * 360)}deg)`
      wrap.appendChild(p)
    }
  }
  document.body.appendChild(wrap)
  window.setTimeout(() => wrap.remove(), 4200)
}
