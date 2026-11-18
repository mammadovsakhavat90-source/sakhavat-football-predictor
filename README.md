# SAKHAVAT FOOTBALL PREDICTOR 1.0

Football fixtures and pre-match analysis dashboard backed by Footballdata.io.

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
- `/api/teams/:id/stats?season_id=&league_id=`
- `/api/matches/:match_id`
- `/api/matches/:match_id/odds`
- `/api/matches/:match_id/probabilities`
- `POST /api/predict` for supplied, verified team and league statistics

## Current implementation
- Live fixture list, league/date filtering, Baku-time display, five-minute refresh, and PWA manifest.
- Fixture-card SAKHAVAT MODEL: available prematch xG blended with same-league/season team xG, then Poisson + Dixon-Coles 1-X-2 and scoreline probabilities.
- Elo calculation is available in the separate prediction API when verified Elo inputs are supplied; Elo ratings are not yet automatically connected to fixture-card predictions.
- GLOBAL CONSENSUS checks three independent data feeds when the same fixture can be matched reliably: Footballdata.io provider probabilities, KiqIQ public model probabilities, and Football Analytics public pre-match picks. Missing sources are not invented. KiqIQ endpoint documentation: https://kiqiq.com/api. Football Analytics data and attribution: https://footballanalytics.pro/data (CC BY 4.0).
- FINAL VERDICT compares SAKHAVAT MODEL with bookmaker 1-X-2 odds after removing the overround, only when all three odds are available.
- Odds, xG, provider probabilities, and external predictions depend on competition coverage and provider availability. No missing values are fabricated.
- Prediction audit/history: the browser records the first available pre-kickoff model forecast for each fixture, then evaluates it when a completed score is loaded. It calculates 1-X-2 hit rate, exact-score hit rate, multiclass Brier score, and log loss. This first version stores history in the current browser's localStorage only; it is not a shared server database and can be lost if browser site data is cleared.
- Push notifications and Android APK packaging are not implemented yet.
