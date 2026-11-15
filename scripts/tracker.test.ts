// Run: npm run test:tracker
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Day, Week } from './indicators'
import type { QualityStock } from './quality'
import { addSignals, applyBars, cancelStale, emptyTracker, summarize, TRACKER_RULES, type TrackedTrade } from './tracker'

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Trading days (Mon–Fri) after `from`, each [open, high, low, close].
function tradingDays(from: string, bars: [number, number, number, number][]): Day[] {
  const days: Day[] = []
  let date = from
  for (const [open, high, low, close] of bars) {
    do date = addDays(date, 1)
    while ([0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
    days.push({ date, open, high, low, close, volume: 1000 })
  }
  return days
}
const flat = (n: number, price = 100): [number, number, number, number][] => Array.from({ length: n }, () => [price, price + 0.5, price - 0.5, price])
// Weekly history comfortably above any 30-week SMA so the thesis rule stays quiet.
const weeks: Week[] = Array.from({ length: 40 }, (_, i) => ({ start: addDays('2025-12-01', 7 * (i - 39)), end: '', high: 50, low: 50, close: 50, volume: 1 }))

const stock = (symbol: string, grade: QualityStock['grade'], over: Partial<QualityStock> = {}) =>
  ({
    symbol,
    name: symbol,
    sector: 'Tech',
    marketCapCr: 5000,
    close: 100,
    rawScore: 80,
    score: 80,
    grade,
    setup: 'breakout',
    setupNote: '',
    trigger: 101,
    stop: 96,
    target: 116,
    riskPct: 5,
    rr: 3,
    triggerGapPct: 1,
    deliveryPct: null,
    fundamentalsCoverage: 1,
    components: [{ key: 'trend', label: 'Trend strength', points: 18, max: 20, note: '' }],
    ...over,
  }) satisfies Omit<QualityStock, 'firstSeen' | 'daysListed'>

const watch = (mode: 'swing' | 'positional' = 'swing'): TrackedTrade => {
  const tracker = emptyTracker()
  addSignals(tracker, mode, [stock('T', 'A')], '2026-01-02', 'risk-on')
  return tracker.trades[0]
}

test('only A and B grades are tracked, one open trade per stock and mode', () => {
  const tracker = emptyTracker()
  const stocks = [stock('A1', 'A'), stock('B1', 'B'), stock('C1', 'C'), stock('N1', null)]
  assert.equal(addSignals(tracker, 'swing', stocks, '2026-01-02', 'caution'), 2)
  assert.equal(addSignals(tracker, 'swing', stocks, '2026-01-05', 'caution'), 0) // still open
  assert.equal(addSignals(tracker, 'positional', stocks, '2026-01-05', 'caution'), 2)
  assert.deepEqual(tracker.trades.map((t) => `${t.mode}:${t.symbol}`), ['swing:A1', 'swing:B1', 'positional:A1', 'positional:B1'])
  assert.equal(tracker.trades[0].regime, 'caution')
  assert.equal(tracker.trades[0].components.trend, 18)
  assert.equal(tracker.startedOn, '2026-01-02')
})

test('a signal that does not trigger expires after the watch window', () => {
  const t = watch()
  applyBars(t, tradingDays('2026-01-02', flat(TRACKER_RULES.swing.watchDays)), weeks)
  assert.equal(t.status, 'expired')
  assert.equal(t.entryDate, undefined)
  assert.equal(t.endedDate, '2026-01-09')
})

test('Watch signals are cancelled when the grade falls below C or the stock leaves the list', () => {
  const tracker = emptyTracker()
  addSignals(tracker, 'swing', [stock('KEEP', 'B'), stock('DROPS', 'A'), stock('GONE', 'B'), stock('BOUGHT', 'B')], '2026-01-02', 'risk-on')
  addSignals(tracker, 'positional', [stock('GONE', 'B')], '2026-01-02', 'risk-on')
  tracker.trades.find((t) => t.symbol === 'BOUGHT')!.status = 'active'
  const today = new Map([
    ['KEEP', { score: 62, grade: 'C' }], // still C: keep the order
    ['DROPS', { score: 57.4, grade: null }],
    ['BOUGHT', { score: 40, grade: null }], // already triggered: not a pending order
  ])
  assert.equal(cancelStale(tracker, 'swing', today, '2026-01-05'), 2)
  const by = (symbol: string, mode = 'swing') => tracker.trades.find((t) => t.symbol === symbol && t.mode === mode)!
  assert.equal(by('KEEP').status, 'watch')
  assert.equal(by('BOUGHT').status, 'active')
  assert.equal(by('DROPS').status, 'cancelled')
  assert.equal(by('DROPS').cancelReason, 'score fell to 57.4 (below C)')
  assert.equal(by('DROPS').endedDate, '2026-01-05')
  assert.match(by('GONE').cancelReason!, /left the list/)
  assert.equal(by('GONE', 'positional').status, 'watch') // other tab untouched
  // A cancelled name can be signalled again once it regrades.
  assert.equal(addSignals(tracker, 'swing', [stock('DROPS', 'B')], '2026-01-06', 'risk-on'), 1)
})

test('the signal day itself is never applied', () => {
  const t = watch()
  applyBars(t, [{ date: '2026-01-02', open: 100, high: 110, low: 99, close: 105, volume: 1 }], weeks)
  assert.equal(t.status, 'watch')
})

test('triggers at the buy-above price, or at the open on a gap up', () => {
  const t = watch()
  applyBars(t, tradingDays('2026-01-02', [[100, 102, 99.5, 101.5]]), weeks)
  assert.equal(t.status, 'active')
  assert.equal(t.entry, 101)
  assert.equal(t.r, 5)
  const gap = watch()
  applyBars(gap, tradingDays('2026-01-02', [[103, 104, 102.5, 103.5]]), weeks)
  assert.equal(gap.entry, 103)
  assert.equal(gap.entryGapPct, 1.98)
})

test('stop hit closes at -1R', () => {
  const t = watch()
  applyBars(t, tradingDays('2026-01-02', [[100, 102, 99.5, 101], [100, 100.5, 95, 95.5]]), weeks)
  assert.equal(t.status, 'closed')
  assert.equal(t.exitReason, 'stop')
  assert.equal(t.rMultiple, -1)
  assert.equal(t.barsHeld, 2)
})

test('breakeven at +1R, half booked at +2R, then the trailing stop exits the rest', () => {
  const t = watch()
  // entry 101, R 5: +1R = 106, +2R = 111
  applyBars(
    t,
    tradingDays('2026-01-02', [
      [100, 102, 100, 101.5],
      [101.5, 107, 101, 106.5], // +1R: stop to 101
      [106.5, 112, 106, 111.5], // +2R: half booked; the prior 3-day low (100) is below the stop
      [111.5, 113, 110, 112],
      [112, 113, 111, 112.5],
      [112, 112, 105, 105.5], // stop raised to 106 (low of the 3 previous days) after the close
      [105.5, 106, 104, 104.5], // opens below 106: exits at the open, 105.5
    ]),
    weeks,
  )
  assert.equal(t.status, 'closed')
  assert.equal(t.exitReason, 'trail')
  assert.equal(t.partialBooked, true)
  assert.equal(t.exitPrice, 105.5)
  assert.equal(t.rMultiple, 1.45) // half at +2R, half at +0.9R
  assert.equal(t.mfeR, 2.4)
})

test('swing time stop: still below +1R after 10 days', () => {
  const t = watch()
  applyBars(t, tradingDays('2026-01-02', [[100, 102, 100, 101.5], ...flat(TRACKER_RULES.swing.timeStopDays, 102)]), weeks)
  assert.equal(t.status, 'closed')
  assert.equal(t.exitReason, 'time')
  assert.equal(t.barsHeld, TRACKER_RULES.swing.timeStopDays)
})

test('summary compares grades by trigger rate, win rate and average R', () => {
  const trades: TrackedTrade[] = [
    { ...watch(), grade: 'A', status: 'closed', entryDate: 'x', rMultiple: 2, barsHeld: 5, mfeR: 2.5 },
    { ...watch(), grade: 'A', status: 'closed', entryDate: 'x', rMultiple: -1, barsHeld: 3, mfeR: 0.5 },
    { ...watch(), grade: 'B', status: 'expired' },
    { ...watch(), grade: 'B', status: 'cancelled' },
    { ...watch(), grade: 'B', status: 'active', entryDate: 'x', entry: 100, r: 5, lastClose: 105, partialBooked: false },
  ]
  const rows = summarize(trades)
  const a = rows.find((r) => r.mode === 'swing' && r.grade === 'A')!
  assert.equal(a.signals, 2)
  assert.equal(a.winRatePct, 50)
  assert.equal(a.avgR, 0.5)
  assert.equal(a.totalR, 1)
  const b = rows.find((r) => r.mode === 'swing' && r.grade === 'B')!
  assert.equal(b.cancelled, 1)
  assert.equal(b.triggerRatePct, 33.33)
  assert.equal(b.openR, 1)
  assert.equal(b.closed, 0)
  assert.equal(rows.find((r) => r.mode === 'swing' && r.grade === 'all')!.signals, 5)
})
