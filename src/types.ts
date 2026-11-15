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
  suggestionDate: string
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

// Top 10 portfolio (public/top-10-portfolio.json); mirrors scripts/top10.ts.
export type Setup = 'breakout' | 'pullback' | 'base'
export type ExitReason = 'stop' | 'trail' | 'time' | 'thesis' | 'dropped'
export type SlotEvent = {
  date: string
  type: 'added' | 'triggered' | 'breakeven' | 'partial' | 'trail' | 'closed' | 'dropped'
  note: string
}

export type Slot = {
  id: string
  symbol: string
  name: string
  sector: string
  setup: Setup
  setupNote: string
  addedWeek: string
  reviewsWaiting: number
  rankAtAdd: number
  lastRank: number | null
  status: 'watch' | 'active' | 'closed'
  trigger: number
  initialStop: number
  stop: number
  riskPct: number
  confidence?: number // at the latest review, while on watch
  entryDate?: string
  entry?: number
  r?: number
  partialBooked?: boolean
  lastDate: string
  lastClose: number
  maxHigh?: number
  closedDate?: string
  exitPrice?: number
  exitReason?: ExitReason
  rMultiple?: number
  mfeR?: number
  daysHeld?: number
  events: SlotEvent[]
}

export type TopTenRules = {
  maxSlots: number
  maxNewPerWeek: number
  watchReviews: number
  partialR: number
  breakevenR: number
  timeStopWeeks: number
  trailWeeks: number
  [key: string]: unknown
}

export type Portfolio = {
  updatedAt: string
  asOf: string
  lastReviewWeek: string
  rules: TopTenRules
  slots: Slot[]
}

export type Candidate = {
  rank: number
  eligible: boolean
  symbol: string
  name: string
  sector: string
  marketCapCr: number
  setup: Setup | null
  setupNote: string
  score: number
  rsPct: number
  sectorPct: number
  trendPct: number
  setupPct: number
  rel6mPct: number
  rel3mPct: number
  trendQuality: number
  sectorBreadthPct: number
  close: number
  rsi: number
  belowHighPct: number
  extensionPct: number
  tradedValueCr: number
  trigger: number
  stop: number
  riskPct: number
  triggerGapPct?: number // missing in files written before confidence was added
  confidence?: number
  qualityScore?: number | null // Positional quality score; missing in older files
}

export type CandidatesData = {
  generatedAt: string
  asOf: string
  reviewWeek: string
  trendUniverse: number
  eligibleCount: number
  candidates: Candidate[]
}

// Rolling Swing / Positional quality scores (public/{rolling-swing,positional}.json); mirrors scripts/quality.ts.
export type QualityComponentKey = 'trend' | 'rs' | 'sector' | 'setup' | 'volume' | 'fundamentals' | 'riskReward'
export type QualityComponent = { key: QualityComponentKey; label: string; points: number; max: number; note: string }
export type Grade = 'A' | 'B' | 'C'

export type MarketRegime = {
  regime: 'risk-on' | 'caution' | 'risk-off'
  asOf: string
  niftyClose: number
  niftyVs50Pct: number
  niftyVs200Pct: number
  sma50Rising: boolean
  breadthPct: number
  note: string
}

export type QualitySector = {
  name: string
  members: number
  ret20Pct: number
  ret65Pct: number
  rel20Pct: number
  rel65Pct: number
  breadthPct: number
  above50: boolean
}

export type QualityStock = {
  symbol: string
  name: string
  sector: string
  marketCapCr: number
  close: number
  rawScore: number
  score: number
  grade: Grade | null
  setup: string | null
  setupNote: string
  trigger: number
  stop: number
  target: number
  riskPct: number
  rr: number
  triggerGapPct: number
  deliveryPct: number | null
  fundamentalsCoverage: number
  components: QualityComponent[]
  firstSeen: string
  daysListed: number
}

export type QualityData = {
  generatedAt: string
  asOf: string
  mode: 'swing' | 'positional'
  scoredCount: number
  minMarketCapCr?: number // missing in files written before it was added
  minTradedValueCr?: number
  deliveryAvailable: boolean
  weights: Record<QualityComponentKey, number>
  grades: Record<Grade, number>
  regime: MarketRegime
  sectors: QualitySector[]
  stocks: QualityStock[]
}
