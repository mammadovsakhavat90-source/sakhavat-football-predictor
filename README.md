# SAKHAVAT FOOTBALL PREDICTOR 1.0

Azerbaijani football analytics PWA and Android wrapper. The application uses Footballdata.io for fixtures and available team/match statistics. It does not guarantee outcomes and suppresses final recommendations when required evidence is missing.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Set `FOOTBALLDATA_API_KEY` in the environment. Never commit the real key.
4. Run `npm start`.

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

- Fixture-card forecasts use available pre-match xG, same-competition/season team xG where available, Poisson score probabilities, and a Dixon-Coles low-score adjustment.
- The Dixon-Coles rho used by the fixture-card implementation is a fixed heuristic, not a parameter fitted from a verified historical dataset. Forecast probabilities are not yet empirically calibrated; treat them as model estimates, not measured guarantees.
- Elo is disabled for automatic fixture forecasts until a verified ratings feed is connected.
- Team form is displayed as context; it is not currently a separately weighted model input.
- Injuries, suspensions, expected lineups and verified squad news are not integrated.
- The high-confidence shortlist requires both team-stat records, model probability threshold, matching external-source consensus and bookmaker market confirmation. It is intentionally possible for the shortlist to be empty.
- Riskier/high-odds candidates are separated from the high-confidence shortlist and are not described as safe picks.
- Footballdata.io supplies fixtures/statistics/odds and is never counted as a consensus vote.
- External consensus uses KiqIQ and Football Analytics only when both feeds return valid, fresh data and the same fixture can be matched by team names and kickoff. KiqIQ must provide a fresh feed-level generated/published timestamp; missing or stale timestamps suppress consensus. This is a two-source agreement check, not proof that the providers' underlying methodologies are statistically independent.

## Caching and PWA

- The free Footballdata.io tier has a monthly request allowance, so the backend caches fixtures, team statistics, match details, odds, results and external feeds in process memory. Team statistics use a longer cache window; odds and live fixture data use shorter windows. Expired cached data may be used only as a fallback when an upstream request fails. The provider documents a 1,000-request free allowance; monitor actual account usage.
- Cache contents are instance-local and are cleared when the Render process restarts. A persistent shared cache/database is not configured.
- The service worker caches only the static app shell for offline opening. API responses and match data are never cached for offline use.
- Scheduled fixture refresh is slower than live-match refresh to reduce free-plan API usage.

## Forecast history and audit limitations

- The browser stores the first available pre-kickoff forecast in localStorage and does not overwrite it with later forecasts.
- While the app is open, it checks saved, due fixtures once per hour through the cached bulk results endpoint, then scores verified completed results and calculates 1-X-2 hit rate, exact-score hit rate, Brier score and log loss. It does not run unattended while the app is closed.
- History is local to the browser/device. There is no central database, cross-device sync or guaranteed unattended background audit yet. Export the JSON backup periodically.
- Push notifications are not configured.
- The Android workflow builds a debug APK for testing. It is not a Play Store-signed production release.
- The Capacitor shell loads the hosted Render website, so the Android app requires internet access for live data and a healthy Render service.

## Android build

GitHub Actions runs the `Android APK` workflow on relevant pushes. The generated artifact is a debug APK retained for 30 days. A signed release requires a private signing key and release configuration; do not store signing secrets in source control.
