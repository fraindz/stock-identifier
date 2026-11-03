// Screens NSE stocks for three consecutive completed weeks of trend:
//   downtrend: lower highs, lows and closes, market cap >= ₹10,000 Cr
//   uptrend:   higher highs, lows and closes, market cap >= ₹500 Cr
// and for range breakouts on volume (see BREAKOUT below).
// Writes public/downtrend.json, public/uptrend.json and public/breakout.json for the web pages.
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

// Last week closed above the highest high of the previous `lookbackWeeks` weeks, on
// at least `volumeMultiple` times their average weekly volume.
const BREAKOUT = {
  minMarketCapCr: 1_000,
  lookbackWeeks: 20,
  volumeMultiple: 1.5,
  output: new URL('../public/breakout.json', import.meta.url),
}

const MIN_MARKET_CAP_CR = Math.min(...SCREENS.map((s) => s.minMarketCapCr), BREAKOUT.minMarketCapCr)
// Enough daily history for the breakout lookback plus last week and the current week.
const HISTORY_DAYS = (BREAKOUT.lookbackWeeks + 3) * 7

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

type Week = { start: string; end: string; high: number; low: number; close: number; volume: number }

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
  const out: { symbol: string; name: string; marketCapCr: number }[] = []
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

async function main() {
  const currentWeek = istWeekStart(new Date())
  const symbols = await nseSymbols()
  console.log(`NSE symbols: ${symbols.length}`)

  const universe = await largeCaps(symbols)
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

  if (failed.length) console.log(`Failed to fetch: ${failed.join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
