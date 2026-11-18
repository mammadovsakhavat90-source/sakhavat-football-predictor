const dateInput = document.getElementById('matchDate');
const matchesBox = document.getElementById('matchList');
const connection = document.getElementById('connection');
const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
dateInput.value = localToday.toISOString().slice(0, 10);
const first = (...values) => values.find(v => v !== undefined && v !== null && String(v).trim() !== '');

function teamName(match, side) {
  const team = match[side + '_team'] || match[side] || {};
  if (typeof team === 'string') return team;
  return first(team.team_name, team.name, team.display_name, match[side + '_team_name'],
    match[side + '_name'], match[side + '_team'], side === 'home' ? 'Ev sahibi' : 'Qonaq');
}
function rawStatus(match) {
  return String(first(match.status_localized, match.status, match.state, '')).toLowerCase();
}
function statusLabel(match) {
  const s = rawStatus(match);
  if (/finish|complete|ended|full/.test(s)) return 'Başa çatıb';
  if (/live|progress|half|in.play/.test(s)) return 'Canlı';
  if (/postpon|cancel|abandon/.test(s)) return 'Təxirə salınıb';
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
    const response = await fetch('/api/fixtures?' + params.toString(), { cache: 'no-store' });
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
      const state = rawStatus(match);
      const hasStarted = /live|progress|half|in.play|finish|complete|ended|full/.test(state);
      // Some providers send 0-0 placeholders for fixtures that have not started.
      score.textContent = hasStarted && homeScore !== undefined && awayScore !== undefined
        ? homeScore + ' : ' + awayScore : 'VS';
      card.append(left, score); matchesBox.append(card);
    });
  } catch (error) { renderEmpty('Məlumat yüklənmədi', error.message); }
}
document.getElementById('refresh')?.addEventListener('click', loadFixtures);
document.getElementById('loadDate')?.addEventListener('click', loadFixtures);
dateInput.addEventListener('change', loadFixtures);
document.getElementById('leagueFilter')?.addEventListener('change', loadFixtures);
document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === button));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === button.dataset.tab));
}));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
checkConnection(); loadFixtures();
setInterval(() => { if (document.visibilityState === 'visible') { checkConnection(); loadFixtures(); } }, 300000);
