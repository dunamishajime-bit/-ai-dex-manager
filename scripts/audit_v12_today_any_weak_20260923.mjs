const entries=[
  {name:"XRP 04:06",symbol:"XRPUSDT",entry:"2026-09-22T19:06:20Z",side:"LONG"},
  {name:"INJ 08:40",symbol:"INJUSDT",entry:"2026-09-22T23:40:22Z",side:"LONG"},
  {name:"XRP 08:40",symbol:"XRPUSDT",entry:"2026-09-22T23:40:31Z",side:"LONG"},
  {name:"LTC 13:00",symbol:"LTCUSDT",entry:"2026-09-23T04:00:27Z",side:"LONG"},
  {name:"SOL 15:00",symbol:"SOLUSDT",entry:"2026-09-23T06:00:31Z",side:"LONG"},
  {name:"NEAR 17:00",symbol:"NEARUSDT",entry:"2026-09-23T08:00:28Z",side:"LONG"},
];
const API="https://www.okx.com/api/v5/market/candles";
async function bars(symbol){
  const inst=symbol.replace("USDT","-USDT-SWAP");
  const u=API+"?instId="+inst+"&bar=2H&limit=100";
  const r=await fetch(u); if(!r.ok) throw new Error(symbol+" "+r.status+" "+await r.text());
  const j=await r.json(); if(j.code!=="0") throw new Error(symbol+" "+JSON.stringify(j));
  const a=j.data.map(x=>({ot:+x[0],ct:+x[0]+2*3600*1000-1,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
  return a.sort((a,b)=>a.ot-b.ot);
}
function idxBefore(b,t){let out=-1;for(let i=0;i<b.length;i++)if(b[i].ct<t)out=i;return out;}
function ret(b,i,n){return i>=n?b[i].c/b[i-n].c-1:NaN;}
function er(b,i,n){if(i<n)return NaN;let path=0;for(let k=i-n+1;k<=i;k++)path+=Math.abs(b[k].c-b[k-1].c);return path?Math.abs(b[i].c-b[i-n].c)/path:0;}
function vr(b,i){if(i<20)return NaN;let m=0;for(let k=i-20;k<i;k++)m+=b[k].v;m/=20;return m?b[i].v/m:NaN;}
const symbols=[...new Set(["BTCUSDT",...entries.map(x=>x.symbol)])];
const all=Object.fromEntries(await Promise.all(symbols.map(async s=>[s,await bars(s)])));
const out=[];
for(const e of entries){
  const t=Date.parse(e.entry), bb=all.BTCUSDT, sb=all[e.symbol];
  const bi=idxBefore(bb,t), si=idxBefore(sb,t);
  const btc24=ret(bb,bi,12), sym24=ret(sb,si,12);
  const f={barClose:new Date(sb[si].ct).toISOString(),btc6:ret(bb,bi,3),btc12:ret(bb,bi,6),btcEr12:er(bb,bi,6),btcEr24:er(bb,bi,12),sym6:ret(sb,si,3),volumeRatio:vr(sb,si),rel24:sym24-btc24,btc24,sym24};
  const A=f.btcEr24>=.50&&f.btcEr12<.50;
  const B=f.btcEr24>=.60&&f.sym6<.01;
  const C=f.volumeRatio>=2.0&&f.rel24<0;
  out.push({...e,...f,A,B,C,BLOCK:A||B||C});
}
console.log(JSON.stringify(out,null,2));