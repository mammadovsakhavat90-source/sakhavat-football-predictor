const dateInput = document.getElementById('match-date');
const fixturesBox = document.getElementById('fixtures');
const statusText = document.getElementById('status');
const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
dateInput.value = localDate;

async function loadFixtures() {
  fixturesBox.innerHTML = '';
  statusText.textContent = 'Oyunlar yüklənir…';
  try {
    const response = await fetch(`/api/fixtures?date=${encodeURIComponent(dateInput.value)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Məlumat alınmadı');
    const games = data.response || [];
    if (!games.length) fixturesBox.innerHTML = '<div class="empty">Bu tarix üçün oyun tapılmadı.</div>';
    games.forEach(item => {
      const el = document.createElement('article'); el.className = 'fixture';
      const home = item.teams?.home?.name || 'Ev sahibi';
      const away = item.teams?.away?.name || 'Qonaq';
      const time = item.fixture?.date ? new Date(item.fixture.date).toLocaleTimeString('az-AZ',{hour:'2-digit',minute:'2-digit'}) : '';
      const league = item.league?.name || '';
      el.innerHTML = `<div><div class="teams"></div><div class="meta"></div></div><strong></strong>`;
      el.querySelector('.teams').textContent = `${home} — ${away}`;
      el.querySelector('.meta').textContent = league;
      el.querySelector('strong').textContent = time;
      fixturesBox.appendChild(el);
    });
    statusText.textContent = `${games.length} oyun göstərilir.`;
  } catch (err) {
    statusText.textContent = err.message;
    fixturesBox.innerHTML = '<div class="empty">Canlı məlumat üçün server və API açarı qurulmalıdır.</div>';
  }
}
document.getElementById('refresh').addEventListener('click', loadFixtures);
dateInput.addEventListener('change', loadFixtures);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
loadFixtures();
