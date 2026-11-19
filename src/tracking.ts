import { signed } from './format'
import type { TrackedTrade } from './types'

export type TrackerMode = TrackedTrade['mode']
export const MODE_LABEL: Record<TrackerMode, string> = { swing: 'Rolling swing', positional: 'Positional', hotlist: 'Hotlist' }
export const EXIT_LABEL: Record<NonNullable<TrackedTrade['exitReason']>, string> = {
  stop: 'Stop',
  trail: 'Trailing stop',
  time: 'Time stop',
  'max-hold': 'Max hold',
  thesis: 'Below 30w SMA',
}

export const rText = (n: number | null) => (n === null ? '—' : `${signed(n)}R`)

// Unrealised R at the latest close (half booked at +2R counts as +1R banked).
export const openR = (t: TrackedTrade) => {
  const r = (t.lastClose - t.entry!) / t.r!
  return t.partialBooked ? 1 + 0.5 * r : r
}

// Capital and risk-per-trade inputs, shared with the Top 10 page.
export const readStored = (key: string, fallback: string) => {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
export const store = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private window): keep the value for this visit only
  }
}
