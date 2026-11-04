import { collection, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore'
import { initializeApp } from 'firebase/app'
import type { Range, ScreenerData, Trend } from './types'

const firebaseApp = initializeApp({
  apiKey: 'AIzaSyBKJ61XG7Kvi2k3ZGpETAUx6JZLgMvTl-g',
  authDomain: 'stock-identifier.firebaseapp.com',
  projectId: 'stock-identifier',
  storageBucket: 'stock-identifier.firebasestorage.app',
  messagingSenderId: '87955743631',
  appId: '1:87955743631:web:b31db0e13c6b38212361fa',
})
const db = getFirestore(firebaseApp)
const HISTORY_COLLECTION = 'weeklyHistory'
const MAX_WEEKS = 26

export type SavedList = { week: Range; savedAt: string; symbols: string[] }
export type History = Record<Trend, Record<string, SavedList>>

export const emptyHistory = (): History => ({ down: {}, up: {} })

export async function loadHistory(): Promise<History> {
  const result = emptyHistory()
  const snapshot = await getDocs(collection(db, HISTORY_COLLECTION))
  snapshot.docs
    .filter((item) => item.data().trend === 'down' || item.data().trend === 'up')
    .sort((a, b) => b.data().weekStart.localeCompare(a.data().weekStart))
    .slice(0, MAX_WEEKS * 2)
    .forEach((item) => {
    const saved = item.data() as SavedList & { trend: Trend; weekStart: string }
    result[saved.trend][saved.weekStart] = {
      week: saved.week,
      savedAt: saved.savedAt,
      symbols: saved.symbols,
    }
    })
  return result
}

export async function saveList(trend: Trend, data: ScreenerData): Promise<SavedList> {
  const week = data.weeks.lastWeek
  const saved = { week, savedAt: data.generatedAt, symbols: data.stocks.map((s) => s.symbol) }
  await setDoc(docRef(trend, week.start), { ...saved, trend, weekStart: week.start })
  return saved
}

function docRef(trend: Trend, weekStart: string) {
  return doc(db, HISTORY_COLLECTION, `${trend}_${weekStart}`)
}

export function previousList(history: History, trend: Trend, weekStart: string): SavedList | null {
  const earlier = Object.keys(history[trend]).filter((start) => start < weekStart).sort()
  return earlier.length ? history[trend][earlier[earlier.length - 1]] : null
}
