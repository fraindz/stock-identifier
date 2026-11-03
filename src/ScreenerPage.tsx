import { useMemo, useState } from 'react'
import { formatRange, inr, pctChange, signed, toneOf } from './format'
import type { SavedList } from './history'
import { CurrentWeekCells, StockCell, WeekCells, WeekHeaders } from './TableCells'
import type { ScreenerData, Stock, Trend } from './types'

type SortKey = 'marketCapCr' | 'symbol' | 'change' | 'currentChange'

// Close-to-close change from two weeks ago to last week.
const changePct = (s: Stock) => pctChange(s.twoWeeksAgo.close, s.lastWeek.close)

// Change from last week's close to the latest close in the current week.
const currentChangePct = (s: Stock) => (s.currentWeek ? pctChange(s.lastWeek.close, s.currentWeek.close) : null)

const COPY = {
  down: { name: 'downtrend', title: 'Three-week downtrend', direction: 'lower', changeSort: 'Biggest 2-week fall' },
  up: { name: 'uptrend', title: 'Three-week uptrend', direction: 'higher', changeSort: 'Biggest 2-week rise' },
}

type Props = {
  trend: Trend
  data: ScreenerData
  // Set for the "still listed" view: the earlier saved list to compare against,
  // or null when no earlier week has been saved yet.
  previous?: SavedList | null
}

export default function ScreenerPage({ trend, data, previous }: Props) {
  const copy = COPY[trend]
  const repeatView = previous !== undefined
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('marketCapCr')

  const listed = useMemo(() => {
    if (!repeatView) return data.stocks
    const earlier = new Set(previous?.symbols ?? [])
    return data.stocks.filter((s) => earlier.has(s.symbol))
  }, [data, previous, repeatView])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = listed.filter(
      (s) => !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    )
    return filtered.sort((a, b) => {
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol)
      if (sort === 'change') return trend === 'down' ? changePct(a) - changePct(b) : changePct(b) - changePct(a)
      if (sort === 'currentChange') {
        return (currentChangePct(b) ?? -Infinity) - (currentChangePct(a) ?? -Infinity)
      }
      return b.marketCapCr - a.marketCapCr
    })
  }, [listed, query, sort, trend])

  const { weeks } = data

  return (
    <>
      <header>
        <h1>{repeatView ? `Still in ${copy.name}` : copy.title}</h1>
        <p className="lede">
          {repeatView && (
            <>
              Stocks on this week’s {copy.name} list that were also on the list saved for the week of{' '}
              {previous ? formatRange(previous.week) : 'an earlier week'}.{' '}
            </>
          )}
          NSE stocks with market cap of at least ₹{inr.format(data.minMarketCapCr)} Cr where each of the
          last two completed weeks made a {copy.direction} high, {copy.direction} low and {copy.direction} close
          than the week before.
        </p>
        <ul className="criteria">
          {weeks.currentWeek && (
            <li className="current"><span>Current week (so far)</span>{formatRange(weeks.currentWeek)}</li>
          )}
          <li><span>Last week</span>{formatRange(weeks.lastWeek)}</li>
          <li><span>1 week ago</span>{formatRange(weeks.oneWeekAgo)}</li>
          <li><span>2 weeks ago</span>{formatRange(weeks.twoWeeksAgo)}</li>
        </ul>
        <p className="meta">
          {repeatView ? (
            <>
              <strong>{listed.length}</strong> of {data.stocks.length} stocks on this week’s list
              {previous && <> were also on the {previous.symbols.length} saved for {formatRange(previous.week)}</>}
            </>
          ) : (
            <>
              <strong>{data.stocks.length}</strong> of {data.universeSize} stocks match
            </>
          )}
          {' '}· data as of{' '}
          {new Date(data.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {data.failed.length > 0 && <> · {data.failed.length} could not be fetched</>}
        </p>
      </header>

      {repeatView && !previous ? (
        <p className="notice first-run">
          This week’s list ({formatRange(weeks.lastWeek)}, {data.stocks.length} stocks) has been saved in this
          browser. After next week’s scan, stocks that are still on the list will appear here.
        </p>
      ) : (
        <>
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
                <option value="change">{copy.changeSort}</option>
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
                  <th colSpan={3} className="group">2 weeks ago</th>
                  <th colSpan={3} className="group">1 week ago</th>
                  <th colSpan={3} className="group">Last week</th>
                  <th rowSpan={2} className="num">2-wk change</th>
                  <th colSpan={3} className="group current">Current week</th>
                  <th colSpan={2} className="group current">vs last week</th>
                </tr>
                <tr>
                  {[0, 1, 2].map((i) => (
                    <WeekHeaders key={i} />
                  ))}
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
                    <WeekCells week={s.twoWeeksAgo} />
                    <WeekCells week={s.oneWeekAgo} />
                    <WeekCells week={s.lastWeek} />
                    <td className={`num ${toneOf(changePct(s))}`}>{signed(changePct(s))}%</td>
                    <CurrentWeekCells current={s.currentWeek} lastClose={s.lastWeek.close} />
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={17} className="empty">
                      {query ? `No stocks match “${query}”.` : 'No stocks carried over from the earlier list.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
