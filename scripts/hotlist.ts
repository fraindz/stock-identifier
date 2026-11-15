// Hotlist: stocks graded on both Rolling swing (daily chart) and Positional (weekly chart),
// i.e. where the short- and medium-term pictures agree. The daily starting point.
// Entries and the target use the swing levels: the stop is tight, so the target is the nearer
// of the 52-week high + 1% and 3R. Bought trades follow the positional exit rules (trailing stop),
// so a winner can still run past the target. Pure functions only; screen.ts does the file writes.
import { round, type Company } from './indicators'
import type { QualityStock } from './quality'

export const HOTLIST_RULES = {
  minScore: 60, // graded C or better on both tabs
  oneAtLeast: 70, // and B or better on at least one
  maxSwingRiskPct: 8, // the swing entry must be actionable
}

type Scored = Omit<QualityStock, 'firstSeen' | 'daysListed'>

export type HotStock = Company & {
  rank: number
  grade: 'A' | 'B' // the better of the two grades
  close: number
  avgScore: number
  swing: { score: number; grade: string; setup: string | null; setupNote: string; trigger: number; stop: number; riskPct: number }
  positional: { score: number; grade: string; setup: string | null; setupNote: string; trigger: number; stop: number; riskPct: number }
  trigger: number // swing buy-above
  stop: number // swing stop
  riskPct: number
  target: number // swing target: the nearer of the 52-week high + 1% and 3R
  rr: number
  swingComponents: QualityStock['components']
}

export function buildHotlist(swing: Scored[], positional: Scored[]): Omit<HotStock, 'firstSeen' | 'daysListed'>[] {
  const R = HOTLIST_RULES
  const pos = new Map(positional.map((p) => [p.symbol, p]))
  const hot = swing.flatMap((s) => {
    const p = pos.get(s.symbol)
    if (!p || !s.grade || !p.grade) return []
    if (s.score < R.minScore || p.score < R.minScore || Math.max(s.score, p.score) < R.oneAtLeast) return []
    if (s.riskPct > R.maxSwingRiskPct || !(s.trigger > s.stop)) return []
    const grade = s.grade === 'A' || p.grade === 'A' ? 'A' : 'B'
    const levels = (q: Scored) => ({ score: q.score, grade: q.grade!, setup: q.setup, setupNote: q.setupNote, trigger: q.trigger, stop: q.stop, riskPct: q.riskPct })
    return [
      {
        rank: 0,
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        marketCapCr: s.marketCapCr,
        grade: grade as HotStock['grade'],
        close: s.close,
        avgScore: round((s.score + p.score) / 2),
        swing: levels(s),
        positional: levels(p),
        trigger: s.trigger,
        stop: s.stop,
        riskPct: s.riskPct,
        target: s.target,
        rr: s.rr,
        swingComponents: s.components,
      },
    ]
  })
  hot.sort((a, b) => b.avgScore - a.avgScore || a.riskPct - b.riskPct)
  hot.forEach((h, i) => (h.rank = i + 1))
  return hot
}

// Shape the tracker records as a signal: swing entry levels, positional target, best grade.
export const asSignal = (h: Omit<HotStock, 'firstSeen' | 'daysListed'>): Scored => ({
  symbol: h.symbol,
  name: h.name,
  sector: h.sector,
  marketCapCr: h.marketCapCr,
  close: h.close,
  rawScore: h.avgScore,
  score: h.avgScore,
  grade: h.grade,
  setup: h.swing.setup,
  setupNote: h.swing.setupNote,
  trigger: h.trigger,
  stop: h.stop,
  target: h.target,
  riskPct: h.riskPct,
  rr: h.rr,
  triggerGapPct: 0,
  deliveryPct: null,
  fundamentalsCoverage: 1,
  components: h.swingComponents,
})
