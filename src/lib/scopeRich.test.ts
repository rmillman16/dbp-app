// The scope lines' formatting: only bold, italic, underline and colour survive; everything else is dropped.
import { describe, expect, it } from 'vitest'
import { cssColour, escapeText, plainOf, sanitizeRich } from './scopeRich'

describe('sanitizeRich', () => {
  it('keeps bold, italic and underline', () => {
    expect(sanitizeRich('a <b>b</b> <strong>c</strong> <em>d</em> <u>e</u>')).toBe('a <b>b</b> <b>c</b> <i>d</i> <u>e</u>')
  })
  it('keeps a colour, as a span with just the colour', () => {
    expect(sanitizeRich('<span style="color: rgb(220, 38, 38); font-size: 20px">Brass</span>')).toBe('<span style="color:#dc2626">Brass</span>')
    expect(sanitizeRich('<font color="#2563eb">x</font>')).toBe('<span style="color:#2563eb">x</span>')
  })
  it('reads bold, italic and underline written as styles (Word, Outlook)', () => {
    expect(sanitizeRich('<span style="font-weight:700;font-style:italic;text-decoration:underline">x</span>')).toBe('<b><i><u>x</u></i></b>')
  })
  it('drops everything else, but keeps the text', () => {
    expect(sanitizeRich('<p class="Mso" style="margin:0"><o:p></o:p>Hello <a href="http://x">link</a><script>alert(1)</script></p>')).toBe('Hello link')
    expect(sanitizeRich('<img src=x onerror=alert(1)>text')).toBe('text')
  })
  it('turns line and paragraph ends into spaces', () => {
    expect(sanitizeRich('<p>one</p><p>two</p>')).toBe('one two')
    expect(sanitizeRich('one<br>two')).toBe('one two')
  })
  it('closes anything left open and removes empty tags', () => {
    expect(sanitizeRich('<b>bold')).toBe('<b>bold</b>')
    expect(sanitizeRich('<b></b>x<i> </i>')).toBe('x')
  })
  it('keeps stray symbols safe', () => {
    expect(sanitizeRich('A & B < C')).toBe('A &amp; B &lt; C')
    expect(sanitizeRich('A &amp; B&nbsp;C')).toBe('A &amp; B C')
  })
  it('ignores black and default colours', () => {
    expect(sanitizeRich('<span style="color:windowtext">x</span><span style="color:#000">y</span>')).toBe('xy')
  })
})

describe('plainOf / escapeText', () => {
  it('strips the tags and reads the symbols', () => {
    expect(plainOf('<b>Stone</b> top &amp; <span style="color:#dc2626">splash</span> &lt;1m')).toBe('Stone top & splash <1m')
  })
  it('round-trips plain text through escapeText', () => {
    const t = 'Tom & Jerry <script> "x"'
    expect(plainOf(escapeText(t))).toBe(t)
  })
  it('turns colours into hex', () => {
    expect(cssColour('rgb(0,128,255)')).toBe('#0080ff')
    expect(cssColour('#abc')).toBe('#aabbcc')
    expect(cssColour('red')).toBe('#dc2626')
    expect(cssColour('black')).toBeNull()
  })
})
