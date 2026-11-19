// Run after `npm run screen`, before committing and deploying. Fails (exit 1) when the
// freshly generated data is older than what is already committed, or when the Nifty-based
// screens lag the stock-based ones. Yahoo sometimes serves day-old bars (seen on runs that
// start after midnight IST), and publishing those would roll the site back a day.
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'

// asOf comes from the latest stock bar here...
const STOCK_DATED = 'momentum.json'
// ...and from the latest ^NSEI bar here.
const NIFTY_DATED = ['positional.json', 'rolling-swing.json', 'hotlist.json', 'grade-tracker.json']

const asOf = (json: string): string | undefined => {
  const value = JSON.parse(json)?.asOf
  return typeof value === 'string' ? value : undefined
}

const committed = (file: string): string | undefined => {
  try {
    return asOf(execFileSync('git', ['show', `HEAD:public/${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    return undefined // new file, nothing to compare against
  }
}

const problems: string[] = []
const fresh = new Map<string, string>()

for (const file of (await readdir('public')).filter((f) => f.endsWith('.json'))) {
  const now = asOf(await readFile(`public/${file}`, 'utf8'))
  if (!now) continue
  fresh.set(file, now)
  const before = committed(file)
  if (before && now < before) problems.push(`${file}: asOf ${now} is older than committed ${before}`)
}

const stockDate = fresh.get(STOCK_DATED)
for (const file of NIFTY_DATED) {
  const date = fresh.get(file)
  if (stockDate && date && date < stockDate) {
    problems.push(`${file}: asOf ${date} lags stock data (${stockDate}); Yahoo has not published the latest ^NSEI bar yet`)
  }
}

if (problems.length) {
  console.error('Not publishing stale data:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(`Data is fresh: ${[...new Set(fresh.values())].sort().join(', ')}`)
