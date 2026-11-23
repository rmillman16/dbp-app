import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// A simple mark-up editor for outside reviewers: draw on a picture or on the pages of a PDF with a pen, lines, arrows,
// boxes, circles and text, in colours. Nothing is changed in the original: each marked page is saved as a new picture
// (PNG) that goes in with the reviewer's response.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Tool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'
interface Shape {
  tool: Tool
  color: string
  width: number
  pts: { x: number; y: number }[] // pen: every point; others: start and end
  text?: string
}
const COLOURS = ['#d62828', '#f77f00', '#fcbf49', '#2a9d3f', '#1d6fd8', '#6a2c91', '#111111', '#ffffff']
const TOOLS: [Tool, string][] = [
  ['pen', '✎ Pen'],
  ['line', '／ Line'],
  ['arrow', '➚ Arrow'],
  ['rect', '▭ Box'],
  ['ellipse', '◯ Circle'],
  ['text', 'T Text'],
]
const MAX_W = 1800

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
    if (s.tool === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const head = Math.max(12, s.width * 4) * scale
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
      ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
      ctx.closePath()
      ctx.fill()
    }
  } else if (s.tool === 'rect') {
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
  } else if (s.tool === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (s.tool === 'text' && s.text) {
    const size = (14 + s.width * 3) * scale
    ctx.font = `600 ${size}px Calibri, Arial, sans-serif`
    ctx.textBaseline = 'top'
    s.text.split('\n').forEach((line, i) => {
      // a thin outline keeps white or yellow text readable on a light drawing
      ctx.lineWidth = Math.max(2, size / 8)
      ctx.strokeStyle = s.color === '#ffffff' ? '#000000' : '#ffffff'
      ctx.strokeText(line, a.x, a.y + i * size * 1.2)
      ctx.fillText(line, a.x, a.y + i * size * 1.2)
    })
  }
}

export default function MarkupEditor({ source, name, onSave, onClose }: { source: Blob; name: string; onSave: (files: File[]) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null) // the picture or PDF page underneath
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [shapes, setShapes] = useState<Record<number, Shape[]>>({})
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLOURS[0])
  const [width, setWidth] = useState(3)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const isPdf = /\.pdf$/i.test(name) || source.type === 'application/pdf'
  // line widths are relative to a 1000px-wide page so marks look the same whatever the size of the drawing
  const [scale, setScale] = useState(1)

  const paint = useCallback(
    (list: Shape[], extra: Shape | null) => {
      const c = canvasRef.current
      const base = baseRef.current
      if (!c || !base) return
      c.width = base.width
      c.height = base.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      for (const s of list) drawShape(ctx, s, scale)
      if (extra) drawShape(ctx, extra, scale)
    },
    [scale],
  )

  // put a page on the base canvas
  const loadPage = useCallback(async (n: number) => {
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
  }, [isPdf, source])

  useEffect(() => {
    loadPage(page)
  }, [page, loadPage])
  useEffect(() => {
    if (!loading && !error) paint(shapes[page] ?? [], draft)
  }, [loading, error, shapes, page, draft, paint])

  const point = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const down = (e: React.PointerEvent) => {
    if (loading || error) return
    const p = point(e)
    if (tool === 'text') {
      const text = window.prompt('Text to put here:')
      if (text?.trim()) setShapes((m) => ({ ...m, [page]: [...(m[page] ?? []), { tool, color, width, pts: [p], text: text.trim() }] }))
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDraft({ tool, color, width, pts: [p] })
  }
  const move = (e: React.PointerEvent) => {
    if (!draft) return
    const p = point(e)
    setDraft(draft.tool === 'pen' ? { ...draft, pts: [...draft.pts, p] } : { ...draft, pts: [draft.pts[0], p] })
  }
  const up = () => {
    if (!draft) return
    setShapes((m) => ({ ...m, [page]: [...(m[page] ?? []), draft] }))
    setDraft(null)
  }
  const undo = () => setShapes((m) => ({ ...m, [page]: (m[page] ?? []).slice(0, -1) }))
  const clear = () => setShapes((m) => ({ ...m, [page]: [] }))
  const marked = Object.entries(shapes).filter(([, l]) => l.length).map(([n]) => Number(n))

  async function save() {
    setLoading(true)
    const out: File[] = []
    const stem = name.replace(/\.[^.]+$/, '')
    for (const n of marked.sort((a, b) => a - b)) {
      await loadPage(n)
      const base = baseRef.current!
      const c = document.createElement('canvas')
      c.width = base.width
      c.height = base.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      for (const s of shapes[n]) drawShape(ctx, s, base.width / 1000)
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
      if (blob) out.push(new File([blob], `${stem} - marked up${isPdf ? ` p${n}` : ''}.png`, { type: 'image/png' }))
    }
    setLoading(false)
    onSave(out)
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
            <button key={c} type="button" className={'markup-swatch' + (color === c ? ' on' : '')} style={{ background: c }} title={c} onClick={() => setColor(c)} />
          ))}
        </div>
        <select value={width} onChange={(e) => setWidth(Number(e.target.value))} title="Thickness">
          <option value={2}>Thin</option>
          <option value={3}>Medium</option>
          <option value={6}>Thick</option>
          <option value={10}>Extra thick</option>
        </select>
        <button type="button" onClick={undo} disabled={!(shapes[page] ?? []).length}>
          ↶ Undo
        </button>
        <button type="button" onClick={clear} disabled={!(shapes[page] ?? []).length}>
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
        <canvas ref={canvasRef} className="markup-canvas" style={{ display: error ? 'none' : 'block' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
      <p className="markup-hint">Draw on the drawing, then press “Use this mark-up”. It is added to your reply as a picture, and the original isn't changed.</p>
    </div>
  )
}
