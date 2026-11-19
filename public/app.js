const dateInput = document.getElementById('matchDate');
const matchesBox = document.getElementById('matchList');
const connection = document.getElementById('connection');
const connectionState = document.getElementById('connectionState');
let currentPickFilter = 'all';
let latestMatches = [];
const API_ORIGIN = window.location.origin;
const apiUrl = path => API_ORIGIN + path;
const bakuParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
dateInput.value = bakuParts.find(p => p.type === 'year').value + '-' + bakuParts.find(p => p.type === 'month').value + '-' + bakuParts.find(p => p.type === 'day').value;
const first = (...values) => values.find(v => v !== undefined && v !== null && String(v).trim() !== '');
function decodeText(value) {
  let text = String(value ?? '');
  for (let i = 0; i < 3; i++) {
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'");
  }
  return text;
}

function teamName(match, side) {
  const team = match[side + '_team'] || match[side] || {};
  if (typeof team === 'string') return decodeText(team);
  return decodeText(first(team.team_name, team.name, team.display_name, match[side + '_team_name'],
    match[side + '_name'], match[side + '_team'], side === 'home' ? 'Ev sahibi' : 'Qonaq'));
}
function teamLogo(match, side) {
  const team = match[side + '_team'] || match[side] || {};
  const candidate = first(team.team_logo, team.logo, team.logo_url, team.image);
  if (!candidate) return null;
  try {
    const url = new URL(String(candidate));
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const img = document.createElement('img');
    img.className = 'team-logo';
    img.src = url.href;
    img.alt = teamName(match, side);
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.remove();
    return img;
  } catch { return null; }
}
function rawStatus(match) {
  return String(first(match.status, match.state, match.status_localized, '')).trim().toLowerCase();
}
function classifyStatus(match) {
  const s = rawStatus(match);
  // "incomplete" is a provider's pre-match state, NOT "complete".
  if (/^(incomplete|not.started|not_started|scheduled|fixture|pending|ns|tbd)$/.test(s)) return 'scheduled';
  if (/^(live|in.progress|in_progress|1h|2h|ht|half.time|halftime|extra.time|penalties|in.play)$/.test(s)) return 'live';
  if (/^(finished|complete|completed|ended|full.time|full_time|ft|aet)$/.test(s)) return 'finished';
  if (/postpon|cancel|abandon|suspend/.test(s)) return 'delayed';
  return 'scheduled';
}
function statusLabel(match) {
  const status = classifyStatus(match);
  if (status === 'finished') return 'Başa çatıb';
  if (status === 'live') return 'Canlı';
  if (status === 'delayed') return 'Təxirə salınıb';
  return 'Başlamayıb';
}
function matchTime(match) {
  const raw = first(match.match_date, match.date, match.kickoff, match.start_time);
  if (!raw && !match.date_unix) return 'Vaxt göstərilməyib';
  // Footballdata.io date_unix is UTC. Always display the converted Baku date
  // as well as the time, so post-midnight kickoffs are not shown on the wrong day.
  let d;
  const unix = Number(match.date_unix);
  if (Number.isFinite(unix) && unix > 0) d = new Date(unix * 1000);
  else if (raw) {
    const value = String(raw);
    d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
      ? value.replace(' ', 'T') + 'Z' : value);
  }
  if (!d || Number.isNaN(d.getTime())) return String(raw || 'Vaxt göstərilməyib');
  const localDate = d.toLocaleDateString('az-AZ', {
    day: '2-digit', month: 'short', timeZone: 'Asia/Baku'
  });
  const localTime = d.toLocaleTimeString('az-AZ', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku'
  });
  return localDate + ' · ' + localTime + ' · Bakı';
}

function poissonProbability(lambda, goals) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= goals; i++) p *= lambda / i;
  return p;
}
let globalPicksPromise = null, globalPicksCache = null, globalPicksFetchedAt = 0;
const kiqiqCache = new Map();
function normalizeTeamLabel(value) {
  let label = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const aliases = [
    [/^real racing club de santander$/, 'racing santander'],
    [/^racing club de santander$/, 'racing santander'],
    [/^real sociedad de futbol$/, 'real sociedad'],
    [/^club atletico de madrid$/, 'atletico madrid'],
    [/^ca osasuna$/, 'osasuna']
  ];
  for (const [pattern, replacement] of aliases) label = label.replace(pattern, replacement);
  return label.replace(/\b(fc|afc|cf|sc|ac|ca|the|club|de|football|futbol)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function teamLabelsMatch(a, b) {
  const x = normalizeTeamLabel(a), y = normalizeTeamLabel(b);
  return !!x && !!y && x === y;
}
const consensusFeedCache = new Map();
const consensusFeedPromises = new Map();
async function fetchConsensusFeeds(selectedDate) {
  if (!selectedDate) return { footballAnalytics: [], kiqiq: [], sources: {} };
  const cached = consensusFeedCache.get(selectedDate);
  if (cached && Date.now() - cached.at < 300000) return cached.data;
  if (consensusFeedPromises.has(selectedDate)) return consensusFeedPromises.get(selectedDate);
  const request = (async () => { try {
    const response = await fetchWithTimeout(apiUrl('/api/consensus?' + new URLSearchParams({ date: selectedDate })),
      { cache: 'no-store' }, 15000);
    if (!response.ok) throw new Error('Konsensus mənbələri serverdən alınmadı');
    const payload = await response.json();
    if (!payload || payload.ok !== true) throw new Error('Konsensus cavabı etibarsızdır');
    const data = {
      footballAnalytics: Array.isArray(payload.footballAnalytics) ? payload.footballAnalytics : [],
      kiqiq: Array.isArray(payload.kiqiq) ? payload.kiqiq : [],
      sources: payload.sources || {}
    };
    consensusFeedCache.set(selectedDate, { at: Date.now(), data });
    return data;
  } catch (error) {
    console.warn('Consensus sources unavailable:', error);
    return { footballAnalytics: [], kiqiq: [], sources: {} };
  } finally {
    consensusFeedPromises.delete(selectedDate);
  } })();
  consensusFeedPromises.set(selectedDate, request);
  return request;
}
async function fetchGlobalPicks() {
  const feeds = await fetchConsensusFeeds(dateInput.value);
  return feeds.footballAnalytics;
}
async function fetchKiqiqPredictions(selectedDate) {
  const feeds = await fetchConsensusFeeds(selectedDate);
  return feeds.kiqiq;
}
function normalizeCompetitionLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase().replace(/\\b(uefa|fifa)\\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();
}
function competitionLabelsMatch(match, externalCompetition) {
  const local = normalizeCompetitionLabel(leagueLabel(match));
  const external = normalizeCompetitionLabel(externalCompetition);
  if (!local || !external) return false;
  const aliases = {
    'la liga': 'laliga',
    'laliga': 'laliga',
    'premier league': 'premier league',
    'champions league': 'champions league',
    'uefa champions league': 'champions league',
    'europa league': 'europa league',
    'world cup': 'world cup',
    'fifa world cup': 'world cup'
  };
  const compactLocal = local.replace(/\\s/g, '');
  const compactExternal = external.replace(/\\s/g, '');
  const a = aliases[local] || aliases[compactLocal] || local;
  const b = aliases[external] || aliases[compactExternal] || external;
  return a === b;
}
function findGlobalPick(match, rows) {
  const kickoff = Number(match.date_unix) * 1000;
  if (!(kickoff > 0)) return null;
  const home = teamName(match, 'home'), away = teamName(match, 'away');
  return rows.find(row => {
    const externalTime = Date.parse(row.kickoff_utc || '');
    const writtenAt = Date.parse(row.pick_written_utc || '');
    const sourceGeneratedAt = Date.parse(row._sourceGeneratedAt || '');
    const sourceIsFresh = Number.isFinite(sourceGeneratedAt) &&
      Date.now() - sourceGeneratedAt <= 24 * 60 * 60 * 1000 &&
      sourceGeneratedAt <= Date.now() + 5 * 60 * 1000;
    return sourceIsFresh && Number.isFinite(externalTime) &&
      Math.abs(externalTime - kickoff) <= 2 * 60 * 60 * 1000 &&
      Number.isFinite(writtenAt) && writtenAt < externalTime &&
      externalTime - writtenAt <= 7 * 86400000 &&
      teamLabelsMatch(home, row.home_team) && teamLabelsMatch(away, row.away_team) &&
      competitionLabelsMatch(match, row.league) && ['1', 'X', '2'].includes(String(row.pick).toUpperCase());
  }) || null;
}
function findKiqiqPrediction(match, rows) {
  const kickoff = Number(match.date_unix) * 1000;
  if (!(kickoff > 0)) return null;
  const home = teamName(match, 'home'), away = teamName(match, 'away');
  return rows.find(row => {
    const externalTime = Date.parse(row.kickoff_iso || '');
    const sourceGeneratedAt = Date.parse(row._sourceGeneratedAt || row.published_at || row.created_at || '');
    const sourceIsFresh = Number.isFinite(sourceGeneratedAt) &&
      Date.now() - sourceGeneratedAt <= 24 * 60 * 60 * 1000 &&
      sourceGeneratedAt <= Date.now() + 5 * 60 * 1000 &&
      sourceGeneratedAt < externalTime;
    return sourceIsFresh && Number.isFinite(externalTime) &&
      Math.abs(externalTime - kickoff) <= 4 * 60 * 60 * 1000 &&
      teamLabelsMatch(home, row.home) && teamLabelsMatch(away, row.away) &&
      competitionLabelsMatch(match, row.competition);
  }) || null;
}
function normalizeExternalProbabilities(row) {
  if (!row) return null;
  let values = [Number(row.home_win_prob), Number(row.draw_prob), Number(row.away_win_prob)];
  if (!values.every(Number.isFinite) || values.some(v => v < 0)) return null;
  if (values.every(v => v <= 1)) values = values.map(v => v * 100);
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum < 85 || sum > 115) return null;
  return values.map(v => v / sum * 100);
}
function finalVerdict(match, analysis, feeds) {
  if (!analysis) return { confirmed: false, pick: null, text: 'FINAL VERDICT: model üçün etibarlı xG məlumatı yoxdur; seçim verilmir' };
  const homeSample = match._teamStats?.home, awaySample = match._teamStats?.away;
  if (!homeSample || !awaySample || homeSample.played < 8 || awaySample.played < 8) {
    return { confirmed: false, pick: null, text: 'FINAL VERDICT: hər iki komanda üçün minimum 8 oyunlu statistik nümunə yoxdur; yekun seçim verilmir' };
  }
  const modelPick = analysis.labels?.[analysis.best] || null;
  const consensusPick = globalConsensusPick(match, analysis, feeds);
  if (!consensusPick) return { confirmed: false, pick: null, text: 'FINAL VERDICT: iki xarici mənbədən təsdiqlənmiş konsensus yoxdur; yekun seçim verilmir' };
  if (!modelPick || consensusPick !== modelPick) {
    return { confirmed: false, pick: null, text: 'FINAL VERDICT: SAKHAVAT modeli və xarici mənbələrin konsensusu fərqlənir; yekun seçim verilmir' };
  }
  const marketKey = { '1':'home', 'X':'draw', '2':'away' }[modelPick];
  if (!analysis.market) return { confirmed: false, pick: null, text: 'FINAL VERDICT: müqayisə üçün etibarlı bazar əmsalı yoxdur; yekun seçim verilmir' };
  if (Math.abs(analysis.outcomes[marketKey] - analysis.market[marketKey]) > 15) {
    return { confirmed: false, pick: null, text: 'FINAL VERDICT: model və bazar arasında 15 faiz bəndindən böyük fərq var; əlavə yoxlama tələb olunur' };
  }
  const marketText = ' · bazar ehtimalı ' + percent(analysis.market[marketKey]);
  return { confirmed: true, pick: modelPick, text: 'FINAL VERDICT: TƏSDİQLƏNDİ · model və 2 xarici proqnoz mənbəyi eyni seçimdədir: ' + modelPick + marketText };
}
function globalConsensusPick(match, analysis, feeds) {
  // Footballdata.io is the fixture/statistics provider, not an independent consensus source.
  // Consensus uses only separate external prediction services.
  const external = findGlobalPick(match, feeds?.footballAnalytics || []);
  const kiqiq = findKiqiqPrediction(match, feeds?.kiqiq || []);
  const kp = normalizeExternalProbabilities(kiqiq);
  const kiqiqPick = kp ? ['1', 'X', '2'][kp.indexOf(Math.max(...kp))] : null;
  const externalPick = external ? String(external.pick).toUpperCase() : null;
  const picks = [kiqiqPick, externalPick].filter(pick => ['1', 'X', '2'].includes(pick));
  if (picks.length < 2) return null;
  const counts = { '1': 0, X: 0, '2': 0 };
  picks.forEach(pick => counts[pick]++);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}
function globalConsensusText(match, analysis, feeds) {
  const external = findGlobalPick(match, feeds?.footballAnalytics || []);
  const kiqiq = findKiqiqPrediction(match, feeds?.kiqiq || []);
  const kp = normalizeExternalProbabilities(kiqiq);
  const kiqiqPick = kp ? ['1', 'X', '2'][kp.indexOf(Math.max(...kp))] : null;
  const externalPick = external ? String(external.pick).toUpperCase() : null;
  const sources = [];
  if (kiqiqPick) sources.push({ name: 'KiqIQ', pick: kiqiqPick });
  if (['1', 'X', '2'].includes(externalPick)) sources.push({ name: 'Football Analytics', pick: externalPick });
  if (!sources.length) return 'GLOBAL CONSENSUS: xarici proqnoz mənbəsi tapılmadı; konsensus hesablanmır';
  const names = sources.map(source => source.name + ': ' + source.pick).join(' · ');
  if (sources.length < 2) return 'GLOBAL CONSENSUS: yalnız 1 xarici mənbə mövcuddur · ' + names;
  const counts = { '1': 0, X: 0, '2': 0 };
  sources.forEach(source => { counts[source.pick]++; });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === ranked[1][1]) return 'GLOBAL CONSENSUS: iki xarici mənbə razılaşmır; yekun seçim yoxdur | ' + names;
  return 'GLOBAL CONSENSUS: 2/2 xarici mənbə eyni istiqamətdədir · ' + ranked[0][0] + ' | ' + names;
}
const teamStatsCache = new Map();
const matchOddsCache = new Map();
const matchProbabilityCache = new Map();
function unwrapMatchPayload(payload, field) {
  if (!payload || payload.ok === false) return null;
  const roots = [payload.data, payload.providerData?.data, payload.providerData, payload].filter(Boolean);
  for (const root of roots) {
    const value = root[field] || root.match?.[field] || root.data?.[field] ||
      root.data?.match?.[field] || root.predictions?.[field];
    if (value && typeof value === 'object') return value;
  }
  return null;
}
function normalize1x2(probabilities) {
  if (!probabilities || typeof probabilities !== 'object') return null;
  const winner = probabilities.match_winner || probabilities;
  let values = [
    Number(winner.home_win ?? winner.home),
    Number(winner.draw),
    Number(winner.away_win ?? winner.away)
  ];
  if (!values.every(Number.isFinite) || values.some(v => v < 0 || v > 100) || values.reduce((a,b)=>a+b,0) <= 0) return null;
  // Some feeds express probabilities as fractions (0-1), others as percentages.
  const initialSum = values.reduce((a,b) => a+b, 0);
  if (values.every(v => v <= 1) && initialSum >= .85 && initialSum <= 1.15) {
    values = values.map(v => v * 100);
  }
  const checkedSum = values.reduce((a,b) => a+b, 0);
  if (checkedSum < 85 || checkedSum > 115) return null;
  const sum = values.reduce((a,b) => a+b, 0);
  return { home_win: values[0] / sum * 100, draw: values[1] / sum * 100,
    away_win: values[2] / sum * 100 };
}
function normalizeOdds(odds) {
  if (!odds || typeof odds !== 'object') return null;
  const winner = odds.match_winner || odds;
  const values = { home: Number(winner.home), draw: Number(winner.draw), away: Number(winner.away) };
  if (!Object.values(values).every(v => Number.isFinite(v) && v > 1 && v < 1000)) return null;
  return { ...odds, match_winner: values };
}
async function fetchMatchOdds(matchId) {
  if (!matchId) return null;
  const key = String(matchId);
  if (!matchOddsCache.has(key)) {
    const request = fetchWithTimeout(apiUrl('/api/matches/' + encodeURIComponent(key) + '/odds'),
      { cache: 'no-store' }, 12000).then(async response => {
        if (!response.ok) return null;
        const payload = await response.json();
        const odds = unwrapMatchPayload(payload, 'odds');
        const returnedId = payload?.data?.match?.match_id ?? payload?.providerData?.data?.match?.match_id;
        if (returnedId != null && String(returnedId) !== key) return null;
        return normalizeOdds(odds);
      }).catch(() => null);
    matchOddsCache.set(key, request);
  }
  return matchOddsCache.get(key);
}
async function fetchMatchProbabilities(matchId) {
  if (!matchId) return null;
  const key = String(matchId);
  if (!matchProbabilityCache.has(key)) {
    const request = fetchWithTimeout(apiUrl('/api/matches/' + encodeURIComponent(key) + '/probabilities'),
      { cache: 'no-store' }, 12000).then(async response => {
        if (!response.ok) return null;
        const payload = await response.json();
        const probabilities = unwrapMatchPayload(payload, 'probabilities');
        const returnedId = payload?.data?.match?.match_id ?? payload?.providerData?.data?.match?.match_id;
        if (returnedId != null && String(returnedId) !== key) return null;
        return normalize1x2(probabilities);
      }).catch(() => null);
    matchProbabilityCache.set(key, request);
  }
  return matchProbabilityCache.get(key);
}
async function fetchTeamStats(teamId, seasonId, leagueId) {
  if (!teamId || !seasonId || !leagueId) return null;
  const key = [teamId, seasonId, leagueId].join(':');
  if (!teamStatsCache.has(key)) {
    const request = fetchWithTimeout(apiUrl('/api/teams/' + encodeURIComponent(teamId) +
      '/stats?' + new URLSearchParams({ season_id: seasonId, league_id: leagueId })),
      { cache: 'no-store' }, 14000).then(async response => {
        const payload = await response.json();
        if (!response.ok || payload.ok === false) return null;
        const stats = payload.data || payload.providerData?.data || {};
        const xg = stats.xg || {};
        const played = Number(stats.summary?.matches_played || 0);
        const xgFor = Number(first(xg.xg_for_per_match, xg.for_per_match, xg.avg_for_per_match, xg.average_for_per_match));
        const xgAgainst = Number(first(xg.xg_against_per_match, xg.against_per_match, xg.avg_against_per_match, xg.average_against_per_match));
        const updatedAt = Date.parse(stats.last_updated || '');
        const statsFresh = Number.isFinite(updatedAt) && updatedAt <= Date.now() + 5 * 60 * 1000 &&
          Date.now() - updatedAt <= 30 * 86400000;
        if (played < 5 || !(xgFor > 0) || !(xgAgainst > 0) || !statsFresh) return null;
        return { played, xgFor, xgAgainst, updatedAt: new Date(updatedAt).toISOString(),
          form: stats.form?.overall || '', wins: Number(stats.summary?.wins || 0),
          draws: Number(stats.summary?.draws || 0), losses: Number(stats.summary?.losses || 0) };
      }).catch(() => null);
    teamStatsCache.set(key, request);
  }
  return teamStatsCache.get(key);
}
function matchAnalysis(match) {
  const providerHx = Number(match.xg?.prematch?.home);
  const providerAx = Number(match.xg?.prematch?.away);
  const homeStats = match._teamStats?.home, awayStats = match._teamStats?.away;
  let hx = providerHx, ax = providerAx;
  if (homeStats && awayStats) {
    const statsHx = (homeStats.xgFor + awayStats.xgAgainst) / 2;
    const statsAx = (awayStats.xgFor + homeStats.xgAgainst) / 2;
    hx = providerHx > 0 ? providerHx * .65 + statsHx * .35 : statsHx;
    ax = providerAx > 0 ? providerAx * .65 + statsAx * .35 : statsAx;
  }
  const odds = normalizeOdds(match.odds)?.match_winner || {};
  const provider = match._providerProbabilityRepeated
    ? {} : (normalize1x2(match.probabilities) || {});
  if (!(hx > 0 && hx <= 4.5 && ax > 0 && ax <= 4.5)) return null;
  let outcomes = { home: 0, draw: 0, away: 0 };
  const scores = [];
  let total = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    let p = poissonProbability(hx, h) * poissonProbability(ax, a);
    const rho = -0.08;
    if (h === 0 && a === 0) p *= 1 - hx * ax * rho;
    else if (h === 0 && a === 1) p *= 1 + hx * rho;
    else if (h === 1 && a === 0) p *= 1 + ax * rho;
    else if (h === 1 && a === 1) p *= 1 - rho;
    total += p;
    if (h > a) outcomes.home += p;
    else if (h === a) outcomes.draw += p;
    else outcomes.away += p;
    scores.push({ score: h + '-' + a, p });
  }
  for (const key of Object.keys(outcomes)) outcomes[key] = outcomes[key] / total * 100;
  scores.sort((a, b) => b.p - a.p);
  const keys = ['home', 'draw', 'away'];
  const labels = { home: '1', draw: 'X', away: '2' };
  let market = null;
  const raw = keys.map(k => Number(odds[k]));
  if (raw.every(v => Number.isFinite(v) && v > 1)) {
    const inv = raw.map(v => 1 / v), sum = inv.reduce((a, b) => a + b, 0);
    market = Object.fromEntries(keys.map((k, i) => [k, inv[i] / sum * 100]));
  }
  const best = keys.reduce((a, b) => outcomes[a] >= outcomes[b] ? a : b);
  const edge = market ? outcomes[best] - market[best] : null;
  const providerMarketDuplicate = !!market && !!provider &&
    keys.every(key => Math.abs(provider[key === 'home' ? 'home_win' : key === 'draw' ? 'draw' : 'away_win'] - market[key]) <= 0.3);
  return { hx, ax, outcomes, scores: scores.slice(0, 2), market, provider, providerMarketDuplicate, best, edge, labels };
}
function doubleChanceSelection(probabilities) {
  const ranked = Object.entries(probabilities || {}).filter(([key, value]) =>
    ['1','X','2'].includes(key) && Number.isFinite(Number(value)))
    .sort((a,b) => Number(b[1]) - Number(a[1]));
  if (ranked.length < 3) return null;
  const pair = ranked.slice(0,2).map(x => x[0]);
  return ['1X','12','X2'].find(label => [...label].every(key => pair.includes(key))) || null;
}
function percent(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(1) + '%' : '—'; }

const HISTORY_KEY = 'sakhavat_predictor_history_v1';
function readPredictionHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function writePredictionHistory(rows) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(-200)));
    return true;
  } catch (error) {
    console.warn('Prediction history could not be saved in this browser:', error);
    return false;
  }
}
function scoreFromMatch(match) {
  const score = match.score || match.result || {};
  const rawHome = first(score.home, score.home_score, match.home_score);
  const rawAway = first(score.away, score.away_score, match.away_score);
  if (rawHome === undefined || rawAway === undefined) return null;
  const home = Number(rawHome), away = Number(rawAway);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, outcome: home > away ? '1' : home < away ? '2' : 'X',
    exact: home + '-' + away };
}
function recordPredictionHistory(match, analysis, feeds) {
  const id = String(first(match.match_id, match.fixture_id, ''));
  if (!id) return;
  const rows = readPredictionHistory();
  const index = rows.findIndex(row => row.id === id);
  const status = classifyStatus(match);
  if (status === 'finished') {
    const result = scoreFromMatch(match);
    if (result && index >= 0 && !rows[index].result) {
      rows[index].result = result;
      rows[index].completedAt = new Date().toISOString();
      writePredictionHistory(rows);
    }
    return;
  }
  const kickoff = Number(match.date_unix) * 1000;
  if (status !== 'scheduled' || !(kickoff > Date.now()) || !analysis || index >= 0) return;
  const probabilities = {
    '1': Number(analysis.outcomes.home),
    'X': Number(analysis.outcomes.draw),
    '2': Number(analysis.outcomes.away)
  };
  if (!Object.values(probabilities).every(Number.isFinite)) return;
  const best = Object.entries(probabilities).sort((a,b) => b[1]-a[1])[0][0];
  const row = {
    id, home: teamName(match,'home'), away: teamName(match,'away'),
    kickoff: new Date(kickoff).toISOString(), league: leagueLabel(match),
    probabilities, best, doubleChance: doubleChanceSelection(probabilities), exactScore: analysis.scores?.[0]?.score || null,
    xg: [analysis.hx,analysis.ax], consensus: globalConsensusText(match,analysis,feeds),
    consensusPick: globalConsensusPick(match,analysis,feeds),
    finalPick: finalVerdict(match,analysis,feeds).confirmed ? best : null,
    savedAt: new Date().toISOString(), result: null
  };
  rows.push(row);
  writePredictionHistory(rows);
}
let auditInProgress = false;
let lastAuditAt = 0;
async function auditPendingResults() {
  if (auditInProgress || Date.now() - lastAuditAt < 55 * 60 * 1000) return;
  auditInProgress = true;
  lastAuditAt = Date.now();
  try {
    const rows = readPredictionHistory();
    const due = rows.filter(row => !row.result &&
      Number.isFinite(Date.parse(row.kickoff)) &&
      Date.parse(row.kickoff) < Date.now() - 90 * 60 * 1000);
    if (!due.length) return;
    const earliestDue = Math.min(...due.map(row => Date.parse(row.kickoff)));
    const auditWindowStart = Math.max(earliestDue, Date.now() - 89 * 86400000);
    const from = new Date(auditWindowStart).toISOString().slice(0, 10);
    const to = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const response = await fetchWithTimeout(apiUrl('/api/results?' + new URLSearchParams({ from, to })),
      { cache: 'no-store' }, 25000);
    if (!response.ok) throw new Error('Nəticə auditi üçün server cavab vermədi');
    const payload = await response.json();
    const matches = Array.isArray(payload.matches) ? payload.matches : [];
    const byId = new Map(matches.map(match => [String(first(match.match_id, match.fixture_id, '')), match]));
    let changed = false;
    const current = readPredictionHistory();
    current.forEach(row => {
      if (row.result) return;
      const match = byId.get(row.id);
      if (!match || classifyStatus(match) !== 'finished') return;
      const result = scoreFromMatch(match);
      if (!result) return;
      row.result = result;
      row.completedAt = new Date().toISOString();
      changed = true;
    });
    if (changed) {
      writePredictionHistory(current);
      renderPredictionHistory();
    }
    if (payload.meta?.truncated) {
      console.warn('Result audit returned the first 300 results only; remaining history will be checked on a later run.');
    }
  } catch (error) {
    console.warn('Automatic result audit deferred:', error);
  } finally {
    auditInProgress = false;
  }
}
function renderPredictionHistory() {
  const rows = readPredictionHistory();
  const completed = rows.filter(row => row.result && row.probabilities);
  const metrics = document.querySelectorAll('#history .metrics > div b');
  if (completed.length) {
    let hits=0, exact=0, brier=0, logLoss=0;
    completed.forEach(row => {
      if (row.best === row.result.outcome) hits++;
      if (row.exactScore === row.result.exact) exact++;
      const p=row.probabilities, actual=row.result.outcome;
      brier += ['1','X','2'].reduce((sum,key) => sum + Math.pow((Number(p[key])||0)/100 - (key===actual?1:0),2),0);
      logLoss += -Math.log(Math.max(0.000001,(Number(p[actual])||0)/100));
    });
    const values=[(hits/completed.length*100).toFixed(1)+'%',(exact/completed.length*100).toFixed(1)+'%',(brier/completed.length).toFixed(3),(logLoss/completed.length).toFixed(3)];
    metrics.forEach((el,i)=>{ if(values[i]) el.textContent=values[i]; });
  } else {
    metrics.forEach(el=>{el.textContent='—';});
  }
  const audit=document.getElementById('systemAudit');
  if(audit){
    const scorePick=field=>{
      const eligible=completed.filter(row=>['1','X','2'].includes(row[field]));
      const hits=eligible.filter(row=>row[field]===row.result.outcome).length;
      return eligible.length ? hits+'/'+eligible.length+' ('+(hits/eligible.length*100).toFixed(1)+'%) · n='+eligible.length : 'qeyd yoxdur';
    };
    const dcRows = completed.filter(row => ['1X','12','X2'].includes(row.doubleChance));
    const dcHits = dcRows.filter(row => row.doubleChance.includes(row.result.outcome)).length;
    const dcRate = dcRows.length ? dcHits+'/'+dcRows.length+' ('+(dcHits/dcRows.length*100).toFixed(1)+'%)' : 'qeyd yoxdur';
    audit.textContent='SAKHAVAT MODEL 1-X-2: '+scorePick('best')+
      ' · İKİQAT ŞANS: '+dcRate+
      ' · GLOBAL CONSENSUS: '+scorePick('consensusPick')+
      ' · FINAL VERDICT: '+scorePick('finalPick')+
      ' | yalnız oyunöncəsi saxlanmış seçimlər';
  }
  const list=document.getElementById('historyList');
  if(!list) return;
  list.replaceChildren();
  const latest=[...rows].sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff)).slice(0,20);
  if(!latest.length){
    const empty=document.createElement('p'); empty.className='muted'; empty.textContent='Hələ saxlanmış proqnoz yoxdur. Oyun başlamazdan əvvəl təqvim yüklənəndə proqnoz avtomatik qeydə alınacaq.'; list.append(empty); return;
  }
  latest.forEach(row=>{
    const item=document.createElement('article'); item.className='history-item';
    const title=document.createElement('strong'); title.textContent=row.home+' — '+row.away;
    const date=document.createElement('div'); date.className='meta';
    date.textContent=new Date(row.kickoff).toLocaleString('az-AZ',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Baku'})+' · Bakı · '+row.league;
    const forecast=document.createElement('div'); forecast.className='history-detail';
    forecast.textContent='Saxlanmış proqnoz: 1 '+percent(row.probabilities['1'])+' · X '+percent(row.probabilities.X)+' · 2 '+percent(row.probabilities['2'])+' | seçim: '+row.best+' | ikiqat şans: '+(row.doubleChance||'—')+' | hesab: '+(row.exactScore||'—');
    const result=document.createElement('div'); result.className='meta';
    result.textContent=row.result?'Nəticə: '+row.result.exact+' · '+(row.best===row.result.outcome?'1-X-2 düzgün':'1-X-2 səhv')+' · '+(row.doubleChance && row.doubleChance.includes(row.result.outcome)?'ikiqat şans düzgün':'ikiqat şans səhv')+' · '+(row.exactScore===row.result.exact?'dəqiq hesab düzgün':'dəqiq hesab səhv'):'Nəticə gözlənilir';
    item.append(title,date,forecast,result); list.append(item);
  });
  const note=document.getElementById('historyNote');
  if(note) note.textContent='Tarixçə bu brauzerdə saxlanılır ('+rows.length+' oyun). Tətbiq açıq olanda başa çatmış oyunların nəticələri saatda bir dəfə toplu sorğu ilə avtomatik yoxlanılır. Bu telefon/brauzer yaddaşıdır; brauzer məlumatları silinsə tarixçə də silinə bilər.';
}

function exportPredictionHistory() {
  const payload = { app: 'SAKHAVAT FOOTBALL PREDICTOR', version: 1,
    exportedAt: new Date().toISOString(), predictions: readPredictionHistory() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sakhavat-prediction-history-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function importPredictionHistory(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result || ''));
      const imported = Array.isArray(payload) ? payload : payload.predictions;
      if (!Array.isArray(imported)) throw new Error('Backup faylında proqnoz siyahısı yoxdur.');
      const valid = imported.filter(row => row && typeof row.id === 'string' &&
        row.probabilities && ['1','X','2'].every(key => Number.isFinite(Number(row.probabilities[key]))) &&
        ['1','X','2'].includes(row.best) && Number.isFinite(Date.parse(row.kickoff)));
      if (!valid.length && imported.length) throw new Error('Faylda bərpa edilə bilən proqnoz yoxdur.');
      const merged = new Map(readPredictionHistory().map(row => [row.id, row]));
      valid.forEach(row => {
        const existing = merged.get(row.id);
        if (!existing) merged.set(row.id, row);
        else if (!existing.result && row.result && ['1','X','2'].includes(row.result.outcome) &&
          Number.isFinite(Number(row.result.home)) && Number.isFinite(Number(row.result.away))) {
          merged.set(row.id, { ...existing, result: row.result, completedAt: row.completedAt || null });
        }
      });
      if (!writePredictionHistory([...merged.values()])) throw new Error('Brauzer yaddaşına yazmaq mümkün olmadı.');
      renderPredictionHistory();
      alert(valid.length + ' proqnoz yoxlanıldı. Yeni qeydlər əlavə edildi; mövcud ilkin qeydlər dəyişdirilmədi.');
    } catch (error) { alert('Backup bərpa edilmədi: ' + error.message); }
  };
  reader.onerror = () => alert('Backup faylı oxunmadı.');
  reader.readAsText(file);
}
function renderEmpty(title, detail) {
  matchesBox.className = 'empty'; matchesBox.replaceChildren();
  const icon = document.createElement('div'); icon.className = 'empty-icon'; icon.textContent = '⌁';
  const heading = document.createElement('b'); heading.textContent = title;
  const p = document.createElement('p'); p.textContent = detail;
  matchesBox.append(icon, heading, p);
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 75000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer, timedOut = false;
  try {
    const request = fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) })
      .catch(error => {
        if (timedOut) {
          const timeoutError = new Error('Server cavabı ' + Math.round(timeoutMs / 1000) + ' saniyə ərzində gəlmədi. Bir az sonra Yenilə düyməsini basın.');
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }
        throw error;
      });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        if (controller) controller.abort();
        const error = new Error('Server cavabı ' + Math.round(timeoutMs / 1000) + ' saniyə ərzində gəlmədi. Bir az sonra Yenilə düyməsini basın.');
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkConnection() {
  try {
    const r = await fetchWithTimeout(apiUrl('/api/status'), { cache: 'no-store' }, 75000); const d = await r.json();
    const label = d.apiConfigured ? 'API açarı qoşulub · ' + (d.provider || 'Provider') : 'API açarı yoxdur';
    connection.textContent = label; if (connectionState) connectionState.textContent = label;
  } catch { connection.textContent = 'Bağlantı xətası'; if (connectionState) connectionState.textContent = 'Bağlantı xətası'; }
}
function kickoffClock(match) {
  const unix = Number(match.date_unix);
  if (unix > 0) return new Intl.DateTimeFormat('az-AZ',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Baku'}).format(new Date(unix*1000));
  const raw = String(first(match.match_date,match.date,match.kickoff,''));
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(' ','T')+'Z' : raw);
  return Number.isNaN(d.getTime()) ? 'Vaxt yoxdur' : new Intl.DateTimeFormat('az-AZ',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Baku'}).format(d);
}
function leagueLabel(match) {
  return first(match.league_display_name, match.league?.league_name, match.league?.name,
    match.league?.competition_name, match.league_name, match.competition?.league_name,
    match.competition?.name, match.competition_name, 'Liqa');
}
function pickOdds(match,key) {
  const odds=normalizeOdds(match.odds)?.match_winner;
  return odds && Number.isFinite(Number(odds[key])) ? Number(odds[key]) : null;
}
function recommendationSets(matches,feeds) {
  const safe=[],value=[];
  const perLeague=new Map();
  for(const match of matches){
    if(classifyStatus(match)!=='scheduled') continue;
    const a=matchAnalysis(match); if(!a) continue;
    const quality=!!(match._teamStats?.home&&match._teamStats?.away&&match._teamStats.home.played>=8&&match._teamStats.away.played>=8);
    const consensus=globalConsensusPick(match,a,feeds);
    const modelPick=a.best, p=a.outcomes[modelPick];
    const marketClose=a.market && Math.abs(a.outcomes[modelPick]-a.market[modelPick])<=9;
    if(quality && p>=58 && consensus===a.labels[modelPick] && !!a.market && marketClose){
      const item={match,analysis:a,pick:a.labels[modelPick],prob:p,quality,consensus};
      const lid=String(match.league?.league_id||match.league_name||'unknown');
      const old=perLeague.get(lid);
      if(!old||item.prob>old.prob) perLeague.set(lid,item);
    }
    const keys=['home','draw','away'];
    for(const key of keys){
      const odds=pickOdds(match,key);
      if(!quality||!a.market||!odds||odds<2.0) continue;
      const edge=a.outcomes[key]-a.market[key];
      if(edge>=3 && a.outcomes[key]>=22 && a.outcomes[key]<=58){
        value.push({match,analysis:a,pick:a.labels[key],prob:a.outcomes[key],odds,edge,quality});
      }
    }
  }
  safe.push(...perLeague.values());
  safe.sort((a,b)=>b.prob-a.prob);
  value.sort((a,b)=>b.edge-a.edge);
  return {safe:safe.slice(0,5),value:value.slice(0,8)};
}
function renderPickCard(item,risky=false) {
  const card=document.createElement('article');card.className='pick-card';
  const head=document.createElement('div');head.className='pick-card-head';
  const left=document.createElement('div');
  const league=document.createElement('div');league.className='pick-league';league.textContent=leagueLabel(item.match)+' · '+kickoffClock(item.match)+' Bakı';
  const teams=document.createElement('strong');teams.textContent=teamName(item.match,'home')+' — '+teamName(item.match,'away');
  left.append(league,teams);
  const badge=document.createElement('span');badge.className=risky?'badge-risk':'badge-safe';badge.textContent=risky?'RİSKLİ SEÇİM':'YÜKSƏK EHTİMAL';
  head.append(left,badge);
  const selection=document.createElement('div');selection.className='pick-selection';selection.textContent='Seçim: '+item.pick;
  const stats=document.createElement('div');stats.className='pick-stats';
  const p=document.createElement('span');p.textContent='Model: '+percent(item.prob);stats.append(p);
  if(risky){const o=document.createElement('span');o.textContent='Əmsal: '+item.odds.toFixed(2);stats.append(o);const e=document.createElement('span');e.textContent='Model üstünlüyü: +'+item.edge.toFixed(1)+' pp';stats.append(e);}
  else {const q=document.createElement('span');q.textContent='Məlumat: xG + forma';stats.append(q);if(item.consensus){const cs=document.createElement('span');cs.textContent='Konsensus: '+item.consensus;stats.append(cs);}}
  const reason=document.createElement('div');reason.className='pick-reason';reason.textContent=risky?'Yüksək əmsal və bazarla müqayisədə müsbət model fərqi var. Risk yüksəkdir, mərc zəmanəti deyil.':'Komanda statistikası mövcuddur və model ehtimalı dəstəkləyici siqnallarla uyğunlaşır. Bu, zəmanət deyil.';
  card.append(head,selection,stats,reason);return card;
}
function renderRecommendations(matches,feeds){
  const sets=recommendationSets(matches,feeds);
  const safeBox=document.getElementById('safePicks'),valueBox=document.getElementById('valuePicks');
  if(safeBox){safeBox.replaceChildren();if(!sets.safe.length){const p=document.createElement('p');p.className='notice';p.textContent='Bu tarixdə 5 liqada yüksək ehtimallı seçim üçün kifayət qədər təsdiqlənmiş statistik məlumat yoxdur.';safeBox.append(p);}else sets.safe.forEach(x=>safeBox.append(renderPickCard(x,false)));}
  if(valueBox){valueBox.replaceChildren();if(!sets.value.length){const p=document.createElement('p');p.className='notice';p.textContent='Bazar əmsalı və model üstünlüyü birlikdə təsdiqlənən riskli seçim tapılmadı.';valueBox.append(p);}else sets.value.forEach(x=>valueBox.append(renderPickCard(x,true)));}
  return sets;
}
function updateKickoffOptions(matches){
  const select=document.getElementById('kickoffFilter');if(!select)return;
  const selected=select.value;const clocks=[...new Set(matches.map(kickoffClock).filter(x=>x!=='Vaxt yoxdur'))].sort();
  select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='Bütün başlama saatları';select.append(all);
  clocks.forEach(clock=>{const opt=document.createElement('option');opt.value=clock;opt.textContent=clock+' · Bakı';select.append(opt);});
  if(clocks.includes(selected))select.value=selected;
}
function renderFixtureCard(match,analysis,feeds){
  const card=document.createElement('article');card.className='fixture';
  const left=document.createElement('div');left.className='fixture-main';
  const league=document.createElement('div');league.className='meta';league.textContent=leagueLabel(match);
  const teams=document.createElement('div');teams.className='teams';
  const homeLogo=teamLogo(match,'home'),awayLogo=teamLogo(match,'away');
  if(homeLogo||awayLogo){const visual=document.createElement('div');visual.className='team-visual';if(homeLogo)visual.append(homeLogo);const names=document.createElement('span');names.textContent=teamName(match,'home')+' — '+teamName(match,'away');visual.append(names);if(awayLogo)visual.append(awayLogo);teams.append(visual);}
  else teams.textContent=teamName(match,'home')+' — '+teamName(match,'away');
  const meta=document.createElement('div');meta.className='meta';meta.textContent=matchTime(match)+' · '+statusLabel(match);
  left.append(league,teams,meta);
  const score=document.createElement('strong');score.className='score';const sc=match.score||match.result||{};
  const hs=first(sc.home,sc.home_score,match.home_score),as=first(sc.away,sc.away_score,match.away_score),state=classifyStatus(match);
  score.textContent=(state==='live'||state==='finished')&&hs!==undefined&&as!==undefined?hs+' : '+as:'VS';
  card.append(left,score);
  const detail=document.createElement('div');detail.className='match-analysis';
  if(analysis){
    const line=document.createElement('div');line.textContent='SAKHAVAT MODEL (xG · Poisson/DC): 1 '+percent(analysis.outcomes.home)+' · X '+percent(analysis.outcomes.draw)+' · 2 '+percent(analysis.outcomes.away);
    const market=document.createElement('div');market.textContent=analysis.market?'BAZAR (marjasız) · 1 '+percent(analysis.market.home)+' · X '+percent(analysis.market.draw)+' · 2 '+percent(analysis.market.away):'BAZAR: əmsal məlumatı yoxdur';
    const provider=document.createElement('div');
    const pv=analysis.provider||{};
    if(match._providerProbabilityRepeated) provider.textContent='PROVIDER EHTİMALI: eyni rəqəmlər çox oyunda təkrarlandığı üçün etibarsız sayıldı';
    else if(analysis.providerMarketDuplicate) provider.textContent='PROVIDER EHTİMALI: bazar ehtimalı ilə eynidir; ayrıca müstəqil təsdiq sayılmır';
    else if(['home_win','draw','away_win'].every(k=>Number.isFinite(Number(pv[k])))) provider.textContent='PROVIDER EHTİMALI: 1 '+percent(pv.home_win)+' · X '+percent(pv.draw)+' · 2 '+percent(pv.away_win);
    else provider.textContent='PROVIDER EHTİMALI: etibarlı 1X2 məlumatı yoxdur';
    const scores=document.createElement('div');scores.textContent='Ən ehtimallı hesablar: '+analysis.scores.map(x=>x.score).join(' · ')+' | xG: '+analysis.hx.toFixed(2)+' - '+analysis.ax.toFixed(2);
    const homeStats=match._teamStats?.home,awayStats=match._teamStats?.away;
    const teamData=document.createElement('div');
    if(homeStats&&awayStats) teamData.textContent='TEAM xG (eyni liqa/mövsüm): '+homeStats.xgFor.toFixed(2)+'/'+homeStats.xgAgainst.toFixed(2)+' · '+awayStats.xgFor.toFixed(2)+'/'+awayStats.xgAgainst.toFixed(2)+' | forma: '+(homeStats.form||'—')+' / '+(awayStats.form||'—');
    else teamData.textContent='TEAM xG: eyni liqa və mövsüm üzrə kifayət qədər təsdiqlənmiş statistika yoxdur';
    const consensus=document.createElement('div');consensus.textContent=globalConsensusText(match,analysis,feeds);
    const verdict=document.createElement('div');verdict.className='verdict';verdict.textContent=finalVerdict(match,analysis,feeds).text;
    detail.append(line,market,provider,scores,teamData,consensus,verdict);
  }else{const note=document.createElement('div');note.textContent='SAKHAVAT MODEL: matçöncəsi xG məlumatı yoxdur; proqnoz hesablanmadı.';detail.append(note);}
  card.append(detail);return card;
}
async function loadFixtures() {
  renderEmpty('Oyunlar yüklənir...', 'Məlumat provayderdən alınır.');
  try {
    lastFixtureLoadAt = Date.now();
    const params = new URLSearchParams({ date: dateInput.value, limit: '100' });
    const league = document.getElementById('leagueFilter')?.value;
    if (league) params.set('league_id', league);
    const response = await fetchWithTimeout(apiUrl('/api/fixtures?' + params.toString()), { cache: 'no-store' }, 75000);
    const data = await response.json();
    if (!response.ok || data.ok === false || data.providerData?.success === false) throw new Error(data.error || 'Məlumat provayderi uğursuz cavab verdi');
    const liveLabel = 'API işləyir · Footballdata.io';
    connection.textContent = liveLabel;
    if (connectionState) connectionState.textContent = liveLabel;
    const games = Array.isArray(data.matches) ? data.matches :
      Array.isArray(data.providerData?.data?.matches) ? data.providerData.data.matches : [];
    if (!games.length) { document.getElementById('safePicks')?.replaceChildren(); document.getElementById('valuePicks')?.replaceChildren(); renderEmpty('Bu tarixdə oyun tapılmadı', 'Provayder bu tarix və seçilmiş liqa üçün oyun qaytarmadı.'); return; }
    // Fetch same-competition, same-season team xG; cache each team for this page session.
    const globalPicksPromiseForDate = Promise.all([fetchGlobalPicks(), fetchKiqiqPredictions(dateInput.value)])
      .then(([footballAnalytics, kiqiq]) => ({ footballAnalytics, kiqiq }));
    const enrichedGames = [];
    for (const match of games) {
      const leagueId = match.league?.league_id ?? match.league_id ?? match.competition?.league_id;
      const seasonId = match.season?.season_id ?? match.season_id;
      const homeId = match.home_team?.team_id ?? match.home_team_id;
      const awayId = match.away_team?.team_id ?? match.away_team_id;
      const existingOdds = match.odds?.match_winner || {};
      const has1x2 = !!normalizeOdds({ match_winner: existingOdds });
      const existingProbabilities = match.probabilities || {};
      const hasProbabilities = !!normalize1x2(existingProbabilities);
      const shouldEnrich = classifyStatus(match) === 'scheduled';
      const oddsPromise = !has1x2 && shouldEnrich ? fetchMatchOdds(match.match_id) : Promise.resolve(null);
      // Provider 1X2 probabilities are informational only, not a consensus vote.
      // Do not spend a second API request per fixture when the list lacks this optional block.
      const probabilitiesPromise = Promise.resolve(null);
      if (!leagueId || !seasonId || !homeId || !awayId) {
        const [odds, probabilities] = await Promise.all([oddsPromise, probabilitiesPromise]);
        enrichedGames.push({
          ...match,
          ...(normalizeOdds(odds || match.odds) ? { odds: normalizeOdds(odds || match.odds) } : {}),
          ...(normalize1x2(probabilities || match.probabilities)
            ? { probabilities: normalize1x2(probabilities || match.probabilities) } : {})
        });
        continue;
      }
      const [homeStats, awayStats, fetchedOdds, fetchedProbabilities] = await Promise.all([
        fetchTeamStats(homeId, seasonId, leagueId),
        fetchTeamStats(awayId, seasonId, leagueId),
        oddsPromise,
        probabilitiesPromise
      ]);
      enrichedGames.push({
        ...match,
        ...(normalizeOdds(fetchedOdds || match.odds)
          ? { odds: normalizeOdds(fetchedOdds || match.odds) } : {}),
        ...(normalize1x2(fetchedProbabilities || match.probabilities)
          ? { probabilities: normalize1x2(fetchedProbabilities || match.probabilities) } : {}),
        _teamStats: { home: homeStats, away: awayStats }
      });
    }
    const globalPicks = await globalPicksPromiseForDate;
    // Repeated identical provider 1X2 triples across separate fixtures can indicate
    // a fallback/default response. Suppress them rather than presenting false precision.
    const probabilityCounts = new Map();
    enrichedGames.forEach(game => {
      const p = normalize1x2(game.probabilities);
      if (!p) return;
      const key = [p.home_win, p.draw, p.away_win].map(v => v.toFixed(1)).join('/');
      probabilityCounts.set(key, (probabilityCounts.get(key) || 0) + 1);
    });
    enrichedGames.forEach(game => {
      const p = normalize1x2(game.probabilities);
      if (!p) return;
      const key = [p.home_win, p.draw, p.away_win].map(v => v.toFixed(1)).join('/');
      game._providerProbabilityRepeated = probabilityCounts.get(key) > 1;
    });
    // Save the original pre-match forecast only after invalid repeated provider probabilities are suppressed.
    enrichedGames.forEach(match => recordPredictionHistory(match, matchAnalysis(match), globalPicks));
    renderPredictionHistory();
    latestMatches=enrichedGames;
    updateKickoffOptions(enrichedGames);
    const pickSets=renderRecommendations(enrichedGames,globalPicks);
    let visible=enrichedGames.slice();
    const leagueNow=document.getElementById('leagueFilter')?.value;
    if(leagueNow)visible=visible.filter(m=>String(m.league?.league_id??m.league_id??m.competition?.league_id)===String(leagueNow));
    const timeNow=document.getElementById('kickoffFilter')?.value;
    if(timeNow)visible=visible.filter(m=>kickoffClock(m)===timeNow);
    if(currentPickFilter==='safe'){const ids=new Set(pickSets.safe.map(x=>String(x.match.match_id)));visible=visible.filter(m=>ids.has(String(m.match_id)));}
    if(currentPickFilter==='value'){const ids=new Set(pickSets.value.map(x=>String(x.match.match_id)));visible=visible.filter(m=>ids.has(String(m.match_id)));}
    const groupSame=document.getElementById('sameTimeToggle')?.checked!==false;
    visible.sort((a,b)=>(Number(a.date_unix)||0)-(Number(b.date_unix)||0));
    matchesBox.className='fixture-list';matchesBox.replaceChildren();
    if(!visible.length){renderEmpty('Uyğun oyun tapılmadı','Bu filtrə uyğun oyun yoxdur. Tarixi, liqanı və ya başlama saatını dəyiş.');return;}
    let lastClock='';
    visible.forEach(match=>{
      const clock=kickoffClock(match);
      if(groupSame&&clock!==lastClock){const label=document.createElement('div');label.className='kickoff-group';label.textContent=clock+' · BAKI VAXTI';matchesBox.append(label);lastClock=clock;}
      const analysis=matchAnalysis(match);
      matchesBox.append(renderFixtureCard(match,analysis,globalPicks));
    });
  } catch (error) {
    console.error('Fixture loading failed:', error);
    const failedLabel = 'API xətası · Footballdata.io';
    connection.textContent = failedLabel;
    if (connectionState) connectionState.textContent = failedLabel;
    renderEmpty('Məlumat yüklənmədi', error.name === 'TimeoutError' ? error.message : (error.message || 'Şəbəkə bağlantısı kəsildi.'));
  }
}
let lastFixtureLoadAt = 0;
document.getElementById('refresh')?.addEventListener('click', loadFixtures);
renderPredictionHistory();
document.getElementById('exportHistory')?.addEventListener('click', exportPredictionHistory);
document.getElementById('importHistory')?.addEventListener('click', () => document.getElementById('importHistoryFile')?.click());
document.getElementById('importHistoryFile')?.addEventListener('change', event => { const file = event.target.files?.[0]; if (file) importPredictionHistory(file); event.target.value = ''; });
document.getElementById('loadDate')?.addEventListener('click', loadFixtures);
dateInput.addEventListener('change', loadFixtures);
document.getElementById('leagueFilter')?.addEventListener('change', loadFixtures);
document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === button));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === button.dataset.tab));
}));
document.querySelectorAll('.quick').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.quick').forEach(x=>x.classList.toggle('active',x===button));
  currentPickFilter=button.dataset.pickFilter||'all';loadFixtures();
}));
document.querySelectorAll('.league-tile').forEach(button=>button.addEventListener('click',()=>{
  const filter=document.getElementById('leagueFilter');if(filter)filter.value=button.dataset.league;
  document.querySelector('[data-tab="matches"]')?.click();loadFixtures();
}));
document.getElementById('kickoffFilter')?.addEventListener('change',loadFixtures);
document.getElementById('leagueFilter')?.addEventListener('change',loadFixtures);
document.getElementById('sameTimeToggle')?.addEventListener('change',loadFixtures);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=8').catch(() => {}));
checkConnection(); loadFixtures(); auditPendingResults();
// Respect the provider's free request allowance: refresh scheduled fixtures hourly,
// but refresh every two minutes while a match is live.
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastFixtureLoadAt > 600000) checkConnection();
  if (Date.now() - lastAuditAt >= 60 * 60 * 1000) auditPendingResults();
  const liveNow = latestMatches.some(match => classifyStatus(match) === 'live');
  const refreshAfter = liveNow ? 120000 : 3600000;
  if (Date.now() - lastFixtureLoadAt >= refreshAfter) loadFixtures();
}, 60000);
