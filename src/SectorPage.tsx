import { formatRange, inr } from './format'
import type { SectorData } from './types'
import RefreshButton from './RefreshButton'

export default function SectorPage({
  data,
  onRefresh,
  refreshing,
}: {
  data: SectorData
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <>
      <header>
        <div className="title-row">
          <h1>Growing sectors</h1>
          <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
        </div>
        <ul className="criteria">
          <li><span>Current week</span>{data.weeks.currentWeek ? formatRange(data.weeks.currentWeek) : 'No trades yet'}</li>
          <li><span>Last week</span>{formatRange(data.weeks.lastWeek)}</li>
        </ul>
        <p className="meta">
          <strong>{data.sectors.length}</strong> sectors with positive combined breadth over two weeks ·{' '}
          {data.universeSize} classified stocks · data as of{' '}
          {new Date(data.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sector</th>
              <th className="num">Sector universe</th>
              <th className="num">1 week ago breadth</th>
              <th className="num">Last week breadth</th>
              <th>Stocks advancing both weeks</th>
            </tr>
          </thead>
          <tbody>
            {data.sectors.map((sector) => (
              <tr key={sector.name}>
                <td><strong>{sector.name}</strong></td>
                <td className="num">{sector.universeCount}</td>
                <td className="num up">{sector.oneWeekBreadthPct.toFixed(1)}%</td>
                <td className="num up">{sector.lastWeekBreadthPct.toFixed(1)}%</td>
                <td>
                  {sector.stocks.map((stock, index) => (
                    <span key={stock.symbol}>
                      {index > 0 && ', '}
                      <a className="symbol" href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(stock.symbol)}`} target="_blank" rel="noreferrer">
                        {stock.symbol}
                      </a>{' '}
                      <span className="name">({inr.format(stock.marketCapCr)} Cr)</span>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {data.sectors.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">No sectors had positive combined breadth over the last two completed weeks.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
