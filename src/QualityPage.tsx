import { Fragment, useMemo, useState } from 'react'
import { formatDay, inr, signed, toneOf } from './format'
import { StockCell } from './TableCells'
import { RegimeBanner } from './TradeParts'
import type { Grade, QualityData, QualityStock } from './types'

const GRADE_ACTIONS: Record<Grade, string> = {
  A: 'Detailed analysis and entry monitoring',
  B: 'Active watchlist',
  C: 'Developing candidate',
}

const SHORT_LABELS: Record<string, string> = {
  trend: 'Trend',
  rs: 'RS',
  sector: 'Sector',
  setup: 'Setup',
  volume: 'Volume',
  fundamentals: 'Fund.',
  riskReward: 'R/R',
}

type GradeFilter = Grade | 'all'

function ComponentCell({ points, max }: { points: number; max: number }) {
  const ratio = max ? points / max : 0
  return (
    <td className="num component-cell" title={`${points} of ${max}`}>
      {points.toFixed(1)}
      <span className="component-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(ratio * 100)}%` }} className={ratio >= 0.7 ? 'strong' : ratio >= 0.4 ? 'mid' : 'weak'} />
      </span>
    </td>
  )
}

export default function QualityPage({ data, title }: { data: QualityData; title: string }) {
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<GradeFilter>('all')
  const [sector, setSector] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const graded = data.stocks.filter((s) => s.grade)
  const counts = { A: 0, B: 0, C: 0 } as Record<Grade, number>
  for (const s of graded) counts[s.grade!]++
  const sectorNames = useMemo(() => [...new Set(data.stocks.map((s) => s.sector))].sort(), [data])
  const componentKeys = data.stocks[0]?.components.map((c) => c.key) ?? []
  const swing = data.mode === 'swing'

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.stocks.filter(
      (s: QualityStock) =>
        (showAll || s.grade) &&
        (grade === 'all' || s.grade === grade) &&
        (!sector || s.sector === sector) &&
        (!q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
    )
  }, [data, query, grade, sector, showAll])

  const topSectors = [...data.sectors].sort((a, b) => (swing ? b.rel20Pct - a.rel20Pct : b.rel65Pct - a.rel65Pct)).slice(0, 6)
  const { regime } = data
  const columns = 12 + componentKeys.length

  return (
    <>
      <header>
        <h1>{title}</h1>
        <p className="meta">
          <strong>{graded.length}</strong> graded of {data.scoredCount} stocks with market cap ≥ ₹{inr.format(data.minMarketCapCr ?? 1000)} Cr and
          20-day traded value ≥ ₹{inr.format(data.minTradedValueCr ?? 10)} Cr · A {counts.A} · B {counts.B} · C {counts.C} · data as of{' '}
          {formatDay(data.asOf)}
          {!data.deliveryAvailable && ' · delivery data unavailable today'}
        </p>
      </header>

      <RegimeBanner regime={regime} />

      <ul className="criteria" aria-label={`Strongest sectors vs Nifty, ${swing ? '20 days' : '13 weeks'}`}>
        <li className="criteria-title">Leading sectors ({swing ? '20D' : '13W'} vs Nifty)</li>
        {topSectors.map((s) => (
          <li key={s.name}>
            <span>{s.name}</span>
            <b className={toneOf(swing ? s.rel20Pct : s.rel65Pct)}>{signed(swing ? s.rel20Pct : s.rel65Pct, 1)}%</b> · {s.breadthPct.toFixed(0)}% breadth
          </li>
        ))}
      </ul>

      <div className="controls">
        <div className="chips" role="group" aria-label="Grade">
          {(['all', 'A', 'B', 'C'] as const).map((g) => (
            <button key={g} type="button" aria-pressed={grade === g} onClick={() => setGrade(g)} title={g === 'all' ? undefined : GRADE_ACTIONS[g]}>
              {g === 'all' ? 'All grades' : `${g} (${counts[g]})`}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search symbol or name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
          <option value="">All sectors</option>
          {sectorNames.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show below 60
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Stock</th>
              <th>Grade</th>
              <th className="num">Score</th>
              {componentKeys.map((key) => (
                <th key={key} className="num" title={data.stocks[0].components.find((c) => c.key === key)?.label}>
                  {SHORT_LABELS[key]} <span className="max">/{data.weights[key]}</span>
                </th>
              ))}
              <th>Setup</th>
              <th className="num">Buy above</th>
              <th className="num">Stop</th>
              <th className="num">Target</th>
              <th className="num">R:R</th>
              <th className="num">Delivery</th>
              <th className="num">Listed</th>
              <th>Sector</th>
              <th aria-label="Details" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const open = expanded === s.symbol
              return (
                <Fragment key={s.symbol}>
                  <tr className={open ? 'expanded' : undefined}>
                    <StockCell symbol={s.symbol} name={s.name} />
                    <td>
                      {s.grade ? <span className={`grade grade-${s.grade}`}>{s.grade}</span> : <span className="muted">—</span>}
                    </td>
                    <td className="num score">
                      {s.score.toFixed(1)}
                      {s.score !== s.rawScore && <div className="name">raw {s.rawScore.toFixed(1)}</div>}
                    </td>
                    {s.components.map((c) => (
                      <ComponentCell key={c.key} points={c.points} max={c.max} />
                    ))}
                    <td>
                      {s.setup ?? '—'}
                      {s.setupNote && <div className="name">{s.setupNote}</div>}
                    </td>
                    <td className="num up">
                      {inr.format(s.trigger)}
                      <div className="name">{signed(s.triggerGapPct, 1)}% away</div>
                    </td>
                    <td className="num down">
                      {inr.format(s.stop)}
                      <div className="name">{s.riskPct.toFixed(1)}% risk</div>
                    </td>
                    <td className="num">{inr.format(s.target)}</td>
                    <td className="num">{s.rr.toFixed(1)}R</td>
                    <td className="num">{s.deliveryPct === null ? 'n/a' : `${s.deliveryPct.toFixed(0)}%`}</td>
                    <td className="num">
                      {s.grade ? (s.daysListed <= 1 ? <span className="new-tag">New</span> : `${s.daysListed}d`) : '—'}
                      {s.grade && s.daysListed > 1 && <div className="name">since {formatDay(s.firstSeen)}</div>}
                    </td>
                    <td>{s.sector}</td>
                    <td>
                      <button type="button" className="link-button" aria-expanded={open} onClick={() => setExpanded(open ? null : s.symbol)}>
                        {open ? 'Hide' : 'Why'}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="details-row">
                      <td colSpan={columns}>
                        <ul className="component-notes">
                          {s.components.map((c) => (
                            <li key={c.key}>
                              <strong>
                                {c.label} {c.points.toFixed(1)}/{c.max}
                              </strong>{' '}
                              {c.note}
                            </li>
                          ))}
                          {s.fundamentalsCoverage < 1 && (
                            <li className="muted">Fundamentals: partial data ({Math.round(s.fundamentalsCoverage * 100)}% of fields), missing fields scored neutral.</li>
                          )}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns} className="empty">
                  No stocks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="meta performance-note">
        Score out of 100 on absolute thresholds:{' '}
        {componentKeys.map((key, i) => `${i ? ', ' : ''}${data.stocks[0].components[i].label.toLowerCase()} ${data.weights[key]}`).join('')}.
        Relative strength compares the stock with Nifty 50 (two-thirds) and its equal-weight sector index (one-third). In a Caution market every score loses 5
        points; in a Risk-off market scores are capped at 79. A 80+ = {GRADE_ACTIONS.A.toLowerCase()}; B 70–79 = {GRADE_ACTIONS.B.toLowerCase()}; C 60–69 ={' '}
        {GRADE_ACTIONS.C.toLowerCase()}. {swing ? 'Swing levels use daily bars: buy above the latest high, stop at the setup low or 1.5 daily ATR.' : 'Positional levels use weekly bars: buy above last week’s high, stop at the setup low or 2 weekly ATR.'}{' '}
        Target is the 52-week high + 1% or 3R, whichever is nearer.
      </p>
    </>
  )
}
