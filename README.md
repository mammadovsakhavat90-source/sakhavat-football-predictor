# SAKHAVAT FOOTBALL PREDICTOR 1.0

Azerbaijani football analytics PWA and Android wrapper. The application uses Footballdata.io for fixtures and available team/match statistics. It does not guarantee outcomes and suppresses final recommendations when required evidence is missing.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Set `FOOTBALLDATA_API_KEY` in the environment. Never commit the real key.
4. Run `npm start`.
5. Run the validation tests with `npm test`.

## Render

Use the repository root as the service root, build command `npm install`, and start command `npm start`. Configure `FOOTBALLDATA_API_KEY` in Render environment settings.

## Supported competitions (fixed allowlist)

- La Liga (10)
- Premier League (15)
- UEFA Champions League (45)
- UEFA Europa League (46)
- FIFA World Cup (50)

The backend rejects other competition IDs and filters fixture responses to this allowlist.

## API

- `/api/status`
- `/api/fixtures?date=YYYY-MM-DD`
- `/api/fixtures?date=YYYY-MM-DD&league_id=15`
- `/api/teams/:id/stats?season_id=&league_id=`
- `/api/matches/:id`
- `/api/matches/:id/odds`
- `/api/matches/:id/probabilities`
- `/api/consensus?date=YYYY-MM-DD`
- `/api/results?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/predict` for supplied, verified statistics

## Current model and evidence rules

- Fixture-card forecasts use available pre-match xG, same-competition/season team xG where available, and a Poisson score baseline. The uncalibrated Dixon-Coles adjustment is deliberately disabled (rho=0).
- Forecast probabilities are not yet empirically calibrated; treat them as model estimates, not measured guarantees. Dixon-Coles rho remains neutral until it can be estimated from a verified historical sample.
- Elo is disabled for automatic fixture forecasts until a verified ratings feed is connected.
- Team form is displayed as context; it is not currently a separately weighted model input.
- Injuries, suspensions, expected lineups and verified squad news are not integrated.
- The high-confidence shortlist requires both team-stat records, model probability threshold, matching external-source consensus and bookmaker market confirmation. It is intentionally possible for the shortlist to be empty.
- Riskier/high-odds candidates are separated from the high-confidence shortlist and are not described as safe picks.
- Footballdata.io supplies fixtures/statistics/odds and is never counted as a consensus vote.
- External consensus uses KiqIQ and Football Analytics only when both feeds pass server-side schema/freshness checks and the same fixture matches by supported competition, team names and kickoff (within 30 minutes). KiqIQ must have a generated_at timestamp no older than 30 minutes; Football Analytics no older than six hours and its pick must be published before kickoff. Stale-cache fallbacks never vote. This checks two separate third-party feeds; it does not prove statistically independent underlying data.

## Caching and PWA

- The free Footballdata.io tier has a monthly request allowance, so the backend caches fixtures, team statistics, match details, odds, results and external feeds in process memory. Team statistics use a longer cache window; odds and live fixture data use shorter windows. Expired cached data may be used only as a fallback when an upstream request fails. The provider documents a 1,000-request free allowance; monitor actual account usage.
- Cache contents are instance-local and are cleared when the Render process restarts. A persistent shared cache/database is not configured.
- The service worker caches the static app shell for offline opening. API responses and match data still require an internet connection.
- Scheduled fixture refresh is slower than live-match refresh to reduce free-plan API usage.

## Forecast history and audit limitations

- The browser stores the first available pre-kickoff forecast in localStorage and does not overwrite it with later forecasts. Due forecasts are checked against completed provider results at app startup and about once an hour while the app remains open.
- While the app is open, it checks saved, due fixtures once per hour through the cached bulk results endpoint, then scores verified completed results and calculates 1-X-2 hit rate, exact-score hit rate, Brier score and log loss. It does not run unattended while the app is closed and does not sync history to a cloud database.
- History is local to the browser/device. There is no central database, cross-device sync or guaranteed unattended background audit yet. Export the JSON backup periodically.
- Push notifications are not configured.
- The Android workflow builds a debug APK for testing. It is not a Play Store-signed production release.
- The Capacitor shell loads the hosted Render website, so the Android app requires internet access for live data and a healthy Render service.

## Android build

GitHub Actions runs the `Android APK` workflow on relevant pushes. The generated artifact is a debug APK retained for 30 days. A signed release requires a private signing key and release configuration; do not store signing secrets in source control.
