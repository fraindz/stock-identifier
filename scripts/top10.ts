// Top 10 bets: a fixed 10-slot portfolio for 1–3 month positional holds.
// Pure functions only (no I/O) so they can be unit tested; screen.ts does the fetching
// and file writes.
//
//   eligible()        hard filters + raw factors for one stock
//   setupFor()        breakout / pullback / base on completed weekly bars
//   rankCandidates()  percentile-ranked composite score
//   confidence()      how likely a Watch name is to trigger and work out (picks and swaps)
//   weeklyReview()    drop stale Watch names, fill free slots and swap weak Watch names (max 3 a
//                     week; new names need a Positional quality score of at least 60)
//   dailyUpdate()     move each open slot through Watch → Active → Closed
import {
  avg,
  atr,
  breakout,
  CRORE,
  daysBetween,
  mondayOf,
  percentileRanks,
  pullback,
  round,
  rsi,
  sma,
  type Company,
  type Day,
  type Week,
} from './indicators'

export const RULES = {
  minMarketCapCr: 1_000,
  minTradedValueCr: 10, // 20-day average of close × volume
  maxBelowHighPct: 25, // close within this % of the 52-week high
  maxExtension: 1.25, // weekly close ≤ this × 10-week SMA
  maxRsi: 75,
  baseMinWeeks: 6,
  baseMaxRangePct: 15,
  baseTopPct: 25, // close in the top quarter of the base
  benchSize: 30,
  keepRank: 40, // Watch names stay while they rank within this
  maxSlots: 10,
  maxPerSector: 2,
  maxNewPerWeek: 3,
  watchReviews: 2, // Watch names that haven't triggered after this many reviews are dropped
  triggerBufferPct: 0.5,
  atrWeeks: 10,
  atrStopMultiple: 2,
  maxRiskPct: 12,
  breakevenR: 1,
  partialR: 2,
  trailWeeks: 3,
  timeStopWeeks: 13,
  weights: { rs: 0.4, sector: 0.2, trend: 0.2, setup: 0.2 },
  // Confidence decides which names take the slots when more qualify than there is room for.
  confidenceWeights: { score: 0.5, risk: 0.25, proximity: 0.25 },
  idealRiskPct: 4, // risk at or below this scores 100; maxRiskPct scores 0
  maxTriggerGapPct: 8, // close this far (or more) from the buy-above price scores 0 on proximity
  swapMargin: 10, // a candidate replaces the weakest Watch name only if its confidence is this much higher
  // New names must also grade C or better on the absolute Positional quality score
  // (scripts/quality.ts), so weak weeks leave slots empty instead of filling them.
  minQualityScore: 60,
}

export type Setup = 'breakout' | 'pullback' | 'base'
export type SetupInfo = { setup: Setup; swingLow: number; quality: number; note: string }

export type Candidate = {
  rank: number
  eligible: boolean // false: passes the trend filter but has no setup or is overextended
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
  rel6mPct: number // 6-month return minus Nifty 50's
  rel3mPct: number
  trendQuality: number // % of the last 26 weeks closing above the 10-week SMA
  sectorBreadthPct: number
  close: number
  rsi: number
  belowHighPct: number
  extensionPct: number // weekly close vs 10-week SMA
  tradedValueCr: number
  trigger: number
  stop: number
  riskPct: number
  triggerGapPct: number // buy-above vs latest close (negative: already above it)
  confidence: number // 0–100, see confidence()
  qualityScore?: number | null // Positional quality score; null: not scored (fails its filters)
}

export type SlotEvent = { date: string; type: 'added' | 'triggered' | 'breakeven' | 'partial' | 'trail' | 'closed' | 'dropped'; note: string }
export type ExitReason = 'stop' | 'trail' | 'time' | 'thesis' | 'dropped'

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
  lastDate: string // latest daily bar applied to this slot
  lastClose: number
  maxHigh?: number
  closedDate?: string
  exitPrice?: number
  exitReason?: ExitReason
  rMultiple?: number
  mfeR?: number // maximum favourable move, in R
  daysHeld?: number
  events: SlotEvent[]
}

export type Portfolio = {
  updatedAt: string
  asOf: string
  lastReviewWeek: string // Monday of the completed week the last review used
  rules: typeof RULES
  slots: Slot[]
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n))
const pct = (from: number, to: number) => ((to - from) / from) * 100

// A range of 6+ weeks (ending last week) no wider than 15%, with the close in its top quarter.
export function base(weeks: Week[]) {
  const rangeOf = (n: number) => {
    const ws = weeks.slice(-n)
    const high = Math.max(...ws.map((w) => w.high))
    const low = Math.min(...ws.map((w) => w.low))
    return { weeks: n, high, low, rangePct: pct(low, high) }
  }
  if (weeks.length < RULES.baseMinWeeks) return null
  let range = rangeOf(RULES.baseMinWeeks)
  if (range.rangePct > RULES.baseMaxRangePct) return null
  while (range.weeks < weeks.length) {
    const wider = rangeOf(range.weeks + 1)
    if (wider.rangePct > RULES.baseMaxRangePct) break
    range = wider
  }
  const close = weeks[weeks.length - 1].close
  if (close < range.low + (1 - RULES.baseTopPct / 100) * (range.high - range.low)) return null
  return range
}

// The latest completed week's setup with its swing low and a 0–100 quality score.
// 0–100 estimate of how likely a Watch name is to become a winning trade: half the ranking
// score (strength, sector, trend, setup), a quarter for a tight stop (a smaller R is
// reached sooner and loses less when wrong), and a quarter for a close near the buy-above
// price (likely to trigger within the watch window without chasing a gap).
export function confidence(score: number, riskPct: number, triggerGapPct: number) {
  const w = RULES.confidenceWeights
  const risk = clamp(((RULES.maxRiskPct - riskPct) / (RULES.maxRiskPct - RULES.idealRiskPct)) * 100)
  const proximity = clamp(((RULES.maxTriggerGapPct - Math.abs(triggerGapPct)) / RULES.maxTriggerGapPct) * 100)
  return round(w.score * score + w.risk * risk + w.proximity * proximity)
}

export function setupFor(weeks: Week[]): SetupInfo | null {
  const last = weeks.at(-1)
  if (!last) return null
  const b = breakout(weeks)
  if (b) {
    return {
      setup: 'breakout',
      swingLow: last.low,
      quality: clamp(((b.volumeRatio - 1.5) / 2.5) * 100),
      note: `Closed ${b.abovePct}% above the ${round(b.rangeHigh)} range high on ${b.volumeRatio}× volume`,
    }
  }
  const pb = pullback(weeks)
  if (pb) {
    const retrace = pb.pullback.retracePct
    const distance = retrace < 38 ? 38 - retrace : retrace > 50 ? retrace - 50 : 0
    return {
      setup: 'pullback',
      swingLow: pb.pullback.low,
      quality: clamp(100 - (distance / 13) * 100),
      note: `${retrace}% pullback of a ${pb.rally.pct}% rally, turned up last week`,
    }
  }
  const range = base(weeks)
  if (range) {
    return {
      setup: 'base',
      swingLow: range.low,
      quality: clamp(((RULES.baseMaxRangePct - range.rangePct) / RULES.baseMaxRangePct) * 100),
      note: `${range.weeks}-week base, ${round(range.rangePct)}% deep, closing near its high`,
    }
  }
  return null
}

export type StockInput = Company & { days: Day[]; weeks: Week[] } // weeks: completed weeks only

export type Analysis = {
  eligible: boolean
  close: number
  rsi: number
  tradedValueCr: number
  belowHighPct: number
  extensionPct: number
  rel6mPct: number
  rel3mPct: number
  rsRaw: number
  trendQuality: number
  setup: SetupInfo | null
  trigger: number
  stop: number
  riskPct: number
}

// Hard filters for one stock. Returns null when it fails market cap, liquidity, trend
// or strength (the "trend filter"); otherwise `eligible` also requires a setup and no
// overextension. `nifty` is Nifty 50's completed weeks.
export function eligible(stock: StockInput, nifty: Week[]): Analysis | null {
  const { days, weeks } = stock
  if (stock.marketCapCr < RULES.minMarketCapCr) return null
  if (weeks.length < 36 || days.length < 20 || nifty.length < 27) return null
  // Stale or suspended: last completed week must match the index's.
  if (mondayOf(weeks.at(-1)!.start) !== mondayOf(nifty.at(-1)!.start)) return null

  const tradedValueCr = avg(days.slice(-20).map((d) => d.close * d.volume)) / CRORE
  if (tradedValueCr < RULES.minTradedValueCr) return null

  const closes = weeks.map((w) => w.close)
  const close = days.at(-1)!.close
  const sma10 = sma(closes, 10)
  const sma30 = sma(closes, 30)
  const sma30Before = sma(closes.slice(0, -4), 30)
  if (!(close > sma30 && sma30 > sma30Before && sma10 > sma30)) return null

  const high52 = Math.max(...weeks.slice(-52).map((w) => w.high))
  const belowHighPct = ((high52 - close) / high52) * 100
  if (belowHighPct > RULES.maxBelowHighPct) return null

  const ret = (xs: number[], k: number) => xs.at(-1)! / xs.at(-1 - k)! - 1
  const niftyCloses = nifty.map((w) => w.close)
  const rel6 = (ret(closes, 26) - ret(niftyCloses, 26)) * 100
  const rel3 = (ret(closes, 13) - ret(niftyCloses, 13)) * 100

  let above = 0
  for (let i = closes.length - 26; i < closes.length; i++) {
    if (closes[i] > avg(closes.slice(i - 9, i + 1))) above++
  }

  const lastWeek = weeks.at(-1)!
  const extension = lastWeek.close / sma10
  const dailyRsi = rsi(days.map((d) => d.close))
  const setup = setupFor(weeks)
  const trigger = lastWeek.high * (1 + RULES.triggerBufferPct / 100)
  const atrStop = trigger - RULES.atrStopMultiple * atr(weeks, RULES.atrWeeks)
  // The tighter (higher) of the setup's swing low and trigger − 2×weekly ATR.
  const stop = Math.max(setup?.swingLow ?? atrStop, atrStop)

  return {
    eligible: setup !== null && extension <= RULES.maxExtension && dailyRsi <= RULES.maxRsi,
    close,
    rsi: dailyRsi,
    tradedValueCr,
    belowHighPct,
    extensionPct: (extension - 1) * 100,
    rel6mPct: rel6,
    rel3mPct: rel3,
    rsRaw: 0.7 * rel6 + 0.3 * rel3,
    trendQuality: (above / 26) * 100,
    setup,
    trigger,
    stop,
    riskPct: ((trigger - stop) / trigger) * 100,
  }
}

// Scores every stock that passed the trend filter. Factors are percentile ranks over that
// whole group so they're comparable. Eligible stocks are ranked 1..n; the others get the
// rank they would have among them (used to decide whether a held name still ranks).
export function rankCandidates(
  stocks: (Company & { analysis: Analysis })[],
  sectorStrength: Map<string, number>,
): Candidate[] {
  const rs = percentileRanks(stocks.map((s) => s.analysis.rsRaw))
  const sector = percentileRanks(stocks.map((s) => sectorStrength.get(s.sector) ?? 0))
  const trend = percentileRanks(stocks.map((s) => s.analysis.trendQuality))
  const withSetup = stocks.flatMap((s, i) => (s.analysis.setup ? [i] : []))
  const setupRanks = percentileRanks(withSetup.map((i) => stocks[i].analysis.setup!.quality))
  const setup = stocks.map(() => 50) // neutral for names without a setup this week
  withSetup.forEach((i, k) => (setup[i] = setupRanks[k]))

  const { weights } = RULES
  const scored = stocks.map((s, i) => {
    const a = s.analysis
    const score = weights.rs * rs[i] + weights.sector * sector[i] + weights.trend * trend[i] + weights.setup * setup[i]
    const triggerGapPct = ((a.trigger - a.close) / a.close) * 100
    return {
      rank: 0,
      eligible: a.eligible,
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      marketCapCr: s.marketCapCr,
      setup: a.setup?.setup ?? null,
      setupNote: a.setup?.note ?? '',
      score: round(score),
      rsPct: round(rs[i]),
      sectorPct: round(sector[i]),
      trendPct: round(trend[i]),
      setupPct: round(setup[i]),
      rel6mPct: round(a.rel6mPct),
      rel3mPct: round(a.rel3mPct),
      trendQuality: round(a.trendQuality),
      sectorBreadthPct: round(sectorStrength.get(s.sector) ?? 0),
      close: round(a.close),
      rsi: round(a.rsi),
      belowHighPct: round(a.belowHighPct),
      extensionPct: round(a.extensionPct),
      tradedValueCr: round(a.tradedValueCr),
      trigger: round(a.trigger),
      stop: round(a.stop),
      riskPct: round(a.riskPct),
      triggerGapPct: round(triggerGapPct),
      confidence: confidence(score, a.riskPct, triggerGapPct),
    } satisfies Candidate
  })
  const ranked = scored.filter((c) => c.eligible).sort((a, b) => b.score - a.score || b.marketCapCr - a.marketCapCr)
  ranked.forEach((c, i) => (c.rank = i + 1))
  for (const c of scored) {
    if (!c.eligible) c.rank = 1 + ranked.filter((r) => r.score > c.score).length
  }
  return [...ranked, ...scored.filter((c) => !c.eligible).sort((a, b) => b.score - a.score)]
}

export const emptyPortfolio = (): Portfolio => ({
  updatedAt: '',
  asOf: '',
  lastReviewWeek: '',
  rules: RULES,
  slots: [],
})

const isOpen = (slot: Slot) => slot.status !== 'closed'

// Weekly review on the latest completed week (`weekStart` = its Monday; `asOf` = its last
// trading day). Active names are left to their trade rules; Watch names are dropped when
// they fail the trend filter, fall out of the top `keepRank`, or wait `watchReviews`
// reviews without triggering. Free slots are then filled with the qualifying candidates
// of highest confidence; once full, a candidate replaces the weakest Watch name when its
// confidence is at least `swapMargin` higher. At most `maxNewPerWeek` names are added
// (no cap on the first fill of an empty portfolio).
export function weeklyReview(portfolio: Portfolio, ranked: Candidate[], weekStart: string, asOf: string): Portfolio {
  const bySymbol = new Map(ranked.map((c) => [c.symbol, c]))
  const bootstrap = portfolio.lastReviewWeek === '' && !portfolio.slots.some(isOpen)
  const dropped = new Set<string>()
  const drop = (slot: Slot, reason: string) => {
    slot.status = 'closed'
    slot.exitReason = 'dropped'
    slot.closedDate = asOf
    slot.events.push({ date: asOf, type: 'dropped', note: `Removed from watch: ${reason}` })
    dropped.add(slot.symbol)
  }

  for (const slot of portfolio.slots.filter(isOpen)) {
    const c = bySymbol.get(slot.symbol)
    slot.lastRank = c?.rank ?? null
    if (slot.status !== 'watch') continue
    slot.reviewsWaiting++
    const reason = !c
      ? 'failed the trend filter'
      : c.rank > RULES.keepRank
        ? `rank fell to #${c.rank}`
        : slot.reviewsWaiting >= RULES.watchReviews
          ? `did not trigger in ${RULES.watchReviews} weeks`
          : null
    if (reason) drop(slot, reason)
    else slot.confidence = confidence(c!.score, slot.riskPct, ((slot.trigger - c!.close) / c!.close) * 100)
  }

  const open = portfolio.slots.filter(isOpen)
  const held = new Set(open.map((s) => s.symbol))
  const perSector = new Map<string, number>()
  for (const s of open) perSector.set(s.sector, (perSector.get(s.sector) ?? 0) + 1)
  const cap = bootstrap ? RULES.maxSlots : RULES.maxNewPerWeek
  const picks = ranked
    .filter((c) => c.eligible && c.setup && c.rank <= RULES.keepRank && c.riskPct <= RULES.maxRiskPct)
    .filter((c) => c.qualityScore === undefined || (c.qualityScore ?? 0) >= RULES.minQualityScore)
    .filter((c) => !held.has(c.symbol) && !dropped.has(c.symbol))
    .sort((a, b) => b.confidence - a.confidence || a.rank - b.rank)

  const add = (c: Candidate, note: string) => {
    portfolio.slots.push({
      id: `${weekStart}_${c.symbol}`,
      symbol: c.symbol,
      name: c.name,
      sector: c.sector,
      setup: c.setup!,
      setupNote: c.setupNote,
      addedWeek: weekStart,
      reviewsWaiting: 0,
      rankAtAdd: c.rank,
      lastRank: c.rank,
      status: 'watch',
      trigger: c.trigger,
      initialStop: c.stop,
      stop: c.stop,
      riskPct: c.riskPct,
      confidence: c.confidence,
      lastDate: asOf,
      lastClose: c.close,
      events: [{ date: asOf, type: 'added', note: `${note} at #${c.rank}, confidence ${c.confidence}${c.qualityScore != null ? `, quality ${c.qualityScore}` : ''}: buy above ${c.trigger}, stop ${c.stop} (${c.riskPct}% risk)` }],
    })
    held.add(c.symbol)
    perSector.set(c.sector, (perSector.get(c.sector) ?? 0) + 1)
  }

  let added = 0
  const sectorFull = (c: Candidate, freed?: Slot) =>
    (perSector.get(c.sector) ?? 0) - (freed?.sector === c.sector ? 1 : 0) >= RULES.maxPerSector
  for (const c of picks) {
    if (added >= cap) break
    if (held.has(c.symbol)) continue
    if (portfolio.slots.filter(isOpen).length < RULES.maxSlots) {
      if (sectorFull(c)) continue
      add(c, 'Added to watch')
      added++
      continue
    }
    // Full: swap out the weakest Watch name kept from earlier weeks, if clearly weaker.
    const weakest = portfolio.slots
      .filter((s) => s.status === 'watch' && s.addedWeek !== weekStart)
      .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))[0]
    if (!weakest || c.confidence < (weakest.confidence ?? 0) + RULES.swapMargin) break
    if (sectorFull(c, weakest)) continue
    drop(weakest, `replaced by ${c.symbol} (confidence ${weakest.confidence} vs ${c.confidence})`)
    held.delete(weakest.symbol)
    perSector.set(weakest.sector, perSector.get(weakest.sector)! - 1)
    add(c, `Added to watch, replacing ${weakest.symbol},`)
    added++
  }

  portfolio.lastReviewWeek = weekStart
  portfolio.asOf = asOf
  return portfolio
}

const rOf = (slot: Slot, price: number) => (price - slot.entry!) / slot.r!

function close(slot: Slot, day: Day, price: number, reason: ExitReason, note: string) {
  const exitR = rOf(slot, price)
  slot.status = 'closed'
  slot.closedDate = day.date
  slot.exitPrice = round(price)
  slot.exitReason = reason
  slot.rMultiple = round(slot.partialBooked ? 0.5 * RULES.partialR + 0.5 * exitR : exitR)
  slot.daysHeld = daysBetween(slot.entryDate!, day.date)
  slot.mfeR = round(rOf(slot, slot.maxHigh!))
  slot.events.push({ date: day.date, type: 'closed', note: `${note}: exit ${round(price)} (${slot.rMultiple >= 0 ? '+' : ''}${slot.rMultiple}R)` })
}

// Applies daily bars after each slot's `lastDate`. `weeks` includes the current week.
function applyBars(slot: Slot, days: Day[], weeks: Week[]) {
  const pending = days.filter((d) => d.date > slot.lastDate)
  for (const [i, day] of pending.entries()) {
    if (slot.status === 'closed') break
    const nextDay = pending[i + 1]

    if (slot.status === 'watch' && day.high >= slot.trigger) {
      slot.status = 'active'
      slot.entry = round(Math.max(slot.trigger, day.open))
      slot.entryDate = day.date
      slot.r = round(slot.entry - slot.stop)
      slot.partialBooked = false
      slot.maxHigh = slot.entry
      slot.events.push({ date: day.date, type: 'triggered', note: `Bought at ${slot.entry}; stop ${slot.stop}, 1R = ${slot.r}` })
    }

    if (slot.status === 'active') {
      const entry = slot.entry!
      const r = slot.r!
      if (day.low <= slot.stop) {
        const trailed = slot.stop > slot.initialStop
        close(slot, day, Math.min(slot.stop, day.open), trailed ? 'trail' : 'stop', trailed ? 'Trailing stop hit' : 'Stop hit')
      } else {
        slot.maxHigh = Math.max(slot.maxHigh ?? entry, day.high)
        if (slot.maxHigh >= entry + RULES.breakevenR * r && slot.stop < entry) {
          slot.stop = entry
          slot.events.push({ date: day.date, type: 'breakeven', note: `+${RULES.breakevenR}R reached: stop moved to entry ${entry}` })
        }
        if (slot.maxHigh >= entry + RULES.partialR * r) {
          if (!slot.partialBooked) {
            slot.partialBooked = true
            slot.events.push({ date: day.date, type: 'partial', note: `+${RULES.partialR}R reached: book half at ${round(entry + RULES.partialR * r)}` })
          }
          const week = mondayOf(day.date)
          const completed = weeks.filter((w) => mondayOf(w.start) < week).slice(-RULES.trailWeeks)
          if (completed.length === RULES.trailWeeks) {
            const trail = round(Math.min(...completed.map((w) => w.low)))
            if (trail > slot.stop) {
              slot.events.push({ date: day.date, type: 'trail', note: `Stop raised from ${slot.stop} to ${trail} (lowest low of ${RULES.trailWeeks} weeks)` })
              slot.stop = trail
            }
          }
        }

        const weekEnds = nextDay ? mondayOf(nextDay.date) !== mondayOf(day.date) : new Date(`${day.date}T00:00:00Z`).getUTCDay() === 5
        if (weekEnds) {
          const closes = weeks.filter((w) => mondayOf(w.start) <= mondayOf(day.date)).map((w) => w.close)
          if (closes.length >= 30 && day.close < sma(closes, 30)) {
            close(slot, day, day.close, 'thesis', 'Weekly close below the 30-week SMA')
          }
        }
        if (slot.status === 'active' && daysBetween(slot.entryDate!, day.date) >= RULES.timeStopWeeks * 7 && day.close < entry + RULES.breakevenR * r) {
          close(slot, day, day.close, 'time', `${RULES.timeStopWeeks} weeks without +${RULES.breakevenR}R`)
        }
      }
    }
    slot.lastDate = day.date
    slot.lastClose = round(day.close)
  }
}

// Daily run: update every open slot from its bars. Membership never changes here.
export function dailyUpdate(portfolio: Portfolio, bars: Map<string, { days: Day[]; weeks: Week[] }>): Portfolio {
  for (const slot of portfolio.slots.filter(isOpen)) {
    const b = bars.get(slot.symbol)
    if (b?.days.length) applyBars(slot, b.days, b.weeks)
  }
  const latest = portfolio.slots.filter(isOpen).reduce((d, s) => (s.lastDate > d ? s.lastDate : d), portfolio.asOf)
  portfolio.asOf = latest
  return portfolio
}
