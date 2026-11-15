// Run: npm run test:quality
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mondayOf, type Day, type Week } from './indicators'
import {
  applyRegime,
  carryFirstSeen,
  deliveryStats,
  fundamentalScore,
  gradeOf,
  lin,
  marketRegime,
  parseBhavcopy,
  passesFilters,
  QUALITY_RULES,
  qualityScore,
  riskRewardScore,
  rsScore,
  sectorIndices,
  swingSetup,
  trendScore,
  volumeScore,
  type Context,
  type MarketRegime,
} from './quality'

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Weekday bars ending on Friday 2026-11-13, one per close (±1% high/low).
function bars(closes: number[], volume: (i: number) => number = () => 1_000_000): Day[] {
  const dates: string[] = []
  let date = '2026-11-14'
  while (dates.length < closes.length) {
    date = addDays(date, -1)
    if (![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) dates.unshift(date)
  }
  return closes.map((close, i) => ({
    date: dates[i],
    open: i ? closes[i - 1] : close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: volume(i),
  }))
}

function weeksOf(days: Day[]): Week[] {
  const map = new Map<string, Week>()
  for (const d of days) {
    const key = mondayOf(d.date)
    const w = map.get(key)
    if (!w) map.set(key, { start: d.date, end: d.date, high: d.high, low: d.low, close: d.close, volume: d.volume })
    else Object.assign(w, { end: d.date, high: Math.max(w.high, d.high), low: Math.min(w.low, d.low), close: d.close, volume: w.volume + d.volume })
  }
  return [...map.values()]
}

const path = (n: number, start: number, dailyPct: number) => Array.from({ length: n }, (_, i) => start * (1 + dailyPct / 100) ** i)
const RISK_ON: MarketRegime = { regime: 'risk-on', asOf: '2026-11-13', niftyClose: 1, niftyVs50Pct: 1, niftyVs200Pct: 1, sma50Rising: true, breadthPct: 60, note: '' }

test('lin maps thresholds in either direction', () => {
  assert.equal(lin(0, 0, 10), 0)
  assert.equal(lin(5, 0, 10), 0.5)
  assert.equal(lin(20, 0, 10), 1)
  assert.equal(lin(1.5, 1.5, 0.3), 0) // lower is better
  assert.equal(lin(0.1, 1.5, 0.3), 1)
})

test('grade boundaries', () => {
  assert.equal(gradeOf(59.99), null)
  assert.equal(gradeOf(60), 'C')
  assert.equal(gradeOf(69.99), 'C')
  assert.equal(gradeOf(70), 'B')
  assert.equal(gradeOf(79.99), 'B')
  assert.equal(gradeOf(80), 'A')
})

test('regime adjustment: caution deducts, risk-off caps below A', () => {
  assert.equal(applyRegime(85, 'risk-on'), 85)
  assert.equal(applyRegime(85, 'caution'), 85 - QUALITY_RULES.regime.cautionPenalty)
  assert.equal(applyRegime(85, 'risk-off'), 79)
  assert.equal(applyRegime(65, 'risk-off'), 65)
  assert.equal(gradeOf(applyRegime(100, 'risk-off')), 'B')
})

test('market regime classification', () => {
  const up = bars(path(250, 100, 0.1))
  const down = bars(path(250, 100, -0.1))
  const rising = Array.from({ length: 10 }, () => ({ days: up }))
  const falling = Array.from({ length: 10 }, () => ({ days: down }))
  assert.equal(marketRegime(up, rising).regime, 'risk-on')
  assert.equal(marketRegime(down, rising).regime, 'risk-off')
  assert.equal(marketRegime(up, falling).regime, 'risk-off') // breadth 0%
  assert.equal(marketRegime(up, [...rising.slice(0, 4), ...falling.slice(0, 6)]).regime, 'caution') // breadth 40%
})

test('trend strength: aligned uptrend scores high, downtrend low', () => {
  const up = bars(path(250, 100, 0.2))
  const down = bars(path(250, 100, -0.2))
  for (const mode of ['swing', 'positional'] as const) {
    assert.ok(trendScore(mode, up, weeksOf(up)).points >= 0.95 * QUALITY_RULES.weights[mode].trend)
    assert.ok(trendScore(mode, down, weeksOf(down)).points <= 0.05 * QUALITY_RULES.weights[mode].trend)
  }
})

test('relative strength vs Nifty: in line scores zero, strong outperformance scores full', () => {
  const nifty = bars(path(250, 100, 0.05))
  assert.equal(rsScore('swing', nifty, nifty, undefined).points, 0)
  const strong = bars(path(250, 100, 0.5))
  assert.equal(rsScore('swing', strong, nifty, undefined).points, QUALITY_RULES.weights.swing.rs)
  assert.equal(rsScore('positional', strong, nifty, undefined).points, QUALITY_RULES.weights.positional.rs)
})

test('missing fundamentals score half; financials skip debt/equity', () => {
  const none = fundamentalScore('positional', null, 'Industrials')
  assert.equal(none.component.points, QUALITY_RULES.weights.positional.fundamentals / 2)
  assert.equal(none.coverage, 0)
  const strong = { revenueGrowth: 0.3, earningsGrowth: 0.4, roe: 0.25, operatingMargin: 0.25, debtToEquity: 0.1 }
  assert.equal(fundamentalScore('positional', strong, 'Industrials').component.points, 15)
  const bank = fundamentalScore('positional', { ...strong, debtToEquity: 8 }, 'Financial Services')
  assert.equal(bank.component.points, 15)
  assert.equal(bank.coverage, 1)
  const partial = fundamentalScore('positional', { revenueGrowth: 0.3 }, 'Industrials')
  assert.equal(partial.coverage, 0.2)
  assert.match(partial.component.note, /1\/5 fields/)
})

test('volume confirmation rescales onto relative volume when delivery is missing', () => {
  // Rising days on 3× volume in the last week: relative and up/down volume both full.
  const days = bars(path(80, 100, 0.3), (i) => (i >= 75 ? 3_000_000 : 1_000_000))
  const weeks = weeksOf(days)
  const without = volumeScore('swing', days, weeks, null)
  assert.equal(without.points, QUALITY_RULES.weights.swing.volume)
  assert.match(without.note, /delivery n\/a/)
  const weakDelivery = volumeScore('swing', days, weeks, { recent5: 20, recent20: 25, base60: 40 })
  assert.ok(weakDelivery.points < without.points)
  const strongDelivery = volumeScore('swing', days, weeks, { recent5: 70, recent20: 65, base60: 45 })
  assert.equal(strongDelivery.points, QUALITY_RULES.weights.swing.volume)
})

test('risk/reward: blue-sky target is 3R, the 52-week high + 1% caps it', () => {
  const blue = riskRewardScore('swing', 100, 101, 98, 100)
  assert.equal(blue.rr, 3)
  assert.equal(blue.target, 110)
  const capped = riskRewardScore('swing', 100, 101, 98, 104)
  assert.equal(capped.target, 105.04) // 52-week high + 1%
  assert.equal(capped.rr, 1.35)
  assert.match(capped.component.note, /52-week high \+ 1%/)
})

test('swing setup detects a 20-day-high breakout', () => {
  const closes = [...path(80, 100, 0.1), 100 * 1.001 ** 79 * 1.03]
  const days = bars(closes, (i) => (i === 80 ? 2_500_000 : 1_000_000))
  const s = swingSetup(days)
  assert.equal(s?.setup, 'breakout')
  assert.ok(s!.stop < s!.trigger)
})

test('quality score sums components and applies the regime', () => {
  const nifty = bars(path(250, 100, 0.05))
  const days = bars(path(250, 100, 0.25))
  const stock = { symbol: 'TEST', name: 'Test', sector: 'Tech', marketCapCr: 5000, days, weeks: weeksOf(days).slice(0, -1), fundamentals: null, delivery: null }
  const ctx: Context = { niftyDays: nifty, regime: RISK_ON, sectors: sectorIndices([], nifty) }
  for (const mode of ['swing', 'positional'] as const) {
    const q = qualityScore(stock, mode, ctx)
    const sum = Math.round(q.components.reduce((s, c) => s + c.points, 0) * 100) / 100
    assert.equal(q.rawScore, sum)
    assert.equal(q.score, q.rawScore)
    assert.equal(q.components.reduce((s, c) => s + c.max, 0), 100)
    const caution = qualityScore(stock, mode, { ...ctx, regime: { ...RISK_ON, regime: 'caution' } })
    assert.equal(caution.score, Math.max(0, Math.round((q.rawScore - 5) * 100) / 100))
  }
})

test('firstSeen carries over for names still graded', () => {
  const base = { grade: 'B' as const }
  const stocks = [
    { ...base, symbol: 'OLD' },
    { ...base, symbol: 'NEW' },
    { ...base, symbol: 'GONE', grade: null },
  ] as Parameters<typeof carryFirstSeen>[0]
  const prev = { stocks: [{ symbol: 'OLD', grade: 'A', firstSeen: '2026-11-11' }, { symbol: 'GONE', grade: 'C', firstSeen: '2026-11-10' }] }
  const out = carryFirstSeen(stocks, prev, ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'], '2026-11-13')
  assert.deepEqual(out.map((s) => [s.symbol, s.firstSeen, s.daysListed]), [
    ['OLD', '2026-11-11', 3],
    ['NEW', '2026-11-13', 1],
    ['GONE', '2026-11-13', 0],
  ])
})

test('bhavcopy parsing and delivery averages', () => {
  const csv = [
    'SYMBOL, SERIES, DATE1, CLOSE_PRICE, DELIV_QTY, DELIV_PER',
    'ABC, EQ, 13-Nov-2026, 10, 5, 55.5',
    'ABC, BE, 13-Nov-2026, 10, 5, 99',
    'XYZ, EQ, 13-Nov-2026, 10, -, -',
  ].join('\n')
  assert.deepEqual([...parseBhavcopy(csv)], [['ABC', 55.5]])
  const byDate = new Map(Array.from({ length: 30 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, new Map([['ABC', i < 25 ? 40 : 60]])]))
  const stats = deliveryStats(byDate).get('ABC')!
  assert.equal(stats.recent5, 60)
  assert.equal(stats.recent20, 45)
})

test('only stocks with market cap of ₹1,000 Cr or more are scored', () => {
  const nifty = bars(path(250, 100, 0.05))
  const days = bars(path(250, 100, 0.1), () => 2_000_000) // ~₹20 Cr+ traded a day
  const stock = (marketCapCr: number) => ({ symbol: 'T', name: 'T', sector: 'Tech', marketCapCr, days, weeks: weeksOf(days), fundamentals: null, delivery: null })
  assert.equal(QUALITY_RULES.minMarketCapCr, 1000)
  assert.equal(passesFilters(stock(999), nifty), false)
  assert.equal(passesFilters(stock(1000), nifty), true)
})

test('one target rule: the nearer of the 52-week high + 1% and 3R', async () => {
  const { targetFor } = await import('./indicators')
  assert.deepEqual(targetFor(100, 95, 100), { target: 115, rr: 3, blueSky: true }) // at the high: 3R
  const r = targetFor(100, 95, 108) // resistance first: 108 + 1%
  assert.equal(Math.round(r.target * 100) / 100, 109.08)
  assert.equal(Math.round(r.rr * 1000) / 1000, 1.816)
  assert.equal(targetFor(100, 95, 114.5).target, 115) // 114.5 + 1% is beyond 3R: 3R
  assert.equal(targetFor(100, 95, 130).target, 115)
})
