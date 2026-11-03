import { useMemo, useState } from 'react'
import { compact, formatRange, inr, pctChange } from './format'
import { CurrentWeekCells, StockCell, WeekCells, WeekHeaders } from './TableCells'
import type { BreakoutData, BreakoutStock } from './types'

type SortKey = 'marketCapCr' | 'abovePct' | 'volumeRatio' | 'currentChange' | 'symbol'

const currentChangePct = (s: BreakoutStock) =>
  s.currentWeek ? pctChange(s.lastWeek.close, s.currentWeek.close) : -Infinity

export default function BreakoutPage({ data }: { data: BreakoutData }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('marketCapCr')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = data.stocks.filter(
      (s) => !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    )
    return filtered.sort((a, b) => {
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol)
      if (sort === 'currentChange') return currentChangePct(b) - currentChangePct(a)
      return b[sort] - a[sort]
    })
  }, [data, query, sort])

  const { weeks } = data

  return (
    <>
      <header>
        <h1>Range breakout on volume</h1>
        <p className="lede">
          NSE stocks with market cap of at least ₹{inr.format(data.minMarketCapCr)} Cr whose close last week was
          above the highest high of the previous {data.lookbackWeeks} weeks, on at least {data.volumeMultiple}× their
          average weekly volume.
        </p>
        <ul className="criteria">
          {weeks.currentWeek && (
            <li className="current"><span>Current week (so far)</span>{formatRange(weeks.currentWeek)}</li>
          )}
          <li><span>Breakout week</span>{formatRange(weeks.lastWeek)}</li>
          <li><span>Prior {data.lookbackWeeks} weeks</span>{formatRange(weeks.lookback)}</li>
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
            <option value="abovePct">Furthest above range</option>
            <option value="volumeRatio">Highest volume ratio</option>
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
              <th rowSpan={2} className="num group-start">{data.lookbackWeeks}-wk high</th>
              <th colSpan={3} className="group">Breakout week</th>
              <th rowSpan={2} className="num">Above high</th>
              <th colSpan={3} className="group">Volume (shares)</th>
              <th colSpan={3} className="group current">Current week</th>
              <th colSpan={2} className="group current">vs last week</th>
            </tr>
            <tr>
              <WeekHeaders />
              <th className="num sub group-start">Week</th>
              <th className="num sub">{data.lookbackWeeks}-wk avg</th>
              <th className="num sub">Ratio</th>
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
                <td className="num group-start">{inr.format(s.rangeHigh)}</td>
                <WeekCells week={s.lastWeek} />
                <td className="num up">+{s.abovePct.toFixed(2)}%</td>
                <td className="num group-start">{compact.format(s.lastWeek.volume)}</td>
                <td className="num">{compact.format(s.avgVolume)}</td>
                <td className="num up">{s.volumeRatio.toFixed(2)}×</td>
                <CurrentWeekCells current={s.currentWeek} lastClose={s.lastWeek.close} />
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={15} className="empty">
                  {query ? `No stocks match “${query}”.` : 'No breakouts last week.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
