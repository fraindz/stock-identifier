import { useState } from 'react'
import { addDays, daysBetween, formatDay, inr, pctFromEntry, signed, toneOf } from './format'
import { StockCell } from './TableCells'
import type { Portfolio, Slot, SlotEvent } from './types'

const SETUP_LABEL: Record<Slot['setup'], string> = { breakout: 'Breakout', pullback: 'Pullback', base: 'Base' }
const EVENT_LABEL: Record<SlotEvent['type'], string> = {
  added: 'New watch',
  triggered: 'Bought',
  breakeven: 'Stop to breakeven',
  partial: 'Book half',
  trail: 'Stop raised',
  closed: 'Exit',
  dropped: 'Removed',
}

const readStored = (key: string, fallback: string) => {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const store = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private window): keep the value for this visit only
  }
}

const rNow = (slot: Slot) => (slot.lastClose - slot.entry!) / slot.r!

function nextAction(slot: Slot, rules: Portfolio['rules']) {
  const entry = slot.entry!
  const r = slot.r!
  if (slot.stop < entry) return `Stop to ${inr.format(entry)} at ${inr.format(entry + rules.breakevenR * r)}`
  if (!slot.partialBooked) return `Book half at ${inr.format(entry + rules.partialR * r)}`
  return `Trail stop under ${rules.trailWeeks}-week low`
}

export default function TopTenDashboard({ data }: { data: Portfolio }) {
  const open = data.slots.filter((s) => s.status !== 'closed')
  const active = open.filter((s) => s.status === 'active').sort((a, b) => a.entryDate!.localeCompare(b.entryDate!))
  const watch = open.filter((s) => s.status === 'watch').sort((a, b) => a.rankAtAdd - b.rankAtAdd)
  const actions = data.slots
    .flatMap((slot) => slot.events.filter((e) => e.date === data.asOf).map((event) => ({ slot, event })))
  const nextReview = data.lastReviewWeek ? addDays(data.lastReviewWeek, 12) : null
  const { rules } = data
  const [capital, setCapital] = useState(() => readStored('topTenCapital', ''))
  const [riskPct, setRiskPct] = useState(() => readStored('topTenRiskPct', '1'))
  const riskBudget = (Number(capital) || 0) * ((Number(riskPct) || 0) / 100)
  const qty = (r: number) => (riskBudget > 0 && r > 0 ? inr.format(Math.floor(riskBudget / r)) : '—')

  return (
    <>
      <header>
        <h1>Top 10 bets</h1>
        <p className="meta">
          <strong>{active.length}</strong> active · <strong>{watch.length}</strong> on watch ·{' '}
          {rules.maxSlots - open.length} free slots · prices as of {formatDay(data.asOf)} · next review: Sat{' '}
          {nextReview ? formatDay(nextReview) : '—'}
        </p>
      </header>

      <div className="controls">
        <label>
          Capital (₹){' '}
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="e.g. 1000000"
            value={capital}
            onChange={(e) => {
              setCapital(e.target.value)
              store('topTenCapital', e.target.value)
            }}
          />
        </label>
        <label>
          Risk per trade %{' '}
          <input
            type="number"
            min="0"
            step="0.25"
            value={riskPct}
            onChange={(e) => {
              setRiskPct(e.target.value)
              store('topTenRiskPct', e.target.value)
            }}
          />
        </label>
        {riskBudget > 0 && <span className="meta">Risk per trade: ₹{inr.format(riskBudget)}</span>}
      </div>

      <section aria-label="Actions today">
        <h2>Actions for {formatDay(data.asOf)}</h2>
        {actions.length ? (
          <ul className="criteria">
            {actions.map(({ slot, event }, i) => (
              <li key={`${slot.id}-${i}`}>
                <strong>{slot.symbol}</strong> · {EVENT_LABEL[event.type]}: {event.note}
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">Nothing to do today. Stops and triggers are unchanged.</p>
        )}
      </section>

      <h2>Active</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Stock</th>
              <th>Setup</th>
              <th>Entry date</th>
              <th className="num">Entry</th>
              <th className="num">Current</th>
              <th className="num">Stop</th>
              <th className="num">R now</th>
              <th className="num">Days held</th>
              <th className="num">Qty</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {active.map((slot) => {
              const r = rNow(slot)
              return (
                <tr key={slot.id}>
                  <StockCell symbol={slot.symbol} name={slot.name} />
                  <td>{SETUP_LABEL[slot.setup]}</td>
                  <td>{formatDay(slot.entryDate)}</td>
                  <td className="num">{inr.format(slot.entry!)}</td>
                  <td className="num">{inr.format(slot.lastClose)}</td>
                  <td className="num down">
                    {inr.format(slot.stop)} ({pctFromEntry(slot.lastClose, slot.stop)})
                  </td>
                  <td className={`num ${toneOf(r)}`}>{signed(r, 1)}R</td>
                  <td className="num">{daysBetween(slot.entryDate!, slot.lastDate)}</td>
                  <td className="num">{qty(slot.r!)}</td>
                  <td>
                    {nextAction(slot, rules)}
                    {slot.partialBooked && <div className="name">Half booked</div>}
                    {r < rules.breakevenR && (
                      <div className="name">Time exit {formatDay(addDays(slot.entryDate!, rules.timeStopWeeks * 7))}</div>
                    )}
                  </td>
                </tr>
              )
            })}
            {active.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">No active positions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Watch</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Stock</th>
              <th>Setup</th>
              <th className="num">Rank</th>
              <th className="num">Last close</th>
              <th className="num">Buy above</th>
              <th className="num">Stop</th>
              <th className="num">Risk</th>
              <th className="num">+1R (stop to entry)</th>
              <th className="num">+2R (book half)</th>
              <th className="num">Qty</th>
              <th>Order valid until</th>
              <th className="num">Weeks waiting</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {watch.map((slot) => {
              const r = slot.trigger - slot.stop
              return (
              <tr key={slot.id}>
                <StockCell symbol={slot.symbol} name={slot.name} />
                <td>
                  {SETUP_LABEL[slot.setup]}
                  <div className="name">{slot.setupNote}</div>
                </td>
                <td className="num">
                  #{slot.lastRank ?? slot.rankAtAdd}
                </td>
                <td className="num">{inr.format(slot.lastClose)}</td>
                <td className="num up">
                  {inr.format(slot.trigger)} ({pctFromEntry(slot.lastClose, slot.trigger)})
                </td>
                <td className="num down">{inr.format(slot.stop)}</td>
                <td className="num">{slot.riskPct.toFixed(1)}%</td>
                <td className="num">{inr.format(slot.trigger + rules.breakevenR * r)}</td>
                <td className="num up">{inr.format(slot.trigger + rules.partialR * r)}</td>
                <td className="num">{qty(r)}</td>
                <td>{formatDay(addDays(slot.addedWeek, 7 * rules.watchReviews + 4))}</td>
                <td className="num">
                  {slot.reviewsWaiting} of {rules.watchReviews}
                </td>
                <td>{slot.sector}</td>
              </tr>
              )
            })}
            {watch.length === 0 && (
              <tr>
                <td colSpan={13} className="empty">No names on watch.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="meta performance-note">
        <strong>How to act:</strong> for each watch name you want, place a buy-stop (SL or GTT) order at the buy-above
        price, valid until the date shown, and attach the stop as a stop-loss once it fills. There is no fixed final
        target: move the stop to entry at +{rules.breakevenR}R, book half at +{rules.partialR}R, and let the rest run on
        the trailing stop. Levels assume a fill at the trigger; a gap above it raises R slightly. Qty = capital × risk % ÷
        (buy − stop).
      </p>
      <p className="meta performance-note">
        Reviewed every Saturday on the completed weekly candle; at most {rules.maxNewPerWeek} new names a week. A watch
        name becomes active when a day’s high reaches its buy level. Stops move to breakeven at +{rules.breakevenR}R; at +
        {rules.partialR}R half is booked and the stop trails the lowest low of the last {rules.trailWeeks} weeks. Positions
        under +{rules.breakevenR}R after {rules.timeStopWeeks} weeks, or with a weekly close below the 30-week average, are
        closed.
      </p>
    </>
  )
}
