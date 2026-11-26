// Phone photos are big (4 to 12 MB). Before one is uploaded it is scaled down so the longest side is at most 1600 px and saved as
// a JPEG: still clear enough to see a defect, and a few hundred KB instead of several MB (quicker on site, and it keeps the
// snag list PDFs and emails small). Anything that isn't a picture the browser can draw is returned as it is.
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    // already small: keep it, unless it's a format a PDF can't hold
    if (scale === 1 && file.size < 400_000 && /jpe?g|png/.test(file.type)) {
      bmp.close()
      return file
    }
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality))
    if (!blob) return file
    const stem = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${stem}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Snagging photos are evidence, so they are kept exactly as taken (26 Nov): a JPEG or PNG is stored untouched, full size and
// full quality. Only a format the browser and the PDFs can't show (e.g. an iPhone HEIC) is converted to a JPEG, at the
// original size and near-maximum quality.
export async function keepPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || /jpe?g|png/.test(file.type)) return file
  return shrinkImage(file, 100000, 0.97)
}
