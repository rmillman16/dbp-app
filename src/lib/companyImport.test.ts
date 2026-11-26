import { describe, expect, it } from 'vitest'
import { buildCompanies, findHeader, guessMapping, normName, parseDate, parseStatus } from './companyImport'

describe('parseDate', () => {
  it('reads typed dates (day first), Excel day numbers and month names', () => {
    expect(parseDate('31/03/2027').value).toBe('2027-03-31')
    expect(parseDate('1.2.27').value).toBe('2027-02-01')
    expect(parseDate('46112').value).toBe('2026-03-31')
    expect(parseDate('5 March 2027').value).toBe('2027-03-05')
    expect(parseDate('Mar 2027').value).toBe('2027-03-31')
    expect(parseDate('2027-06-30').value).toBe('2027-06-30')
  })
  it('treats blank as no date and flags nonsense', () => {
    expect(parseDate('')).toEqual({ value: null, bad: false })
    expect(parseDate('soon').bad).toBe(true)
    expect(parseDate('31/02/2027').bad).toBe(true)
  })
})

describe('parseStatus and names', () => {
  it('reads PQQ statuses', () => {
    expect(parseStatus('Approved')).toBe('approved')
    expect(parseStatus('Not sent')).toBe('not_sent')
    expect(parseStatus('Awaiting reply')).toBe('sent')
    expect(parseStatus('N/A')).toBe('not_required')
  })
  it('matches company names loosely', () => {
    expect(normName('Smith & Sons Ltd.')).toBe(normName('SMITH AND SONS LIMITED'))
  })
})

describe('buildCompanies', () => {
  const rows = [
    ['Our supply chain'],
    ['Company', 'Trade', 'Contact', 'Contact email', 'Phone', 'PQQ expiry', 'Status'],
    ['Acme Joinery Ltd', 'Joinery', 'Ann', 'ann@acme.co.uk', '0123', '46112', ''],
    ['', '', 'Bob', 'bob@acme.co.uk', '', '', ''],
    ['Beta Glass', 'Glazing', '', '', '', '', 'Not sent'],
  ]
  it('finds the header and maps the columns', () => {
    expect(findHeader(rows)).toBe(1)
    const m = guessMapping(rows[1])
    expect(m).toMatchObject({ name: 0, trade: 1, contact_name: 2, contact_email: 3, phone: 4, pqq_expires_on: 5, pqq_status: 6 })
  })
  it('builds companies, joins continuation rows and works out the PQQ', () => {
    const list = buildCompanies(rows, 1, guessMapping(rows[1]), 'subcontractor')
    expect(list).toHaveLength(2)
    expect(list[0].contacts.map((c) => c.name)).toEqual(['Ann', 'Bob'])
    expect(list[0].pqq_status).toBe('approved')
    expect(list[0].pqq_expires_on).toBe('2026-03-31')
    expect(list[0].pqq_approved_on).toBe('2025-03-31')
    expect(list[1].pqq_status).toBe('not_sent')
    expect(list[1].type).toBe('subcontractor')
  })
})

describe('an expiry date means it has a PQQ', () => {
  it('is approved even when the status column says otherwise', () => {
    const rows = [['Company', 'PQQ expiry', 'Status'], ['Gamma Ltd', '31/03/2027', 'Not sent']]
    const [c] = buildCompanies(rows, 0, guessMapping(rows[0]), 'supplier')
    expect(c.pqq_status).toBe('approved')
    expect(c.pqq_expires_on).toBe('2027-03-31')
  })
})
