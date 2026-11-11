server/index.jsconst express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = 'https://v3.football.api-sports.io';

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/status', (_req, res) => res.json({
  ok: true,
  app: 'SAKHAVAT FOOTBALL PREDICTOR 1.0',
  apiConfigured: Boolean(API_KEY)
}));

async function apiFootball(endpoint, res) {
  if (!API_KEY) return res.status(503).json({ error: 'API_FOOTBALL_KEY is not configured on the server.' });
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Football data provider error', details: data });
    return res.json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Could not reach football data provider.' });
  }
}

app.get('/api/fixtures', (req, res) => {
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Use date=YYYY-MM-DD' });
  return apiFootball(`/fixtures?date=${encodeURIComponent(date)}`, res);
});
app.get('/api/standings', (req, res) => {
  const { league, season } = req.query;
  if (!league || !season) return res.status(400).json({ error: 'Use league and season query parameters.' });
  return apiFootball(`/standings?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`, res);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.listen(PORT, () => console.log(`SAKHAVAT FOOTBALL PREDICTOR running on port ${PORT}`));
