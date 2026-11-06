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

The `Refresh` button in local development regenerates data through the Vite
server. On the deployed static site, it reloads the latest files from Hosting;
the scheduled workflow is what generates and publishes new data.
