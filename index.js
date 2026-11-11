import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../public');
const port = Number(process.env.PORT || 8787);
const apiKey = process.env.API_FOOTBALL_KEY || '';
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

async function apiFootball(endpoint) {
  if (!apiKey || apiKey.includes('PASTE_')) throw new Error('API_FOOTBALL_KEY_NOT_CONFIGURED');
  const response = await fetch(`https://v3.football.api-sports.io/${endpoint}`, {headers:{'x-apisports-key':apiKey}});
  if (!response.ok) throw new Error(`FOOTBALL_API_HTTP_${response.status}`);
  const data = await response.json();
  if (data.errors && Object.keys(data.errors).length) throw new Error('FOOTBALL_API_ERROR');
  return data.response || [];
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin','*');
  if (url.pathname.startsWith('/api/')) {
    try {
      let data;
      if (url.pathname === '/api/status') data = {configured: !!apiKey && !apiKey.includes('PASTE_'), provider:'API-Football'};
      else if (url.pathname === '/api/fixtures') {
        const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
        const league = url.searchParams.get('league');
        const season = url.searchParams.get('season') || String(new Date().getFullYear());
        let endpoint = `fixtures?date=${encodeURIComponent(date)}`;
        if (league) endpoint += `&league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`;
        data = await apiFootball(endpoint);
      } else if (url.pathname === '/api/standings') {
        const league = url.searchParams.get('league'); const season = url.searchParams.get('season') || String(new Date().getFullYear());
        if (!league) throw new Error('LEAGUE_ID_REQUIRED');
        data = await apiFootball(`standings?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`);
      } else { res.writeHead(404); res.end(JSON.stringify({error:'NOT_FOUND'})); return; }
      res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data));
    } catch(e) { res.writeHead(503, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root)) {res.writeHead(403);res.end('Forbidden');return;}
  fs.readFile(file,(err,buf)=>{ if(err){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(buf); });
});
server.listen(port,()=>console.log(`Sakhavat Predictor running on http://localhost:${port}`));
