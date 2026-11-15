import { inr, signed } from './format'
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

export type Action = { t: TrackedTrade; kind: 'place' | 'bought' | 'cancel' | 'exit'; text: string }
export const ACTION_LABEL: Record<Action['kind'], string> = { place: 'New order', bought: 'Bought', cancel: 'Cancel order', exit: 'Exit' }

// What changed on the latest data date, in the order you'd act on it.
export function actionsOn(trades: TrackedTrade[], date: string): Action[] {
  const out: Action[] = []
  for (const t of trades) {
    if (t.exitDate === date) out.push({ t, kind: 'exit', text: `Exited at ${inr.format(t.exitPrice!)} (${EXIT_LABEL[t.exitReason!]}), ${signed(t.rMultiple!)}R` })
    if (t.endedDate === date)
      out.push({ t, kind: 'cancel', text: `Cancel the buy-above order at ${inr.format(t.trigger)}: ${t.cancelReason ?? 'did not trigger within the watch window'}` })
    if (t.entryDate === date && t.status !== 'closed')
      out.push({ t, kind: 'bought', text: `Bought at ${inr.format(t.entry!)}; stop ${inr.format(t.stop)}, 1R = ${inr.format(t.r!)}` })
    if (t.addedDate === date && t.status === 'watch')
      out.push({ t, kind: 'place', text: `Buy above ${inr.format(t.trigger)}, stop ${inr.format(t.initialStop)}, target ${inr.format(t.target)}` })
  }
  const order = { exit: 0, cancel: 1, bought: 2, place: 3 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.t.symbol.localeCompare(b.t.symbol))
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
