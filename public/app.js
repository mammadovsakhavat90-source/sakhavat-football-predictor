
const dateInput = document.getElementById('match-date');
const fixturesBox = document.getElementById('fixtures');
const statusText = document.getElementById('status');

const today = new Date();
const localDate = new Date(
  today.getTime() - today.getTimezoneOffset() * 60000
).toISOString().slice(0, 10);

dateInput.value = localDate;

function getMatchTime(match) {
  if (match.date_unix) {
    return new Date(match.date_unix * 1000)
      .toLocaleTimeString('az-AZ', {
        hour: '2-digit',
        minute: '2-digit'
      });
  }
  return '';
}

async function loadFixtures() {
  fixturesBox.innerHTML = '';
  statusText.textContent = 'Oyunlar yüklənir...';

  try {
    const response = await fetch(
      `/api/fixtures?date=${encodeURIComponent(dateInput.value)}`
    );

    const data = await response.json();

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || 'Məlumat alınmadı');
    }

    const games = data.matches || [];

    if (!games.length) {
      fixturesBox.innerHTML =
        '<div class="empty">Bu tarixdə seçilmiş liqalarda oyun tapılmadı.</div>';
      statusText.textContent = 'API bağlantısı aktivdir. Oyun yoxdur.';
      return;
    }

    games.forEach(match => {
      const home = match.home_team?.team_name || 'Ev sahibi';
      const away = match.away_team?.team_name || 'Qonaq';
      const league = match.league?.name || 'Liqa';
      const score = match.score;
      const time = getMatchTime(match);

      const result = score &&
        score.home !== null &&
        score.away !== null
        ? `${score.home} - ${score.away}`
        : time || 'Başlamayıb';

      const el = document.createElement('article');
      el.className = 'fixture';

      const info = document.createElement('div');
      const teams = document.createElement('div');
      const meta = document.createElement('div');
      const resultEl = document.createElement('strong');

      teams.className = 'teams';
      meta.className = 'meta';

      teams.textContent = `${home} — ${away}`;
      meta.textContent = `${league} · ${match.status || 'scheduled'}`;
      resultEl.textContent = result;

      info.appendChild(teams);
      info.appendChild(meta);
      el.appendChild(info);
      el.appendChild(resultEl);

      fixturesBox.appendChild(el);
    });

    statusText.textContent = `${games.length} oyun göstərilir.`;

  } catch (error) {
    statusText.textContent = error.message;
    fixturesBox.innerHTML =
      '<div class="empty">Məlumat yüklənmədi. Yenidən yoxlayın.</div>';
  }
}

document.getElementById('refresh')
  .addEventListener('click', loadFixtures);

dateInput.addEventListener('change', loadFixtures);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

loadFixtures();
