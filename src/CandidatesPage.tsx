import { useMemo, useState } from 'react'
import { formatDay, inr, signed, toneOf } from './format'
import { StockCell } from './TableCells'
import type { CandidatesData, Portfolio } from './types'

export default function CandidatesPage({ data, portfolio }: { data: CandidatesData; portfolio: Portfolio | null }) {
  const [query, setQuery] = useState('')
  const held = useMemo(
    () => new Map((portfolio?.slots ?? []).filter((s) => s.status !== 'closed').map((s) => [s.symbol, s.status])),
    [portfolio],
  )
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.candidates.filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
  }, [data, query])

  return (
    <>
      <header>
        <h1>Top 10 candidates</h1>
        <p className="meta">
          Top <strong>{data.candidates.length}</strong> of {data.eligibleCount} eligible ({data.trendUniverse} pass the trend
          filter) · week of {formatDay(data.reviewWeek)} · data as of {formatDay(data.asOf)}
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
              <th className="num">Rank</th>
              <th>Setup</th>
              <th className="num">Score</th>
              <th className="num">6M vs Nifty</th>
              <th className="num">3M vs Nifty</th>
              <th className="num">Trend</th>
              <th className="num">Sector</th>
              <th className="num">RSI</th>
              <th className="num">Off high</th>
              <th className="num">Buy above</th>
              <th className="num">Stop</th>
              <th className="num">Risk</th>
              <th className="num">Mkt cap (Cr)</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.symbol}>
                <StockCell symbol={c.symbol} name={c.name} />
                <td className="num">
                  #{c.rank}
                  {held.has(c.symbol) && <div className="name">{held.get(c.symbol)}</div>}
                </td>
                <td>
                  {c.setup}
                  <div className="name">{c.setupNote}</div>
                </td>
                <td className="num">{c.score.toFixed(1)}</td>
                <td className={`num ${toneOf(c.rel6mPct)}`}>{signed(c.rel6mPct, 1)}%</td>
                <td className={`num ${toneOf(c.rel3mPct)}`}>{signed(c.rel3mPct, 1)}%</td>
                <td className="num">{c.trendQuality.toFixed(0)}%</td>
                <td className="num">{c.sectorBreadthPct.toFixed(0)}%</td>
                <td className="num">{c.rsi.toFixed(1)}</td>
                <td className="num">{c.belowHighPct.toFixed(1)}%</td>
                <td className="num up">{inr.format(c.trigger)}</td>
                <td className="num down">{inr.format(c.stop)}</td>
                <td className="num">{c.riskPct.toFixed(1)}%</td>
                <td className="num">{inr.format(c.marketCapCr)}</td>
                <td>{c.sector}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={15} className="empty">No candidates match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="meta performance-note">
        Score = 40% relative strength vs Nifty 50 + 20% sector breadth + 20% trend quality + 20% setup quality, each as a
        percentile. Trend = share of the last 26 weeks closing above the 10-week average.
      </p>
    </>
  )
}
