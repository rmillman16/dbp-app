// The PDFs' font (24 Nov). DBP's standard font is Aptos. It is a Microsoft font, so its files can't ship with the app: put
// Aptos-Regular.ttf, Aptos-Bold.ttf and Aptos-Italic.ttf in the public/fonts folder and every PDF built with this uses them.
// Until they are there, the PDFs use Carlito (an open font with the same metrics as Calibri), as before.
const APTOS = ['/fonts/Aptos-Regular.ttf', '/fonts/Aptos-Bold.ttf', '/fonts/Aptos-Italic.ttf']
const CARLITO = ['/minutes/fonts/Carlito-Regular.ttf', '/minutes/fonts/Carlito-Bold.ttf', '/minutes/fonts/Carlito-Italic.ttf']

async function all(urls: string[]) {
  return Promise.all(
    urls.map((u) =>
      fetch(u).then(async (r) => {
        // the dev server answers a missing file with the app's page, so check it really is a font
        const type = r.headers.get('content-type') ?? ''
        if (!r.ok || /html/i.test(type)) throw new Error(u)
        return r.arrayBuffer()
      }),
    ),
  )
}

export async function loadPdfFonts(): Promise<ArrayBuffer[]> {
  try {
    return await all(APTOS)
  } catch {
    return all(CARLITO)
  }
}
