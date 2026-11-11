# SAKHAVAT FOOTBALL PREDICTOR 1.0

Starter project for a football fixtures and prediction app. This is not yet a finished prediction engine or a built APK.

## Run locally
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Set `API_FOOTBALL_KEY` in your environment (never commit the real key).
4. Run `npm start`.

## Deploy
Use the repository root as the Render service root, build command `npm install`, start command `npm start`. Add `API_FOOTBALL_KEY` in Render Environment settings.

## Current endpoints
- `/api/status`
- `/api/fixtures?date=YYYY-MM-DD`
- `/api/standings?league=39&season=2026`

Live data requires a valid API-Football key. The current interface is a starter scaffold; advanced prediction models, push notifications and APK packaging still need implementation.
