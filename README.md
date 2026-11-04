So, to update both the hosted data and Firestore history:

npm run screen
npm run build
npx firebase-tools deploy --only hosting --project stock-identifier
