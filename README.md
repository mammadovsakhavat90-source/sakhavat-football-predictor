# SAKHAVAT FOOTBALL PREDICTOR 1.0

Football fixtures dashboard backed by Footballdata.io.

## Run locally
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Set `FOOTBALLDATA_API_KEY` in your environment. Never commit the real key.
4. Run `npm start`.

## Render deployment
Use the repository root as the service root, build command `npm install`, and start command `npm start`. Add `FOOTBALLDATA_API_KEY` in the Render environment settings.

## API
- `/api/status`
- `/api/fixtures?date=YYYY-MM-DD`
- Optional league filter: `/api/fixtures?date=YYYY-MM-DD&league_id=15`

## Current scope
The live fixture dashboard, league/date filtering, Baku-time display, five-minute refresh, and PWA manifest are present. A Poisson + Dixon-Coles + Elo calculation engine is available at POST /api/predict. It requires real, verified team attack/defence rates, league goal averages, and optionally Elo/xG inputs. The fixture provider currently does not supply those historical team metrics through the configured fixtures endpoint, so automatic fixture predictions remain disabled. Verified global forecast consensus, FINAL VERDICT integration, prediction audit/history storage, push notifications, and Android APK are not implemented yet. The interface labels these as planned rather than presenting fabricated predictions. Provider coverage depends on its plan and supported competitions.
