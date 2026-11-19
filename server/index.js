const express=require('express');
const path=require('path');
const {predict}=require('./prediction');
const app=express(),PORT=process.env.PORT||3000,API_KEY=process.env.FOOTBALLDATA_API_KEY,API_BASE='https://footballdata.io/api/v1';
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.json({limit:'32kb'}));
app.use(express.static(path.join(__dirname,'..','public')));
async function footballData(endpoint,res){
 if(!API_KEY)return res.status(503).json({ok:false,error:'FOOTBALLDATA_API_KEY is not configured.'});
 try{const response=await fetch(`${API_BASE}${endpoint}`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)});const data=await response.json();if(!response.ok)return res.status(response.status).json({ok:false,error:'Football data provider error',details:data});return res.json({ok:true,provider:'Footballdata.io',providerData:data,matches:data.data?.matches||(Array.isArray(data.data)?data.data:[])});}
 catch(error){const timedOut=error.name==='TimeoutError'||error.name==='AbortError';return res.status(timedOut?504:502).json({ok:false,error:timedOut?'Football data provider timed out after 12 seconds.':'Could not reach Footballdata.io',details:error.message});}
}

// Provider data routes used by the analytics layer. Only fixed endpoint templates are exposed.
async function providerGet(endpoint,res){
 if(!API_KEY)return res.status(503).json({ok:false,error:'FOOTBALLDATA_API_KEY is not configured.'});
 try{
  const response=await fetch(API_BASE+endpoint,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  const data=await response.json();
  if(!response.ok)return res.status(response.status).json({ok:false,error:'Football data provider error',details:data});
  return res.json({ok:true,provider:'Footballdata.io',providerData:data,data:data.data??data});
 }catch(error){const timedOut=error.name==='TimeoutError'||error.name==='AbortError';return res.status(timedOut?504:502).json({ok:false,error:timedOut?'Provider sorğusu 12 saniyədə cavab vermədi.':'Footballdata.io bağlantı xətası',details:error.message});}
}
app.get('/api/teams/search',(req,res)=>{
 const q=String(req.query.q||'').trim().slice(0,80);
 if(!q)return res.status(400).json({ok:false,error:'q parametrində komanda adı tələb olunur.'});
 return providerGet('/teams?'+new URLSearchParams({q}),res);
});
app.get('/api/teams/:id/stats',(req,res)=>{
 if(!/^\d+$/.test(req.params.id))return res.status(400).json({ok:false,error:'Yanlış team id.'});
 const params=new URLSearchParams();
 if(req.query.season_id&&/^\d+$/.test(String(req.query.season_id)))params.set('season_id',req.query.season_id);
 if(req.query.league_id&&/^\d+$/.test(String(req.query.league_id)))params.set('league_id',req.query.league_id);
 return providerGet('/teams/'+req.params.id+'/stats'+(params.size?'?'+params.toString():''),res);
});
app.get('/api/teams/:id/matches',(req,res)=>{
 if(!/^\d+$/.test(req.params.id))return res.status(400).json({ok:false,error:'Yanlış team id.'});
 return providerGet('/teams/'+req.params.id+'/matches',res);
});
app.get('/api/matches/:id',(req,res)=>{
 if(!/^\d+$/.test(req.params.id))return res.status(400).json({ok:false,error:'Yanlış match id.'});
 return providerGet('/matches/'+req.params.id,res);
});
app.get('/api/matches/:id/:kind',(req,res)=>{
 if(!/^\d+$/.test(req.params.id)||!['stats','odds','probabilities','events'].includes(req.params.kind))return res.status(400).json({ok:false,error:'Yanlış match sorğusu.'});
 return providerGet('/matches/'+req.params.id+'/'+req.params.kind,res);
});

app.get('/api/status',(_req,res)=>res.json({ok:true,app:'SAKHAVAT FOOTBALL PREDICTOR 1.0',apiConfigured:Boolean(API_KEY),provider:'Footballdata.io',predictionEngine:'Frontend: xG + Poisson + Dixon-Coles; Elo optional only with verified input ratings',predictionMode:'Elo is not auto-applied because no verified rating feed is connected'}));
app.get('/api/fixtures',(req,res)=>{const date=req.query.date,leagueId=req.query.league_id;if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({ok:false,error:'Use date=YYYY-MM-DD'});const params=new URLSearchParams({date});if(leagueId)params.set('league_id',leagueId);return footballData(`/matches?${params.toString()}`,res);});
app.post('/api/predict',(req,res)=>{try{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({ok:false,error:'JSON statistik girişləri tələb olunur.'});return res.json({ok:true,prediction:predict(req.body)});}catch(error){return res.status(400).json({ok:false,error:error.message});}});
app.listen(PORT,()=>console.log(`SAKHAVAT FOOTBALL PREDICTOR running on port ${PORT}`));
