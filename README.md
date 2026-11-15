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
  stocks with market cap of at least ₹1,000 Cr, a 20-day traded value of at least
  ₹10 Cr, a rising 30-week trend, a price within 25% of the 52-week high, and a
  weekly breakout, pullback or base setup are ranked by relative strength vs
  Nifty 50, sector breadth, trend quality and setup quality. The top 30 are written to
  `public/top-10-candidates.json`. Watch names that fall out of the top 40, fail the
  trend filter, or don't trigger within 2 reviews are dropped. Free slots are filled
  from the top 40 by **confidence**: 50% ranking score, 25% stop tightness (risk of 4%
  or less scores full, 12% scores zero) and 25% closeness of the latest close to the
  buy-above price (8% or more away scores zero). When all 10 slots are taken, a
  candidate whose confidence is at least 10 points higher replaces the weakest Watch
  name. At most 3 names are added a week, with at most 2 per sector.
- **Daily run** (Mon–Fri): updates the open slots only. A Watch name becomes Active
  when a day's high reaches its trigger. Its stop moves to breakeven at +1R, half is
  booked at +2R, and after that the stop trails the lowest low of the last 3 weeks.
  Exits happen on a stop hit, after 13 weeks below +1R, or on a weekly close below
  the 30-week SMA.

The scheduled workflow commits `public/*.json` back to the repository before
deploying.

## Rolling swing and Positional tabs

**Rolling swing** (days to ~3 weeks) and **Positional** (1–3 months) score every liquid stock on an
absolute 100-point quality score. The stocks must have a market cap of at least ₹1,000 Cr, a 20-day
traded value of at least ₹10 Cr, and a bar on the latest session. The logic is in `scripts/quality.ts`
(pure functions, tested by `npm run test:quality`), and the results are written to
`public/rolling-swing.json` and `public/positional.json` on every run.

| Component | Swing | Positional | Measures |
|---|---|---|---|
| Trend strength | 20 | 20 | Daily 20/50 EMA and 200-DMA alignment, weekly 10w/30w SMA alignment (swing weighs daily 70%, positional weekly 70%) |
| Relative strength | 15 | 15 | Return vs Nifty 50 (⅔) and vs the stock's equal-weight sector index (⅓); 20/60 days or 13/26 weeks |
| Sector strength | 10 | 10 | Sector index vs Nifty, % of sector above its 50-DMA, sector index above its 50-DMA |
| Setup quality | 25 | 15 | Swing: 20-day-high breakout, tight consolidation or pullback to the 20 EMA. Positional: weekly breakout, pullback or base |
| Volume confirmation | 15 | 10 | Up-day/up-week relative volume, up/down volume ratio, delivery % vs its 60-day average when available |
| Fundamental health | 5 | 15 | Sales and earnings growth, ROE, operating margin, debt/equity (not scored for financials); missing fields score neutral |
| Risk/reward | 10 | 15 | Stop distance, distance to the buy-above price, and R to the target (52-week high or 3R, whichever is nearer) |

Grades: **A** 80+ (detailed analysis and entry monitoring), **B** 70–79 (active watchlist), **C** 60–69
(developing candidate). The **market regime** is based on Nifty against its 50/200-DMA and on universe
breadth:

- **Risk-on**: scores are unchanged.
- **Caution**: every score loses 5 points.
- **Risk-off**: scores are capped at 79, so no stock gets an A.

Delivery % comes from NSE's daily bhavcopy (`sec_bhavdata_full`), cached in `.cache/bhav/`. If NSE
can't be reached, volume is scored on relative volume only. Thresholds and weights are in
`QUALITY_RULES`.
