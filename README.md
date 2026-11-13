So, to update both the hosted data and Firestore history:

npm run screen
npm run build
npx firebase-tools deploy --only hosting --project stock-identifier

The scanner also generates daily swing-trading screens for Momentum, Healthy
Pullbacks, Breakout Watchlist, Volume Surge, and Trade Plan. These use daily
EMA, RSI, volume-ratio, 20-day-high, and ATR-based calculations.

To enable Google Analytics 4, set `VITE_GA_MEASUREMENT_ID` to the property's
measurement ID before building and deploying:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX npm run build
npx firebase-tools deploy --only hosting --project stock-identifier
```

Analytics is disabled when the variable is not set. Tab navigation is tracked
as a page view using the hash route.

## Automatic hosted data updates

The GitHub Actions workflow at
`.github/workflows/update-market-data.yml` runs at 16:45 IST on weekdays,
after the NSE trading session. It generates fresh market data, builds the
static site, and deploys the result to Firebase Hosting. It can also be run
manually from the repository's Actions page.

Add these GitHub repository secrets before enabling the workflow:

- `FIREBASE_SERVICE_ACCOUNT`: Firebase service-account JSON with permission to
  deploy Hosting for the `stock-identifier` project.
- `VITE_GA_MEASUREMENT_ID`: Optional GA4 measurement ID.

## Top 10 outcome tracking

The scanner records each day's top 10 Trade Plan ideas in
`public/top-10-performance.json`, including the suggestion date, entry, stop,
and target. Subsequent daily candles are checked until the stop or target is
reached. If neither level is reached within four calendar months, the idea is
closed as expired on the last trading date up to its expiry. If both stop and
target are within a single day's range, the idea is conservatively recorded as
a stop loss because daily candles do not reveal which level traded first.

The scheduled workflow commits this ledger back to the repository before
deploying, preserving its history across daily runs. The **Top 10 results**
tab shows target, stop-loss, expired, and open counts, plus the full list of
tracked ideas and their suggestion and close dates. Trade Plan scores are a ranking
heuristic, not a statistically calibrated probability.
