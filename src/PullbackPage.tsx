import { useMemo, useState } from 'react'
import { formatRange, inr, pctChange } from './format'
import { CurrentWeekCells, StockCell, WeekCells, WeekHeaders } from './TableCells'
import type { PullbackData, PullbackStock } from './types'
import RefreshButton from './RefreshButton'

type SortKey = 'marketCapCr' | 'rallyPct' | 'retracePct' | 'belowPeakPct' | 'currentChange' | 'symbol'

const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const weekOf = (start: string) => `Week of ${shortDate.format(new Date(start))}`

const sortValue: Record<Exclude<SortKey, 'symbol'>, (s: PullbackStock) => number> = {
  marketCapCr: (s) => -s.marketCapCr,
  rallyPct: (s) => -s.rally.pct,
  retracePct: (s) => s.pullback.retracePct,
  belowPeakPct: (s) => s.belowPeakPct,
  currentChange: (s) => (s.currentWeek ? -pctChange(s.lastWeek.close, s.currentWeek.close) : Infinity),
}

export default function PullbackPage({
  data,
  onRefresh,
  refreshing,
}: {
  data: PullbackData
  onRefresh: () => void
  refreshing: boolean
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('marketCapCr')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = data.stocks.filter(
      (s) => !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    )
    return filtered.sort((a, b) =>
      sort === 'symbol' ? a.symbol.localeCompare(b.symbol) : sortValue[sort](a) - sortValue[sort](b),
    )
  }, [data, query, sort])

  const { weeks } = data

  return (
    <>
      <header>
        <div className="title-row">
          <h1>Rally, pullback, ready to resume</h1>
          <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
        </div>
        <ul className="criteria">
          {weeks.currentWeek && (
            <li className="current"><span>Current week (so far)</span>{formatRange(weeks.currentWeek)}</li>
          )}
          <li><span>Turn week</span>{formatRange(weeks.lastWeek)}</li>
        </ul>
        <p className="meta">
          <strong>{data.stocks.length}</strong> of {data.universeSize} stocks match · data as of{' '}
          {new Date(data.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {data.failed.length > 0 && <> · {data.failed.length} could not be fetched</>}
        </p>
      </header>

      <div className="controls">
        <input
          type="search"
          placeholder="Search symbol or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="marketCapCr">Market cap</option>
            <option value="rallyPct">Biggest rally</option>
            <option value="retracePct">Shallowest pullback</option>
            <option value="belowPeakPct">Closest to peak</option>
            <option value="currentChange">Best current week</option>
            <option value="symbol">Symbol</option>
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th rowSpan={2} className="sticky-col">Stock</th>
              <th rowSpan={2} className="num">Mcap (₹ Cr)</th>
              <th colSpan={3} className="group">Rally</th>
              <th colSpan={4} className="group">Pullback</th>
              <th colSpan={3} className="group">Last week</th>
              <th rowSpan={2} className="num group-start">Prev wk high</th>
              <th rowSpan={2} className="num">Below peak</th>
              <th colSpan={3} className="group current">Current week</th>
              <th colSpan={2} className="group current">vs last week</th>
            </tr>
            <tr>
              <th className="num sub group-start">From low</th>
              <th className="num sub">To peak</th>
              <th className="num sub">Gain</th>
              <th className="num sub group-start">Weeks</th>
              <th className="num sub">Low</th>
              <th className="num sub">Retrace</th>
              <th className="num sub">Vol vs rally</th>
              <WeekHeaders />
              <WeekHeaders />
              <th className="num sub group-start">₹</th>
              <th className="num sub">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.symbol}>
                <StockCell symbol={s.symbol} name={s.name} />
                <td className="num">{inr.format(s.marketCapCr)}</td>
                <td className="num group-start" title={weekOf(s.rally.start)}>{inr.format(s.rally.low)}</td>
                <td className="num" title={weekOf(s.rally.peakWeek)}>{inr.format(s.rally.high)}</td>
                <td className="num up">+{s.rally.pct.toFixed(1)}%</td>
                <td className="num group-start">{s.pullback.weeks}</td>
                <td className="num">{inr.format(s.pullback.low)}</td>
                <td className="num">{s.pullback.retracePct.toFixed(1)}%</td>
                <td className="num">{s.pullback.volumeVsRally.toFixed(2)}×</td>
                <WeekCells week={s.lastWeek} />
                <td className="num group-start">{inr.format(s.prevWeekHigh)}</td>
                <td className="num">{s.belowPeakPct.toFixed(2)}%</td>
                <CurrentWeekCells current={s.currentWeek} lastClose={s.lastWeek.close} />
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={19} className="empty">
                  {query ? `No stocks match “${query}”.` : 'No stocks fit the setup last week.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
