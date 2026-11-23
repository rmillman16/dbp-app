import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// A mark-up editor for outside reviewers: draw on a picture or on the pages of a PDF with a pen, lines, arrows, boxes,
// circles, revision clouds, text and call-out boxes (text in a box with an arrow to the thing it's about). Everything stays
// editable until you press "Use this mark-up": select a mark to move it, recolour it, change its text or delete it, and the
// eraser takes out ink. Nothing is changed in the original: each marked page is saved as a new picture (PNG) that goes in
// with the reviewer's response.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Tool = 'select' | 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'callout' | 'eraser'
type Pt = { x: number; y: number }
interface Shape {
  tool: Exclude<Tool, 'select' | 'eraser'>
  color: string
  width: number
  pts: Pt[] // pen: every point; shapes and arrows: start and end; text: its corner; call-out: [box corner, arrow tip]
  text?: string
}
const COLOURS = ['#d62828', '#f77f00', '#fcbf49', '#2a9d3f', '#1d6fd8', '#6a2c91', '#111111', '#ffffff']
const TOOLS: [Tool, string, string][] = [
  ['select', '✋ Select / move', 'Click a mark to move it. Double-click text to change it.'],
  ['pen', '✎ Pen', ''],
  ['line', '／ Line', ''],
  ['arrow', '➚ Arrow', ''],
  ['rect', '▭ Box', ''],
  ['ellipse', '◯ Circle', ''],
  ['cloud', '☁ Cloud', 'Revision cloud: drag across the area.'],
  ['text', 'T Text', ''],
  ['callout', '💬 Call-out', 'Press on the thing you mean, drag away and let go where the text should sit.'],
  ['eraser', '⌫ Eraser', 'Drag over a mark to take it out.'],
]
const MAX_W = 1800
const FONT = 'Calibri, Arial, sans-serif'
const meas = document.createElement('canvas').getContext('2d')!

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}
const rectOf = (a: Pt, b: Pt) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })

// the size of a text or call-out box
function textBox(s: Shape, scale: number) {
  const size = (14 + s.width * 3) * scale
  meas.font = `600 ${size}px ${FONT}`
  const lines = (s.text ?? '').split('\n')
  const pad = s.tool === 'callout' ? 8 * scale : 0
  const w = Math.max(...lines.map((l) => meas.measureText(l).width)) + pad * 2
  const h = lines.length * size * 1.2 + pad * 2
  return { x: s.pts[0].x, y: s.pts[0].y, w, h, size, pad, lines }
}
// where the call-out's arrow leaves the box (the box edge, on the line towards the tip)
function anchorOf(box: { x: number; y: number; w: number; h: number }, tip: Pt): Pt | null {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = tip.x - cx
  const dy = tip.y - cy
  if (dx === 0 && dy === 0) return null
  const k = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy))
  return k >= 1 ? null : { x: cx + dx * k, y: cy + dy * k }
}

function arrowHead(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, width: number, scale: number) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const head = Math.max(12, width * 4) * scale
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
  ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
  ctx.closePath()
  ctx.fill()
}

// a revision cloud: a row of scallops round the rectangle, bulging outwards
function cloudPath(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, scale: number) {
  const r = rectOf(a, b)
  if (r.w < 4 || r.h < 4) return
  const arc = Math.max(10, Math.min(r.w, r.h) / 4, 14 * scale)
  const corners: Pt[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const p = corners[i]
    const q = corners[(i + 1) % 4]
    const len = dist(p, q)
    const n = Math.max(1, Math.round(len / (arc * 2)))
    for (let k = 0; k < n; k++) {
      const s0 = { x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n }
      const s1 = { x: p.x + ((q.x - p.x) * (k + 1)) / n, y: p.y + ((q.y - p.y) * (k + 1)) / n }
      const c = { x: (s0.x + s1.x) / 2, y: (s0.y + s1.y) / 2 }
      const a0 = Math.atan2(s1.y - s0.y, s1.x - s0.x) + Math.PI
      ctx.moveTo(s0.x, s0.y)
      ctx.arc(c.x, c.y, dist(s0, s1) / 2, a0, a0 + Math.PI, false)
    }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, scale: number) {
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.width * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const a = s.pts[0]
  const b = s.pts[s.pts.length - 1]
  if (!a) return
  if (s.tool === 'pen') {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    for (const p of s.pts.slice(1)) ctx.lineTo(p.x, p.y)
    if (s.pts.length === 1) ctx.lineTo(a.x + 0.1, a.y)
    ctx.stroke()
  } else if (s.tool === 'line' || s.tool === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    if (s.tool === 'arrow') arrowHead(ctx, a, b, s.width, scale)
  } else if (s.tool === 'rect') {
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
  } else if (s.tool === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (s.tool === 'cloud') {
    cloudPath(ctx, a, b, scale)
    ctx.stroke()
  } else if ((s.tool === 'text' || s.tool === 'callout') && s.text) {
    const t = textBox(s, scale)
    const dark = s.color === '#ffffff'
    if (s.tool === 'callout') {
      const tip = s.pts[1]
      const an = anchorOf(t, tip)
      if (an) {
        ctx.beginPath()
        ctx.moveTo(an.x, an.y)
        ctx.lineTo(tip.x, tip.y)
        ctx.stroke()
        arrowHead(ctx, an, tip, s.width, scale)
      }
      // no fill: the drawing shows through the box
      ctx.strokeStyle = s.color
      ctx.lineWidth = Math.max(1.5, s.width * scale * 0.7)
      ctx.strokeRect(t.x, t.y, t.w, t.h)
    }
    ctx.fillStyle = s.color
    ctx.font = `600 ${t.size}px ${FONT}`
    ctx.textBaseline = 'top'
    t.lines.forEach((line, i) => {
      const x = t.x + t.pad
      const y = t.y + t.pad + i * t.size * 1.2
      // a thin outline keeps the text readable on a busy drawing now the box has no fill
      ctx.lineWidth = Math.max(2, t.size / 8)
      ctx.strokeStyle = dark ? '#000000' : '#ffffff'
      ctx.strokeText(line, x, y)
      ctx.fillText(line, x, y)
    })
  }
}

// is the point on this mark? (for picking it to move, and for the eraser, which only takes marks it touches)
function hits(s: Shape, p: Pt, scale: number, erase: boolean) {
  const tol = (s.width / 2 + (erase ? 7 : 6)) * scale
  const a = s.pts[0]
  const b = s.pts[s.pts.length - 1]
  if (s.tool === 'pen') {
    if (s.pts.length === 1) return dist(p, a) < tol
    for (let i = 1; i < s.pts.length; i++) if (segDist(p, s.pts[i - 1], s.pts[i]) < tol) return true
    return false
  }
  if (s.tool === 'line' || s.tool === 'arrow') return segDist(p, a, b) < tol
  if (s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'cloud') {
    const r = rectOf(a, b)
    const inOuter = p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol
    if (!inOuter) return false
    if (!erase) return true
    const inInner = p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol
    return !inInner
  }
  if (s.text) {
    const t = textBox(s, scale)
    const inBox = p.x >= t.x - tol && p.x <= t.x + t.w + tol && p.y >= t.y - tol && p.y <= t.y + t.h + tol
    if (inBox) return true
    if (s.tool === 'callout') {
      const an = anchorOf(t, s.pts[1])
      return !!an && segDist(p, an, s.pts[1]) < tol
    }
  }
  return false
}

function bounds(s: Shape, scale: number) {
  if (s.tool === 'text' || s.tool === 'callout') {
    const t = textBox(s, scale)
    const xs = [t.x, t.x + t.w, ...(s.tool === 'callout' ? [s.pts[1].x] : [])]
    const ys = [t.y, t.y + t.h, ...(s.tool === 'callout' ? [s.pts[1].y] : [])]
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  }
  const xs = s.pts.map((p) => p.x)
  const ys = s.pts.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

type Marks = Record<number, Shape[]>

export default function MarkupEditor({ source, name, onSave, onClose }: { source: Blob; name: string; onSave: (files: File[]) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null) // the picture or PDF page underneath
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null)
  const vpScale = useRef(1) // pixels per PDF point of the page on screen
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [shapes, setShapes] = useState<Marks>({})
  const shapesRef = useRef<Marks>({})
  shapesRef.current = shapes
  const history = useRef<Marks[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLOURS[0])
  const [width, setWidth] = useState(3)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const drag = useRef<{ mode: 'move' | 'tip' | 'erase'; idx: number; last: Pt } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const isPdf = /\.pdf$/i.test(name) || source.type === 'application/pdf'
  // line widths are relative to a 1000px-wide page so marks look the same whatever the size of the drawing
  const [scale, setScale] = useState(1)

  const mine = shapes[page] ?? []
  const remember = () => {
    history.current.push(shapesRef.current)
    setCanUndo(true)
  }
  const setMine = (fn: (l: Shape[]) => Shape[]) => setShapes((m) => ({ ...m, [page]: fn(m[page] ?? []) }))

  const paint = useCallback(
    (list: Shape[], extra: Shape | null, selected: number | null) => {
      const c = canvasRef.current
      const base = baseRef.current
      if (!c || !base) return
      c.width = base.width
      c.height = base.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      for (const s of list) drawShape(ctx, s, scale)
      if (extra) drawShape(ctx, extra, scale)
      const s = selected !== null ? list[selected] : null
      if (s) {
        const bd = bounds(s, scale)
        const pad = 8 * scale
        ctx.save()
        ctx.setLineDash([6 * scale, 4 * scale])
        ctx.lineWidth = Math.max(1, scale)
        ctx.strokeStyle = '#1d6fd8'
        ctx.strokeRect(bd.x - pad, bd.y - pad, bd.w + pad * 2, bd.h + pad * 2)
        ctx.restore()
        if (s.tool === 'callout') {
          ctx.fillStyle = '#1d6fd8'
          ctx.beginPath()
          ctx.arc(s.pts[1].x, s.pts[1].y, 6 * scale, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    },
    [scale],
  )

  // put a page on the base canvas
  const loadPage = useCallback(
    async (n: number) => {
      setLoading(true)
      setError(null)
      try {
        const base = document.createElement('canvas')
        if (isPdf) {
          if (!pdfRef.current) {
            pdfRef.current = await pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()) }).promise
            setPages(pdfRef.current.numPages)
          }
          const pg = await pdfRef.current.getPage(n)
          const v1 = pg.getViewport({ scale: 1 })
          const vp = pg.getViewport({ scale: Math.min(MAX_W / v1.width, 3) })
          vpScale.current = vp.scale
          base.width = Math.round(vp.width)
          base.height = Math.round(vp.height)
          const ctx = base.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, base.width, base.height)
          await pg.render({ canvasContext: ctx, viewport: vp }).promise
        } else {
          const url = URL.createObjectURL(source)
          const img = new Image()
          await new Promise<void>((ok, bad) => {
            img.onload = () => ok()
            img.onerror = () => bad(new Error('x'))
            img.src = url
          })
          const k = Math.min(1, MAX_W / img.naturalWidth)
          base.width = Math.round(img.naturalWidth * k)
          base.height = Math.round(img.naturalHeight * k)
          base.getContext('2d')!.drawImage(img, 0, 0, base.width, base.height)
          URL.revokeObjectURL(url)
        }
        baseRef.current = base
        setScale(base.width / 1000)
      } catch {
        setError("This file can't be marked up here. Download it, mark it up in your own software and attach that instead.")
      }
      setLoading(false)
    },
    [isPdf, source],
  )

  useEffect(() => {
    setSel(null)
    loadPage(page)
  }, [page, loadPage])
  useEffect(() => {
    if (!loading && !error) paint(mine, draft, sel)
  }, [loading, error, shapes, page, draft, sel, paint]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSel = useCallback(() => {
    if (sel === null) return
    remember()
    setMine((l) => l.filter((_, i) => i !== sel))
    setSel(null)
  }, [sel, page]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault()
        deleteSel()
      }
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sel, deleteSel])

  const point = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const topHit = (p: Pt, erase: boolean) => {
    for (let i = mine.length - 1; i >= 0; i--) if (hits(mine[i], p, scale, erase)) return i
    return -1
  }
  const ask = (current = '') => window.prompt('Text:', current)?.trim() || null

  const down = (e: React.PointerEvent) => {
    if (loading || error) return
    const p = point(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (tool === 'select') {
      // the tip of a selected call-out can be dragged on its own
      const cur = sel !== null ? mine[sel] : null
      if (cur && cur.tool === 'callout' && dist(p, cur.pts[1]) < 14 * scale) {
        remember()
        drag.current = { mode: 'tip', idx: sel!, last: p }
        return
      }
      const i = topHit(p, false)
      setSel(i >= 0 ? i : null)
      if (i >= 0) {
        remember()
        drag.current = { mode: 'move', idx: i, last: p }
      }
      return
    }
    if (tool === 'eraser') {
      remember()
      drag.current = { mode: 'erase', idx: -1, last: p }
      const i = topHit(p, true)
      if (i >= 0) setMine((l) => l.filter((_, k) => k !== i))
      setSel(null)
      return
    }
    if (tool === 'text') {
      const text = ask()
      if (text) {
        remember()
        setMine((l) => [...l, { tool, color, width, pts: [p], text }])
        setSel(mine.length)
      }
      return
    }
    setSel(null)
    setDraft({ tool, color, width, pts: [p] })
  }
  const move = (e: React.PointerEvent) => {
    const p = point(e)
    const d = drag.current
    if (d) {
      if (d.mode === 'erase') {
        const i = topHit(p, true)
        if (i >= 0) setMine((l) => l.filter((_, k) => k !== i))
        return
      }
      const dx = p.x - d.last.x
      const dy = p.y - d.last.y
      d.last = p
      setMine((l) =>
        l.map((s, i) => {
          if (i !== d.idx) return s
          if (d.mode === 'tip') return { ...s, pts: [s.pts[0], { x: s.pts[1].x + dx, y: s.pts[1].y + dy }] }
          // a call-out moves by its box: the arrow keeps pointing at the same place
          if (s.tool === 'callout') return { ...s, pts: [{ x: s.pts[0].x + dx, y: s.pts[0].y + dy }, s.pts[1]] }
          return { ...s, pts: s.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) }
        }),
      )
      return
    }
    if (!draft) return
    setDraft(draft.tool === 'pen' ? { ...draft, pts: [...draft.pts, p] } : { ...draft, pts: [draft.pts[0], p] })
  }
  const up = () => {
    drag.current = null
    if (!draft) return
    const d = draft
    setDraft(null)
    if (d.tool === 'callout') {
      const tip = d.pts[0]
      const end = d.pts[d.pts.length - 1]
      const text = ask()
      if (!text) return
      // a plain click puts the box up and to the right of the point
      const box = dist(tip, end) < 12 * scale ? { x: tip.x + 70 * scale, y: tip.y - 60 * scale } : end
      remember()
      setMine((l) => [...l, { ...d, pts: [box, tip], text }])
      setSel(mine.length)
      setTool('select')
      return
    }
    // a click without dragging draws nothing for the shapes (a dot for the pen)
    if (d.tool !== 'pen' && dist(d.pts[0], d.pts[d.pts.length - 1]) < 4 * scale) return
    remember()
    setMine((l) => [...l, d])
  }
  const edit = (e: React.MouseEvent) => {
    const i = topHit(point(e), false)
    const s = i >= 0 ? mine[i] : null
    if (!s || (s.tool !== 'text' && s.tool !== 'callout')) return
    const text = ask(s.text)
    if (text === null) return
    remember()
    setMine((l) => l.map((x, k) => (k === i ? { ...x, text } : x)))
    setSel(i)
  }
  const pickColour = (c: string) => {
    setColor(c)
    if (sel !== null) {
      remember()
      setMine((l) => l.map((s, i) => (i === sel ? { ...s, color: c } : s)))
    }
  }
  const pickWidth = (w: number) => {
    setWidth(w)
    if (sel !== null) {
      remember()
      setMine((l) => l.map((s, i) => (i === sel ? { ...s, width: w } : s)))
    }
  }
  const undo = () => {
    const prev = history.current.pop()
    if (prev) setShapes(prev)
    setCanUndo(history.current.length > 0)
    setSel(null)
  }
  const clear = () => {
    remember()
    setMine(() => [])
    setSel(null)
  }
  const marked = Object.entries(shapes).filter(([, l]) => l.length).map(([n]) => Number(n))
  const hint = TOOLS.find(([k]) => k === tool)?.[2]

  async function save() {
    setLoading(true)
    setSel(null)
    try {
      const stem = name.replace(/\.[^.]+$/, '')
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((ok, bad) => c.toBlob(async (b) => (b ? ok(new Uint8Array(await b.arrayBuffer())) : bad(new Error('png'))), 'image/png'))
      const pdf = isPdf ? await PDFDocument.load(await source.arrayBuffer(), { ignoreEncryption: true }) : await PDFDocument.create()
      const font = await pdf.embedFont(StandardFonts.HelveticaBold)
      const body = await pdf.embedFont(StandardFonts.Helvetica)
      const red = rgb(0.84, 0.16, 0.16)
      const safe = (t: string) => t.replace(/[^\x20-\x7E -ÿ]/g, '?')
      const order = [...marked].sort((a, b) => a - b)
      const notes: { page: number; text: string }[] = []

      for (const n of order) {
        await loadPage(n)
        const base = baseRef.current!
        const k = base.width / 1000
        // the marks on their own, on a clear background, so the drawing underneath stays as it was
        const over = document.createElement('canvas')
        over.width = base.width
        over.height = base.height
        const octx = over.getContext('2d')!
        for (const s of shapes[n]) {
          drawShape(octx, s, k)
          if ((s.tool === 'text' || s.tool === 'callout') && s.text) notes.push({ page: n, text: s.text.replace(/\s+/g, ' ') })
        }
        const overPng = await pdf.embedPng(await toPng(over))
        let page
        if (isPdf) {
          page = pdf.getPage(n - 1)
          if (page.getRotation().angle !== 0) {
            // a rotated page: replace it with the picture of the page and its marks, same size as on screen
            const flat = document.createElement('canvas')
            flat.width = base.width
            flat.height = base.height
            flat.getContext('2d')!.drawImage(base, 0, 0)
            flat.getContext('2d')!.drawImage(over, 0, 0)
            const w = base.width / vpScale.current
            const h = base.height / vpScale.current
            pdf.removePage(n - 1)
            page = pdf.insertPage(n - 1, [w, h])
            page.drawImage(await pdf.embedPng(await toPng(flat)), { x: 0, y: 0, width: w, height: h })
          } else {
            const cb = page.getCropBox()
            page.drawImage(overPng, { x: cb.x, y: cb.y, width: cb.width, height: cb.height })
          }
        } else {
          const w = base.width * 0.5
          const h = base.height * 0.5
          page = pdf.addPage([w, h])
          page.drawImage(await pdf.embedPng(await toPng(base)), { x: 0, y: 0, width: w, height: h })
          page.drawImage(overPng, { x: 0, y: 0, width: w, height: h })
        }
        // make it plain which pages carry marks: a red frame and a tag in the corner
        const cb = page.getCropBox()
        page.drawRectangle({ x: cb.x + 2, y: cb.y + 2, width: cb.width - 4, height: cb.height - 4, borderColor: red, borderWidth: 3 })
        const tag = 'MARKED UP'
        const tw = font.widthOfTextAtSize(tag, 11) + 14
        page.drawRectangle({ x: cb.x + cb.width - tw - 8, y: cb.y + cb.height - 26, width: tw, height: 18, color: red })
        page.drawText(tag, { x: cb.x + cb.width - tw - 1, y: cb.y + cb.height - 21, size: 11, font, color: rgb(1, 1, 1) })
      }

      // a summary page first: which pages are marked, and everything written on them
      const sum = pdf.insertPage(0, [595, 842])
      let y = 790
      sum.drawText('Mark-up summary', { x: 50, y, size: 20, font, color: red })
      y -= 26
      sum.drawText(safe(name), { x: 50, y, size: 11, font: body, color: rgb(0.2, 0.2, 0.25) })
      y -= 18
      sum.drawText(`Marked-up pages (red frame and "MARKED UP" tag): ${order.join(', ')}`, { x: 50, y, size: 11, font: body })
      y -= 26
      if (notes.length) {
        sum.drawText('Comments written on the drawing', { x: 50, y, size: 12, font })
        y -= 18
        for (const nt of notes) {
          // wrap to the page width
          const words = safe(`Page ${nt.page}: ${nt.text}`).split(' ')
          let line = ''
          const lines: string[] = []
          for (const w of words) {
            if (body.widthOfTextAtSize(line + w, 10.5) > 495) {
              lines.push(line)
              line = ''
            }
            line += w + ' '
          }
          lines.push(line)
          for (const l of lines) {
            if (y < 60) break
            sum.drawText(l.trimEnd(), { x: 50, y, size: 10.5, font: body })
            y -= 14
          }
          y -= 4
        }
      } else sum.drawText('No text was written: the marks are lines, arrows, boxes and clouds on the pages listed above.', { x: 50, y, size: 10.5, font: body })

      const bytes = await pdf.save()
      setLoading(false)
      onSave([new File([bytes as BlobPart], `${stem} - marked up.pdf`, { type: 'application/pdf' })])
    } catch {
      setLoading(false)
      setError("The marked-up PDF couldn't be made. Please try again.")
    }
  }

  return (
    <div className="markup-overlay" role="dialog" aria-label="Mark up">
      <div className="markup-bar">
        <strong className="markup-name">✏ Mark up: {name}</strong>
        <div className="markup-tools">
          {TOOLS.map(([k, l]) => (
            <button key={k} type="button" className={tool === k ? 'on' : ''} onClick={() => setTool(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="markup-colours" aria-label="Colour">
          {COLOURS.map((c) => (
            <button key={c} type="button" className={'markup-swatch' + (color === c ? ' on' : '')} style={{ background: c }} title={sel !== null ? 'Recolour the selected mark' : c} onClick={() => pickColour(c)} />
          ))}
        </div>
        <select value={width} onChange={(e) => pickWidth(Number(e.target.value))} title="Thickness (and text size)">
          <option value={2}>Thin</option>
          <option value={3}>Medium</option>
          <option value={6}>Thick</option>
          <option value={10}>Extra thick</option>
        </select>
        <button type="button" onClick={undo} disabled={!canUndo}>
          ↶ Undo
        </button>
        <button type="button" onClick={deleteSel} disabled={sel === null}>
          Delete selected
        </button>
        <button type="button" onClick={clear} disabled={!mine.length}>
          Clear page
        </button>
        {pages > 1 && (
          <span className="markup-pages">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
              ◀
            </button>
            Page {page} of {pages}
            <button type="button" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
              ▶
            </button>
          </span>
        )}
        <span className="markup-end">
          <button type="button" className="primary" disabled={loading || !marked.length} onClick={save}>
            Use this mark-up{marked.length > 1 ? ` (${marked.length} pages)` : ''}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </span>
      </div>
      <div className="markup-stage">
        {loading && <p className="muted markup-msg">Working…</p>}
        {error && <p className="error markup-msg">{error}</p>}
        <canvas
          ref={canvasRef}
          className="markup-canvas"
          style={{ display: error ? 'none' : 'block', cursor: tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={edit}
        />
      </div>
      <p className="markup-hint">{hint ? hint + ' ' : ''}Press “Use this mark-up” when you've finished: it is added to your reply as a picture, and the original isn't changed.</p>
    </div>
  )
}
