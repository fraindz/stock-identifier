import { inr, pctChange, signed, toneOf } from './format'
import type { Week } from './types'

export function StockCell({ symbol, name }: { symbol: string; name: string }) {
  return (
    <td className="sticky-col">
      <a
        className="symbol"
        href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`}
        target="_blank"
        rel="noreferrer"
      >
        {symbol}
      </a>
      <div className="name">{name}</div>
    </td>
  )
}

export function WeekHeaders() {
  return (
    <>
      <th className="num sub group-start">High</th>
      <th className="num sub">Low</th>
      <th className="num sub">Close</th>
    </>
  )
}

export function WeekCells({ week }: { week: Week }) {
  return (
    <>
      <td className="num group-start">{inr.format(week.high)}</td>
      <td className="num">{inr.format(week.low)}</td>
      <td className="num">{inr.format(week.close)}</td>
    </>
  )
}

// Current week's high, low and close plus its change from last week's close (5 columns).
export function CurrentWeekCells({ current, lastClose }: { current: Week | null; lastClose: number }) {
  if (!current) return <td colSpan={5} className="group-start empty">No trades yet</td>
  const diff = current.close - lastClose
  const tone = toneOf(diff)
  return (
    <>
      <WeekCells week={current} />
      <td className={`num group-start ${tone}`}>{signed(diff)}</td>
      <td className={`num ${tone}`}>{signed(pctChange(lastClose, current.close))}%</td>
    </>
  )
}
