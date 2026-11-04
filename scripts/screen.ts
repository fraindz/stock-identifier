// Screens NSE stocks for three consecutive completed weeks of trend:
//   downtrend: lower highs, lows and closes, market cap >= ₹10,000 Cr
//   uptrend:   higher highs, lows and closes, market cap >= ₹500 Cr
// and for range breakouts on volume and pullbacks within a rally (see BREAKOUT and PULLBACK below).
// Writes public/{downtrend,uptrend,breakout,pullback,sectors}.json for the web pages.
//
// Usage: npm run screen
import { writeFile } from 'node:fs/promises'
import YahooFinance from 'yahoo-finance2'

const CRORE = 1e7
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const QUOTE_BATCH = 100
const CHART_CONCURRENCY = 6

type Trend = 'down' | 'up'

const SCREENS: { trend: Trend; minMarketCapCr: number; output: URL }[] = [
  { trend: 'down', minMarketCapCr: 10_000, output: new URL('../public/downtrend.json', import.meta.url) },
  { trend: 'up', minMarketCapCr: 500, output: new URL('../public/uptrend.json', import.meta.url) },
]
const SECTORS_OUTPUT = new URL('../public/sectors.json', import.meta.url)

// Last week closed above the highest high of the previous `lookbackWeeks` weeks, on
// at least `volumeMultiple` times their average weekly volume.
const BREAKOUT = {
  minMarketCapCr: 1_000,
  lookbackWeeks: 20,
  volumeMultiple: 1.5,
  output: new URL('../public/breakout.json', import.meta.url),
}

// A rally of at least `minRallyPct` up to a peak within the last `peakWithinWeeks` weeks,
// measured from the lowest low of the `rallyWeeks` weeks up to the peak; then a pullback
// of `minRetracePct`–`maxRetracePct` of the rally on lighter volume than the rally; and
// last week closing above the previous week's high while still below the peak.
const PULLBACK = {
  minMarketCapCr: 1_000,
  peakWithinWeeks: 12,
  rallyWeeks: 12,
  minRallyPct: 20,
  minRetracePct: 25,
  maxRetracePct: 62,
  output: new URL('../public/pullback.json', import.meta.url),
}

const MIN_MARKET_CAP_CR = Math.min(
  ...SCREENS.map((s) => s.minMarketCapCr),
  BREAKOUT.minMarketCapCr,
  PULLBACK.minMarketCapCr,
)
// Enough daily history for the longest lookback plus last week and the current week.
const HISTORY_DAYS =
  (Math.max(BREAKOUT.lookbackWeeks, PULLBACK.peakWithinWeeks + PULLBACK.rallyWeeks) + 3) * 7

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

type Week = { start: string; end: string; high: number; low: number; close: number; volume: number }
type Company = { symbol: string; name: string; marketCapCr: number; sector: string }

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

function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

async function largeCaps(symbols: string[]) {
  const out: Omit<Company, 'sector'>[] = []
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const batch = symbols.slice(i, i + QUOTE_BATCH).map((s) => `${s}.NS`)
    const quotes = await yf.quote(batch, { fields: ['symbol', 'marketCap', 'longName', 'shortName'] })
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
async function weeklyBars(symbol: string): Promise<Week[]> {
  const chart = await yf.chart(`${symbol}.NS`, {
    period1: new Date(Date.now() - HISTORY_DAYS * DAY_MS),
    interval: '1d',
  })
  const weeks = new Map<string, Week>()
  for (const bar of chart.quotes) {
    if (bar.high == null || bar.low == null || bar.close == null) continue
    const key = istWeekStart(bar.date)
    const day = istDate(bar.date)
    const volume = bar.volume ?? 0
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
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, w]) => w)
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

async function loadSectors(companies: Omit<Company, 'sector'>[]): Promise<Company[]> {
  return mapLimit(companies, CHART_CONCURRENCY, async (company) => {
    try {
      const summary = await yf.quoteSummary(`${company.symbol}.NS`, { modules: ['assetProfile'] })
      return { ...company, sector: summary.assetProfile?.sector?.trim() || 'Unclassified' }
    } catch {
      return { ...company, sector: 'Unclassified' }
    }
  })
}

const round = (n: number) => Math.round(n * 100) / 100

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

// Breakout figures for the latest completed week, or null if it isn't a breakout.
function breakout(weeks: Week[]) {
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

const avg = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length

// Rally/pullback figures for the latest completed week, or null if it doesn't fit the setup.
function pullback(weeks: Week[]) {
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

async function main() {
  const currentWeek = istWeekStart(new Date())
  const symbols = await nseSymbols()
  console.log(`NSE symbols: ${symbols.length}`)

  const universe = await loadSectors(await largeCaps(symbols))
  console.log(`Market cap >= ₹${MIN_MARKET_CAP_CR.toLocaleString('en-IN')} Cr: ${universe.length}`)

  const failed: string[] = []
  const candidates = await mapLimit(universe, CHART_CONCURRENCY, async (stock) => {
    try {
      const bars = await weeklyBars(stock.symbol)
      const current = (bars.at(-1)?.start ?? '') >= currentWeek ? bars.pop() : undefined
      return { ...stock, weeks: bars, current }
    } catch {
      failed.push(stock.symbol)
      return { ...stock, weeks: [] as Week[], current: undefined }
    }
  })

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

  let uptrendStocks: Company[] = []
  for (const screen of SCREENS) {
    const inUniverse = candidates.filter((c) => c.marketCapCr >= screen.minMarketCapCr)
    const matches = inUniverse
      .filter((c) => isTrending(c.weeks, screen.trend))
      .map(({ weeks, current, ...stock }) => {
        const [twoWeeksAgo, oneWeekAgo, lastWeek] = weeks.slice(-3).map(roundWeek)
        return { ...stock, currentWeek: current ? roundWeek(current) : null, lastWeek, oneWeekAgo, twoWeeksAgo }
      })
      .sort((a, b) => b.marketCapCr - a.marketCapCr)
    if (screen.trend === 'up') uptrendStocks = matches.map((stock) => ({ ...stock, sector: candidates.find((c) => c.symbol === stock.symbol)?.sector ?? 'Unclassified' }))

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
  const sectorGroups = new Map<string, { universeCount: number; stocks: Company[] }>()
  for (const company of candidates.filter((c) => c.marketCapCr >= SCREENS.find((s) => s.trend === 'up')!.minMarketCapCr)) {
    const group = sectorGroups.get(company.sector) ?? { universeCount: 0, stocks: [] }
    group.universeCount++
    sectorGroups.set(company.sector, group)
  }
  for (const stock of uptrendStocks) {
    const group = sectorGroups.get(stock.sector)
    if (group) group.stocks.push(stock)
  }
  const sectorRows = [...sectorGroups.entries()]
    .filter(([, group]) => group.stocks.length > 0)
    .map(([name, group]) => ({
      name,
      stockCount: group.stocks.length,
      universeCount: group.universeCount,
      breadthPct: round((group.stocks.length / group.universeCount) * 100),
      stocks: group.stocks
        .sort((a, b) => b.marketCapCr - a.marketCapCr)
        .map(({ symbol, name: stockName, marketCapCr }) => ({ symbol, name: stockName, marketCapCr })),
    }))
    .sort((a, b) => b.stockCount - a.stockCount || b.breadthPct - a.breadthPct || a.name.localeCompare(b.name))
  await writeFile(
    SECTORS_OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        weeks: { currentWeek: weeks.currentWeek, lastWeek: weeks.lastWeek },
        universeSize: candidates.filter((c) => c.marketCapCr >= 500).length,
        uptrendSize: uptrendStocks.length,
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
    BREAKOUT.output,
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
    PULLBACK.output,
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

  if (failed.length) console.log(`Failed to fetch: ${failed.join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
