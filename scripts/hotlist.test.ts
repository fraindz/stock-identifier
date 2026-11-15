// Run: npm run test:hotlist
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asSignal, buildHotlist } from './hotlist'
import { gradeOf, type QualityStock } from './quality'

type Scored = Omit<QualityStock, 'firstSeen' | 'daysListed'>
const q = (symbol: string, score: number, over: Partial<Scored> = {}): Scored => ({
  symbol,
  name: symbol,
  sector: 'Tech',
  marketCapCr: 5000,
  close: 100,
  rawScore: score,
  score,
  grade: gradeOf(score),
  setup: 'breakout',
  setupNote: '',
  trigger: 101,
  stop: 96,
  target: 116,
  riskPct: 4.95,
  rr: 3,
  triggerGapPct: 1,
  deliveryPct: null,
  fundamentalsCoverage: 1,
  components: [],
  ...over,
})

test('needs C+ on both tabs and B+ on at least one', () => {
  const swing = [q('BOTH_B', 75), q('B_AND_C', 72), q('C_AND_C', 65), q('SWING_ONLY', 85), q('POS_BELOW', 80)]
  const pos = [q('BOTH_B', 74), q('B_AND_C', 61), q('C_AND_C', 68), q('POS_BELOW', 59)]
  const hot = buildHotlist(swing, pos)
  assert.deepEqual(hot.map((h) => h.symbol), ['BOTH_B', 'B_AND_C'])
  assert.deepEqual(hot.map((h) => h.rank), [1, 2])
  assert.equal(hot[0].avgScore, 74.5)
})

test('skips a swing entry with too much risk', () => {
  const hot = buildHotlist([q('WIDE', 80, { riskPct: 9 })], [q('WIDE', 75)])
  assert.equal(hot.length, 0)
})

test('uses the swing levels and target, capping R:R at 3', () => {
  const [h] = buildHotlist([q('X', 82, { trigger: 101, stop: 96, target: 116, rr: 3 })], [q('X', 66, { trigger: 104, stop: 90, target: 140 })])
  assert.equal(h.grade, 'A')
  assert.equal(h.trigger, 101)
  assert.equal(h.stop, 96)
  assert.equal(h.target, 116) // not the positional 140, which would be 7.8R on this stop
  assert.equal(h.rr, 3)
  const signal = asSignal(h)
  assert.equal(signal.grade, 'A')
  assert.equal(signal.score, 74)
  assert.equal(signal.target, 116)
})
