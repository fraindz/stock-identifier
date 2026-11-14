// Run: npx tsx scripts/top10.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Day, Week } from './indicators'
import { dailyUpdate, emptyPortfolio, RULES, weeklyReview, type Candidate, type Portfolio, type Slot } from './top10'

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Trading days (Mon–Fri) after `from`, each with the given OHLC.
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

// Flat weekly history (comfortably above any SMA check) so the thesis rule stays quiet.
const flatWeeks = (end: string, n: number, price: number): Week[] =>
  Array.from({ length: n }, (_, i) => {
    const start = addDays(end, -7 * (n - i) - 4) // a Monday before `end` (a Friday)
    return { start, end: addDays(start, 4), high: price, low: price, close: price, volume: 1 }
  })

function watchSlot(over: Partial<Slot> = {}): Slot {
  return {
    id: 'w_TEST',
    symbol: 'TEST',
    name: 'Test Ltd',
    sector: 'Tech',
    setup: 'base',
    setupNote: '',
    addedWeek: '2026-01-05',
    reviewsWaiting: 0,
    rankAtAdd: 1,
    lastRank: 1,
    status: 'watch',
    trigger: 100,
    initialStop: 90,
    stop: 90,
    riskPct: 10,
    lastDate: '2026-01-09', // a Friday
    lastClose: 98,
    events: [],
    ...over,
  }
}

const portfolioWith = (slot: Slot): Portfolio => ({ ...emptyPortfolio(), lastReviewWeek: '2026-01-05', slots: [slot] })
const run = (p: Portfolio, days: Day[]) =>
  dailyUpdate(p, new Map([['TEST', { days, weeks: flatWeeks('2026-01-09', 40, 50) }]]))

test('trigger hit → active', () => {
  const p = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', [[99, 101, 98, 100.5]]))
  const s = p.slots[0]
  assert.equal(s.status, 'active')
  assert.equal(s.entry, 100)
  assert.equal(s.r, 10)
  assert.equal(s.entryDate, '2026-01-12')
})

test('gap above trigger enters at the open', () => {
  const s = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', [[103, 104, 102, 103]])).slots[0]
  assert.equal(s.entry, 103)
  assert.equal(s.r, 13)
})

test('+1R moves stop to breakeven', () => {
  const s = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', [[99, 101, 98, 100], [100, 110.5, 100, 109]])).slots[0]
  assert.equal(s.status, 'active')
  assert.equal(s.stop, 100)
  assert.ok(s.events.some((e) => e.type === 'breakeven'))
})

test('stop hit → closed at -1R', () => {
  const s = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', [[99, 101, 98, 100], [97, 97, 89, 90]])).slots[0]
  assert.equal(s.status, 'closed')
  assert.equal(s.exitReason, 'stop')
  assert.equal(s.rMultiple, -1)
})

test('+2R books half and the blended R counts it', () => {
  const s = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', [[99, 101, 98, 100], [100, 121, 100, 120], [118, 118, 99, 99]])).slots[0]
  assert.equal(s.partialBooked, true)
  assert.equal(s.status, 'closed')
  assert.equal(s.exitReason, 'trail') // stop had moved to breakeven
  assert.equal(s.rMultiple, 1) // half at +2R, half at 0R
})

test('13 weeks under +1R → time exit', () => {
  const bars = Array.from({ length: 70 }, () => [101, 102, 99, 101] as [number, number, number, number])
  bars[0] = [99, 101, 98, 100]
  const s = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', bars)).slots[0]
  assert.equal(s.status, 'closed')
  assert.equal(s.exitReason, 'time')
  assert.ok(s.daysHeld! >= RULES.timeStopWeeks * 7)
})

test('daily update never changes membership', () => {
  const p = run(portfolioWith(watchSlot()), tradingDays('2026-01-09', [[95, 96, 94, 95]]))
  assert.equal(p.slots.length, 1)
  assert.equal(p.slots[0].status, 'watch')
})

// --- weekly review ---

const candidate = (rank: number, sector = `S${rank}`, over: Partial<Candidate> = {}): Candidate => ({
  rank,
  eligible: true,
  symbol: `C${rank}`,
  name: `Company ${rank}`,
  sector,
  marketCapCr: 10_000,
  setup: 'base',
  setupNote: '',
  score: 100 - rank,
  rsPct: 0, sectorPct: 0, trendPct: 0, setupPct: 0,
  rel6mPct: 0, rel3mPct: 0, trendQuality: 0, sectorBreadthPct: 0,
  close: 100, rsi: 60, belowHighPct: 5, extensionPct: 5, tradedValueCr: 50,
  trigger: 101, stop: 92, riskPct: 9,
  ...over,
})

test('first review fills 10 slots with ≤ 2 per sector', () => {
  const ranked = Array.from({ length: 30 }, (_, i) => candidate(i + 1, `S${i % 4}`))
  const p = weeklyReview(emptyPortfolio(), ranked, '2026-01-05', '2026-01-09')
  // only 4 sectors × 2 = 8 possible
  assert.equal(p.slots.length, 8)
  const ranked2 = Array.from({ length: 30 }, (_, i) => candidate(i + 1))
  assert.equal(weeklyReview(emptyPortfolio(), ranked2, '2026-01-05', '2026-01-09').slots.length, 10)
})

test('skips names with too much risk', () => {
  const ranked = [candidate(1, 'A', { riskPct: 15 }), candidate(2, 'B')]
  const p = weeklyReview(emptyPortfolio(), ranked, '2026-01-05', '2026-01-09')
  assert.deepEqual(p.slots.map((s) => s.symbol), ['C2'])
})

test('second review with the same ranks: no changes; watch dropped after 2 reviews; ≤ 3 adds', () => {
  const ranked = Array.from({ length: 30 }, (_, i) => candidate(i + 1))
  const p = weeklyReview(emptyPortfolio(), ranked, '2026-01-05', '2026-01-09')
  p.slots[0].status = 'active' // pretend one triggered
  weeklyReview(p, ranked, '2026-01-12', '2026-01-16')
  assert.equal(p.slots.length, 10)
  assert.equal(p.slots.filter((s) => s.status !== 'closed').length, 10)

  weeklyReview(p, ranked, '2026-01-19', '2026-01-23')
  const dropped = p.slots.filter((s) => s.exitReason === 'dropped')
  assert.equal(dropped.length, 9)
  const added = p.slots.filter((s) => s.addedWeek === '2026-01-19')
  assert.equal(added.length, RULES.maxNewPerWeek)
  assert.ok(added.every((s) => !dropped.some((d) => d.symbol === s.symbol)))
})

test('watch name below keepRank is dropped', () => {
  const ranked = Array.from({ length: 30 }, (_, i) => candidate(i + 1))
  const p = weeklyReview(emptyPortfolio(), ranked, '2026-01-05', '2026-01-09')
  const reRanked = ranked.map((c) => (c.symbol === 'C1' ? { ...c, rank: 45 } : c))
  weeklyReview(p, reRanked, '2026-01-12', '2026-01-16')
  assert.equal(p.slots.find((s) => s.symbol === 'C1')!.exitReason, 'dropped')
})
