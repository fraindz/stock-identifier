So, to update both the hosted data and Firestore history:

npm run screen
npm run build
npx firebase-tools deploy --only hosting --project stock-identifier

To enable Google Analytics 4, set `VITE_GA_MEASUREMENT_ID` to the property's
measurement ID before building and deploying:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX npm run build
npx firebase-tools deploy --only hosting --project stock-identifier
```

Analytics is disabled when the variable is not set. Tab navigation is tracked
as a page view using the hash route.
