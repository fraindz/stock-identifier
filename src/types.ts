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
