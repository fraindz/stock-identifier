import type { TopTenPerformance, TrackedIdea } from './types'
import { pctFromEntry } from './format'

const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

const resultLabel = (status: TrackedIdea['status']) => {
  if (status === 'target') return 'Target hit'
  if (status === 'stop') return 'Stop loss'
  if (status === 'expired') return 'Expired'
  return 'Open'
}

export default function TopTenDashboard({ data }: { data: TopTenPerformance }) {
  const targets = data.ideas.filter((idea) => idea.status === 'target').length
  const stops = data.ideas.filter((idea) => idea.status === 'stop').length
  const expired = data.ideas.filter((idea) => idea.status === 'expired').length
  const open = data.ideas.filter((idea) => idea.status === 'open').length
  const ideas = [...data.ideas].sort(
    (a, b) => b.suggestionDate.localeCompare(a.suggestionDate) || a.rank - b.rank,
  )

  return (
    <>
      <header>
        <h1>Top 10 results</h1>
        <p className="meta">
          Tracking each day’s top 10 Trade Plan ideas · updated{' '}
          {data.updatedAt ? new Date(data.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet'}
        </p>
      </header>

      <section className="performance-summary" aria-label="Trade outcome counts">
        <div className="performance-card target">
          <span>Targets hit</span>
          <strong>{targets}</strong>
        </div>
        <div className="performance-card stop">
          <span>Stop losses</span>
          <strong>{stops}</strong>
        </div>
        <div className="performance-card">
          <span>Expired after 4 months</span>
          <strong>{expired}</strong>
        </div>
        <div className="performance-card">
          <span>Open ideas</span>
          <strong>{open}</strong>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th className="num">Rank</th>
              <th>Suggested</th>
              <th className="num">Entry</th>
              <th className="num">Stop loss</th>
              <th className="num">Target</th>
              <th>Result</th>
              <th>Closed date</th>
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea) => (
              <tr key={idea.id}>
                <td>
                  <a
                    className="symbol"
                    href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(idea.symbol)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {idea.symbol}
                  </a>
                  <div className="name">{idea.name}</div>
                </td>
                <td className="num">#{idea.rank}</td>
                <td>{formatDate(idea.suggestionDate)}</td>
                <td className="num">{idea.entry.toFixed(2)}</td>
                <td className="num">{idea.stop.toFixed(2)} ({pctFromEntry(idea.entry, idea.stop)})</td>
                <td className="num">{idea.target.toFixed(2)} ({pctFromEntry(idea.entry, idea.target)})</td>
                <td className={idea.status === 'target' ? 'up' : idea.status === 'stop' ? 'down' : ''}>
                  {resultLabel(idea.status)}
                </td>
                <td>{formatDate(idea.closedDate)}</td>
              </tr>
            ))}
            {ideas.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">No Top 10 ideas have been tracked yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="meta performance-note">
        Outcomes are checked against daily high/low prices after each suggestion date. If both stop and target fall
        within the same day’s range, the idea is counted as a stop loss. Ideas that reach neither level within four
        calendar months are closed as expired.
      </p>
    </>
  )
}
