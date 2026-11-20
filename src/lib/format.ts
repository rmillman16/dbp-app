// UK formats used across the app: £ and DD/MM/YYYY.

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export function money(value: number | null | undefined): string {
  return value == null ? '' : gbp.format(value)
}

// Dates come from the database as 'YYYY-MM-DD'.
export function ukDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
