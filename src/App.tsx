import { useEffect, useState } from 'react'
import BreakoutPage from './BreakoutPage'
import PullbackPage from './PullbackPage'
import ScreenerPage from './ScreenerPage'
import { loadHistory, previousList, saveList, type History } from './history'
import type { BreakoutData, PullbackData, ScreenerData, Trend } from './types'
import './App.css'

type Page =
  | { path: string; label: string; kind: 'trend'; trend: Trend; repeat: boolean }
  | { path: string; label: string; kind: 'breakout' }
  | { path: string; label: string; kind: 'pullback' }

const PAGES: Page[] = [
  { path: '#/downtrend', label: 'Downtrend', kind: 'trend', trend: 'down', repeat: false },
  { path: '#/uptrend', label: 'Uptrend', kind: 'trend', trend: 'up', repeat: false },
  { path: '#/still-downtrend', label: 'Still in downtrend', kind: 'trend', trend: 'down', repeat: true },
  { path: '#/still-uptrend', label: 'Still in uptrend', kind: 'trend', trend: 'up', repeat: true },
  { path: '#/breakout', label: 'Breakout', kind: 'breakout' },
  { path: '#/pullback', label: 'Pullback', kind: 'pullback' },
]

const pageFromHash = (): Page => PAGES.find((p) => p.path === window.location.hash) ?? PAGES[0]

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [lists, setLists] = useState<Record<Trend, ScreenerData> | null>(null)
  const [breakouts, setBreakouts] = useState<BreakoutData | null>(null)
  const [pullbacks, setPullbacks] = useState<PullbackData | null>(null)
  const [history, setHistory] = useState<History>(loadHistory)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Both lists are loaded and saved on every visit, so a week is recorded
  // whichever tab is opened.
  useEffect(() => {
    Promise.all([
      fetchJson<ScreenerData>('/downtrend.json'),
      fetchJson<ScreenerData>('/uptrend.json'),
      fetchJson<BreakoutData>('/breakout.json'),
      fetchJson<PullbackData>('/pullback.json'),
    ])
      .then(([down, up, breakout, pullback]) => {
        setHistory((h) => saveList(saveList(h, 'down', down), 'up', up))
        setLists({ down, up })
        setBreakouts(breakout)
        setPullbacks(pullback)
      })
      .catch(() => setError('No screener data found. Run `npm run screen` to generate it.'))
  }, [])

  const content = (() => {
    if (page.kind === 'breakout') return breakouts && <BreakoutPage data={breakouts} />
    if (page.kind === 'pullback') return pullbacks && <PullbackPage data={pullbacks} />
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
        {PAGES.map((p) => (
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
