import { useMemo, useState } from 'react'
import { formatDay, inr, signed, toneOf } from './format'
import { OrdersList, RegimeBanner } from './TradeParts'
import { actionsOn, openR, readStored, rText, store } from './tracking'
import type { HotlistData, HotStock, Portfolio, TrackedTrade, TrackerData } from './types'

function OrderStatus({ trade }: { trade: TrackedTrade | undefined }) {
  if (!trade) return <span className="muted">—</span>
  if (trade.status === 'watch') {
    return (
      <>
        Pending
        <div className="name">since {formatDay(trade.addedDate)}</div>
      </>
    )
  }
  const r = openR(trade)
  return (
    <>
      <span className={toneOf(r)}>Bought {rText(r)}</span>
      <div className="name">
        at {inr.format(trade.entry!)} · stop {inr.format(trade.stop)}
      </div>
    </>
  )
}

function GradeCell({ levels }: { levels: HotStock['swing'] }) {
  return (
    <td>
      <span className={`grade grade-${levels.grade}`}>{levels.grade}</span> <span className="muted">{levels.score.toFixed(0)}</span>
    </td>
  )
}

export default function HotlistPage({ data, tracker, portfolio }: { data: HotlistData; tracker: TrackerData | null; portfolio: Portfolio | null }) {
  const [capital, setCapital] = useState(() => readStored('topTenCapital', ''))
  const [riskPct, setRiskPct] = useState(() => readStored('topTenRiskPct', '1'))
  // Half the usual risk outside a risk-on market.
  const regimeFactor = data.regime.regime === 'risk-on' ? 1 : 0.5
  const riskBudget = (Number(capital) || 0) * ((Number(riskPct) || 0) / 100) * regimeFactor
  const qty = (s: HotStock) => (riskBudget > 0 ? inr.format(Math.floor(riskBudget / (s.trigger - s.stop))) : '—')

  const openTrades = useMemo(
    () => new Map((tracker?.trades ?? []).filter((t) => t.mode === 'hotlist' && (t.status === 'watch' || t.status === 'active')).map((t) => [t.symbol, t])),
    [tracker],
  )
  const top10 = useMemo(() => new Map((portfolio?.slots ?? []).filter((s) => s.status !== 'closed').map((s) => [s.symbol, s.status])), [portfolio])
  const actions = useMemo(() => (tracker ? actionsOn(tracker.trades.filter((t) => t.mode === 'hotlist'), tracker.asOf) : []), [tracker])
  // Bought trades whose stock has since left the list still need managing.
  const heldOffList = [...openTrades.values()].filter((t) => t.status === 'active' && !data.stocks.some((s) => s.symbol === t.symbol))
  const { rules } = data

  return (
    <>
      <header>
        <h1>Hotlist</h1>
        <p className="meta">
          <strong>{data.stocks.length}</strong> stocks strong on both Rolling swing and Positional · data as of {formatDay(data.asOf)}
        </p>
      </header>

      <RegimeBanner regime={data.regime} />

      {tracker && <OrdersList actions={actions} date={tracker.asOf} showMode={false} />}

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
        {riskBudget > 0 && (
          <span className="meta">
            Risk per trade: ₹{inr.format(riskBudget)}
            {regimeFactor < 1 && ' (halved: market not risk-on)'}
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th className="sticky-col">Stock</th>
              <th>Swing</th>
              <th>Positional</th>
              <th className="num">Avg</th>
              <th>Setup</th>
              <th className="num">Buy above</th>
              <th className="num">Stop</th>
              <th className="num">Target</th>
              <th className="num">R:R</th>
              <th className="num">Qty</th>
              <th>Order</th>
              <th className="num">Listed</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {data.stocks.map((s) => (
              <tr key={s.symbol}>
                <td className="num">{s.rank}</td>
                <td className="sticky-col">
                  <a className="symbol" href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(s.symbol)}`} target="_blank" rel="noreferrer">
                    {s.symbol}
                  </a>
                  {top10.has(s.symbol) && <span className="tag">Top 10 {top10.get(s.symbol)}</span>}
                  <div className="name">{s.name}</div>
                </td>
                <GradeCell levels={s.swing} />
                <GradeCell levels={s.positional} />
                <td className="num score">{s.avgScore.toFixed(1)}</td>
                <td>
                  {s.swing.setup ?? '—'}
                  <div className="name">{s.swing.setupNote}</div>
                </td>
                <td className="num up">
                  {inr.format(s.trigger)}
                  <div className="name">{signed(((s.trigger - s.close) / s.close) * 100, 1)}% away</div>
                </td>
                <td className="num down">
                  {inr.format(s.stop)}
                  <div className="name">{s.riskPct.toFixed(1)}% risk</div>
                </td>
                <td className="num">{inr.format(s.target)}</td>
                <td className="num">{s.rr.toFixed(1)}R</td>
                <td className="num">{qty(s)}</td>
                <td>
                  <OrderStatus trade={openTrades.get(s.symbol)} />
                </td>
                <td className="num">{s.daysListed <= 1 ? <span className="new-tag">New</span> : `${s.daysListed}d`}</td>
                <td>{s.sector}</td>
              </tr>
            ))}
            {data.stocks.length === 0 && (
              <tr>
                <td colSpan={14} className="empty">
                  Nothing qualifies today. That's normal in a weak market: wait rather than lower the bar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {heldOffList.length > 0 && (
        <>
          <h2>Still held, no longer on the list</h2>
          <p className="meta">Keep managing these with their stops; leaving the list is not an exit signal.</p>
          <ul className="criteria">
            {heldOffList.map((t) => (
              <li key={t.id}>
                <StockLink symbol={t.symbol} /> <OrderStatus trade={t} />
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="meta performance-note">
        Hotlist = graded C or better ({rules.minScore}+) on both Rolling swing and Positional, B or better ({rules.oneAtLeast}+) on at
        least one, with a swing stop no more than {rules.maxSwingRiskPct}% away; ranked by the average of the two scores. Buy
        above, stop and target are the swing levels (target = the nearer of the 52-week high + 1% and 3R). Bought trades are
        managed with the positional rules, so a winner can run past the target: stop to entry at +1R, half booked at +2R, the rest trailing the 3-week low. Orders are kept
        automatically: a pending order is cancelled when the stock drops off the hotlist and expires after 5 trading days.
        Qty = risk per trade ÷ (buy above − stop). Every hotlist signal is recorded in the Grade tracker.
      </p>
    </>
  )
}

function StockLink({ symbol }: { symbol: string }) {
  return (
    <a className="symbol" href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
      {symbol}
    </a>
  )
}
