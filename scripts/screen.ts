// Screens NSE stocks for three consecutive completed weeks of trend:
//   downtrend: lower highs, lows and closes, market cap >= ₹10,000 Cr
//   uptrend:   higher highs, lows and closes, market cap >= ₹500 Cr
// and for range breakouts on volume and pullbacks within a rally (see BREAKOUT and PULLBACK below).
// Writes public/{downtrend,uptrend,breakout,pullback,sectors}.json for the web pages.
//
// Usage: npm run screen
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import YahooFinance from 'yahoo-finance2'
import {
  atr,
  BREAKOUT,
  CRORE,
  DAY_MS,
  ema,
  mondayOf,
  percentileRanks,
  pullback,
  breakout,
  PULLBACK,
  round,
  rsi,
  sectorBreadth,
  sma,
  type Company,
  type Day,
  type Week,
} from './indicators'
import { dailyUpdate, eligible, emptyPortfolio, rankCandidates, RULES, weeklyReview, type Portfolio } from './top10'
import {
  carryFirstSeen,
  deliveryStats,
  marketRegime,
  parseBhavcopy,
  passesFilters,
  QUALITY_RULES,
  qualityScore,
  sectorIndices,
  type Delivery,
  type Fundamentals,
  type Mode,
  type QualityStock,
} from './quality'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const QUOTE_BATCH = 100
// Yahoo starts answering HTTP 429 when more requests run at once.
const CHART_CONCURRENCY = 3

type Trend = 'down' | 'up'

const SCREENS: { trend: Trend; minMarketCapCr: number; output: URL }[] = [
  { trend: 'down', minMarketCapCr: 10_000, output: new URL('../public/downtrend.json', import.meta.url) },
  { trend: 'up', minMarketCapCr: 500, output: new URL('../public/uptrend.json', import.meta.url) },
]
const SECTORS_OUTPUT = new URL('../public/sectors.json', import.meta.url)
const BREAKOUT_OUTPUT = new URL('../public/breakout.json', import.meta.url)
const PULLBACK_OUTPUT = new URL('../public/pullback.json', import.meta.url)
const SWING_OUTPUTS = {
  momentum: new URL('../public/momentum.json', import.meta.url),
  pullbacks: new URL('../public/healthy-pullbacks.json', import.meta.url),
  breakouts: new URL('../public/breakout-watchlist.json', import.meta.url),
  volume: new URL('../public/volume-surge.json', import.meta.url),
  tradePlan: new URL('../public/trade-plan.json', import.meta.url),
}
const PORTFOLIO_OUTPUT = new URL('../public/top-10-portfolio.json', import.meta.url)
const CANDIDATES_OUTPUT = new URL('../public/top-10-candidates.json', import.meta.url)
const QUALITY_OUTPUTS: Record<Mode, URL> = {
  swing: new URL('../public/rolling-swing.json', import.meta.url),
  positional: new URL('../public/positional.json', import.meta.url),
}
const BHAV_CACHE = new URL('../.cache/bhav/', import.meta.url)
// Rows below grade C kept in each quality file for the page's "show all" toggle.
const QUALITY_UNGRADED_ROWS = 50

const MIN_MARKET_CAP_CR = Math.min(
  ...SCREENS.map((s) => s.minMarketCapCr),
  BREAKOUT.minMarketCapCr,
  PULLBACK.minMarketCapCr,
)
// About 54 weeks of daily history: the 52-week high and the 30-week SMA (rising vs 4 weeks ago).
const HISTORY_DAYS = 380

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

async function nseSymbols(): Promise<string[]> {
  const res = await fetch('https://archives.nseindia.com/content/equities/EQUITY_L.csv')
  if (!res.ok) throw new Error(`NSE symbol list: HTTP ${res.status}`)
  const rows = (await res.text()).trim().split('\n').slice(1)
  return rows
    .map((r) => r.split(','))
    .filter((cols) => ['EQ', 'BE'].includes(cols[2]?.trim()))
    .map((cols) => cols[0].trim())
}

// IST calendar date (YYYY-MM-DD) of the Monday starting the week containing `d`.
function istWeekStart(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7
  return new Date(ist.getTime() - daysSinceMonday * DAY_MS).toISOString().slice(0, 10)
}

// Monday of the first week that hasn't finished yet. On Saturday and Sunday the week just
// ended counts as completed, so the weekend review uses Friday's weekly candle.
function openWeekStart(d: Date): string {
  const monday = istWeekStart(d)
  const weekday = new Date(d.getTime() + IST_OFFSET_MS).getUTCDay()
  if (weekday !== 0 && weekday !== 6) return monday
  return new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * DAY_MS).toISOString().slice(0, 10)
}

function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

async function largeCaps(symbols: string[]) {
  const out: Omit<Company, 'sector'>[] = []
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const batch = symbols.slice(i, i + QUOTE_BATCH).map((s) => `${s}.NS`)
    const quotes = await withRetry(() => yf.quote(batch, { fields: ['symbol', 'marketCap', 'longName', 'shortName'] }))
    for (const q of quotes) {
      const capCr = (q.marketCap ?? 0) / CRORE
      if (capCr >= MIN_MARKET_CAP_CR) {
        out.push({
          symbol: q.symbol.replace(/\.NS$/, ''),
          name: q.longName ?? q.shortName ?? q.symbol,
          marketCapCr: Math.round(capCr),
        })
      }
    }
    process.stdout.write(`\rMarket caps: ${Math.min(i + QUOTE_BATCH, symbols.length)}/${symbols.length}`)
  }
  process.stdout.write('\n')
  return out
}

// Daily bars grouped into Mon–Fri weeks, oldest first. The last entry may be the
// current, still-incomplete week.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const isRateLimited = (error: unknown) => (error as { code?: unknown })?.code === 429

// Retries with exponential backoff: 1s, 2s, 4s… for ordinary errors and 5s, 10s, 20s…
// when Yahoo rate-limits (HTTP 429), since its blocks last several seconds.
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= tries) throw error
      await sleep((isRateLimited(error) ? 5_000 : 1_000) * 2 ** (attempt - 1))
    }
  }
}

async function priceBars(ticker: string): Promise<{ weeks: Week[]; days: Day[] }> {
  const chart = await withRetry(() =>
    yf.chart(ticker, {
      period1: new Date(Date.now() - HISTORY_DAYS * DAY_MS),
      interval: '1d',
    }),
  )
  const weeks = new Map<string, Week>()
  const days: Day[] = []
  for (const bar of chart.quotes) {
    if (bar.open == null || bar.high == null || bar.low == null || bar.close == null) continue
    const key = istWeekStart(bar.date)
    const day = istDate(bar.date)
    const volume = bar.volume ?? 0
    days.push({ date: day, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume })
    const w = weeks.get(key)
    if (!w) {
      weeks.set(key, { start: day, end: day, high: bar.high, low: bar.low, close: bar.close, volume })
    } else {
      w.high = Math.max(w.high, bar.high)
      w.low = Math.min(w.low, bar.low)
      w.close = bar.close
      w.end = day
      w.volume += volume
    }

  }
  return {
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, w]) => w),
    days,
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
        process.stdout.write(`\rWeekly candles: ${++done}/${items.length}`)
      }
    }),
  )
  process.stdout.write('\n')
  return results
}

// Sector plus fundamentals from one quoteSummary call per stock. Fundamentals are kept in
// a separate map so they don't leak into the per-screen JSON files.
async function loadProfiles(companies: Omit<Company, 'sector'>[]) {
  const fundamentals = new Map<string, Fundamentals>()
  const finite = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)
  const withSectors = await mapLimit(companies, CHART_CONCURRENCY, async (company): Promise<Company> => {
    try {
      const summary = await withRetry(() =>
        yf.quoteSummary(`${company.symbol}.NS`, { modules: ['assetProfile', 'financialData'] }),
      )
      const f = summary.financialData
      if (f) {
        const de = finite(f.debtToEquity)
        fundamentals.set(company.symbol, {
          revenueGrowth: finite(f.revenueGrowth),
          earningsGrowth: finite(f.earningsGrowth),
          debtToEquity: de === undefined ? undefined : de / 100, // Yahoo reports D/E in percent
          roe: finite(f.returnOnEquity),
          operatingMargin: finite(f.operatingMargins),
        })
      }
      return { ...company, sector: summary.assetProfile?.sector?.trim() || 'Unclassified' }
    } catch {
      return { ...company, sector: 'Unclassified' }
    }
  })
  return { companies: withSectors, fundamentals }
}

// Delivery % from NSE's daily bhavcopy for the given trading dates (YYYY-MM-DD). Files are
// cached in .cache/bhav so later runs only fetch new days. Returns null when too few days
// could be fetched (NSE sometimes blocks cloud runners), and scoring falls back to volume only.
async function fetchDeliveryHistory(dates: string[]): Promise<Map<string, Delivery> | null> {
  await mkdir(BHAV_CACHE, { recursive: true })
  const byDate = new Map<string, Map<string, number>>()
  let failures = 0
  await mapLimit(dates, 2, async (date) => {
    const [y, m, d] = date.split('-')
    const file = new URL(`sec_bhavdata_full_${d}${m}${y}.csv`, BHAV_CACHE)
    let csv: string | null = null
    try {
      csv = await readFile(file, 'utf8')
    } catch {
      try {
        csv = await withRetry(async () => {
          const res = await fetch(`https://archives.nseindia.com/products/content/sec_bhavdata_full_${d}${m}${y}.csv`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' },
            signal: AbortSignal.timeout(20_000),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.text()
        }, 3)
        await writeFile(file, csv)
      } catch {
        failures++
      }
    }
    const parsed = csv ? parseBhavcopy(csv) : null
    if (parsed?.size) byDate.set(date, parsed)
  })
  console.log(`Delivery data: ${byDate.size}/${dates.length} days${failures ? ` (${failures} failed)` : ''}`)
  return byDate.size >= 20 ? deliveryStats(byDate) : null
}

// Each week's high, low and close is strictly below (down) or above (up) the week before.
function isTrending(weeks: Week[], trend: Trend): boolean {
  if (weeks.length < 3) return false
  const beyond = trend === 'down' ? (a: number, b: number) => a < b : (a: number, b: number) => a > b
  const [w2, w1, w0] = weeks.slice(-3) // 2 weeks ago, 1 week ago, last week
  return [[w0, w1], [w1, w2]].every(
    ([later, earlier]) =>
      beyond(later.high, earlier.high) && beyond(later.low, earlier.low) && beyond(later.close, earlier.close),
  )
}

const roundWeek = (w: Week) => ({ ...w, high: round(w.high), low: round(w.low), close: round(w.close) })

type SwingStock = {
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

function swingMetrics(company: Company, days: Day[]): SwingStock | null {
  if (days.length < 51) return null
  const closes = days.map((day) => day.close)
  const latest = days.at(-1)!
  const averageVolume = sma(days.map((day) => day.volume), 20)
  const latestAtr = atr(days)
  const entry = latest.close
  return {
    symbol: company.symbol,
    name: company.name,
    sector: company.sector,
    marketCapCr: company.marketCapCr,
    suggestionDate: latest.date,
    close: round(entry),
    change5Pct: round(((entry - closes.at(-6)!) / closes.at(-6)!) * 100),
    change20Pct: round(((entry - closes.at(-21)!) / closes.at(-21)!) * 100),
    rsi: round(rsi(closes)),
    ema20: round(ema(closes.slice(-60), 20)),
    ema50: round(ema(closes, 50)),
    volumeRatio: round(averageVolume ? latest.volume / averageVolume : 0),
    high20: round(Math.max(...days.slice(-20).map((day) => day.high))),
    atr: round(latestAtr),
    entry: round(entry),
    stop: round(entry - latestAtr * 1.5),
    target: round(entry + latestAtr * 3),
    score: 0,
  }
}

async function main() {
  const now = new Date()
  const currentWeek = openWeekStart(now)
  const weekday = new Date(now.getTime() + IST_OFFSET_MS).getUTCDay()
  const forceReview = process.argv.includes('--review')
  // Fetched first, before the bulk requests can trip Yahoo's rate limit.
  const niftyBars = await priceBars('^NSEI')
  const niftyWeeks = niftyBars.weeks
  const symbols = await nseSymbols()
  console.log(`NSE symbols: ${symbols.length}`)

  const { companies: universe, fundamentals } = await loadProfiles(await largeCaps(symbols))
  console.log(`Market cap >= ₹${MIN_MARKET_CAP_CR.toLocaleString('en-IN')} Cr: ${universe.length}`)

  const loadBars = async (stock: Company) => {
    try {
      const { weeks: allWeeks, days: allDays } = await priceBars(`${stock.symbol}.NS`)
      const weeks = [...allWeeks]
      const current = (weeks.at(-1)?.start ?? '') >= currentWeek ? weeks.pop() : undefined
      return { ...stock, weeks, days: allDays, current, ok: true }
    } catch {
      return { ...stock, weeks: [] as Week[], days: [] as Day[], current: undefined as Week | undefined, ok: false }
    }
  }
  const firstPass = await mapLimit(universe, CHART_CONCURRENCY, loadBars)
  // Second pass: give Yahoo a pause, then retry the failures one at a time.
  const retryIndexes = firstPass.flatMap((c, i) => (c.ok ? [] : [i]))
  if (retryIndexes.length) {
    console.log(`Retrying ${retryIndexes.length} failed charts one at a time…`)
    await sleep(30_000)
    const retried = await mapLimit(retryIndexes, 1, (i) => loadBars(universe[i]))
    retryIndexes.forEach((i, k) => (firstPass[i] = retried[k]))
  }
  const failed = firstPass.filter((c) => !c.ok).map((c) => c.symbol)
  const candidates = firstPass.map(({ ok: _ok, ...c }) => c)

  // Week ranges are taken from the largest stock, which trades every session.
  const ref = candidates.reduce((a, b) => (b.weeks.length >= 3 && b.marketCapCr > a.marketCapCr ? b : a))
  const [w2, w1, w0] = ref.weeks.slice(-3)
  const wc = ref.current
  const weeks = {
    currentWeek: wc ? { start: wc.start, end: wc.end } : null,
    lastWeek: { start: w0.start, end: w0.end },
    oneWeekAgo: { start: w1.start, end: w1.end },
    twoWeeksAgo: { start: w2.start, end: w2.end },
  }

  for (const screen of SCREENS) {
    const inUniverse = candidates.filter((c) => c.marketCapCr >= screen.minMarketCapCr)
    const matches = inUniverse
      .filter((c) => isTrending(c.weeks, screen.trend))
      .map(({ weeks, current, ...stock }) => {
        const [twoWeeksAgo, oneWeekAgo, lastWeek] = weeks.slice(-3).map(roundWeek)
        return { ...stock, currentWeek: current ? roundWeek(current) : null, lastWeek, oneWeekAgo, twoWeeksAgo }
      })
      .sort((a, b) => b.marketCapCr - a.marketCapCr)
    await writeFile(
      screen.output,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          trend: screen.trend,
          minMarketCapCr: screen.minMarketCapCr,
          universeSize: inUniverse.length,
          failed: failed.filter((symbol) => inUniverse.some((c) => c.symbol === symbol)),
          weeks,
          stocks: matches,
        },
        null,
        2,
      ),
    )
    console.log(`${screen.trend}trend matches: ${matches.length} of ${inUniverse.length}`)
  }
  const sectorGroups = sectorBreadth(candidates.filter((c) => c.marketCapCr >= 500))
  const sectorRows = [...sectorGroups.entries()]
    .filter(([, group]) => group.advancingOneWeek + group.advancingLastWeek > group.universeCount)
    .map(([name, group]) => ({
      name,
      universeCount: group.universeCount,
      oneWeekBreadthPct: round((group.advancingOneWeek / group.universeCount) * 100),
      lastWeekBreadthPct: round((group.advancingLastWeek / group.universeCount) * 100),
      stocks: group.stocks
        .sort((a, b) => b.marketCapCr - a.marketCapCr)
        .map(({ symbol, name: stockName, marketCapCr }) => ({ symbol, name: stockName, marketCapCr })),
    }))
    .sort((a, b) => b.lastWeekBreadthPct + b.oneWeekBreadthPct - a.lastWeekBreadthPct - a.oneWeekBreadthPct || a.name.localeCompare(b.name))
  await writeFile(
    SECTORS_OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        weeks: { currentWeek: weeks.currentWeek, lastWeek: weeks.lastWeek },
        universeSize: candidates.filter((c) => c.marketCapCr >= 500).length,
        sectors: sectorRows,
      },
      null,
      2,
    ),
  )
  const breakoutUniverse = candidates.filter((c) => c.marketCapCr >= BREAKOUT.minMarketCapCr)
  const breakouts = breakoutUniverse
    .flatMap(({ weeks, current, ...stock }) => {
      const b = breakout(weeks)
      return b ? [{ ...stock, ...b, lastWeek: roundWeek(weeks[weeks.length - 1]), currentWeek: current ? roundWeek(current) : null }] : []
    })
    .sort((a, b) => b.marketCapCr - a.marketCapCr)
  const lookbackWeeks = ref.weeks.slice(-BREAKOUT.lookbackWeeks - 1, -1)
  await writeFile(
    BREAKOUT_OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        minMarketCapCr: BREAKOUT.minMarketCapCr,
        lookbackWeeks: BREAKOUT.lookbackWeeks,
        volumeMultiple: BREAKOUT.volumeMultiple,
        universeSize: breakoutUniverse.length,
        failed: failed.filter((symbol) => breakoutUniverse.some((c) => c.symbol === symbol)),
        weeks: {
          currentWeek: weeks.currentWeek,
          lastWeek: weeks.lastWeek,
          lookback: { start: lookbackWeeks[0].start, end: lookbackWeeks[lookbackWeeks.length - 1].end },
        },
        stocks: breakouts,
      },
      null,
      2,
    ),
  )
  console.log(`breakout matches: ${breakouts.length} of ${breakoutUniverse.length}`)

  const pullbackUniverse = candidates.filter((c) => c.marketCapCr >= PULLBACK.minMarketCapCr)
  const pullbacks = pullbackUniverse
    .flatMap(({ weeks, current, ...stock }) => {
      const pb = pullback(weeks)
      return pb ? [{ ...stock, ...pb, lastWeek: roundWeek(weeks[weeks.length - 1]), currentWeek: current ? roundWeek(current) : null }] : []
    })
    .sort((a, b) => b.marketCapCr - a.marketCapCr)
  await writeFile(
    PULLBACK_OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        minMarketCapCr: PULLBACK.minMarketCapCr,
        peakWithinWeeks: PULLBACK.peakWithinWeeks,
        rallyWeeks: PULLBACK.rallyWeeks,
        minRallyPct: PULLBACK.minRallyPct,
        minRetracePct: PULLBACK.minRetracePct,
        maxRetracePct: PULLBACK.maxRetracePct,
        universeSize: pullbackUniverse.length,
        failed: failed.filter((symbol) => pullbackUniverse.some((c) => c.symbol === symbol)),
        weeks: { currentWeek: weeks.currentWeek, lastWeek: weeks.lastWeek },
        stocks: pullbacks,
      },
      null,
      2,
    ),
  )
  console.log(`pullback matches: ${pullbacks.length} of ${pullbackUniverse.length}`)

  const swingStocks = candidates
    .map(({ weeks: _weeks, current: _current, days, ...company }) => swingMetrics(company, days))
    .filter((stock): stock is SwingStock => stock !== null)
  const writeSwingScreen = async (output: URL, stocks: SwingStock[]) => {
    await writeFile(output, JSON.stringify({
      generatedAt: new Date().toISOString(),
      asOf: swingStocks.length ? daysAsOf(candidates) : null,
      universeSize: swingStocks.length,
      stocks,
    }, null, 2))
  }
  const momentum = swingStocks
    .filter((s) => s.close > s.ema20 && s.ema20 > s.ema50 && s.change20Pct >= 5 && s.rsi >= 55 && s.rsi <= 78)
    .map((s) => ({ ...s, score: round(s.change20Pct + s.volumeRatio * 2) }))
  const healthyPullbacks = swingStocks
    .filter((s) => s.close > s.ema50 && s.close >= s.ema20 * 0.97 && s.close <= s.ema20 * 1.03 && s.rsi >= 40 && s.rsi <= 65 && s.change20Pct > 0)
    .map((s) => ({ ...s, score: round(s.change20Pct - Math.abs(s.close / s.ema20 - 1) * 100) }))
  const breakoutWatchlist = swingStocks
    .filter((s) => s.close <= s.high20 && s.close >= s.high20 * 0.95 && s.close > s.ema50 && s.volumeRatio >= 1)
    .map((s) => ({ ...s, score: round((s.close / s.high20) * 100 + s.volumeRatio) }))
  const volumeSurge = swingStocks
    .filter((s) => {
      const latest = candidates.find((candidate) => candidate.symbol === s.symbol)?.days.at(-1)
      return latest && s.volumeRatio >= 2 && Math.abs(s.change5Pct) >= 2 && (latest.close - latest.low) / Math.max(latest.high - latest.low, 0.01) >= 0.65
    })
    .map((s) => ({ ...s, score: round(s.volumeRatio + Math.max(s.change5Pct, 0)) }))
  // Each screen's score is on its own scale, so rank within each list (0–100) before merging.
  const normalized = (stocks: SwingStock[]) => {
    const ranks = percentileRanks(stocks.map((s) => s.score))
    return stocks.map((s, i) => ({ ...s, score: round(ranks[i]) }))
  }
  const bestBySymbol = new Map<string, SwingStock>()
  for (const stock of [...normalized(momentum), ...normalized(healthyPullbacks), ...normalized(breakoutWatchlist)]) {
    const seen = bestBySymbol.get(stock.symbol)
    if (!seen || stock.score > seen.score) bestBySymbol.set(stock.symbol, stock)
  }
  const tradePlan = [...bestBySymbol.values()].sort((a, b) => b.score - a.score || b.marketCapCr - a.marketCapCr)
  await Promise.all([
    writeSwingScreen(SWING_OUTPUTS.momentum, momentum.sort((a, b) => b.score - a.score)),
    writeSwingScreen(SWING_OUTPUTS.pullbacks, healthyPullbacks.sort((a, b) => b.score - a.score)),
    writeSwingScreen(SWING_OUTPUTS.breakouts, breakoutWatchlist.sort((a, b) => b.score - a.score)),
    writeSwingScreen(SWING_OUTPUTS.volume, volumeSurge.sort((a, b) => b.score - a.score)),
    writeSwingScreen(SWING_OUTPUTS.tradePlan, tradePlan),
  ])
  console.log(`swing screens: momentum ${momentum.length}, pullbacks ${healthyPullbacks.length}, breakouts ${breakoutWatchlist.length}, volume ${volumeSurge.length}`)

  await writeQualityScreens(candidates, niftyBars.days, fundamentals, currentWeek)

  await updateTopTen(candidates, {
    currentWeek,
    review: forceReview || weekday === 0 || weekday === 6,
    forceReview,
    sectorGroups,
    niftyWeeks,
    asOf: daysAsOf(candidates),
  })

  if (failed.length) console.log(`Failed to fetch: ${failed.join(', ')}`)
}

type Loaded = Company & { weeks: Week[]; days: Day[]; current: Week | undefined }

// Rolling Swing and Positional: score every liquid stock on the 100-point quality score,
// gated by the market regime, and write the graded lists.
async function writeQualityScreens(candidates: Loaded[], niftyDays: Day[], fundamentals: Map<string, Fundamentals>, currentWeek: string) {
  let delivery: Map<string, Delivery> | null = null
  try {
    delivery = await fetchDeliveryHistory(niftyDays.slice(-60).map((d) => d.date))
  } catch (error) {
    console.error('Delivery data unavailable:', error)
  }
  const liquid = candidates.filter((c) => c.marketCapCr >= QUALITY_RULES.minMarketCapCr && c.days.length >= 50)
  const regime = marketRegime(niftyDays, liquid)
  const sectors = sectorIndices(liquid, niftyDays)
  const ctx = { niftyDays, regime, sectors }
  const inputs = candidates
    .map((c) => ({
      symbol: c.symbol,
      name: c.name,
      sector: c.sector,
      marketCapCr: c.marketCapCr,
      days: c.days,
      weeks: c.weeks.filter((w) => w.start < currentWeek),
      fundamentals: fundamentals.get(c.symbol) ?? null,
      delivery: delivery?.get(c.symbol) ?? null,
    }))
    .filter((s) => passesFilters(s, niftyDays))
  const asOf = niftyDays.at(-1)!.date
  const tradingDates = niftyDays.map((d) => d.date)
  const sectorRows = [...sectors.values()].sort((a, b) => b.rel20Pct + b.rel65Pct - (a.rel20Pct + a.rel65Pct))

  for (const mode of ['swing', 'positional'] as const) {
    let previous: { stocks: QualityStock[] } | null = null
    try {
      previous = JSON.parse(await readFile(QUALITY_OUTPUTS[mode], 'utf8'))
    } catch {
      // first run
    }
    const scored = inputs
      .map((s) => qualityScore(s, mode, ctx))
      .sort((a, b) => b.score - a.score || b.rawScore - a.rawScore || b.marketCapCr - a.marketCapCr)
    const graded = scored.filter((s) => s.grade)
    const kept = [...graded, ...scored.filter((s) => !s.grade).slice(0, QUALITY_UNGRADED_ROWS)]
    await writeFile(
      QUALITY_OUTPUTS[mode],
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          asOf,
          mode,
          scoredCount: scored.length,
          minMarketCapCr: QUALITY_RULES.minMarketCapCr,
          minTradedValueCr: QUALITY_RULES.minTradedValueCr,
          deliveryAvailable: delivery !== null,
          weights: QUALITY_RULES.weights[mode],
          grades: QUALITY_RULES.grades,
          regime,
          sectors: sectorRows,
          stocks: carryFirstSeen(kept, previous, tradingDates, asOf),
        },
        null,
        2,
      ),
    )
    const count = (g: string) => graded.filter((s) => s.grade === g).length
    console.log(`${mode} quality: ${scored.length} scored, A ${count('A')}, B ${count('B')}, C ${count('C')}`)
  }
  console.log(`Market regime: ${regime.regime} (Nifty ${regime.niftyVs50Pct}% vs 50-DMA, breadth ${regime.breadthPct}%), ${sectors.size} sector indices`)
}

// Top 10 portfolio: daily update of the open slots, then (on weekends, with --review, or
// when there's no portfolio yet) the weekly review that refills free slots.
async function updateTopTen(
  candidates: Loaded[],
  opts: { currentWeek: string; review: boolean; forceReview: boolean; sectorGroups: ReturnType<typeof sectorBreadth>; niftyWeeks: Week[]; asOf: string },
) {
  let existing: Portfolio | null = null
  try {
    existing = JSON.parse(await readFile(PORTFOLIO_OUTPUT, 'utf8')) as Portfolio
  } catch {
    console.log('No Top 10 portfolio yet: running the first review')
  }
  const portfolio = existing ?? emptyPortfolio()
  portfolio.rules = RULES

  const bars = new Map(
    candidates.map((c) => [c.symbol, { days: c.days, weeks: c.current ? [...c.weeks, c.current] : c.weeks }]),
  )
  const missing = [...new Set(portfolio.slots.filter((s) => s.status !== 'closed' && !bars.get(s.symbol)?.days.length).map((s) => s.symbol))]
  for (const [symbol, b] of await mapLimit(missing, CHART_CONCURRENCY, async (symbol) => {
    try {
      return [symbol, await priceBars(`${symbol}.NS`)] as const
    } catch (error) {
      console.error(`Could not update Top 10 slot ${symbol}:`, error)
      return [symbol, { weeks: [] as Week[], days: [] as Day[] }] as const
    }
  })) bars.set(symbol, b)
  dailyUpdate(portfolio, bars)

  const nifty = opts.niftyWeeks.filter((w) => w.start < opts.currentWeek)
  const reviewWeek = mondayOf(nifty.at(-1)!.start)
  const doReview = !existing || opts.forceReview || (opts.review && reviewWeek > portfolio.lastReviewWeek)

  if (doReview) {
    const sectorStrength = new Map(
      [...opts.sectorGroups.entries()].map(([name, g]) => [name, ((g.advancingOneWeek + g.advancingLastWeek) / (2 * g.universeCount)) * 100]),
    )
    const analysed = candidates.flatMap((c) => {
      const analysis = eligible(c, nifty)
      return analysis ? [{ symbol: c.symbol, name: c.name, sector: c.sector, marketCapCr: c.marketCapCr, analysis }] : []
    })
    const ranked = rankCandidates(analysed, sectorStrength)
    weeklyReview(portfolio, ranked, reviewWeek, opts.asOf)
    const bench = ranked.filter((c) => c.eligible)
    await writeFile(
      CANDIDATES_OUTPUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          asOf: opts.asOf,
          reviewWeek,
          trendUniverse: analysed.length,
          eligibleCount: bench.length,
          rules: RULES,
          candidates: bench.slice(0, RULES.benchSize),
        },
        null,
        2,
      ),
    )
    console.log(`Top 10 review (week of ${reviewWeek}): ${analysed.length} pass the trend filter, ${bench.length} eligible`)
  }
  portfolio.updatedAt = new Date().toISOString()
  await writeFile(PORTFOLIO_OUTPUT, JSON.stringify(portfolio, null, 2))
  const open = portfolio.slots.filter((s) => s.status !== 'closed')
  console.log(`Top 10 portfolio: ${open.filter((s) => s.status === 'active').length} active, ${open.filter((s) => s.status === 'watch').length} watch`)
}

function daysAsOf(candidates: { days: Day[] }[]) {
  return candidates.reduce((latest, candidate) => {
    const date = candidate.days.at(-1)?.date ?? ''
    return date > latest ? date : latest
  }, '')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
