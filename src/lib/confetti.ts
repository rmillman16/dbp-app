// A burst of confetti over the whole screen, for a win. Draws on its own canvas and removes itself when done.
// Returns how long it runs (ms), so a caller can wait before moving on; 0 if the person asked for less motion.
const COLOURS = ['#2b2257', '#d62828', '#f77f00', '#fcbf49', '#2a9d3f', '#1d6fd8', '#e63d8b', '#6a2c91']

export function fireConfetti(duration = 2800): number {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0
  } catch {
    /* carry on */
  }
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10000'
  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return 0
  }
  ctx.scale(dpr, dpr)
  const W = window.innerWidth
  const H = window.innerHeight
  type P = { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; round: boolean }
  const make = (x: number, y: number, angle: number, speed: number): P => {
    const a = angle + (Math.random() - 0.5) * 0.9
    const s = speed * (0.5 + Math.random() * 0.7)
    return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, c: COLOURS[Math.floor(Math.random() * COLOURS.length)], round: Math.random() < 0.25 }
  }
  const parts: P[] = []
  // two cannons from the bottom corners, then a shower from the top
  for (let i = 0; i < 110; i++) parts.push(make(0, H, -Math.PI / 3, 20), make(W, H, (-2 * Math.PI) / 3, 20))
  for (let i = 0; i < 90; i++) parts.push({ ...make(Math.random() * W, -20 - Math.random() * H * 0.5, Math.PI / 2, 3), vx: (Math.random() - 0.5) * 3 })
  const start = performance.now()
  const tick = (now: number) => {
    const t = now - start
    ctx.clearRect(0, 0, W, H)
    const fade = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1
    for (const p of parts) {
      p.vy += 0.38 // gravity
      p.vx *= 0.992
      p.vy *= 0.992
      p.x += p.vx
      p.y += p.vy
      p.r += p.vr
      ctx.save()
      ctx.globalAlpha = fade
      ctx.translate(p.x, p.y)
      ctx.rotate(p.r)
      ctx.fillStyle = p.c
      if (p.round) {
        ctx.beginPath()
        ctx.arc(0, 0, p.w / 2.2, 0, 6.28)
        ctx.fill()
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    if (t < duration) requestAnimationFrame(tick)
    else canvas.remove()
  }
  requestAnimationFrame(tick)
  return duration
}
