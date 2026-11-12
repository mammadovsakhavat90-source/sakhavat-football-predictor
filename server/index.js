
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.FOOTBALLDATA_API_KEY;
const API_BASE = 'https://footballdata.io/api/v1';

app.use(express.static(path.join(__dirname, '..', 'public')));

async function footballData(endpoint, res) {
  if (!API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'FOOTBALLDATA_API_KEY is not configured.'
    });
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: 'Football data provider error',
        details: data
      });
    }

    return res.json({
      ok: true,
      provider: 'Footballdata.io',
      providerData: data,
      matches: data.data?.matches || (
        Array.isArray(data.data) ? data.data : []
      )
    });

  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'Could not reach Footballdata.io',
      details: error.message
    });
  }
}

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    app: 'SAKHAVAT FOOTBALL PREDICTOR 1.0',
    apiConfigured: Boolean(API_KEY),
    provider: 'Footballdata.io'
  });
});

app.get('/api/fixtures', (req, res) => {
  const date = req.query.date;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: 'Use date=YYYY-MM-DD'
    });
  }

  return footballData(
    `/matches/date/${encodeURIComponent(date)}`,
    res
  );
});

app.get('/api/leagues', (_req, res) => {
  return footballData('/leagues', res);
});

app.get('/api/usage', (_req, res) => {
  return footballData('/account/usage', res);
});

app.get('*', (_req, res) => {
  res.sendFile(
    path.join(__dirname, '..', 'public', 'index.html')
  );
});

app.listen(PORT, () => {
  console.log(
    `SAKHAVAT FOOTBALL PREDICTOR running on port ${PORT}`
  );
});
