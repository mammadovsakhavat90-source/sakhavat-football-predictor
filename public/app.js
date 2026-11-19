const dateInput = document.getElementById('matchDate');
const matchesBox = document.getElementById('matchList');
const connection = document.getElementById('connection');
const API_ORIGIN = 'https://sakhavat-football-predictor.onrender.com';
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
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|afc|cf|sc|ac|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function teamLabelsMatch(a, b) {
  const x = normalizeTeamLabel(a), y = normalizeTeamLabel(b);
  return !!x && !!y && (x === y || x.endsWith(' ' + y) || y.endsWith(' ' + x));
}
async function fetchGlobalPicks() {
  if (globalPicksCache && Date.now() - globalPicksFetchedAt < 900000) return globalPicksCache;
  if (!globalPicksPromise) {
    globalPicksPromise = fetchWithTimeout('https://footballanalytics.pro/data/upcoming.json',
      { cache: 'no-store' }, 7000).then(async response => {
        if (!response.ok) return [];
        const payload = await response.json();
        globalPicksCache = Array.isArray(payload.data) ? payload.data : [];
        globalPicksFetchedAt = Date.now();
        return globalPicksCache;
      }).catch(() => []).finally(() => { globalPicksPromise = null; });
  }
  return globalPicksPromise;
}
async function fetchKiqiqPredictions(selectedDate) {
  if (!selectedDate) return [];
  if (kiqiqCache.has(selectedDate)) return kiqiqCache.get(selectedDate);
  const promise = (async () => {
    try {
      // Include the previous UTC day because late-night Baku fixtures can fall on
      // the previous calendar day in UTC.
      const fromDate = new Date(Date.parse(selectedDate + 'T00:00:00Z') - 86400000)
        .toISOString().slice(0, 10);
      const params = new URLSearchParams({ from: fromDate, to: selectedDate, limit: '100' });
      const response = await fetchWithTimeout('https://kiqiq.com/api/v1/predictions?' + params,
        { cache: 'no-store' }, 8000);
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload.fixtures) ? payload.fixtures : [];
    } catch { return []; }
  })();
  kiqiqCache.set(selectedDate, promise);
  return promise;
}
function findGlobalPick(match, rows) {
  const kickoff = Number(match.date_unix) * 1000;
  if (!(kickoff > 0)) return null;
  const home = teamName(match, 'home'), away = teamName(match, 'away');
  return rows.find(row => {
    const externalTime = Date.parse(row.kickoff_utc || '');
    return Number.isFinite(externalTime) && Math.abs(externalTime - kickoff) <= 4 * 60 * 60 * 1000 &&
      teamLabelsMatch(home, row.home_team) && teamLabelsMatch(away, row.away_team) &&
      ['1', 'X', '2'].includes(String(row.pick).toUpperCase());
  }) || null;
}
function findKiqiqPrediction(match, rows) {
  const kickoff = Number(match.date_unix) * 1000;
  if (!(kickoff > 0)) return null;
  const home = teamName(match, 'home'), away = teamName(match, 'away');
  return rows.find(row => {
    const externalTime = Date.parse(row.kickoff_iso || '');
    return Number.isFinite(externalTime) && Math.abs(externalTime - kickoff) <= 4 * 60 * 60 * 1000 &&
      teamLabelsMatch(home, row.home) && teamLabelsMatch(away, row.away);
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
function globalConsensusPick(match, analysis, feeds) {
  const external = findGlobalPick(match, feeds?.footballAnalytics || []);
  const kiqiq = findKiqiqPrediction(match, feeds?.kiqiq || []);
  const provider = analysis.provider || {};
  const values = [Number(provider.home_win), Number(provider.draw), Number(provider.away_win)];
  const providerPick = values.every(Number.isFinite) && values.every(v => v >= 0) && values.some(v => v > 0)
    ? ['1', 'X', '2'][values.indexOf(Math.max(...values))] : null;
  const kp = normalizeExternalProbabilities(kiqiq);
  const kiqiqPick = kp ? ['1', 'X', '2'][kp.indexOf(Math.max(...kp))] : null;
  const picks = [providerPick, kiqiqPick, external ? String(external.pick).toUpperCase() : null]
    .filter(pick => ['1', 'X', '2'].includes(pick));
  // One external source is not a consensus; require at least two independent feeds.
  if (picks.length < 2) return null;
  const counts = { '1': 0, X: 0, '2': 0 };
  picks.forEach(pick => counts[pick]++);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}
function finalVerdict(match, analysis, feeds) {
  const modelPick = ['home', 'draw', 'away'].reduce((best, key) =>
    analysis.outcomes[key] > analysis.outcomes[best] ? key : best, 'home');
  const model = { home: '1', draw: 'X', away: '2' }[modelPick];
  const consensus = globalConsensusPick(match, analysis, feeds);
  if (!consensus) return { pick: null, text: 'FINAL VERDICT: etibarlı ortaq seçim yoxdur; yekun seçim verilmir' };
  if (model === consensus) return { pick: model, text: 'FINAL VERDICT: SAKHAVAT MODEL və GLOBAL CONSENSUS razıdır · ' + model };
  return { pick: null, text: 'FINAL VERDICT: fikir ayrılığı var · MODEL ' + model + ' / CONSENSUS ' + consensus + ' · yekun seçim verilmir' };
}
function globalConsensusText(match, analysis, feeds) {
  const external = findGlobalPick(match, feeds?.footballAnalytics || []);
  const kiqiq = findKiqiqPrediction(match, feeds?.kiqiq || []);
  const provider = analysis.provider || {};
  const values = [Number(provider.home_win), Number(provider.draw), Number(provider.away_win)];
  const providerAvailable = values.every(Number.isFinite) && values.every(v => v >= 0) &&
    values.some(v => v > 0);
  const providerPick = providerAvailable
    ? ['1', 'X', '2'][values.indexOf(Math.max(...values))] : null;
  const kp = normalizeExternalProbabilities(kiqiq);
  const kiqiqPick = kp ? ['1', 'X', '2'][kp.indexOf(Math.max(...kp))] : null;
  const sources = [];
  if (providerPick) sources.push({ name: 'Footballdata.io', pick: providerPick });
  if (kiqiqPick) sources.push({ name: 'KiqIQ', pick: kiqiqPick });
  if (external) sources.push({ name: 'Football Analytics', pick: String(external.pick).toUpperCase() });
  if (!sources.length) return 'GLOBAL CONSENSUS: uyğun müstəqil proqnoz tapılmadı; mənbə əhatəsi məhduddur';
  const counts = { '1': 0, X: 0, '2': 0 };
  sources.forEach(source => { counts[source.pick]++; });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const names = sources.map(source => source.name + ': ' + source.pick).join(' · ');
  if (sources.length === 1) return 'GLOBAL CONSENSUS: yalnız 1 mənbə mövcuddur · ' + names;
  if (ranked[1] && ranked[0][1] === ranked[1][1]) return 'GLOBAL CONSENSUS: mənbələr arasında bərabərlik var; ortaq seçim yoxdur | ' + names;
  const agreement = top[1] === sources.length
    ? sources.length + '/' + sources.length + ' mənbə eyni istiqamətdədir · ' + top[0]
    : top[1] + '/' + sources.length + ' mənbənin ortaq istiqaməti · ' + top[0];
  return 'GLOBAL CONSENSUS: ' + agreement + ' | ' + names;
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
        if (played < 3 || !(Number(xg.xg_for_per_match) > 0) ||
            !(Number(xg.xg_against_per_match) > 0)) return null;
        return { played, xgFor: Number(xg.xg_for_per_match),
          xgAgainst: Number(xg.xg_against_per_match),
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
  return { hx, ax, outcomes, scores: scores.slice(0, 2), market, provider, best, edge, labels };
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
    kickoff: new Date(kickoff).toISOString(), league: first(match.league?.name,match.league_name,'Liqa'),
    probabilities, best, doubleChance: doubleChanceSelection(probabilities), exactScore: analysis.scores?.[0]?.score || null,
    xg: [analysis.hx,analysis.ax], consensus: globalConsensusText(match,analysis,feeds),
    consensusPick: globalConsensusPick(match,analysis,feeds),
    finalPick: globalConsensusPick(match,analysis,feeds) === best ? best : null,
    savedAt: new Date().toISOString(), result: null
  };
  rows.push(row);
  writePredictionHistory(rows);
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
  if(note) note.textContent='Tarixçə bu brauzerdə saxlanılır ('+rows.length+' oyun). Eyni telefonda və brauzerdə qalır; brauzer məlumatları silinsə tarixçə də silinə bilər.';
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
    connection.textContent = d.apiConfigured ? 'API aktivdir · ' + (d.provider || 'Provider') : 'API açarı yoxdur';
  } catch { connection.textContent = 'Bağlantı xətası'; }
}
async function loadFixtures() {
  renderEmpty('Oyunlar yüklənir...', 'Məlumat provayderdən alınır.');
  try {
    const params = new URLSearchParams({ date: dateInput.value });
    const league = document.getElementById('leagueFilter')?.value;
    if (league) params.set('league_id', league);
    const response = await fetchWithTimeout(apiUrl('/api/fixtures?' + params.toString()), { cache: 'no-store' }, 75000);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Məlumat alınmadı');
    const games = Array.isArray(data.matches) ? data.matches :
      Array.isArray(data.providerData?.data?.matches) ? data.providerData.data.matches : [];
    if (!games.length) { renderEmpty('Bu tarixdə oyun tapılmadı', 'Provayder bu tarix və seçilmiş liqa üçün oyun qaytarmadı.'); return; }
    // Fetch same-competition, same-season team xG; cache each team for this page session.
    const globalPicksPromiseForDate = Promise.all([fetchGlobalPicks(), fetchKiqiqPredictions(dateInput.value)])
      .then(([footballAnalytics, kiqiq]) => ({ footballAnalytics, kiqiq }));
    const enrichedGames = [];
    for (const match of games) {
      const leagueId = match.league?.league_id, seasonId = match.season?.season_id;
      const homeId = match.home_team?.team_id, awayId = match.away_team?.team_id;
      const existingOdds = match.odds?.match_winner || {};
      const has1x2 = !!normalizeOdds({ match_winner: existingOdds });
      const existingProbabilities = match.probabilities || {};
      const hasProbabilities = !!normalize1x2(existingProbabilities);
      const shouldEnrich = classifyStatus(match) === 'scheduled';
      const oddsPromise = !has1x2 && shouldEnrich ? fetchMatchOdds(match.match_id) : Promise.resolve(null);
      const probabilitiesPromise = !hasProbabilities && shouldEnrich
        ? fetchMatchProbabilities(match.match_id) : Promise.resolve(null);
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
    matchesBox.className = 'fixture-list'; matchesBox.replaceChildren();
    enrichedGames.forEach(match => {
      const card = document.createElement('article'); card.className = 'fixture';
      const left = document.createElement('div'); left.className = 'fixture-main';
      const leagueName = document.createElement('div'); leagueName.className = 'meta';
      leagueName.textContent = first(match.league?.name, match.league_name, match.competition?.name, 'Liqa');
      const teams = document.createElement('div'); teams.className = 'teams';
      const homeLogo = teamLogo(match, 'home'), awayLogo = teamLogo(match, 'away');
      if (homeLogo || awayLogo) {
        const visual = document.createElement('div'); visual.className = 'team-visual';
        if (homeLogo) visual.append(homeLogo);
        const names = document.createElement('span');
        names.textContent = teamName(match, 'home') + '  —  ' + teamName(match, 'away');
        visual.append(names);
        if (awayLogo) visual.append(awayLogo);
        teams.append(visual);
      } else {
        teams.textContent = teamName(match, 'home') + '  —  ' + teamName(match, 'away');
      }
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = matchTime(match) + ' · ' + statusLabel(match);
      left.append(leagueName, teams, meta);
      const score = document.createElement('strong'); score.className = 'score';
      const sc = match.score || match.result || {};
      const homeScore = first(sc.home, sc.home_score, match.home_score);
      const awayScore = first(sc.away, sc.away_score, match.away_score);
      const state = classifyStatus(match);
      score.textContent = (state === 'live' || state === 'finished') &&
        homeScore !== undefined && awayScore !== undefined
        ? homeScore + ' : ' + awayScore : 'VS';
      card.append(left, score);
      const analysis = matchAnalysis(match);
      if (analysis) {
        const detail = document.createElement('div'); detail.className = 'match-analysis';
        const modelLine = document.createElement('div'); modelLine.textContent =
          'SAKHAVAT MODEL (xG · Poisson/DC): 1 ' + percent(analysis.outcomes.home) +
          ' · X ' + percent(analysis.outcomes.draw) + ' · 2 ' + percent(analysis.outcomes.away);
        const marketLine = document.createElement('div'); marketLine.textContent = analysis.market
          ? 'BAZAR (marjasız): 1 ' + percent(analysis.market.home) + ' · X ' + percent(analysis.market.draw) + ' · 2 ' + percent(analysis.market.away)
          : 'BAZAR: əmsal məlumatı yoxdur';
        const providerLine = document.createElement('div'); providerLine.textContent =
          match._providerProbabilityRepeated
            ? 'PROVIDER EHTİMALI: eyni 1X2 göstəricisi başqa oyunlarda da təkrarlandığı üçün etibarlı mənbə kimi göstərilmir'
            : 'PROVIDER EHTİMALI: 1 ' + percent(analysis.provider.home_win) +
              ' · X ' + percent(analysis.provider.draw) + ' · 2 ' + percent(analysis.provider.away_win);
        const verdict = document.createElement('div'); verdict.className = 'verdict';
        verdict.textContent = finalVerdict(match, analysis, globalPicks).text;
        const scoresLine = document.createElement('div'); scoresLine.textContent =
          'Ən ehtimallı hesablar: ' + analysis.scores.map(x => x.score).join(' · ') +
          ' | xG: ' + analysis.hx.toFixed(2) + ' - ' + analysis.ax.toFixed(2);
        const statsLine = document.createElement('div'); statsLine.className = 'meta';
        const hs = match._teamStats?.home, as = match._teamStats?.away;
        statsLine.textContent = hs && as
          ? 'TEAM xG (eyni liqa/sezon): ' + hs.xgFor.toFixed(2) + '/' + hs.xgAgainst.toFixed(2) +
            ' · ' + as.xgFor.toFixed(2) + '/' + as.xgAgainst.toFixed(2) +
            ' | forma: ' + (hs.form || '—') + ' / ' + (as.form || '—')
          : 'TEAM xG: kifayət qədər təsdiqlənmiş komanda statistikası tapılmadı';
        const consensus = document.createElement('div'); consensus.className = 'meta';
        consensus.textContent = globalConsensusText(match, analysis, globalPicks);
        detail.append(modelLine, marketLine, providerLine, verdict, scoresLine, statsLine, consensus);
        card.append(detail);
      } else {
        const note = document.createElement('div'); note.className = 'match-analysis meta';
        note.textContent = 'SAKHAVAT MODEL: matçöncəsi xG məlumatı yoxdur; proqnoz hesablanmadı.';
        const consensus = document.createElement('div'); consensus.className = 'meta';
        consensus.textContent = globalConsensusText(match, { provider: match.probabilities || {} }, globalPicks);
        card.append(note, consensus);
      }
      matchesBox.append(card);
    });
  } catch (error) { console.error('Fixture loading failed:', error); renderEmpty('Məlumat yüklənmədi', error.name === 'TimeoutError' ? error.message : (error.message || 'Şəbəkə bağlantısı kəsildi.')); }
}
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
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=7').catch(() => {}));
checkConnection(); loadFixtures();
setInterval(() => { if (document.visibilityState === 'visible') { checkConnection(); loadFixtures(); } }, 300000);
