import { useCallback, useEffect, useState } from 'react'
import { trackPageView } from './analytics'
import BreakoutPage from './BreakoutPage'
import PullbackPage from './PullbackPage'
import SectorPage from './SectorPage'
import ScreenerPage from './ScreenerPage'
import SwingPage from './SwingPage'
import TopTenDashboard from './TopTenDashboard'
import CandidatesPage from './CandidatesPage'
import { emptyHistory, loadHistory, previousList, saveList, type History } from './history'
import type { BreakoutData, CandidatesData, Portfolio, PullbackData, ScreenerData, SectorData, SwingData, Trend } from './types'
import './App.css'

type Page =
  | { path: string; label: string; kind: 'trend'; trend: Trend; repeat: boolean }
  | { path: string; label: string; kind: 'breakout' }
  | { path: string; label: string; kind: 'pullback' }
  | { path: string; label: string; kind: 'sectors' }
  | { path: string; label: string; kind: 'swing'; file: string; title: string; limit?: number; showLevelPercent?: boolean }
  | { path: string; label: string; kind: 'portfolio' }
  | { path: string; label: string; kind: 'candidates' }

const PAGES: Page[] = [
  { path: '#/downtrend', label: 'Downtrend', kind: 'trend', trend: 'down', repeat: false },
  { path: '#/uptrend', label: 'Uptrend', kind: 'trend', trend: 'up', repeat: false },
  { path: '#/still-downtrend', label: 'Still in downtrend', kind: 'trend', trend: 'down', repeat: true },
  { path: '#/still-uptrend', label: 'Still in uptrend', kind: 'trend', trend: 'up', repeat: true },
  { path: '#/breakout', label: 'Breakout', kind: 'breakout' },
  { path: '#/pullback', label: 'Pullback', kind: 'pullback' },
  { path: '#/sectors', label: 'Growing sectors', kind: 'sectors' },
  { path: '#/momentum', label: 'Momentum', kind: 'swing', file: 'momentum', title: 'Momentum' },
  { path: '#/healthy-pullbacks', label: 'Healthy pullbacks', kind: 'swing', file: 'healthy-pullbacks', title: 'Healthy pullbacks' },
  { path: '#/breakout-watchlist', label: 'Breakout watchlist', kind: 'swing', file: 'breakout-watchlist', title: 'Breakout watchlist' },
  { path: '#/volume-surge', label: 'Volume surge', kind: 'swing', file: 'volume-surge', title: 'Volume surge' },
  { path: '#/trade-plan', label: 'Trade plan', kind: 'swing', file: 'trade-plan', title: 'Trade plan' },
  { path: '#/top-10-bets', label: 'Top 10 bets', kind: 'portfolio' },
  { path: '#/top-10-candidates', label: 'Top 10 candidates', kind: 'candidates' },
]
const HIDDEN_PATHS = new Set([
  '#/downtrend',
  '#/uptrend',
  '#/breakout',
  '#/pullback',
  '#/sectors',
  '#/still-downtrend',
  '#/still-uptrend',
])

const pageFromHash = (): Page => {
  const hash = window.location.hash === '#/top-bets' ? '#/top-10-bets' : window.location.hash
  return PAGES.find((p) => p.path === hash) ?? PAGES[0]
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${path}?refresh=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

// Files that may not exist yet (before the first Top 10 review) shouldn't break the page.
const fetchOptional = <T,>(path: string) => fetchJson<T>(path).catch(() => null)

function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [lists, setLists] = useState<Record<Trend, ScreenerData> | null>(null)
  const [breakouts, setBreakouts] = useState<BreakoutData | null>(null)
  const [pullbacks, setPullbacks] = useState<PullbackData | null>(null)
  const [sectors, setSectors] = useState<SectorData | null>(null)
  const [swingData, setSwingData] = useState<Record<string, SwingData>>({})
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [candidates, setCandidates] = useState<CandidatesData | null>(null)
  const [topTenLoaded, setTopTenLoaded] = useState(false)
  const [history, setHistory] = useState<History>(emptyHistory)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    trackPageView(window.location.hash || '#/downtrend')
  }, [page])

  // Both lists are loaded and saved on every visit, so a week is recorded
  // whichever tab is opened.
  const loadData = useCallback(async () => {
    setError(null)
    try {
      const swingPages = PAGES.filter((p): p is Extract<Page, { kind: 'swing' }> => p.kind === 'swing')
      const [down, up, breakout, pullback, sectorData, portfolioData, candidatesData, ...allSwingData] = await Promise.all([
        fetchJson<ScreenerData>('/downtrend.json'),
        fetchJson<ScreenerData>('/uptrend.json'),
        fetchJson<BreakoutData>('/breakout.json'),
        fetchJson<PullbackData>('/pullback.json'),
        fetchJson<SectorData>('/sectors.json'),
        fetchOptional<Portfolio>('/top-10-portfolio.json'),
        fetchOptional<CandidatesData>('/top-10-candidates.json'),
        ...swingPages.map((p) => fetchJson<SwingData>(`/${p.file}.json`)),
      ])
      await Promise.all([saveList('down', down), saveList('up', up)])
      const loadedHistory = await loadHistory()
      setHistory(loadedHistory)
      setLists({ down, up })
      setBreakouts(breakout)
      setPullbacks(pullback)
      setSectors(sectorData)
      setPortfolio(portfolioData)
      setCandidates(candidatesData)
      setTopTenLoaded(true)
      setSwingData(Object.fromEntries(swingPages.map((p, index) => [p.path, allSwingData[index]])))
    } catch {
      setError('Could not load market data. Please try again later.')
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const content = (() => {
    if (page.kind === 'breakout') {
      return breakouts && <BreakoutPage data={breakouts} />
    }
    if (page.kind === 'pullback') {
      return pullbacks && <PullbackPage data={pullbacks} />
    }
    if (page.kind === 'sectors') {
      return sectors && <SectorPage data={sectors} />
    }
    if (page.kind === 'portfolio' || page.kind === 'candidates') {
      if (!topTenLoaded) return null
      if (page.kind === 'candidates') {
        return candidates ? <CandidatesPage data={candidates} portfolio={portfolio} /> : <p className="notice">No candidates yet: they are generated at the weekly review.</p>
      }
      if (!portfolio) return <p className="notice">The Top 10 portfolio hasn’t been created yet.</p>
      return <TopTenDashboard data={portfolio} />
    }
    if (page.kind === 'swing') {
      const data = swingData[page.path]
      return data && <SwingPage data={data} title={page.title} limit={page.limit} showLevelPercent={page.showLevelPercent} />
    }
    const data = lists?.[page.trend]
    return (
      data && (
        <ScreenerPage
          key={page.path}
          trend={page.trend}
          data={data}
          previous={page.repeat ? previousList(history, page.trend, data.weeks.lastWeek.start) : undefined}
        />
      )
    )
  })()

  return (
    <main className="page">
      <nav className="tabs">
        {PAGES.filter((p) => !HIDDEN_PATHS.has(p.path)).map((p) => (
          <a key={p.path} href={p.path} aria-current={p === page ? 'page' : undefined}>
            {p.label}
          </a>
        ))}
      </nav>
      {error ? (
        <p className="notice">{error}</p>
      ) : (
        (content ?? <p className="notice">Loading…</p>)
      )}
    </main>
  )
}

export default App
