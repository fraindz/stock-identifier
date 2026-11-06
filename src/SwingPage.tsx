import { useMemo, useState } from 'react'
import RefreshButton from './RefreshButton'
import type { SwingData } from './types'

type Props = {
  data: SwingData
  title: string
  description: string
  onRefresh: () => void
  refreshing: boolean
}

export default function SwingPage({ data, title, description, onRefresh, refreshing }: Props) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.stocks.filter((stock) => !q || stock.symbol.toLowerCase().includes(q) || stock.name.toLowerCase().includes(q))
  }, [data.stocks, query])

  return (
    <>
      <header>
        <div className="title-row">
          <h1>{title}</h1>
          <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
        </div>
        <p className="lede">{description}</p>
        <p className="meta">
          <strong>{data.stocks.length}</strong> candidates · data as of {data.asOf ?? 'unavailable'} · generated{' '}
          {new Date(data.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </header>
      <div className="controls">
        <input type="search" placeholder="Search symbol or name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Stock</th>
              <th className="num">Latest close</th>
              <th className="num">5-day</th>
              <th className="num">20-day</th>
              <th className="num">RSI</th>
              <th className="num">20 EMA</th>
              <th className="num">50 EMA</th>
              <th className="num">Vol ratio</th>
              <th className="num">Entry</th>
              <th className="num">Stop</th>
              <th className="num">Target</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((stock) => (
              <tr key={stock.symbol}>
                <td className="sticky-col">
                  <a className="symbol" href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(stock.symbol)}`} target="_blank" rel="noreferrer">
                    {stock.symbol}
                  </a>
                  <div className="name">{stock.name}</div>
                </td>
                <td className="num">{stock.close.toFixed(2)}</td>
                <td className={`num ${stock.change5Pct >= 0 ? 'up' : 'down'}`}>{stock.change5Pct.toFixed(1)}%</td>
                <td className={`num ${stock.change20Pct >= 0 ? 'up' : 'down'}`}>{stock.change20Pct.toFixed(1)}%</td>
                <td className="num">{stock.rsi.toFixed(1)}</td>
                <td className="num">{stock.ema20.toFixed(2)}</td>
                <td className="num">{stock.ema50.toFixed(2)}</td>
                <td className="num">{stock.volumeRatio.toFixed(2)}×</td>
                <td className="num">{stock.entry.toFixed(2)}</td>
                <td className="num down">{stock.stop.toFixed(2)}</td>
                <td className="num up">{stock.target.toFixed(2)}</td>
                <td>{stock.sector}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="empty">No candidates match your search.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
