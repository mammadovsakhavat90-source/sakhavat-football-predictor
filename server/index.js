'use strict';
const express = require('express');
const path = require('path');
const { predict } = require('./prediction');
const { sanitizeFootballAnalytics, sanitizeKiqiq } = require('./consensus');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.FOOTBALLDATA_API_KEY;
const API_BASE = 'https://footballdata.io/api/v1';
const ALLOWED_LEAGUES = Object.freeze({
  '10': 'La Liga',
  '15': 'Premier League',
  '45': 'UEFA Champions League',
  '46': 'UEFA Europa League',
  '50': 'FIFA World Cup'
});
const ALLOWED_LEAGUE_IDS = new Set(Object.keys(ALLOWED_LEAGUES));
const cache = new Map();
const CACHE_LIMIT = 600;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt > Date.now() && entry.value !== undefined) return { value: entry.value, stale: false };
  if (entry.promise) return { promise: entry.promise };
  return null;
}
async function cachedJson(key, ttlMs, loader, staleMs = ttlMs * 4) {
  const existing = cacheGet(key);
  if (existing?.value !== undefined) return { data: existing.value, cached: true, stale: existing.stale };
  if (existing?.promise) return existing.promise;
  const previous = cache.get(key);
  const promise = (async () => {
    try {
      const value = await loader();
      cache.set(key, { value, expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + staleMs });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return { data: value, cached: false, stale: false };
    } catch (error) {
      if (previous?.value !== undefined && previous.staleUntil > Date.now()) {
        cache.set(key, previous);
        return { data: previous.value, cached: true, stale: true, warning: error.message };
      }
      cache.delete(key);
      throw error;
    }
  })();
  cache.set(key, { ...(previous || {}), promise });
  return promise;
}
async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error('Mənbə JSON əvəzinə etibarsız cavab qaytardı.'); }
  if (!response.ok) throw new Error('Mənbə HTTP ' + response.status + ': ' + JSON.stringify(data).slice(0, 500));
  return data;
}
function providerTtl(endpoint) {
  if (endpoint.startsWith('/teams/')) return 6 * 60 * 60 * 1000;
  if (endpoint.endsWith('/odds')) return 2 * 60 * 1000;
  if (endpoint.endsWith('/probabilities')) return 10 * 60 * 1000;
  if (endpoint.startsWith('/matches/')) return 2 * 60 * 1000;
  return 10 * 60 * 1000;
}
async function providerData(endpoint) {
  if (!API_KEY) {
    const error = new Error('FOOTBALLDATA_API_KEY konfiqurasiya edilməyib.');
    error.status = 503;
    throw error;
  }
  const key = 'footballdata:' + endpoint;
  return cachedJson(key, providerTtl(endpoint), () =>
    fetchJson(API_BASE + endpoint, { Authorization: 'Bearer ' + API_KEY }));
}
function sendProviderError(res, error) {
  const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
  return res.status(error.status || (timedOut ? 504 : 502)).json({
    ok: false,
    error: timedOut ? 'Məlumat provayderi 12 saniyədə cavab vermədi.' : 'Məlumat provayderinə qoşulmaq mümkün olmadı.',
    details: error.message
  });
}
async function providerGet(endpoint, res) {
  try {
    const result = await providerData(endpoint);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true,
      provider: 'Footballdata.io',
      providerData: result.data,
      data: result.data.data ?? result.data,
      meta: { cache: result.cached ? (result.stale ? 'stale-fallback' : 'hit') : 'miss' }
    });
  } catch (error) { return sendProviderError(res, error); }
}

app.get('/api/status', (_req, res) => res.json({
  ok: true,
  app: 'SAKHAVAT FOOTBALL PREDICTOR 1.0',
  apiConfigured: Boolean(API_KEY),
  provider: 'Footballdata.io',
  allowedLeagues: ALLOWED_LEAGUES,
  predictionEngine: 'xG + Poisson baseline; Dixon-Coles disabled pending historical calibration',
  predictionMode: 'Elo disabled until a verified ratings feed is connected',
  cache: { entries: cache.size, policy: 'fixtures 2-15m; odds 2m; team statistics 6h; stale fallback enabled' },
  consensus: { endpoint: '/api/consensus?date=YYYY-MM-DD', sources: ['KiqIQ', 'Football Analytics'], providerCountsAsVote: false, freshnessRequired: true, matchToleranceMinutes: 30 }
}));

app.get('/api/consensus', async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + 'T00:00:00.000Z').toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ ok: false, error: 'date=YYYY-MM-DD tələb olunur.' });
  }
  const from = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const [faResult, kiqiqResult] = await Promise.allSettled([
    cachedJson('external:footballanalytics', 5 * 60 * 1000,
      () => fetchJson('https://footballanalytics.pro/data/upcoming.json'), 30 * 60 * 1000),
    cachedJson('external:kiqiq:' + date, 5 * 60 * 1000, () => fetchJson(
      'https://kiqiq.com/api/v1/predictions?' +
      new URLSearchParams({ from, to, limit: '100' })
    ), 15 * 60 * 1000)
  ]);

  // A stale cache fallback is useful for fixture display, but must never vote in consensus.
  const faCached = faResult.status === 'fulfilled' ? faResult.value : null;
  const kiqiqCached = kiqiqResult.status === 'fulfilled' ? kiqiqResult.value : null;
  const faUsable = !!faCached && !faCached.stale;
  const kiqiqUsable = !!kiqiqCached && !kiqiqCached.stale;
  const fa = faUsable ? sanitizeFootballAnalytics(faCached.data) : {
    fresh: false, generatedAt: null, ageSeconds: null, count: 0, fixtures: [],
    error: faCached?.stale ? 'Köhnə keş konsensus üçün istifadə edilmir.' : 'Football Analytics mənbəsinə qoşulmaq mümkün olmadı.'
  };
  const kiqiq = kiqiqUsable ? sanitizeKiqiq(kiqiqCached.data) : {
    fresh: false, generatedAt: null, ageSeconds: null, count: 0, fixtures: [],
    error: kiqiqCached?.stale ? 'Köhnə keş konsensus üçün istifadə edilmir.' : 'KiqIQ mənbəsinə qoşulmaq mümkün olmadı.'
  };

  const footballAnalyticsRows = fa.fixtures.map(row => ({
    ...row, _sourceGeneratedAt: fa.generatedAt
  }));
  const kiqiqRows = kiqiq.fixtures.map(row => ({
    ...row, _sourceGeneratedAt: kiqiq.generatedAt
  }));

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    date,
    footballAnalytics: footballAnalyticsRows,
    kiqiq: kiqiqRows,
    sources: {
      footballAnalytics: {
        ok: fa.fresh, fresh: fa.fresh, generatedAt: fa.generatedAt,
        ageSeconds: fa.ageSeconds, count: fa.count,
        cache: faCached?.cached ? (faCached.stale ? 'stale-rejected' : 'hit') : 'miss',
        error: fa.error || (faResult.status === 'rejected' ? faResult.reason.message : null)
      },
      kiqiq: {
        ok: kiqiq.fresh, fresh: kiqiq.fresh, generatedAt: kiqiq.generatedAt,
        ageSeconds: kiqiq.ageSeconds, count: kiqiq.count,
        cache: kiqiqCached?.cached ? (kiqiqCached.stale ? 'stale-rejected' : 'hit') : 'miss',
        error: kiqiq.error || (kiqiqResult.status === 'rejected' ? kiqiqResult.reason.message : null)
      }
    },
    consensusPolicy: 'Only fresh, schema-valid third-party feeds may vote. Team names, competition and kickoff must match; bookmaker/fixture provider does not vote.'
  });
});

app.get('/api/teams/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (!q) return res.status(400).json({ ok: false, error: 'q parametrində komanda adı tələb olunur.' });
  return providerGet('/teams?' + new URLSearchParams({ q }), res);
});
app.get('/api/teams/:id/stats', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Yanlış team id.' });
  const params = new URLSearchParams();
  if (req.query.season_id && /^\d+$/.test(String(req.query.season_id))) params.set('season_id', req.query.season_id);
  if (req.query.league_id && ALLOWED_LEAGUE_IDS.has(String(req.query.league_id))) params.set('league_id', req.query.league_id);
  if (req.query.league_id && !ALLOWED_LEAGUE_IDS.has(String(req.query.league_id))) return res.status(400).json({ ok: false, error: 'Yarış ID-si icazəli deyil.' });
  return providerGet('/teams/' + req.params.id + '/stats' + (params.size ? '?' + params.toString() : ''), res);
});
app.get('/api/teams/:id/matches', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Yanlış team id.' });
  return providerGet('/teams/' + req.params.id + '/matches', res);
});
app.get('/api/matches/:id', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Yanlış match id.' });
  return providerGet('/matches/' + req.params.id, res);
});
app.get('/api/matches/:id/:kind', (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !['stats', 'odds', 'probabilities', 'events'].includes(req.params.kind)) {
    return res.status(400).json({ ok: false, error: 'Yanlış match sorğusu.' });
  }
  return providerGet('/matches/' + req.params.id + '/' + req.params.kind, res);
});
app.get('/api/results', async (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ ok: false, error: 'from və to tarixləri YYYY-MM-DD formatında olmalıdır.' });
  }
  const fromMs = Date.parse(from + 'T00:00:00Z');
  const toMs = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs || toMs - fromMs > 90 * 86400000) {
    return res.status(400).json({ ok: false, error: 'Nəticə auditi üçün tarix aralığı maksimum 90 gün ola bilər.' });
  }
  if (!API_KEY) return res.status(503).json({ ok: false, error: 'FOOTBALLDATA_API_KEY konfiqurasiya edilməyib.' });
  try {
    const params = new URLSearchParams({ from, to, page: '1', limit: '100' });
    const firstPage = await cachedJson('footballdata:results:' + params.toString(), 6 * 60 * 60 * 1000, () =>
      fetchJson(API_BASE + '/fixtures/results?' + params.toString(), { Authorization: 'Bearer ' + API_KEY }), 24 * 60 * 60 * 1000);
    if (firstPage.data.success === false) throw new Error('Footballdata.io nəticə sorğusu uğursuz oldu.');
    const root = firstPage.data.data || {};
    const firstMatches = Array.isArray(root.matches) ? root.matches : [];
    const reportedPages = Number(firstPage.data.meta?.pagination?.total_pages) || 0;
    const totalPages = Math.max(1, reportedPages || (firstMatches.length >= 100 ? 3 : 1));
    const pageCount = Math.min(totalPages, 3);
    const more = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => {
      const page = index + 2;
      const query = new URLSearchParams({ from, to, page: String(page), limit: '100' });
      return cachedJson('footballdata:results:' + query.toString(), 6 * 60 * 60 * 1000, () =>
        fetchJson(API_BASE + '/fixtures/results?' + query.toString(), { Authorization: 'Bearer ' + API_KEY }), 24 * 60 * 60 * 1000);
    }));
    const allMatches = firstMatches.concat(...more.map(item => item.data.data?.matches || []));
    const seenResults = new Set();
    const matches = allMatches.filter(match => {
      const id = String(match.league?.league_id ?? match.league_id ?? match.competition?.league_id ?? '');
      const matchId = String(match.match_id ?? match.fixture_id ?? '');
      const status = String(match.status || '').toLowerCase().replace(/[\\s_-]+/g, '.');
      const score = match.score || match.result || {};
      const homeScore = Number(score.home ?? score.home_score ?? match.home_score);
      const awayScore = Number(score.away ?? score.away_score ?? match.away_score);
      if (!ALLOWED_LEAGUE_IDS.has(id) || !matchId || seenResults.has(matchId) ||
          !/^(finished|complete|completed|ended|full.time|ft|aet)$/.test(status) ||
          !Number.isInteger(homeScore) || !Number.isInteger(awayScore) ||
          homeScore < 0 || awayScore < 0) return false;
      seenResults.add(matchId);
      return true;
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true, provider: 'Footballdata.io', matches,
      meta: { from, to, providerMatches: allMatches.length, filteredMatches: matches.length,
        pagesFetched: pageCount, truncated: totalPages > pageCount || (!reportedPages && allMatches.length >= 300),
        cache: firstPage.cached ? (firstPage.stale ? 'stale-fallback' : 'hit') : 'miss' }
    });
  } catch (error) { return sendProviderError(res, error); }
});

app.get('/api/fixtures', (req, res) => {
  const date = String(req.query.date || '');
  const leagueId = req.query.league_id;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'date=YYYY-MM-DD istifadə et.' });
  if (leagueId && !ALLOWED_LEAGUE_IDS.has(String(leagueId))) return res.status(400).json({ ok: false, error: 'Yalnız təsdiqlənmiş 5 yarış dəstəklənir.' });
  const params = new URLSearchParams({ date, limit: String(Math.min(100, Math.max(1, Number(req.query.limit) || 100))), page: '1' });
  if (leagueId) params.set('league_id', leagueId);
  const bakuToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const requested = Date.parse(date + 'T00:00:00Z');
  const today = Date.parse(bakuToday + 'T00:00:00Z');
  const ttl = requested < today ? 12 * 60 * 60 * 1000 : requested === today ? 2 * 60 * 1000 : 15 * 60 * 1000;
  const endpoint = '/matches?' + params.toString();
  // The fixtures cache is date- and league-specific; old results are cached longer.
  return footballDataCached(endpoint, res, leagueId, date, ttl);
});
async function footballDataCached(endpoint, res, requestedLeagueId, date, ttl) {
  try {
    if (!API_KEY) return res.status(503).json({ ok: false, error: 'FOOTBALLDATA_API_KEY konfiqurasiya edilməyib.' });
    const result = await cachedJson('footballdata:' + endpoint, ttl, () =>
      fetchJson(API_BASE + endpoint, { Authorization: 'Bearer ' + API_KEY }), ttl * 4);
    const data = result.data;
    if (data.success === false) return res.status(502).json({ ok: false, error: 'Footballdata.io uğursuz cavab qaytardı.', details: data });
    const root = data.data || {};
    const rawMatches = root.matches || root.fixtures || (Array.isArray(root) ? root : []);
    const seen = new Set();
    const matches = rawMatches.filter(match => {
      const id = String(match.league?.league_id ?? match.league_id ?? match.competition?.league_id ?? '');
      const matchId = String(match.match_id ?? match.fixture_id ?? '');
      const home = match.home_team?.team_name ?? match.home_team?.name ?? match.home_team_name;
      const away = match.away_team?.team_name ?? match.away_team?.name ?? match.away_team_name;
      const kickoff = Number(match.date_unix);
      if (!ALLOWED_LEAGUE_IDS.has(id) ||
          (requestedLeagueId && id !== String(requestedLeagueId)) ||
          !matchId || !home || !away || !Number.isFinite(kickoff) || kickoff <= 0 ||
          seen.has(matchId)) return false;
      seen.add(matchId);
      return true;
    }).map(match => {
      const id = String(match.league?.league_id ?? match.league_id ?? match.competition?.league_id ?? '');
      return { ...match, league_display_name: ALLOWED_LEAGUES[id] };
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true, provider: 'Footballdata.io', providerData: data, matches,
      meta: {
        requestedDate: date, allowedLeagues: ALLOWED_LEAGUES,
        providerMatches: rawMatches.length, filteredMatches: matches.length,
        cache: result.cached ? (result.stale ? 'stale-fallback' : 'hit') : 'miss',
        ...(result.warning ? { cacheWarning: result.warning } : {})
      }
    });
  } catch (error) { return sendProviderError(res, error); }
}
app.post('/api/predict', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ ok: false, error: 'JSON statistik girişləri tələb olunur.' });
    return res.json({ ok: true, prediction: predict(req.body) });
  } catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
});
app.listen(PORT, () => console.log('SAKHAVAT FOOTBALL PREDICTOR running on port ' + PORT));
