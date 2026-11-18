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
  if (!raw) return 'Vaxt göstərilməyib';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleTimeString('az-AZ', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku'
  }) + ' · Bakı';
}

function poissonProbability(lambda, goals) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= goals; i++) p *= lambda / i;
  return p;
}
function matchAnalysis(match) {
  const hx = Number(match.xg?.prematch?.home);
  const ax = Number(match.xg?.prematch?.away);
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
async function checkConnection() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' }); const d = await r.json();
    connection.textContent = d.apiConfigured ? 'API aktivdir · ' + (d.provider || 'Provider') : 'API açarı yoxdur';
  } catch { connection.textContent = 'Bağlantı xətası'; }
}
async function loadFixtures() {
  renderEmpty('Oyunlar yüklənir...', 'Məlumat provayderdən alınır.');
  try {
    const params = new URLSearchParams({ date: dateInput.value });
    const league = document.getElementById('leagueFilter')?.value;
    if (league) params.set('league_id', league);
    const response = await fetch('/api/fixtures?' + params.toString(), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Məlumat alınmadı');
    const games = Array.isArray(data.matches) ? data.matches :
      Array.isArray(data.providerData?.data?.matches) ? data.providerData.data.matches : [];
    if (!games.length) { renderEmpty('Bu tarixdə oyun tapılmadı', 'Provayder bu tarix və seçilmiş liqa üçün oyun qaytarmadı.'); return; }
    matchesBox.className = 'fixture-list'; matchesBox.replaceChildren();
    games.forEach(match => {
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
          ' (' + (analysis.edge > 0 ? '+' : '') + analysis.edge.toFixed(1) + faiz bəndi)';
        const scoresLine = document.createElement('div'); scoresLine.textContent =
          'Ən ehtimallı hesablar: ' + analysis.scores.map(x => x.score).join(' · ') +
          ' | xG: ' + analysis.hx.toFixed(2) + ' - ' + analysis.ax.toFixed(2);
        const consensus = document.createElement('div'); consensus.className = 'meta';
        consensus.textContent = 'GLOBAL CONSENSUS: aktiv deyil · yalnız 1 provayder mənbəyi var';
        detail.append(modelLine, marketLine, providerLine, verdict, scoresLine, consensus);
        card.append(detail);
      } else {
        const note = document.createElement('div'); note.className = 'match-analysis meta';
        note.textContent = 'SAKHAVAT MODEL: matçöncəsi xG məlumatı yoxdur; proqnoz hesablanmadı.';
        card.append(note);
      }
      matchesBox.append(card);
    });
  } catch (error) { renderEmpty('Məlumat yüklənmədi', error.name === 'TimeoutError' ? 'Server 20 saniyə ərzində cavab vermədi. Yenilə düyməsini yenidən yoxla.' : error.message || 'Şəbəkə bağlantısı kəsildi.'); }
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
