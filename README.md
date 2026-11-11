# SAKHAVAT FOOTBALL PREDICTOR 1.0 — starter project

This is the first installable PWA + Capacitor Android project scaffold. It deliberately does not invent fixtures or prediction numbers. Live fixture retrieval is wired to API-Football through a small Node server; API keys stay on the server.

## Requirements
- Node.js 20+
- API-Football account/key: https://www.api-football.com/
- For Android APK: Android Studio + Android SDK + Java 17+

## Run locally
1. Copy `.env.example` to `.env` and set `API_FOOTBALL_KEY`.
2. Load environment variables in your shell (or use your preferred dotenv runner), then run `npm start`.
3. Open `http://localhost:8787`.

For example on macOS/Linux:
`export API_FOOTBALL_KEY='your-key'; npm start`

## Install as PWA
Deploy the site behind HTTPS. Open it in Chrome on Android → menu → Install app / Add to Home screen. Service worker caching is included.

## Build Android APK
1. `npm install`
2. `npx cap add android`
3. `npx cap sync android`
4. Open `android/` in Android Studio, configure the production API base URL and build a signed APK.

Important: the Android app needs a reachable HTTPS backend for live data. Do not embed provider API keys in the APK. Push notifications require a notification service (e.g. Firebase Cloud Messaging) and backend credentials; these are not enabled in this initial scaffold.

## Next implementation milestones
- Odds provider adapter + margin removal
- Elo + Poisson/Dixon-Coles probability engine and calibration
- xG provider integration where available
- Persisted, timestamp-frozen predictions and result grading
- Brier score, log loss, exact-score hit rate and historical-only ROI
- Firebase push notifications and scheduled refresh jobs

## Data integrity
No fabricated odds, xG, lineups, fixtures or results. If the provider is not configured or a field is unavailable, the UI reports the limitation.
