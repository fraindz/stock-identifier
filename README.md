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

## Top 10 bets

**Top 10 bets** is a fixed portfolio of up to 10 positional (1–3 month) trades,
stored in `public/top-10-portfolio.json`. The logic is in `scripts/top10.ts`
(pure functions, tested by `npm run test:top10`).

- **Weekly review** (the Saturday workflow run, or `npm run screen -- --review`):
  stocks with market cap of at least ₹5,000 Cr, a 20-day traded value of at least
  ₹10 Cr, a rising 30-week trend, a price within 25% of the 52-week high, and a
  weekly breakout, pullback or base setup are ranked by relative strength vs
  Nifty 50, sector breadth, trend quality and setup quality. The top 30 are written to
  `public/top-10-candidates.json`. Watch names that fall out of the top 40, fail the
  trend filter, or don't trigger within 2 reviews are dropped. Free slots are filled
  from the ranking, with at most 3 new names a week and 2 per sector.
- **Daily run** (Mon–Fri): updates the open slots only. A Watch name becomes Active
  when a day's high reaches its trigger. Its stop moves to breakeven at +1R, half is
  booked at +2R, and after that the stop trails the lowest low of the last 3 weeks.
  Exits happen on a stop hit, after 13 weeks below +1R, or on a weekly close below
  the 30-week SMA.

The scheduled workflow commits `public/*.json` back to the repository before
deploying.
