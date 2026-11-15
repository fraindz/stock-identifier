// Grade tracker: records every A/B stock on the Rolling swing and Positional tabs as a
// paper trade and follows it with fixed rules, so the record shows whether higher grades
// actually lead to better trades. Pure functions only (no I/O); screen.ts does the
// fetching and file writes.
//
//   addSignals()   new A/B names become Watch trades (one open trade per stock and mode)
//   updateTrades() apply each day's bars: Watch → Active (or Expired) → Closed
//   cancelStale()  cancel Watch signals whose stock fell below grade C or left the list
//   summarize()    trigger rate, win rate and average R per mode and grade
import { avg, mondayOf, round, sma, type Day, type Week } from './indicators'
import type { ComponentKey, Mode as QualityMode, QualityStock, Regime } from './quality'

// Hotlist trades enter on the swing levels and are managed with the positional rules.
export type Mode = QualityMode | 'hotlist'
export const MODES: Mode[] = ['swing', 'positional', 'hotlist']

export const TRACKER_RULES = {
  grades: ['A', 'B'] as const,
  breakevenR: 1, // stop moves to entry once the high reaches +1R
  partialR: 2, // half is booked at +2R; the rest trails
  swing: {
    watchDays: 5, // trading days to trigger before the signal expires
    timeStopDays: 10, // exit if still below +1R after this many days in the trade
    maxHoldDays: 20,
    trailDays: 3, // after +2R, stop trails the lowest low of the last 3 days
  },
  positional: {
    watchDays: 10,
    timeStopDays: 65, // ~13 weeks
    trailWeeks: 3,
    thesisSmaWeeks: 30, // exit on a weekly close below the 30-week SMA
  },
  hotlist: {
    watchDays: 5, // swing entry window; once bought, managed with the positional rules
  },
}

export type TradeStatus = 'watch' | 'active' | 'closed' | 'expired' | 'cancelled'
export type TradeExit = 'stop' | 'trail' | 'time' | 'max-hold' | 'thesis'

export type TrackedTrade = {
  id: string
  mode: Mode
  symbol: string
  name: string
  sector: string
  grade: 'A' | 'B' | 'C'
  score: number
  components: Partial<Record<ComponentKey, number>>
  setup: string | null
  regime: Regime
  addedDate: string // signal date (the close the score was computed on)
  trigger: number
  initialStop: number
  stop: number
  target: number
  status: TradeStatus
  barsWaiting: number
  endedDate?: string // when an untriggered signal expired or was cancelled
  cancelReason?: string
  entryDate?: string
  entry?: number
  entryGapPct?: number // entry vs trigger (gap-ups enter above it)
  r?: number
  partialBooked?: boolean
  maxHigh?: number
  barsHeld?: number
  exitDate?: string
  exitPrice?: number
  exitReason?: TradeExit
  rMultiple?: number
  mfeR?: number // maximum favourable move, in R
  lastDate: string
  lastClose: number
}

type Signal = Omit<QualityStock, 'firstSeen' | 'daysListed'>

export type Tracker = { updatedAt: string; asOf: string; startedOn: string; rules: typeof TRACKER_RULES; trades: TrackedTrade[] }

export const emptyTracker = (): Tracker => ({ updatedAt: '', asOf: '', startedOn: '', rules: TRACKER_RULES, trades: [] })

const isOpen = (t: TrackedTrade) => t.status === 'watch' || t.status === 'active'

// Adds each A/B stock that has no open trade in this mode yet. The signal's own bar is
// never applied (lastDate = asOf), so entries only happen on later sessions.
export function addSignals(tracker: Tracker, mode: Mode, stocks: Signal[], asOf: string, regime: Regime): number {
  const open = new Set(tracker.trades.filter((t) => t.mode === mode && isOpen(t)).map((t) => t.symbol))
  let added = 0
  for (const s of stocks) {
    if (!s.grade || !(TRACKER_RULES.grades as readonly string[]).includes(s.grade) || open.has(s.symbol)) continue
    if (!(s.trigger > s.stop)) continue
    tracker.trades.push({
      id: `${mode}_${asOf}_${s.symbol}`,
      mode,
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      grade: s.grade,
      score: s.score,
      components: Object.fromEntries(s.components.map((c) => [c.key, c.points])),
      setup: s.setup,
      regime,
      addedDate: asOf,
      trigger: s.trigger,
      initialStop: s.stop,
      stop: s.stop,
      target: s.target,
      status: 'watch',
      barsWaiting: 0,
      lastDate: asOf,
      lastClose: s.close,
    })
    open.add(s.symbol)
    added++
  }
  if (!tracker.startedOn) tracker.startedOn = asOf
  return added
}

const rOf = (t: TrackedTrade, price: number) => (price - t.entry!) / t.r!

function close(t: TrackedTrade, day: Day, price: number, reason: TradeExit) {
  const exitR = rOf(t, price)
  t.status = 'closed'
  t.exitDate = day.date
  t.exitPrice = round(price)
  t.exitReason = reason
  t.rMultiple = round(t.partialBooked ? 0.5 * TRACKER_RULES.partialR + 0.5 * exitR : exitR)
  t.mfeR = round(rOf(t, t.maxHigh!))
}

// Applies the daily bars after `lastDate` to one trade. `weeks` includes the current week.
export function applyBars(t: TrackedTrade, days: Day[], weeks: Week[]) {
  const R = TRACKER_RULES
  const pending = days.filter((d) => d.date > t.lastDate)
  for (const [i, day] of pending.entries()) {
    if (!isOpen(t)) break

    if (t.status === 'watch') {
      if (day.high >= t.trigger) {
        t.status = 'active'
        t.entry = round(Math.max(t.trigger, day.open))
        t.entryGapPct = round(((t.entry - t.trigger) / t.trigger) * 100)
        t.entryDate = day.date
        t.r = round(t.entry - t.stop)
        t.partialBooked = false
        t.maxHigh = t.entry
        t.barsHeld = 0
      } else {
        t.barsWaiting++
        if (t.barsWaiting >= R[t.mode].watchDays) {
          t.status = 'expired'
          t.endedDate = day.date
        }
      }
    }

    if (t.status === 'active') {
      const entry = t.entry!
      const r = t.r!
      t.barsHeld!++
      if (day.low <= t.stop) {
        close(t, day, Math.min(t.stop, day.open), t.stop > t.initialStop ? 'trail' : 'stop')
      } else {
        t.maxHigh = Math.max(t.maxHigh!, day.high)
        if (t.maxHigh >= entry + R.breakevenR * r && t.stop < entry) t.stop = entry
        if (t.maxHigh >= entry + R.partialR * r) {
          t.partialBooked = true
          const trail =
            t.mode === 'swing'
              ? Math.min(...days.filter((d) => d.date < day.date).slice(-R.swing.trailDays).map((d) => d.low))
              : Math.min(...weeks.filter((w) => mondayOf(w.start) < mondayOf(day.date)).slice(-R.positional.trailWeeks).map((w) => w.low))
          if (Number.isFinite(trail) && trail > t.stop) t.stop = round(trail)
        }
        const below1R = day.close < entry + R.breakevenR * r
        if (t.mode === 'swing') {
          if (t.barsHeld! >= R.swing.maxHoldDays) close(t, day, day.close, 'max-hold')
          else if (t.barsHeld! >= R.swing.timeStopDays && below1R) close(t, day, day.close, 'time')
        } else {
          const nextDay = pending[i + 1]
          const weekEnds = nextDay ? mondayOf(nextDay.date) !== mondayOf(day.date) : new Date(`${day.date}T00:00:00Z`).getUTCDay() === 5
          const closes = weeks.filter((w) => mondayOf(w.start) <= mondayOf(day.date)).map((w) => w.close)
          if (weekEnds && closes.length >= R.positional.thesisSmaWeeks && day.close < sma(closes, R.positional.thesisSmaWeeks)) {
            close(t, day, day.close, 'thesis')
          } else if (t.barsHeld! >= R.positional.timeStopDays && below1R) {
            close(t, day, day.close, 'time')
          }
        }
      }
    }
    t.lastDate = day.date
    t.lastClose = round(day.close)
  }
}

// Cancels Watch signals in `mode` whose stock no longer grades C or better today. `scores`
// holds every stock scored today; a missing symbol failed the filters (left the list).
export function cancelStale(
  tracker: Tracker,
  mode: Mode,
  scores: Map<string, { score: number; grade: string | null }>,
  asOf: string,
  missingReason = 'left the list (no longer passes the filters)',
): number {
  let cancelled = 0
  for (const t of tracker.trades.filter((t) => t.mode === mode && t.status === 'watch')) {
    const today = scores.get(t.symbol)
    if (today?.grade) continue
    t.status = 'cancelled'
    t.endedDate = asOf
    t.cancelReason = today ? `score fell to ${round(today.score)} (below C)` : missingReason
    cancelled++
  }
  return cancelled
}

export function updateTrades(tracker: Tracker, bars: Map<string, { days: Day[]; weeks: Week[] }>) {
  for (const t of tracker.trades.filter(isOpen)) {
    const b = bars.get(t.symbol)
    if (b?.days.length) applyBars(t, b.days, b.weeks)
  }
}

export type SummaryRow = {
  mode: Mode
  grade: 'A' | 'B' | 'C' | 'all'
  signals: number
  watching: number
  expired: number
  cancelled: number
  triggered: number
  triggerRatePct: number | null // of signals that have resolved (triggered, expired or cancelled)
  active: number
  closed: number
  winRatePct: number | null
  avgR: number | null // expectancy per closed trade
  totalR: number
  avgWinR: number | null
  avgLossR: number | null
  avgBarsHeld: number | null
  avgMfeR: number | null
  openR: number | null // average unrealised R of active trades at the latest close
}

export function summarize(trades: TrackedTrade[]): SummaryRow[] {
  const rows: SummaryRow[] = []
  const mean = (xs: number[]) => (xs.length ? round(avg(xs)) : null)
  for (const mode of MODES) {
    for (const grade of ['A', 'B', 'all'] as const) {
      const ts = trades.filter((t) => t.mode === mode && (grade === 'all' || t.grade === grade))
      const triggered = ts.filter((t) => t.entryDate)
      const expired = ts.filter((t) => t.status === 'expired')
      const cancelled = ts.filter((t) => t.status === 'cancelled')
      const closed = ts.filter((t) => t.status === 'closed')
      const active = ts.filter((t) => t.status === 'active')
      const rs = closed.map((t) => t.rMultiple!)
      const resolved = triggered.length + expired.length + cancelled.length
      rows.push({
        mode,
        grade,
        signals: ts.length,
        watching: ts.filter((t) => t.status === 'watch').length,
        expired: expired.length,
        cancelled: cancelled.length,
        triggered: triggered.length,
        triggerRatePct: resolved ? round((triggered.length / resolved) * 100) : null,
        active: active.length,
        closed: closed.length,
        winRatePct: closed.length ? round((rs.filter((r) => r > 0).length / closed.length) * 100) : null,
        avgR: mean(rs),
        totalR: round(rs.reduce((s, r) => s + r, 0)),
        avgWinR: mean(rs.filter((r) => r > 0)),
        avgLossR: mean(rs.filter((r) => r <= 0)),
        avgBarsHeld: mean(closed.map((t) => t.barsHeld!)),
        avgMfeR: mean(closed.map((t) => t.mfeR!)),
        openR: mean(active.map((t) => (t.partialBooked ? 0.5 * TRACKER_RULES.partialR + 0.5 * rOf(t, t.lastClose) : rOf(t, t.lastClose)))),
      })
    }
  }
  return rows
}
