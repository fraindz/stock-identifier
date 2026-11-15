// Pure price helpers and weekly setups shared by screen.ts and top10.ts.

export const CRORE = 1e7
export const DAY_MS = 24 * 60 * 60 * 1000

export type Week = { start: string; end: string; high: number; low: number; close: number; volume: number }
export type Day = { date: string; open: number; high: number; low: number; close: number; volume: number }
export type Bar = { high: number; low: number; close: number }
export type Company = { symbol: string; name: string; marketCapCr: number; sector: string }

// Last week closed above the highest high of the previous `lookbackWeeks` weeks, on
// at least `volumeMultiple` times their average weekly volume.
export const BREAKOUT = {
  minMarketCapCr: 1_000,
  lookbackWeeks: 20,
  volumeMultiple: 1.5,
}

// A rally of at least `minRallyPct` up to a peak within the last `peakWithinWeeks` weeks,
// measured from the lowest low of the `rallyWeeks` weeks up to the peak; then a pullback
// of `minRetracePct`–`maxRetracePct` of the rally on lighter volume than the rally; and
// last week closing above the previous week's high while still below the peak.
export const PULLBACK = {
  minMarketCapCr: 1_000,
  peakWithinWeeks: 12,
  rallyWeeks: 12,
  minRallyPct: 20,
  minRetracePct: 25,
  maxRetracePct: 62,
}

export const round = (n: number) => Math.round(n * 100) / 100

// One target rule for every tab: the nearer of the 52-week high (overhead resistance) and
// TARGET_R times the risk. With the 52-week high within 2% of the entry (or below it) there's
// no resistance overhead ("blue sky") and the target is TARGET_R.
export const TARGET_R = 3
export function targetFor(entry: number, stop: number, high52: number) {
  const risk = entry - stop
  const cap = entry + TARGET_R * risk
  const blueSky = high52 <= entry * 1.02
  const target = blueSky ? cap : Math.min(high52, cap)
  return { target, rr: risk > 0 ? (target - entry) / risk : 0, blueSky }
}
export const avg = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length
export const sma = (xs: number[], length: number) => avg(xs.slice(-length))

export function ema(xs: number[], length: number) {
  const alpha = 2 / (length + 1)
  return xs.slice(1).reduce((value, price) => alpha * price + (1 - alpha) * value, xs[0])
}

export function rsi(closes: number[], length = 14) {
  const changes = closes.slice(1).map((close, i) => close - closes[i])
  const gains = changes.slice(-length).map((change) => Math.max(change, 0))
  const losses = changes.slice(-length).map((change) => Math.max(-change, 0))
  const averageLoss = avg(losses)
  return averageLoss === 0 ? 100 : 100 - 100 / (1 + avg(gains) / averageLoss)
}

// Average true range over the last `length` bars (daily or weekly).
export function atr(bars: Bar[], length = 14) {
  const ranges = bars
    .slice(1)
    .map((bar, i) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i].close), Math.abs(bar.low - bars[i].close)))
  return avg(ranges.slice(-length))
}

// Monday (YYYY-MM-DD) of the week containing a YYYY-MM-DD date.
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - daysSinceMonday * DAY_MS).toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

// Breakout figures for the latest completed week, or null if it isn't a breakout.
export function breakout(weeks: Week[]) {
  if (weeks.length < BREAKOUT.lookbackWeeks + 1) return null
  const last = weeks[weeks.length - 1]
  const lookback = weeks.slice(-BREAKOUT.lookbackWeeks - 1, -1)
  const rangeHigh = Math.max(...lookback.map((w) => w.high))
  const avgVolume = lookback.reduce((sum, w) => sum + w.volume, 0) / lookback.length
  if (!(last.close > rangeHigh && avgVolume > 0 && last.volume >= BREAKOUT.volumeMultiple * avgVolume)) return null
  return {
    rangeHigh: round(rangeHigh),
    abovePct: round(((last.close - rangeHigh) / rangeHigh) * 100),
    avgVolume: Math.round(avgVolume),
    volumeRatio: round(last.volume / avgVolume),
  }
}

// Rally/pullback figures for the latest completed week, or null if it doesn't fit the setup.
export function pullback(weeks: Week[]) {
  const L = weeks.length - 1
  // The peak needs at least one pullback week between it and last week (the turn week).
  const peakFrom = Math.max(0, L - PULLBACK.peakWithinWeeks)
  if (L - 2 < peakFrom) return null
  let p = peakFrom
  for (let i = peakFrom; i <= L - 2; i++) if (weeks[i].high > weeks[p].high) p = i
  const peak = weeks[p]
  const after = weeks.slice(p + 1) // pullback weeks plus last week
  if (after.some((w) => w.high >= peak.high)) return null

  const rally = weeks.slice(Math.max(0, p - PULLBACK.rallyWeeks), p + 1)
  let s = 0
  for (let i = 1; i < rally.length; i++) if (rally[i].low < rally[s].low) s = i
  const start = rally[s]
  if (s === rally.length - 1) return null // the peak week itself was the low
  const rallyPct = ((peak.high - start.low) / start.low) * 100
  if (rallyPct < PULLBACK.minRallyPct) return null

  const pullbackLow = Math.min(...after.map((w) => w.low))
  const retracePct = ((peak.high - pullbackLow) / (peak.high - start.low)) * 100
  if (retracePct < PULLBACK.minRetracePct || retracePct > PULLBACK.maxRetracePct) return null

  const rallyVolume = avg(rally.slice(s + 1).map((w) => w.volume))
  const pullbackVolume = avg(after.slice(0, -1).map((w) => w.volume))
  if (!(rallyVolume > 0 && pullbackVolume < rallyVolume)) return null

  const last = weeks[L]
  const prev = weeks[L - 1]
  if (!(last.close > prev.high && last.close < peak.high)) return null

  return {
    rally: { start: start.start, low: round(start.low), peakWeek: peak.start, high: round(peak.high), pct: round(rallyPct) },
    pullback: { weeks: after.length - 1, low: round(pullbackLow), retracePct: round(retracePct), volumeVsRally: round(pullbackVolume / rallyVolume) },
    prevWeekHigh: round(prev.high),
    belowPeakPct: round(((peak.high - last.close) / peak.high) * 100),
  }
}

export type SectorGroup = { universeCount: number; advancingOneWeek: number; advancingLastWeek: number; stocks: Company[] }

// Per-sector counts of stocks whose weekly close rose one week ago and last week.
export function sectorBreadth(companies: (Company & { weeks: Week[] })[]): Map<string, SectorGroup> {
  const groups = new Map<string, SectorGroup>()
  for (const company of companies) {
    if (company.weeks.length < 3) continue
    const [twoWeeksAgo, oneWeekAgo, lastWeek] = company.weeks.slice(-3)
    const group = groups.get(company.sector) ?? { universeCount: 0, advancingOneWeek: 0, advancingLastWeek: 0, stocks: [] }
    group.universeCount++
    if (oneWeekAgo.close > twoWeeksAgo.close) group.advancingOneWeek++
    if (lastWeek.close > oneWeekAgo.close) group.advancingLastWeek++
    if (oneWeekAgo.close > twoWeeksAgo.close && lastWeek.close > oneWeekAgo.close) group.stocks.push(company)
    groups.set(company.sector, group)
  }
  return groups
}

// Percentile rank (0–100) of each value within the list; ties share their average rank.
export function percentileRanks(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50)
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const ranks = new Array<number>(values.length)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const pct = (((i + j) / 2) / (values.length - 1)) * 100
    for (let k = i; k <= j; k++) ranks[order[k][1]] = pct
    i = j + 1
  }
  return ranks
}
