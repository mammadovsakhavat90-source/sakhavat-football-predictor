'use strict';
const express = require('express');
const path = require('path');
const { predict } = require('./prediction');

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
  if (entry.expiresAt > Date.now()) return { value: entry.value, stale: false };
  if (entry.promise) return { promise: entry.promise };
  return entry.staleUntil > Date.now() ? { value: entry.value, stale: true } : null;
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
async function footballData(endpoint, res, requestedLeagueId, date) {
  try {
    const result = await providerData(endpoint);
    const data = result.data;
    if (data.success === false) return res.status(502).json({ ok: false, error: 'Footballdata.io uğursuz cavab qaytardı.', details: data });
    const root = data.data || {};
    const rawMatches = root.matches || root.fixtures || (Array.isArray(root) ? root : []);
    const matches = rawMatches.filter(match => {
      const id = String(match.league?.league_id ?? match.league_id ?? match.competition?.league_id ?? '');
      return ALLOWED_LEAGUE_IDS.has(id) && (!requestedLeagueId || id === String(requestedLeagueId));
    }).map(match => {
      const id = String(match.league?.league_id ?? match.league_id ?? match.competition?.league_id ?? '');
      return { ...match, league_display_name: ALLOWED_LEAGUES[id] };
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true,
      provider: 'Footballdata.io',
      providerData: data,
      matches,
      meta: {
        allowedLeagues: ALLOWED_LEAGUES,
        providerMatches: rawMatches.length,
        filteredMatches: matches.length,
        cache: result.cached ? (result.stale ? 'stale-fallback' : 'hit') : 'miss',
        ...(result.warning ? { cacheWarning: result.warning } : {})
      }
    });
  } catch (error) { return sendProviderError(res, error); }
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
  predictionEngine: 'xG + Poisson + Dixon-Coles',
  predictionMode: 'Elo disabled until a verified ratings feed is connected',
  cache: { entries: cache.size, policy: 'fixtures 2-15m; odds 2m; team statistics 6h; stale fallback enabled' },
  consensus: { endpoint: '/api/consensus?date=YYYY-MM-DD', sources: ['KiqIQ', 'Football Analytics'], providerCountsAsVote: false }
}));

app.get('/api/consensus', async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'date=YYYY-MM-DD tələb olunur.' });
  const from = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const [faResult, kiqiqResult] = await Promise.allSettled([
    cachedJson('external:footballanalytics', 5 * 60 * 1000, () => fetchJson('https://footballanalytics.pro/data/upcoming.json'), 30 * 60 * 1000),
    cachedJson('external:kiqiq:' + date, 5 * 60 * 1000, () => fetchJson(
      'https://kiqiq.com/api/v1/predictions?' + new URLSearchParams({ from, to, limit: '100' })
    ), 15 * 60 * 1000)
  ]);
  const fa = faResult.status === 'fulfilled' ? faResult.value : null;
  const kiqiq = kiqiqResult.status === 'fulfilled' ? kiqiqResult.value : null;
  const faPayload = fa?.data || {};
  const kiqiqPayload = kiqiq?.data || {};
  const faGenerated = faPayload.generated_at || faPayload.updated_at || null;
  const kiqiqGenerated = kiqiqPayload.generated_at || kiqiqPayload.updated_at || kiqiqPayload.published_at || null;
  const faFresh = Number.isFinite(Date.parse(faGenerated || '')) &&
    Date.now() - Date.parse(faGenerated) <= 24 * 60 * 60 * 1000 &&
    Date.parse(faGenerated) <= Date.now() + 5 * 60 * 1000;
  const kiqiqRows = Array.isArray(kiqiqPayload.fixtures) ? kiqiqPayload.fixtures :
    Array.isArray(kiqiqPayload.data?.fixtures) ? kiqiqPayload.data.fixtures : [];
  const kiqiqFresh = Number.isFinite(Date.parse(kiqiqGenerated || '')) &&
    Date.now() - Date.parse(kiqiqGenerated) <= 24 * 60 * 60 * 1000 &&
    Date.parse(kiqiqGenerated) <= Date.now() + 5 * 60 * 1000;
  const faRows = faFresh && Array.isArray(faPayload.data) ? faPayload.data.map(row => ({
    ...row, _sourceGeneratedAt: faGenerated
  })) : [];
  const validKiqiqRows = kiqiqFresh ? kiqiqRows.map(row => ({
    ...row, _sourceGeneratedAt: kiqiqGenerated
  })) : [];
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.json({
    ok: true,
    date,
    footballAnalytics: faRows,
    kiqiq: validKiqiqRows,
    sources: {
      footballAnalytics: {
        ok: !!fa,
        fresh: faFresh,
        generatedAt: faGenerated,
        count: faRows.length,
        cache: fa?.cached ? (fa.stale ? 'stale-fallback' : 'hit') : 'miss',
        error: faResult.status === 'rejected' ? faResult.reason.message : (!faFresh ? 'Mənbənin generated_at vaxtı yoxdur və ya 24 saatdan köhnədir.' : null)
      },
      kiqiq: {
        ok: !!kiqiq,
        fresh: kiqiqFresh,
        generatedAt: kiqiqGenerated,
        count: validKiqiqRows.length,
        cache: kiqiq?.cached ? (kiqiq.stale ? 'stale-fallback' : 'hit') : 'miss',
        error: kiqiqResult.status === 'rejected' ? kiqiqResult.reason.message : (!kiqiqFresh ? 'Mənbənin generated_at vaxtı yoxdur və ya 24 saatdan köhnədir.' : null)
      }
    },
    consensusAllowed: faRows.length > 0 && validKiqiqRows.length > 0
  });
});

app.get('/api/teams/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (!q) return res.status(400).json({ ok: false, error: 'q parametrində komanda adı tələb olunur.' });
  return providerGet('/teams?' + new URLSearchParams({ q }), res);
});
app.get('/api/teams/:id/stats', (req, res) => {
  if (!/^\\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Yanlış team id.' });
  const params = new URLSearchParams();
  if (req.query.season_id && /^\\d+$/.test(String(req.query.season_id))) params.set('season_id', req.query.season_id);
  if (req.query.league_id && ALLOWED_LEAGUE_IDS.has(String(req.query.league_id))) params.set('league_id', req.query.league_id);
  if (req.query.league_id && !ALLOWED_LEAGUE_IDS.has(String(req.query.league_id))) return res.status(400).json({ ok: false, error: 'Yarış ID-si icazəli deyil.' });
  return providerGet('/teams/' + req.params.id + '/stats' + (params.size ? '?' + params.toString() : ''), res);
});
app.get('/api/teams/:id/matches', (req, res) => {
  if (!/^\\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Yanlış team id.' });
  return providerGet('/teams/' + req.params.id + '/matches', res);
});
app.get('/api/matches/:id', (req, res) => {
  if (!/^\\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Yanlış match id.' });
  return providerGet('/matches/' + req.params.id, res);
});
app.get('/api/matches/:id/:kind', (req, res) => {
  if (!/^\\d+$/.test(req.params.id) || !['stats', 'odds', 'probabilities', 'events'].includes(req.params.kind)) {
    return res.status(400).json({ ok: false, error: 'Yanlış match sorğusu.' });
  }
  return providerGet('/matches/' + req.params.id + '/' + req.params.kind, res);
});
app.get('/api/fixtures', (req, res) => {
  const date = String(req.query.date || '');
  const leagueId = req.query.league_id;
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'date=YYYY-MM-DD istifadə et.' });
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
    const matches = rawMatches.filter(match => {
      const id = String(match.league?.league_id ?? match.league_id ?? match.competition?.league_id ?? '');
      return ALLOWED_LEAGUE_IDS.has(id) && (!requestedLeagueId || id === String(requestedLeagueId));
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
