import type { Range } from './types'

export const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
export const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export const formatRange = (r: Range) =>
  `${shortDate.format(new Date(r.start))} – ${shortDate.format(new Date(r.end))}`

export const signed = (n: number, digits = 2) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`

export const toneOf = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '')

export const pctChange = (from: number, to: number) => ((to - from) / from) * 100
