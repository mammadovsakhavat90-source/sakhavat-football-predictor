'use strict';
function finite(value,name,min=0.01,max=10){const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw new Error(name+' dəyəri '+min+'–'+max+' aralığında olmalıdır.');return n;}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function predict(input){
 const avgH=finite(input.leagueAvgHomeGoals,'leagueAvgHomeGoals',0.2,4),avgA=finite(input.leagueAvgAwayGoals,'leagueAvgAwayGoals',0.2,4);
 const hAtt=finite(input.homeAttack,'homeAttack',0.25,3),hDef=finite(input.homeDefense,'homeDefense',0.25,3),aAtt=finite(input.awayAttack,'awayAttack',0.25,3),aDef=finite(input.awayDefense,'awayDefense',0.25,3);
 let hx=avgH*hAtt*aDef,ax=avgA*aAtt*hDef;
 if(input.homeXgFor!=null&&input.awayXgAgainst!=null){hx=hx*.65+finite(input.homeXgFor,'homeXgFor',.05,4)*.35;hx=hx*.75+finite(input.awayXgAgainst,'awayXgAgainst',.05,4)*.25;}
 if(input.awayXgFor!=null&&input.homeXgAgainst!=null){ax=ax*.65+finite(input.awayXgFor,'awayXgFor',.05,4)*.35;ax=ax*.75+finite(input.homeXgAgainst,'homeXgAgainst',.05,4)*.25;}
 const eh=input.homeElo==null?null:finite(input.homeElo,'homeElo',800,2400),ea=input.awayElo==null?null:finite(input.awayElo,'awayElo',800,2400);
 if(eh!=null&&ea!=null){const f=Math.pow(10,(eh+60-ea)/1200),s=Math.sqrt(f);hx*=s;ax/=s;}
 hx=Math.max(.15,Math.min(4.5,hx));ax=Math.max(.15,Math.min(4.5,ax));
 const rho=input.dixonColesRho==null?-.08:Number(input.dixonColesRho);if(!Number.isFinite(rho)||rho<-.2||rho>.2)throw new Error('dixonColesRho -0.2 ilə 0.2 arasında olmalıdır.');
 let home=0,draw=0,away=0,total=0;const scores=[];
 for(let h=0;h<=8;h++)for(let a=0;a<=8;a++){let p=poisson(hx,h)*poisson(ax,a);if(h===0&&a===0)p*=1-hx*ax*rho;else if(h===0&&a===1)p*=1+hx*rho;else if(h===1&&a===0)p*=1+ax*rho;else if(h===1&&a===1)p*=1-rho;total+=p;if(h>a)home+=p;else if(h===a)draw+=p;else away+=p;scores.push({score:h+'-'+a,p});}
 const pct=v=>Number((v/total*100).toFixed(1));scores.sort((x,y)=>y.p-x.p);
 return {model:'SAKHAVAT Poisson + Dixon-Coles + Elo',expectedGoals:{home:Number(hx.toFixed(2)),away:Number(ax.toFixed(2))},probabilities:{homeWin:pct(home),draw:pct(draw),awayWin:pct(away)},mostLikelyScores:scores.slice(0,5).map(x=>({score:x.score,probability:Number((x.p/total*100).toFixed(1))})),dataQuality:{eloUsed:eh!=null&&ea!=null,xgUsed:input.homeXgFor!=null&&input.awayXgAgainst!=null&&input.awayXgFor!=null&&input.homeXgAgainst!=null,source:input.source||'user_supplied_statistics'},note:'Ehtimallar verilmiş statistik girişlərə əsaslanır. Girişlər real və eyni liqa/sezon üzrə deyilsə nəticə etibarlı deyil.'};
}
module.exports={predict};
