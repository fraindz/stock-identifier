import type { Range } from './types'

export const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
export const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export const formatRange = (r: Range) =>
  `${shortDate.format(new Date(r.start))} – ${shortDate.format(new Date(r.end))}`

export const signed = (n: number, digits = 2) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`

export const toneOf = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '')

export const pctChange = (from: number, to: number) => ((to - from) / from) * 100

export const pctFromEntry = (entry: number, level: number) => {
  const change = pctChange(entry, level)
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// YYYY-MM-DD → "14 Nov 2026"
export const formatDay = (date: string | null | undefined) => (date ? dayFormat.format(new Date(`${date}T00:00:00Z`)) : '—')

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
