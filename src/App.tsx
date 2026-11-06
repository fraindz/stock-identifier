import { useCallback, useEffect, useState } from 'react'
import BreakoutPage from './BreakoutPage'
import PullbackPage from './PullbackPage'
import SectorPage from './SectorPage'
import ScreenerPage from './ScreenerPage'
import { emptyHistory, loadHistory, previousList, saveList, type History } from './history'
import type { BreakoutData, PullbackData, ScreenerData, SectorData, Trend } from './types'
import './App.css'

type Page =
  | { path: string; label: string; kind: 'trend'; trend: Trend; repeat: boolean }
  | { path: string; label: string; kind: 'breakout' }
  | { path: string; label: string; kind: 'pullback' }
  | { path: string; label: string; kind: 'sectors' }

const PAGES: Page[] = [
  { path: '#/downtrend', label: 'Downtrend', kind: 'trend', trend: 'down', repeat: false },
  { path: '#/uptrend', label: 'Uptrend', kind: 'trend', trend: 'up', repeat: false },
  { path: '#/still-downtrend', label: 'Still in downtrend', kind: 'trend', trend: 'down', repeat: true },
  { path: '#/still-uptrend', label: 'Still in uptrend', kind: 'trend', trend: 'up', repeat: true },
  { path: '#/breakout', label: 'Breakout', kind: 'breakout' },
  { path: '#/pullback', label: 'Pullback', kind: 'pullback' },
  { path: '#/sectors', label: 'Growing sectors', kind: 'sectors' },
]
const HIDDEN_PATHS = new Set(['#/still-downtrend', '#/still-uptrend'])

const pageFromHash = (): Page => PAGES.find((p) => p.path === window.location.hash) ?? PAGES[0]

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${path}?refresh=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [lists, setLists] = useState<Record<Trend, ScreenerData> | null>(null)
  const [breakouts, setBreakouts] = useState<BreakoutData | null>(null)
  const [pullbacks, setPullbacks] = useState<PullbackData | null>(null)
  const [sectors, setSectors] = useState<SectorData | null>(null)
  const [history, setHistory] = useState<History>(emptyHistory)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(true)

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Both lists are loaded and saved on every visit, so a week is recorded
  // whichever tab is opened.
  const loadData = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [down, up, breakout, pullback, sectorData] = await Promise.all([
        fetchJson<ScreenerData>('/downtrend.json'),
        fetchJson<ScreenerData>('/uptrend.json'),
        fetchJson<BreakoutData>('/breakout.json'),
        fetchJson<PullbackData>('/pullback.json'),
        fetchJson<SectorData>('/sectors.json'),
      ])
      await Promise.all([saveList('down', down), saveList('up', up)])
      const loadedHistory = await loadHistory()
      setHistory(loadedHistory)
      setLists({ down, up })
      setBreakouts(breakout)
      setPullbacks(pullback)
      setSectors(sectorData)
    } catch {
      setError('No screener data found. Run `npm run screen` to generate it.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const refreshData = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const response = await fetch('/api/refresh', { method: 'POST' })
      if (!response.ok) {
        throw new Error('Refresh failed')
      }
      await loadData()
    } catch {
      setError('Could not refresh market data. Make sure the local screen server is running.')
      setRefreshing(false)
    }
  }, [loadData])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const content = (() => {
    if (page.kind === 'breakout') {
      return breakouts && <BreakoutPage data={breakouts} onRefresh={refreshData} refreshing={refreshing} />
    }
    if (page.kind === 'pullback') {
      return pullbacks && <PullbackPage data={pullbacks} onRefresh={refreshData} refreshing={refreshing} />
    }
    if (page.kind === 'sectors') {
      return sectors && <SectorPage data={sectors} onRefresh={refreshData} refreshing={refreshing} />
    }
    const data = lists?.[page.trend]
    return (
      data && (
        <ScreenerPage
          key={page.path}
          trend={page.trend}
          data={data}
          onRefresh={refreshData}
          refreshing={refreshing}
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
