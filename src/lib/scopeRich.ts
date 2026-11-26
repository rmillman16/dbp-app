// Light formatting for the scope lines: bold, italic, underline and a text colour, kept as a tiny, safe subset of HTML
// (<b> <i> <u> <span style="color:#rrggbb">). Anything else that arrives (pasted from Word or Outlook, say) is dropped and only the
// text and these four things are kept. No DOM needed, so it can be tested and used anywhere.

const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr'])
const NAMED: Record<string, string> = { red: '#dc2626', blue: '#2563eb', green: '#16a34a', orange: '#ea580c', purple: '#7c3aed' }

function hex2(n: number) {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
}
// "rgb(220, 38, 38)", "#dc2626", "#d22" or "red" to #rrggbb; black / default text colours give null (no span needed)
export function cssColour(v: string): string | null {
  const t = v.trim().toLowerCase()
  let out: string | null = null
  let m = /^#([0-9a-f]{6})$/.exec(t)
  if (m) out = '#' + m[1]
  else if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t))) out = '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]
  else if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(t))) out = '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3])
  else if (NAMED[t]) out = NAMED[t]
  if (!out || out === '#000000') return null
  return out
}

function formatsOf(name: string, attrs: string): string[] {
  if (name === 'b' || name === 'strong') return ['b']
  if (name === 'i' || name === 'em') return ['i']
  if (name === 'u') return ['u']
  if (name !== 'span' && name !== 'font') return []
  const out: string[] = []
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(attrs)) out.push('b')
  if (/font-style\s*:\s*italic/i.test(attrs)) out.push('i')
  if (/text-decoration[^;"']*underline/i.test(attrs)) out.push('u')
  const c = /(?:^|[;"'\s])color\s*:\s*([^;"']+)/i.exec(attrs) ?? /\bcolor\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)
  const col = c ? cssColour(c[1]) : null
  if (col) out.push('c' + col)
  return out
}
const openTag = (f: string) => (f[0] === 'c' ? `<span style="color:${f.slice(1)}">` : `<${f}>`)
const closeTag = (f: string) => (f[0] === 'c' ? '</span>' : `</${f}>`)

function fixText(t: string) {
  return t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
}

export function sanitizeRich(input: string | null | undefined): string {
  if (!input) return ''
  const s = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>|<br\s*\/?>/gi, ' ')
  const out: string[] = []
  const stack: string[][] = []
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:]*)([^>]*)>|([^<]+)|</g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m[4] !== undefined) out.push(fixText(m[4]))
    else if (m[0] === '<') out.push('&lt;')
    else {
      const name = m[2].toLowerCase()
      if (m[1] === '/') {
        const opened = stack.pop()
        if (opened) for (const f of [...opened].reverse()) out.push(closeTag(f))
      } else if (!VOID.has(name) && !/\/\s*$/.test(m[3])) {
        const f = formatsOf(name, m[3])
        f.forEach((x) => out.push(openTag(x)))
        stack.push(f)
      }
    }
  }
  while (stack.length) for (const f of [...(stack.pop() as string[])].reverse()) out.push(closeTag(f))
  let r = out.join('')
  for (let k = 0; k < 4; k++) r = r.replace(/<(b|i|u)>\s*<\/\1>|<span style="color:#[0-9a-f]{6}">\s*<\/span>/g, '')
  return r.replace(/\s+/g, ' ').trim()
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function plainOf(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : all
      }
      return ENTITIES[e.toLowerCase()] ?? all
    })
    .trim()
}
// plain typed or pasted text, made safe to keep alongside formatted lines
export const escapeText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
