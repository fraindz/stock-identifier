// Rolling Swing and Positional quality scores: an absolute 0–100 score per stock from
// trend, relative strength, sector strength, setup, volume, fundamentals and risk/reward,
// gated by the overall market regime. Pure functions only (no I/O); screen.ts does the
// fetching and file writes.
//
// Every sub-score is a piecewise-linear map of an absolute threshold (not a percentile),
// so grades stay comparable from one day to the next and a weak tape produces fewer A's.
import { atr, avg, CRORE, ema, round, sma, type Company, type Day, type Week } from './indicators'
import { setupFor, RULES as TOP10_RULES } from './top10'

export type Mode = 'swing' | 'positional'
export type ComponentKey = 'trend' | 'rs' | 'sector' | 'setup' | 'volume' | 'fundamentals' | 'riskReward'

export const QUALITY_RULES = {
  minMarketCapCr: 1_000,
  minTradedValueCr: 10, // 20-day average of close × volume
  minDays: 130, // ~26 weeks of daily bars for the positional return windows
  minSectorMembers: 5,
  weights: {
    swing: { trend: 20, rs: 15, sector: 10, setup: 25, volume: 15, fundamentals: 5, riskReward: 10 },
    positional: { trend: 20, rs: 15, sector: 10, setup: 15, volume: 10, fundamentals: 15, riskReward: 15 },
  } satisfies Record<Mode, Record<ComponentKey, number>>,
  regime: {
    riskOnBreadthPct: 50, // % of the universe above its 50-DMA
    riskOffBreadthPct: 30,
    cautionPenalty: 5,
    riskOffCap: 79, // no A grades in a risk-off market
  },
  grades: { A: 80, B: 70, C: 60 },
  swing: {
    retWindows: [20, 60] as const, // trading days; vs Nifty and vs sector, equal weight
    rsFullVsNiftyPct: 12,
    rsFullVsSectorPct: 8,
    sectorRelRange: [-2, 5] as const, // sector index 20-day return minus Nifty's
    breakoutLookback: 20,
    maxBreakoutExtensionPct: 5,
    tightRangeDays: 10,
    nearHighPct: 3,
    pullbackBandPct: 3, // close within this % of the 20 EMA
    triggerBufferPct: 0.2,
    atrStopMultiple: 1.5,
    maxRiskPct: 8,
    idealRiskPct: 2.5,
  },
  positional: {
    retWindows: [65, 130] as const, // ~13 and ~26 weeks
    retWeights: [0.3, 0.7] as const,
    rsFullVsNiftyPct: 25,
    rsFullVsSectorPct: 15,
    sectorRelRange: [-3, 10] as const, // sector index 13-week return minus Nifty's
    maxRiskPct: 12,
    idealRiskPct: 4,
  },
  targetR: 3, // target = resistance (52-week high) or this many R, whichever is nearer
  fullRR: 2.5,
}

export type Fundamentals = {
  revenueGrowth?: number // fraction, year on year
  earningsGrowth?: number
  debtToEquity?: number // ratio (Yahoo reports a percentage; screen.ts divides by 100)
  roe?: number
  operatingMargin?: number
}

// Average delivery % over the last 5, 20 and 60 sessions (NSE bhavcopy).
export type Delivery = { recent5: number; recent20: number; base60: number }

export type Component = { key: ComponentKey; label: string; points: number; max: number; note: string }

export type Regime = 'risk-on' | 'caution' | 'risk-off'
export type MarketRegime = {
  regime: Regime
  asOf: string
  niftyClose: number
  niftyVs50Pct: number
  niftyVs200Pct: number
  sma50Rising: boolean
  breadthPct: number // % of the universe closing above its 50-DMA
  note: string
}

export type SectorStats = {
  name: string
  members: number
  ret20Pct: number
  ret60Pct: number
  ret65Pct: number
  ret130Pct: number
  rel20Pct: number // vs Nifty
  rel65Pct: number
  breadthPct: number // % of members above their 50-DMA
  above50: boolean // equal-weight sector index above its own 50-DMA
}

export type QualityInput = Company & {
  days: Day[] // all daily bars, oldest first
  weeks: Week[] // completed weeks only
  fundamentals: Fundamentals | null
  delivery: Delivery | null
}

export type Context = {
  niftyDays: Day[]
  regime: MarketRegime
  sectors: Map<string, SectorStats>
}

export type QualityStock = {
  symbol: string
  name: string
  sector: string
  marketCapCr: number
  close: number
  rawScore: number
  score: number
  grade: 'A' | 'B' | 'C' | null
  setup: string | null
  setupNote: string
  trigger: number
  stop: number
  target: number
  riskPct: number
  rr: number
  triggerGapPct: number
  deliveryPct: number | null
  fundamentalsCoverage: number // fields available, out of the fields scored
  components: Component[]
  firstSeen: string
  daysListed: number
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
// 0 at `zero`, 1 at `full`, linear in between; works in either direction.
export const lin = (x: number, zero: number, full: number) => clamp01((x - zero) / (full - zero))
const pct = (from: number, to: number) => ((to - from) / from) * 100
const ret = (xs: number[], k: number) => (xs.length > k ? pct(xs[xs.length - 1 - k], xs[xs.length - 1]) : 0)
const signedPct = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`

// Weighted checks (each 0–1) → points out of `max`.
function fromChecks(key: ComponentKey, label: string, max: number, checks: { w: number; v: number; label: string }[], extra = '') {
  const total = checks.reduce((s, c) => s + c.w, 0)
  const score = checks.reduce((s, c) => s + c.w * c.v, 0) / total
  const missing = checks.filter((c) => c.v < 0.5).map((c) => c.label)
  const note = [extra, missing.length ? `weak: ${missing.join(', ')}` : 'all checks pass'].filter(Boolean).join('; ')
  return { key, label, points: round(max * score), max, note } satisfies Component
}

export function gradeOf(score: number): QualityStock['grade'] {
  const g = QUALITY_RULES.grades
  return score >= g.A ? 'A' : score >= g.B ? 'B' : score >= g.C ? 'C' : null
}

// ---------- Market and sectors ----------

export function marketRegime(niftyDays: Day[], universe: { days: Day[] }[]): MarketRegime {
  const r = QUALITY_RULES.regime
  const closes = niftyDays.map((d) => d.close)
  const close = closes.at(-1)!
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, Math.min(200, closes.length))
  const sma50Before = sma(closes.slice(0, -10), 50)
  const counted = universe.filter((u) => u.days.length >= 50)
  const above = counted.filter((u) => u.days.at(-1)!.close > sma(u.days.map((d) => d.close), 50)).length
  const breadthPct = counted.length ? (above / counted.length) * 100 : 50
  const regime: Regime =
    close < sma200 || breadthPct < r.riskOffBreadthPct
      ? 'risk-off'
      : close > sma50 && sma50 > sma200 && sma50 > sma50Before && breadthPct >= r.riskOnBreadthPct
        ? 'risk-on'
        : 'caution'
  const note =
    regime === 'risk-on'
      ? 'Nifty above rising 50-DMA and 200-DMA with broad participation'
      : regime === 'risk-off'
        ? `Weak market: scores capped at ${r.riskOffCap} (no A grades)`
        : `Mixed market: ${r.cautionPenalty} points deducted from every score`
  return {
    regime,
    asOf: niftyDays.at(-1)!.date,
    niftyClose: round(close),
    niftyVs50Pct: round(pct(sma50, close)),
    niftyVs200Pct: round(pct(sma200, close)),
    sma50Rising: sma50 > sma50Before,
    breadthPct: round(breadthPct),
    note,
  }
}

// Equal-weight sector indices on Nifty's trading calendar: each day the index moves by
// the average daily return of the members that traded that day and the day before.
export function sectorIndices(universe: (Company & { days: Day[] })[], niftyDays: Day[]): Map<string, SectorStats> {
  const dates = niftyDays.map((d) => d.date)
  const niftyCloses = niftyDays.map((d) => d.close)
  const bySector = new Map<string, (Company & { days: Day[] })[]>()
  for (const c of universe) {
    if (c.sector === 'Unclassified' || c.marketCapCr < QUALITY_RULES.minMarketCapCr || c.days.length < 60) continue
    bySector.set(c.sector, [...(bySector.get(c.sector) ?? []), c])
  }
  const out = new Map<string, SectorStats>()
  for (const [name, members] of bySector) {
    if (members.length < QUALITY_RULES.minSectorMembers) continue
    const closeMaps = members.map((m) => new Map(m.days.map((d) => [d.date, d.close])))
    const index = [100]
    for (let i = 1; i < dates.length; i++) {
      const rets = closeMaps.flatMap((m) => {
        const today = m.get(dates[i])
        const prev = m.get(dates[i - 1])
        // Clamp single-day moves to dampen bad ticks and corporate actions.
        return today && prev ? [Math.max(-0.2, Math.min(0.2, today / prev - 1))] : []
      })
      index.push(index[i - 1] * (1 + (rets.length ? avg(rets) : 0)))
    }
    const above = members.filter((m) => m.days.at(-1)!.close > sma(m.days.map((d) => d.close), 50)).length
    const ret20Pct = ret(index, 20)
    const ret65Pct = ret(index, 65)
    out.set(name, {
      name,
      members: members.length,
      ret20Pct: round(ret20Pct),
      ret60Pct: round(ret(index, 60)),
      ret65Pct: round(ret65Pct),
      ret130Pct: round(ret(index, 130)),
      rel20Pct: round(ret20Pct - ret(niftyCloses, 20)),
      rel65Pct: round(ret65Pct - ret(niftyCloses, 65)),
      breadthPct: round((above / members.length) * 100),
      above50: index.at(-1)! > sma(index, 50),
    })
  }
  return out
}

// ---------- Components ----------

export function trendScore(mode: Mode, days: Day[], weeks: Week[]): Component {
  const max = QUALITY_RULES.weights[mode].trend
  const dc = days.map((d) => d.close)
  const close = dc.at(-1)!
  const ema20 = ema(dc.slice(-80), 20)
  const ema50 = ema(dc, 50)
  const ema50Before = ema(dc.slice(0, -10), 50)
  const sma200 = dc.length >= 200 ? sma(dc, 200) : null
  const wc = weeks.map((w) => w.close)
  const w10 = sma(wc, 10)
  const w30 = sma(wc, 30)
  const w30Before = sma(wc.slice(0, -4), 30)
  let above10 = 0
  const span = Math.min(26, wc.length - 10)
  for (let i = wc.length - span; i < wc.length; i++) if (wc[i] > avg(wc.slice(i - 9, i + 1))) above10++
  const quality = span > 0 ? (above10 / span) * 100 : 0
  const b = (x: boolean) => (x ? 1 : 0)
  const daily = [
    { w: 3, v: b(close > ema20), label: 'close > 20 EMA' },
    { w: 3, v: b(ema20 > ema50), label: '20 > 50 EMA' },
    { w: 3, v: b(ema50 > ema50Before), label: '50 EMA rising' },
    { w: 3, v: b(sma200 !== null && close > sma200), label: 'close > 200 DMA' },
  ]
  const weekly = [
    { w: 3, v: b(wc.at(-1)! > w10), label: 'weekly close > 10w' },
    { w: 3, v: b(w10 > w30), label: '10w > 30w' },
    { w: 3, v: b(w30 > w30Before), label: '30w rising' },
    { w: 3, v: lin(quality, 50, 85), label: 'consistent weekly trend' },
  ]
  // Swing: daily alignment carries 70% of the weight; positional: weekly carries 70%.
  const [dw, ww] = mode === 'swing' ? [0.7, 0.3] : [0.3, 0.7]
  const scale = (cs: typeof daily, f: number) => cs.map((c) => ({ ...c, w: c.w * f }))
  return fromChecks('trend', 'Trend strength', max, [...scale(daily, dw), ...scale(weekly, ww)], `${quality.toFixed(0)}% of 26 weeks above 10w`)
}

export function rsScore(mode: Mode, days: Day[], niftyDays: Day[], sector: SectorStats | undefined): Component {
  const max = QUALITY_RULES.weights[mode].rs
  const dc = days.map((d) => d.close)
  const nc = niftyDays.map((d) => d.close)
  let relNifty: number
  let relSector: number | null = null
  let full: [number, number]
  if (mode === 'swing') {
    const [a, b] = QUALITY_RULES.swing.retWindows
    relNifty = 0.5 * (ret(dc, a) - ret(nc, a)) + 0.5 * (ret(dc, b) - ret(nc, b))
    if (sector) relSector = 0.5 * (ret(dc, a) - sector.ret20Pct) + 0.5 * (ret(dc, b) - sector.ret60Pct)
    full = [QUALITY_RULES.swing.rsFullVsNiftyPct, QUALITY_RULES.swing.rsFullVsSectorPct]
  } else {
    const [a, b] = QUALITY_RULES.positional.retWindows
    const [wa, wb] = QUALITY_RULES.positional.retWeights
    relNifty = wa * (ret(dc, a) - ret(nc, a)) + wb * (ret(dc, b) - ret(nc, b))
    if (sector) relSector = wa * (ret(dc, a) - sector.ret65Pct) + wb * (ret(dc, b) - sector.ret130Pct)
    full = [QUALITY_RULES.positional.rsFullVsNiftyPct, QUALITY_RULES.positional.rsFullVsSectorPct]
  }
  const vsNifty = lin(relNifty, 0, full[0])
  const score = relSector === null ? vsNifty : (2 / 3) * vsNifty + (1 / 3) * lin(relSector, 0, full[1])
  const note = `${signedPct(relNifty)} vs Nifty${relSector === null ? '' : `, ${signedPct(relSector)} vs ${sector!.name}`}`
  return { key: 'rs', label: 'Relative strength', points: round(max * score), max, note }
}

export function sectorScore(mode: Mode, sector: SectorStats | undefined): Component {
  const max = QUALITY_RULES.weights[mode].sector
  if (!sector) return { key: 'sector', label: 'Sector strength', points: round(max / 2), max, note: 'sector index unavailable: neutral' }
  const rel = mode === 'swing' ? sector.rel20Pct : sector.rel65Pct
  const [lo, hi] = QUALITY_RULES[mode].sectorRelRange
  return fromChecks(
    'sector',
    'Sector strength',
    max,
    [
      { w: 0.4, v: lin(rel, lo, hi), label: 'sector lagging Nifty' },
      { w: 0.4, v: lin(sector.breadthPct, 30, 70), label: 'narrow sector breadth' },
      { w: 0.2, v: sector.above50 ? 1 : 0, label: 'sector index below 50-DMA' },
    ],
    `${sector.name} ${signedPct(rel)} vs Nifty, ${sector.breadthPct.toFixed(0)}% above 50-DMA`,
  )
}

type SetupResult = { setup: string; note: string; quality: number; trigger: number; stop: number }

// Daily swing setups: 20-day-high breakout, tight consolidation near the high, or a
// pullback to the rising 20 EMA. The best-quality one wins.
export function swingSetup(days: Day[]): SetupResult | null {
  const S = QUALITY_RULES.swing
  if (days.length < 60) return null
  const dc = days.map((d) => d.close)
  const last = days.at(-1)!
  const prev = days.at(-2)!
  const avgVol = sma(days.slice(-21, -1).map((d) => d.volume), 20)
  const dayAtr = atr(days)
  const ema20 = ema(dc.slice(-80), 20)
  const ema50 = ema(dc, 50)
  const closePos = (d: Day) => (d.high > d.low ? (d.close - d.low) / (d.high - d.low) : 0.5)
  const priorHigh = Math.max(...days.slice(-S.breakoutLookback - 1, -1).map((d) => d.high))
  const trigger = round(last.high * (1 + S.triggerBufferPct / 100))
  const withStop = (swingLow: number) => Math.max(swingLow, trigger - S.atrStopMultiple * dayAtr)
  const found: SetupResult[] = []

  const extension = pct(priorHigh, last.close)
  if (last.close > priorHigh && extension <= S.maxBreakoutExtensionPct) {
    const volRatio = avgVol ? last.volume / avgVol : 0
    found.push({
      setup: 'breakout',
      note: `Closed ${extension.toFixed(1)}% above the ${S.breakoutLookback}-day high on ${volRatio.toFixed(1)}× volume`,
      quality: 0.5 + 0.5 * (0.5 * lin(volRatio, 1, 2.5) + 0.25 * closePos(last) + 0.25 * lin(extension, S.maxBreakoutExtensionPct, 0)),
      trigger,
      stop: withStop(Math.min(...days.slice(-3).map((d) => d.low))),
    })
  }

  const recent = days.slice(-S.tightRangeDays)
  const rangeHigh = Math.max(...recent.map((d) => d.high))
  const rangeLow = Math.min(...recent.map((d) => d.low))
  const rangePct = pct(rangeLow, rangeHigh)
  const belowHigh = pct(last.close, priorHigh)
  const nr7 = last.high - last.low <= Math.min(...days.slice(-7).map((d) => d.high - d.low))
  if (last.close <= priorHigh && belowHigh <= S.nearHighPct && rangePct <= 10 && last.close > ema50) {
    const dryUp = avg(days.slice(-5).map((d) => d.volume)) < avgVol
    found.push({
      setup: 'consolidation',
      note: `${S.tightRangeDays}-day range ${rangePct.toFixed(1)}% wide, ${belowHigh.toFixed(1)}% below the ${S.breakoutLookback}-day high${nr7 ? ', NR7' : ''}`,
      quality: 0.4 + 0.6 * (0.5 * lin(rangePct, 10, 3) + 0.2 * (nr7 ? 1 : 0) + 0.15 * (dryUp ? 1 : 0) + 0.15 * lin(belowHigh, S.nearHighPct, 0)),
      trigger: round(Math.max(trigger, rangeHigh * (1 + S.triggerBufferPct / 100))),
      stop: withStop(rangeLow),
    })
  }

  const gap = Math.abs(pct(ema20, last.close))
  const rsi14 = (() => {
    const ch = dc.slice(-15).map((c, i, a) => (i ? c - a[i - 1] : 0)).slice(1)
    const loss = avg(ch.map((c) => Math.max(-c, 0)))
    return loss === 0 ? 100 : 100 - 100 / (1 + avg(ch.map((c) => Math.max(c, 0))) / loss)
  })()
  if (ema20 > ema50 && last.close > ema50 && gap <= S.pullbackBandPct && rsi14 >= 40 && rsi14 <= 65 && ret(dc, 20) > -3) {
    const turned = last.close > prev.high
    const lighter = avg(days.slice(-5).map((d) => d.volume)) < avgVol
    found.push({
      setup: 'pullback',
      note: `Within ${gap.toFixed(1)}% of the rising 20 EMA, RSI ${rsi14.toFixed(0)}${turned ? ', turned up today' : ''}`,
      quality: 0.4 + 0.6 * (0.35 * lin(gap, S.pullbackBandPct, 0) + 0.3 * (turned ? 1 : 0) + 0.2 * (lighter ? 1 : 0) + 0.15 * lin(Math.abs(rsi14 - 50), 15, 0)),
      trigger,
      stop: withStop(Math.min(...days.slice(-5).map((d) => d.low))),
    })
  }
  return found.sort((a, b) => b.quality - a.quality)[0] ?? null
}

// Weekly setups reuse the Top 10 detector (breakout, pullback or base) with its trigger
// and stop rules; an extended weekly close (> 25% above the 10-week SMA) halves quality.
export function positionalSetup(weeks: Week[]): SetupResult | null {
  const info = setupFor(weeks)
  if (!info) return null
  const last = weeks.at(-1)!
  const trigger = round(last.high * (1 + TOP10_RULES.triggerBufferPct / 100))
  const atrStop = trigger - TOP10_RULES.atrStopMultiple * atr(weeks, TOP10_RULES.atrWeeks)
  const extended = last.close / sma(weeks.map((w) => w.close), 10) > TOP10_RULES.maxExtension
  return {
    setup: info.setup,
    note: info.note + (extended ? ' (extended)' : ''),
    quality: (0.4 + 0.6 * (info.quality / 100)) * (extended ? 0.5 : 1),
    trigger,
    stop: Math.max(info.swingLow, atrStop),
  }
}

export function setupScore(mode: Mode, s: SetupResult | null): Component {
  const max = QUALITY_RULES.weights[mode].setup
  if (!s) return { key: 'setup', label: 'Setup quality', points: 0, max, note: 'no breakout, pullback or consolidation setup' }
  return { key: 'setup', label: 'Setup quality', points: round(max * clamp01(s.quality)), max, note: `${s.setup}: ${s.note}` }
}

export function volumeScore(mode: Mode, days: Day[], weeks: Week[], delivery: Delivery | null): Component {
  const max = QUALITY_RULES.weights[mode].volume
  const window = mode === 'swing' ? 20 : 50
  const recent = days.slice(-window)
  const upVol = recent.filter((d, i) => i > 0 && d.close >= recent[i - 1].close).reduce((s, d) => s + d.volume, 0)
  const downVol = recent.filter((d, i) => i > 0 && d.close < recent[i - 1].close).reduce((s, d) => s + d.volume, 0)
  const upDown = downVol ? upVol / downVol : 2
  let relVol: number
  let relLabel: string
  if (mode === 'swing') {
    // Strongest up-day volume of the last 5 sessions against the 20-day average.
    const avgVol = sma(days.slice(-25, -5).map((d) => d.volume), 20)
    const last5 = days.slice(-6)
    const upDays = last5.slice(1).filter((d, i) => d.close >= last5[i].close)
    relVol = avgVol && upDays.length ? Math.max(...upDays.map((d) => d.volume)) / avgVol : 0
    relLabel = 'up-day volume'
  } else {
    const avgVol = sma(weeks.slice(-23, -3).map((w) => w.volume), 20)
    const last3 = weeks.slice(-4)
    const upWeeks = last3.slice(1).filter((w, i) => w.close >= last3[i].close)
    relVol = avgVol && upWeeks.length ? Math.max(...upWeeks.map((w) => w.volume)) / avgVol : 0
    relLabel = 'up-week volume'
  }
  const checks = [
    { w: 0.4, v: lin(relVol, 0.8, 2), label: `${relLabel} ${relVol.toFixed(1)}×` },
    { w: 0.3, v: lin(upDown, 0.8, 1.6), label: `up/down volume ${upDown.toFixed(2)}` },
  ]
  let extra = `${relLabel} ${relVol.toFixed(1)}×, up/down ${upDown.toFixed(2)}`
  if (delivery) {
    const recentPct = mode === 'swing' ? delivery.recent5 : delivery.recent20
    const ratio = delivery.base60 ? recentPct / delivery.base60 : 1
    checks.push({ w: 0.3, v: 0.6 * lin(ratio, 0.9, 1.3) + 0.4 * lin(recentPct, 30, 60), label: `delivery ${recentPct.toFixed(0)}%` })
    extra += `, delivery ${recentPct.toFixed(0)}% vs ${delivery.base60.toFixed(0)}% avg`
  } else {
    extra += ', delivery n/a'
  }
  return fromChecks('volume', 'Volume confirmation', max, checks, extra)
}

// Banks and NBFCs carry leverage by design, so debt/equity isn't scored for them.
const LEVERED_SECTORS = new Set(['Financial Services'])

export function fundamentalScore(mode: Mode, f: Fundamentals | null, sector: string) {
  const max = QUALITY_RULES.weights[mode].fundamentals
  const fields: { value: number | undefined; v: (x: number) => number; label: string; fmt: (x: number) => string }[] = [
    { value: f?.revenueGrowth, v: (x) => lin(x, 0, 0.2), label: 'sales growth', fmt: (x) => signedPct(x * 100, 0) },
    { value: f?.earningsGrowth, v: (x) => lin(x, 0, 0.25), label: 'earnings growth', fmt: (x) => signedPct(x * 100, 0) },
    { value: f?.roe, v: (x) => lin(x, 0.05, 0.2), label: 'ROE', fmt: (x) => `${(x * 100).toFixed(0)}%` },
    { value: f?.operatingMargin, v: (x) => lin(x, 0, 0.2), label: 'op. margin', fmt: (x) => `${(x * 100).toFixed(0)}%` },
  ]
  if (!LEVERED_SECTORS.has(sector)) {
    fields.push({ value: f?.debtToEquity, v: (x) => lin(x, 1.5, 0.3), label: 'D/E', fmt: (x) => x.toFixed(2) })
  }
  const known = fields.filter((x) => x.value !== undefined && Number.isFinite(x.value))
  // Missing fields score neutral (half), so patchy data neither helps nor sinks a stock.
  const score = avg(fields.map((x) => (x.value !== undefined && Number.isFinite(x.value) ? x.v(x.value) : 0.5)))
  const note = known.length
    ? `${known.map((x) => `${x.label} ${x.fmt(x.value!)}`).join(', ')}${known.length < fields.length ? ` (${known.length}/${fields.length} fields)` : ''}`
    : 'no fundamental data: neutral'
  return {
    component: { key: 'fundamentals', label: 'Fundamental health', points: round(max * score), max, note } satisfies Component,
    coverage: known.length / fields.length,
  }
}

export function riskRewardScore(mode: Mode, close: number, trigger: number, stop: number, high52: number) {
  const max = QUALITY_RULES.weights[mode].riskReward
  const R = trigger - stop
  const riskPct = (R / trigger) * 100
  const gapPct = pct(close, trigger)
  const blueSky = high52 <= trigger * 1.02
  const cap = trigger + QUALITY_RULES.targetR * R
  const target = blueSky ? cap : Math.min(high52, cap)
  const rr = R > 0 ? (target - trigger) / R : 0
  const { maxRiskPct, idealRiskPct } = QUALITY_RULES[mode]
  const component = fromChecks(
    'riskReward',
    'Risk/reward',
    max,
    [
      { w: 0.4, v: R > 0 ? lin(riskPct, maxRiskPct, idealRiskPct) : 0, label: `${riskPct.toFixed(1)}% risk` },
      { w: 0.2, v: lin(Math.abs(gapPct), mode === 'swing' ? 4 : 8, 0.5), label: `${gapPct.toFixed(1)}% to trigger` },
      { w: 0.4, v: lin(rr, 1, QUALITY_RULES.fullRR), label: `${rr.toFixed(1)}R to target` },
    ],
    `${riskPct.toFixed(1)}% risk, ${rr.toFixed(1)}R to ${blueSky ? 'blue-sky target' : '52-week high'}`,
  )
  return { component, target: round(target), rr: round(rr), riskPct: round(riskPct), gapPct: round(gapPct) }
}

// ---------- Total ----------

export function applyRegime(raw: number, regime: Regime) {
  const r = QUALITY_RULES.regime
  if (regime === 'caution') return Math.max(0, raw - r.cautionPenalty)
  if (regime === 'risk-off') return Math.min(raw, r.riskOffCap)
  return raw
}

// Hard filters: size, liquidity, enough history, and not stale (trades on the index's last day).
export function passesFilters(stock: QualityInput, niftyDays: Day[]) {
  const { days } = stock
  if (stock.marketCapCr < QUALITY_RULES.minMarketCapCr) return false
  if (days.length < QUALITY_RULES.minDays || stock.weeks.length < 36) return false
  if (days.at(-1)!.date !== niftyDays.at(-1)!.date) return false
  const tradedValueCr = avg(days.slice(-20).map((d) => d.close * d.volume)) / CRORE
  return tradedValueCr >= QUALITY_RULES.minTradedValueCr
}

export function qualityScore(stock: QualityInput, mode: Mode, ctx: Context): Omit<QualityStock, 'firstSeen' | 'daysListed'> {
  const { days, weeks } = stock
  const sector = ctx.sectors.get(stock.sector)
  const close = days.at(-1)!.close
  const setup = mode === 'swing' ? swingSetup(days) : positionalSetup(weeks)
  // Without a setup, still show levels: buy above the latest high, stop at 2 ATRs.
  const fallbackTrigger = mode === 'swing' ? days.at(-1)!.high * 1.002 : weeks.at(-1)!.high * 1.005
  const trigger = setup?.trigger ?? fallbackTrigger
  const stop = setup?.stop ?? trigger - 2 * (mode === 'swing' ? atr(days) : atr(weeks, 10))
  const high52 = Math.max(...days.slice(-250).map((d) => d.high))
  const rr = riskRewardScore(mode, close, trigger, stop, high52)
  const fundamentals = fundamentalScore(mode, stock.fundamentals, stock.sector)
  const components = [
    trendScore(mode, days, weeks),
    rsScore(mode, days, ctx.niftyDays, sector),
    sectorScore(mode, sector),
    setupScore(mode, setup),
    volumeScore(mode, days, weeks, stock.delivery),
    fundamentals.component,
    rr.component,
  ]
  const rawScore = round(components.reduce((s, c) => s + c.points, 0))
  const score = round(applyRegime(rawScore, ctx.regime.regime))
  return {
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector,
    marketCapCr: stock.marketCapCr,
    close: round(close),
    rawScore,
    score,
    grade: gradeOf(score),
    setup: setup?.setup ?? null,
    setupNote: setup?.note ?? '',
    trigger: round(trigger),
    stop: round(stop),
    target: rr.target,
    riskPct: rr.riskPct,
    rr: rr.rr,
    triggerGapPct: rr.gapPct,
    deliveryPct: stock.delivery ? round(mode === 'swing' ? stock.delivery.recent5 : stock.delivery.recent20) : null,
    fundamentalsCoverage: round(fundamentals.coverage),
    components,
  }
}

// Carries `firstSeen` over from the previous file for names that stay graded; `daysListed`
// counts trading days since then (1 = new today).
export function carryFirstSeen(
  stocks: Omit<QualityStock, 'firstSeen' | 'daysListed'>[],
  previous: { stocks: { symbol: string; grade: string | null; firstSeen: string }[] } | null,
  tradingDates: string[],
  asOf: string,
): QualityStock[] {
  const prev = new Map((previous?.stocks ?? []).filter((s) => s.grade).map((s) => [s.symbol, s.firstSeen]))
  return stocks.map((s) => {
    const firstSeen = (s.grade && prev.get(s.symbol)) || asOf
    const daysListed = s.grade ? tradingDates.filter((d) => d >= firstSeen && d <= asOf).length : 0
    return { ...s, firstSeen, daysListed }
  })
}

// Delivery averages per symbol from parsed bhavcopy rows (date → symbol → DELIV_PER).
export function deliveryStats(byDate: Map<string, Map<string, number>>): Map<string, Delivery> {
  const dates = [...byDate.keys()].sort()
  const series = new Map<string, number[]>()
  for (const date of dates.slice(-60)) {
    for (const [symbol, value] of byDate.get(date)!) series.set(symbol, [...(series.get(symbol) ?? []), value])
  }
  const out = new Map<string, Delivery>()
  for (const [symbol, values] of series) {
    if (values.length < 10) continue
    out.set(symbol, { recent5: round(avg(values.slice(-5))), recent20: round(avg(values.slice(-20))), base60: round(avg(values)) })
  }
  return out
}

// Parses NSE's sec_bhavdata_full CSV into symbol → delivery % for the EQ series.
export function parseBhavcopy(csv: string): Map<string, number> {
  const [header, ...rows] = csv.trim().split('\n')
  const cols = header.split(',').map((c) => c.trim())
  const iSym = cols.indexOf('SYMBOL')
  const iSeries = cols.indexOf('SERIES')
  const iDeliv = cols.indexOf('DELIV_PER')
  const out = new Map<string, number>()
  if (iSym < 0 || iSeries < 0 || iDeliv < 0) return out
  for (const row of rows) {
    const c = row.split(',').map((x) => x.trim())
    const value = Number(c[iDeliv])
    if (c[iSeries] === 'EQ' && c[iDeliv] !== '-' && Number.isFinite(value)) out.set(c[iSym], value)
  }
  return out
}
