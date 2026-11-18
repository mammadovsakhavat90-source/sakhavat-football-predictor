const dateInput = document.getElementById('matchDate');
const matchesBox = document.getElementById('matchList');
const connection = document.getElementById('connection');
const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
dateInput.value = localToday.toISOString().slice(0, 10);
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
    d = new Date(/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(value)
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
function globalConsensusText(match, analysis, rows) {
  const external = findGlobalPick(match, rows);
  const provider = analysis.provider || {};
  const values = [Number(provider.home_win), Number(provider.draw), Number(provider.away_win)];
  const providerAvailable = values.every(Number.isFinite) && values.every(v => v >= 0) &&
    values.some(v => v > 0);
  const providerPick = providerAvailable
    ? ['1', 'X', '2'][values.indexOf(Math.max(...values))] : null;
  const providerText = providerPick ? 'Footballdata.io: ' + providerPick : null;
  const externalText = external ? 'Football Analytics: ' + String(external.pick).toUpperCase() : null;
  if (providerText && externalText) return 'GLOBAL CONSENSUS: ' +
    (providerPick === String(external.pick).toUpperCase()
      ? '2/2 mənbə eyni istiqaməti göstərir · ' + providerPick
      : 'mənbələr fərqli istiqamət göstərir') + ' | ' + providerText + ' · ' + externalText;
  if (externalText) return 'GLOBAL CONSENSUS: 1 xarici model pick-i · ' + externalText +
    ' | ikinci ehtimal mənbəyi yoxdur';
  if (providerText) return 'GLOBAL CONSENSUS: yalnız Footballdata.io ehtimalı mövcuddur · ' +
    providerText + ' | xarici model pick-i tapılmadı';
  return 'GLOBAL CONSENSUS: Football Analytics açıq feed-ində bu oyun hələ yoxdur · əhatə və tarix pəncərəsini yoxlamaq lazımdır';
}
const teamStatsCache = new Map();
const matchOddsCache = new Map();
const matchProbabilityCache = new Map();
function unwrapMatchPayload(payload, field) {
  if (!payload || payload.ok === false) return null;
  const roots = [payload.data, payload.providerData?.data, payload.providerData, payload].filter(Boolean);
  for (const root of roots) {
    const value = root[field] || root.match?.[field] || root.data?.[field] || root.data?.match?.[field];
    if (value && typeof value === 'object') return value;
  }
  return null;
}
async function fetchMatchOdds(matchId) {
  if (!matchId) return null;
  const key = String(matchId);
  if (!matchOddsCache.has(key)) {
    const request = fetchWithTimeout('/api/matches/' + encodeURIComponent(key) + '/odds',
      { cache: 'no-store' }, 12000).then(async response => {
        if (!response.ok) return null;
        const payload = await response.json();
        return unwrapMatchPayload(payload, 'odds');
      }).catch(() => null);
    matchOddsCache.set(key, request);
  }
  return matchOddsCache.get(key);
}
async function fetchMatchProbabilities(matchId) {
  if (!matchId) return null;
  const key = String(matchId);
  if (!matchProbabilityCache.has(key)) {
    const request = fetchWithTimeout('/api/matches/' + encodeURIComponent(key) + '/probabilities',
      { cache: 'no-store' }, 12000).then(async response => {
        if (!response.ok) return null;
        const payload = await response.json();
        const probabilities = unwrapMatchPayload(payload, 'probabilities');
        if (!probabilities) return null;
        const winner = probabilities.match_winner || probabilities;
        return {
          ...probabilities,
          home_win: Number(winner.home_win ?? winner.home),
          draw: Number(winner.draw),
          away_win: Number(winner.away_win ?? winner.away)
        };
      }).catch(() => null);
    matchProbabilityCache.set(key, request);
  }
  return matchProbabilityCache.get(key);
}
async function fetchTeamStats(teamId, seasonId, leagueId) {
  if (!teamId || !seasonId || !leagueId) return null;
  const key = [teamId, seasonId, leagueId].join(':');
  if (!teamStatsCache.has(key)) {
    const request = fetchWithTimeout('/api/teams/' + encodeURIComponent(teamId) +
      '/stats?' + new URLSearchParams({ season_id: seasonId, league_id: leagueId }),
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
  const odds = match.odds?.match_winner || {};
  const provider = match.probabilities || {};
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
function percent(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(1) + '%' : '—'; }

function renderEmpty(title, detail) {
  matchesBox.className = 'empty'; matchesBox.replaceChildren();
  const icon = document.createElement('div'); icon.className = 'empty-icon'; icon.textContent = '⌁';
  const heading = document.createElement('b'); heading.textContent = title;
  const p = document.createElement('p'); p.textContent = detail;
  matchesBox.append(icon, heading, p);
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer;
  try {
    const request = fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        const error = new Error('Sorğu ' + Math.round(timeoutMs / 1000) + ' saniyəyə cavab vermədi.');
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
    const r = await fetchWithTimeout('/api/status', { cache: 'no-store' }, 10000); const d = await r.json();
    connection.textContent = d.apiConfigured ? 'API aktivdir · ' + (d.provider || 'Provider') : 'API açarı yoxdur';
  } catch { connection.textContent = 'Bağlantı xətası'; }
}
async function loadFixtures() {
  renderEmpty('Oyunlar yüklənir...', 'Məlumat provayderdən alınır.');
  try {
    const params = new URLSearchParams({ date: dateInput.value });
    const league = document.getElementById('leagueFilter')?.value;
    if (league) params.set('league_id', league);
    const response = await fetchWithTimeout('/api/fixtures?' + params.toString(), { cache: 'no-store' }, 18000);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Məlumat alınmadı');
    const games = Array.isArray(data.matches) ? data.matches :
      Array.isArray(data.providerData?.data?.matches) ? data.providerData.data.matches : [];
    if (!games.length) { renderEmpty('Bu tarixdə oyun tapılmadı', 'Provayder bu tarix və seçilmiş liqa üçün oyun qaytarmadı.'); return; }
    // Fetch same-competition, same-season team xG; cache each team for this page session.
    const globalPicksPromiseForDate = fetchGlobalPicks();
    const enrichedGames = [];
    for (const match of games) {
      const leagueId = match.league?.league_id, seasonId = match.season?.season_id;
      const homeId = match.home_team?.team_id, awayId = match.away_team?.team_id;
      const existingOdds = match.odds?.match_winner || {};
      const has1x2 = ['home', 'draw', 'away'].every(k => Number(existingOdds[k]) > 1);
      const existingProbabilities = match.probabilities || {};
      const hasProbabilities = ['home_win', 'draw', 'away_win'].some(k =>
        Number.isFinite(Number(existingProbabilities[k])) && Number(existingProbabilities[k]) > 0);
      const shouldEnrich = classifyStatus(match) === 'scheduled';
      const oddsPromise = !has1x2 && shouldEnrich ? fetchMatchOdds(match.match_id) : Promise.resolve(null);
      const probabilitiesPromise = !hasProbabilities && shouldEnrich
        ? fetchMatchProbabilities(match.match_id) : Promise.resolve(null);
      if (!leagueId || !seasonId || !homeId || !awayId) {
        const [odds, probabilities] = await Promise.all([oddsPromise, probabilitiesPromise]);
        enrichedGames.push({
          ...match,
          ...(odds ? { odds } : {}),
          ...(probabilities ? { probabilities } : {})
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
        ...(fetchedOdds ? { odds: fetchedOdds } : {}),
        ...(fetchedProbabilities ? { probabilities: fetchedProbabilities } : {}),
        _teamStats: { home: homeStats, away: awayStats }
      });
    }
    const globalPicks = await globalPicksPromiseForDate;
    matchesBox.className = 'fixture-list'; matchesBox.replaceChildren();
    enrichedGames.forEach(match => {
      const card = document.createElement('article'); card.className = 'fixture';
      const left = document.createElement('div'); left.className = 'fixture-main';
      const leagueName = document.createElement('div'); leagueName.className = 'meta';
      leagueName.textContent = first(match.league?.name, match.league_name, match.competition?.name, 'Liqa');
      const teams = document.createElement('div'); teams.className = 'teams';
      teams.textContent = teamName(match, 'home') + '  —  ' + teamName(match, 'away');
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
          'PROVIDER EHTİMALI: 1 ' + percent(analysis.provider.home_win) +
          ' · X ' + percent(analysis.provider.draw) + ' · 2 ' + percent(analysis.provider.away_win);
        const verdict = document.createElement('div'); verdict.className = 'verdict';
        verdict.textContent = analysis.edge === null ? 'FINAL VERDICT: bazar müqayisəsi mümkün deyil' :
          Math.abs(analysis.edge) < 3 ? 'FINAL VERDICT: aydın statistik üstünlük yoxdur' :
          'FINAL VERDICT: ' + (analysis.edge > 0 ? '1/X/2 ' + analysis.labels[analysis.best] + ' istiqamətində model üstünlüyü' : 'bazar modeldən daha güclüdür') +
          ' (' + (analysis.edge > 0 ? '+' : '') + analysis.edge.toFixed(1) + ' faiz bəndi)';
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
document.getElementById('loadDate')?.addEventListener('click', loadFixtures);
dateInput.addEventListener('change', loadFixtures);
document.getElementById('leagueFilter')?.addEventListener('change', loadFixtures);
document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === button));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === button.dataset.tab));
}));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=6').catch(() => {}));
checkConnection(); loadFixtures();
setInterval(() => { if (document.visibilityState === 'visible') { checkConnection(); loadFixtures(); } }, 300000);
