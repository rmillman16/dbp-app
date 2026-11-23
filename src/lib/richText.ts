// RFI questions and replies are written with a small formatting toolbar (bold, italic, underline, links, lists,
// alignment). What's saved is cleaned here to those tags only, on the way in and again when shown, so pasted or
// outside text can never bring scripts or styles into the page.
const KEEP = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'br', 'p', 'div', 'span'])

export function cleanHtml(html: string | null | undefined): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase()
      if (!KEEP.has(tag)) {
        // unknown tag: keep its text and any allowed children, drop the tag
        walk(child)
        child.replaceWith(...child.childNodes)
        continue
      }
      for (const a of [...child.attributes]) {
        const keep =
          (tag === 'a' && a.name === 'href' && /^(https?:|mailto:)/i.test(a.value.trim())) ||
          (a.name === 'style' && /^text-align:\s*(left|center|right)\s*;?$/i.test(a.value.trim()))
        if (!keep) child.removeAttribute(a.name)
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noopener noreferrer')
      }
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

// the words only, for lists, Excel and the PDF
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'))
  doc.querySelectorAll('li').forEach((li) => li.prepend('• '))
  doc.querySelectorAll('p, div, li').forEach((el) => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
