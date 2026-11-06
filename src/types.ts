export type Trend = 'down' | 'up'

export type Week = { start: string; end: string; high: number; low: number; close: number }

export type Stock = {
  symbol: string
  name: string
  marketCapCr: number
  currentWeek: Week | null
  lastWeek: Week
  oneWeekAgo: Week
  twoWeeksAgo: Week
}

export type Range = { start: string; end: string }

export type ScreenerData = {
  generatedAt: string
  minMarketCapCr: number
  universeSize: number
  failed: string[]
  weeks: { currentWeek: Range | null; lastWeek: Range; oneWeekAgo: Range; twoWeeksAgo: Range }
  stocks: Stock[]
}

export type BreakoutStock = {
  symbol: string
  name: string
  marketCapCr: number
  rangeHigh: number // highest high of the lookback weeks
  abovePct: number // last week's close above rangeHigh, in %
  avgVolume: number // average weekly volume over the lookback weeks
  volumeRatio: number // last week's volume / avgVolume
  lastWeek: Week & { volume: number }
  currentWeek: Week | null
}

export type BreakoutData = {
  generatedAt: string
  minMarketCapCr: number
  lookbackWeeks: number
  volumeMultiple: number
  universeSize: number
  failed: string[]
  weeks: { currentWeek: Range | null; lastWeek: Range; lookback: Range }
  stocks: BreakoutStock[]
}

export type PullbackStock = {
  symbol: string
  name: string
  marketCapCr: number
  rally: { start: string; low: number; peakWeek: string; high: number; pct: number }
  pullback: { weeks: number; low: number; retracePct: number; volumeVsRally: number }
  prevWeekHigh: number
  belowPeakPct: number // last week's close below the rally peak, in %
  lastWeek: Week
  currentWeek: Week | null
}

export type PullbackData = {
  generatedAt: string
  minMarketCapCr: number
  peakWithinWeeks: number
  rallyWeeks: number
  minRallyPct: number
  minRetracePct: number
  maxRetracePct: number
  universeSize: number
  failed: string[]
  weeks: { currentWeek: Range | null; lastWeek: Range }
  stocks: PullbackStock[]
}

export type Sector = {
  name: string
  universeCount: number
  oneWeekBreadthPct: number
  lastWeekBreadthPct: number
  stocks: { symbol: string; name: string; marketCapCr: number }[]
}

export type SectorData = {
  generatedAt: string
  weeks: { lastWeek: Range; currentWeek: Range | null }
  universeSize: number
  sectors: Sector[]
}

export type SwingStock = {
  symbol: string
  name: string
  sector: string
  marketCapCr: number
  close: number
  change5Pct: number
  change20Pct: number
  rsi: number
  ema20: number
  ema50: number
  volumeRatio: number
  high20: number
  atr: number
  entry: number
  stop: number
  target: number
  score: number
}

export type SwingData = {
  generatedAt: string
  asOf: string | null
  universeSize: number
  stocks: SwingStock[]
}
