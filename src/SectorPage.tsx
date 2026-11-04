import { formatRange, inr } from './format'
import type { SectorData } from './types'

export default function SectorPage({ data }: { data: SectorData }) {
  return (
    <>
      <header>
        <h1>Growing sectors</h1>
        <ul className="criteria">
          <li><span>Current week</span>{data.weeks.currentWeek ? formatRange(data.weeks.currentWeek) : 'No trades yet'}</li>
          <li><span>Last week</span>{formatRange(data.weeks.lastWeek)}</li>
        </ul>
        <p className="meta">
          <strong>{data.sectors.length}</strong> sectors · <strong>{data.uptrendSize}</strong> uptrend stocks of{' '}
          {data.universeSize} classified stocks · data as of{' '}
          {new Date(data.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sector</th>
              <th className="num">Uptrend stocks</th>
              <th className="num">Sector universe</th>
              <th className="num">Breadth</th>
              <th>Stocks in uptrend</th>
            </tr>
          </thead>
          <tbody>
            {data.sectors.map((sector) => (
              <tr key={sector.name}>
                <td><strong>{sector.name}</strong></td>
                <td className="num">{sector.stockCount}</td>
                <td className="num">{sector.universeCount}</td>
                <td className="num up">{sector.breadthPct.toFixed(1)}%</td>
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
          </tbody>
        </table>
      </div>
    </>
  )
}
