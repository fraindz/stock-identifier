// Weekly screener lists saved in this browser's localStorage, so a later week's
// scan can be compared with earlier ones.
import type { Range, ScreenerData, Trend } from './types'

const STORAGE_KEY = 'weekly-trend-screener:history'
const MAX_WEEKS = 26

export type SavedList = { week: Range; savedAt: string; symbols: string[] }

// Saved lists per trend, keyed by the start date of the completed week they cover.
export type History = Record<Trend, Record<string, SavedList>>

export function loadHistory(): History {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as History | null
    return { down: parsed?.down ?? {}, up: parsed?.up ?? {} }
  } catch {
    return { down: {}, up: {} }
  }
}

// Saves this scan's list (replacing any earlier save for the same week) and returns
// the updated history. The history is still returned if storage is unavailable.
export function saveList(history: History, trend: Trend, data: ScreenerData): History {
  const week = data.weeks.lastWeek
  const lists = {
    ...history[trend],
    [week.start]: { week, savedAt: data.generatedAt, symbols: data.stocks.map((s) => s.symbol) },
  }
  const kept = Object.fromEntries(
    Object.entries(lists).sort(([a], [b]) => b.localeCompare(a)).slice(0, MAX_WEEKS),
  )
  const next = { ...history, [trend]: kept }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode or storage full: comparisons work for this session only.
  }
  return next
}

// The most recent saved list for a week before `weekStart`.
export function previousList(history: History, trend: Trend, weekStart: string): SavedList | null {
  const earlier = Object.keys(history[trend]).filter((start) => start < weekStart).sort()
  return earlier.length ? history[trend][earlier[earlier.length - 1]] : null
}
