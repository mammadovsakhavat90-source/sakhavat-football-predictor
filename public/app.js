
const dateInput = document.getElementById('matchDate');
const matchesBox = document.getElementById('matchList');
const connection = document.getElementById('connection');

const today = new Date();
dateInput.value = new Date(
  today.getTime() - today.getTimezoneOffset() * 60000
).toISOString().slice(0, 10);

async function checkConnection() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    connection.textContent = data.apiConfigured
      ? 'API aktivdir · ' + data.provider
      : 'API açarı yoxdur';
  } catch {
    connection.textContent = 'Bağlantı xətası';
  }
}

function getTeam(match, side) {
  return match[side + '_team']?.team_name ||
    match[side + '_team']?.name ||
    match[side]?.name ||
    match[side + '_team_name'] ||
    (side === 'home' ? 'Ev sahibi' : 'Qonaq');
}

async function loadFixtures() {
  matchesBox.className = 'empty';
  matchesBox.textContent = 'Oyunlar yüklənir...';

  try {
    const response = await fetch(
      `/api/fixtures?date=${encodeURIComponent(dateInput.value)}`
    );

    const data = await response.json();

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || 'Məlumat alınmadı');
    }

    const games = data.matches || [];

    matchesBox.innerHTML = '';

    if (!games.length) {
      matchesBox.className = 'empty';
      matchesBox.innerHTML =
        '<div class="empty-icon">⌁</div>' +
        '<b>Bu tarixdə oyun tapılmadı</b>' +
        '<p>Seçilmiş liqalar üzrə provayder məlumat qaytarmadı.</p>';
      return;
    }

    matchesBox.className = '';

    games.forEach(match => {
      const card = document.createElement('article');
      card.className = 'fixture';

      const teams = document.createElement('div');
      teams.className = 'teams';
      teams.textContent =
        `${getTeam(match, 'home')} — ${getTeam(match, 'away')}`;

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent =
        match.league?.name ||
        match.league_name ||
        'Liqa məlumatı yoxdur';

      const result = document.createElement('strong');
      const score = match.score;

      result.textContent =
        score && score.home != null && score.away != null
          ? `${score.home} - ${score.away}`
          : 'Nəticə gözlənilir';

      card.append(teams, meta, result);
      matchesBox.appendChild(card);
    });

  } catch (error) {
    matchesBox.className = 'empty';
    matchesBox.textContent = 'Xəta: ' + error.message;
  }
}

document.getElementById('refresh')
  ?.addEventListener('click', loadFixtures);

document.getElementById('loadDate')
  .addEventListener('click', loadFixtures);

dateInput.addEventListener('change', loadFixtures);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

checkConnection();
loadFixtures();
