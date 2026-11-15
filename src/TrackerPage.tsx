import { useMemo, useState } from 'react'
import { formatDay, inr, signed, toneOf } from './format'
import { StockCell } from './TableCells'
import { OrdersList } from './TradeParts'
import { actionsOn, EXIT_LABEL, MODE_LABEL, openR, rText, type TrackerMode } from './tracking'
import type { TrackedTrade, TrackerData, TrackerSummaryRow } from './types'

type Mode = TrackerMode
const STATUS_LABEL: Record<TrackedTrade['status'], string> = { watch: 'Watch', active: 'Active', closed: 'Closed', expired: 'Expired', cancelled: 'Cancelled' }
// Fewer closed trades than this and the averages are mostly noise.
const MIN_SAMPLE = 20

const num = (n: number | null, digits = 2, suffix = '') => (n === null ? '—' : `${n.toFixed(digits)}${suffix}`)
function SummaryTable({ rows }: { rows: TrackerSummaryRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="sticky-col">Tab · grade</th>
            <th className="num">Signals</th>
            <th className="num">Watching</th>
            <th className="num">Triggered</th>
            <th className="num">Expired</th>
            <th className="num">Cancelled</th>
            <th className="num">Trigger rate</th>
            <th className="num">Active</th>
            <th className="num">Open R (avg)</th>
            <th className="num">Closed</th>
            <th className="num">Win rate</th>
            <th className="num">Avg R</th>
            <th className="num">Total R</th>
            <th className="num">Avg win / loss</th>
            <th className="num">Avg days held</th>
            <th className="num">Avg best R</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.mode}-${r.grade}`} className={r.grade === 'all' ? 'total-row' : undefined}>
              <td className="sticky-col">
                {MODE_LABEL[r.mode]} · {r.grade === 'all' ? 'All' : <span className={`grade grade-${r.grade}`}>{r.grade}</span>}
              </td>
              <td className="num">{r.signals}</td>
              <td className="num">{r.watching}</td>
              <td className="num">{r.triggered}</td>
              <td className="num">{r.expired}</td>
              <td className="num">{r.cancelled ?? 0}</td>
              <td className="num">{num(r.triggerRatePct, 0, '%')}</td>
              <td className="num">{r.active}</td>
              <td className={`num ${toneOf(r.openR ?? 0)}`}>{rText(r.openR)}</td>
              <td className="num">
                {r.closed}
                {r.closed > 0 && r.closed < MIN_SAMPLE && <div className="name">small sample</div>}
              </td>
              <td className="num">{num(r.winRatePct, 0, '%')}</td>
              <td className={`num ${toneOf(r.avgR ?? 0)}`}>{rText(r.avgR)}</td>
              <td className={`num ${toneOf(r.totalR)}`}>{r.closed ? rText(r.totalR) : '—'}</td>
              <td className="num">
                {rText(r.avgWinR)} / {rText(r.avgLossR)}
              </td>
              <td className="num">{num(r.avgBarsHeld, 1)}</td>
              <td className="num">{rText(r.avgMfeR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TrackerPage({ data }: { data: TrackerData }) {
  const [mode, setMode] = useState<Mode | 'all'>('all')
  const [status, setStatus] = useState<TrackedTrade['status'] | 'all'>('all')
  const [query, setQuery] = useState('')

  const trades = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.trades
      .filter((t) => (mode === 'all' || t.mode === mode) && (status === 'all' || t.status === status))
      .filter((t) => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .sort((a, b) => (b.exitDate ?? b.entryDate ?? b.addedDate).localeCompare(a.exitDate ?? a.entryDate ?? a.addedDate))
  }, [data, mode, status, query])

  const summary = data.summary.filter((r) => mode === 'all' || r.mode === mode)
  const closedCount = data.trades.filter((t) => t.status === 'closed').length
  const { rules } = data
  const actions = useMemo(() => actionsOn(data.trades, data.asOf).filter((a) => mode === 'all' || a.t.mode === mode), [data, mode])

  return (
    <>
      <header>
        <h1>Grade tracker</h1>
        <p className="meta">
          Every A/B stock on Rolling swing and Positional, and every Hotlist stock, as a paper trade · tracking since {formatDay(data.startedOn)} ·{' '}
          <strong>{data.trades.length}</strong> signals, <strong>{closedCount}</strong> closed · prices as of {formatDay(data.asOf)}
        </p>
      </header>

      <OrdersList actions={actions} date={data.asOf} />
      <section aria-label="Order rules">
        <p className="meta performance-note">
          Pending orders are kept automatically: a signal is cancelled when its stock falls below grade C or leaves the list,
          and expires if it doesn't trigger within {rules.swing.watchDays} trading days (swing and hotlist) or{' '}
          {rules.positional.watchDays} (positional). Hotlist signals are also cancelled when they drop off the hotlist.
        </p>
      </section>

      <h2>Do higher grades do better?</h2>
      <SummaryTable rows={summary} />
      <p className="meta performance-note">
        Compare A with B on <strong>Avg R</strong> (average result per closed trade, in multiples of the initial risk) and on
        win rate. Treat any row with fewer than {MIN_SAMPLE} closed trades as anecdotal. Trigger rate counts only signals
        that have either triggered or expired.
      </p>

      <div className="controls">
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode | 'all')} aria-label="Tab">
          <option value="all">All lists</option>
          <option value="swing">Rolling swing</option>
          <option value="positional">Positional</option>
          <option value="hotlist">Hotlist</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as TrackedTrade['status'] | 'all')} aria-label="Status">
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search symbol or name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Stock</th>
              <th>Tab</th>
              <th>Grade</th>
              <th>Signal</th>
              <th>Status</th>
              <th className="num">Buy above</th>
              <th>Entry</th>
              <th className="num">Stop</th>
              <th>Exit</th>
              <th className="num">Result</th>
              <th className="num">Days</th>
              <th className="num">Best</th>
              <th>Setup</th>
              <th>Market</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const result = t.status === 'closed' ? t.rMultiple! : t.status === 'active' ? openR(t) : null
              return (
                <tr key={t.id}>
                  <StockCell symbol={t.symbol} name={t.name} />
                  <td>{MODE_LABEL[t.mode]}</td>
                  <td>
                    <span className={`grade grade-${t.grade}`}>{t.grade}</span> <span className="muted">{t.score.toFixed(0)}</span>
                  </td>
                  <td>{formatDay(t.addedDate)}</td>
                  <td>
                    {STATUS_LABEL[t.status]}
                    {t.endedDate && (
                      <div className="name">
                        {formatDay(t.endedDate)}
                        {t.cancelReason ? ` · ${t.cancelReason}` : ' · did not trigger'}
                      </div>
                    )}
                  </td>
                  <td className="num">{inr.format(t.trigger)}</td>
                  <td>
                    {t.entryDate ? (
                      <>
                        {inr.format(t.entry!)}
                        <div className="name">
                          {formatDay(t.entryDate)}
                          {t.entryGapPct ? ` · gap ${signed(t.entryGapPct, 1)}%` : ''}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num down">
                    {inr.format(t.stop)}
                    {t.stop !== t.initialStop && <div className="name">from {inr.format(t.initialStop)}</div>}
                  </td>
                  <td>
                    {t.exitDate ? (
                      <>
                        {inr.format(t.exitPrice!)}
                        <div className="name">
                          {formatDay(t.exitDate)} · {EXIT_LABEL[t.exitReason!]}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`num ${toneOf(result ?? 0)}`}>
                    {result === null ? '—' : rText(result)}
                    {t.status === 'active' && <div className="name">open</div>}
                  </td>
                  <td className="num">{t.barsHeld ?? (t.status === 'watch' || t.status === 'expired' ? '—' : 0)}</td>
                  <td className="num">{t.mfeR !== undefined ? rText(t.mfeR) : '—'}</td>
                  <td>{t.setup ?? '—'}</td>
                  <td>{t.regime}</td>
                </tr>
              )
            })}
            {trades.length === 0 && (
              <tr>
                <td colSpan={14} className="empty">
                  No tracked trades match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="meta performance-note">
        Rules: a signal is bought when a later day's high reaches the buy-above price (at the open if it gaps above). Swing
        signals expire after {rules.swing.watchDays} trading days, positional after {rules.positional.watchDays}. The stop
        moves to entry at +{rules.breakevenR}R; half is booked at +{rules.partialR}R and the rest trails the lowest low of the
        last {rules.swing.trailDays} days (swing) or {rules.positional.trailWeeks} weeks (positional). Swing trades exit after{' '}
        {rules.swing.timeStopDays} days below +1R or {rules.swing.maxHoldDays} days in total; positional trades after{' '}
        {rules.positional.timeStopDays} days below +1R or a weekly close below the {rules.positional.thesisSmaWeeks}-week SMA.
        Results ignore costs and slippage.
      </p>
    </>
  )
}
