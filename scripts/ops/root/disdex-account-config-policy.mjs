export function configurationPlan(symbols, positions, orders) {
 if (!Array.isArray(positions) || !Array.isArray(orders)) throw new Error("CONFIG_DATA_INVALID");
 const out=[];
 for (const symbol of symbols) {
  const rows=positions.filter(r=>r.symbol===symbol);
  if (!rows.length) throw new Error("CONFIG_SYMBOL_MISSING:"+symbol);
  for (const r of rows) {
   if (!["number","string"].includes(typeof r.positionAmt) || !["number","string"].includes(typeof r.leverage) || r.positionAmt==null || String(r.positionAmt).trim()==="" || r.leverage==null || String(r.leverage).trim()==="" || !Number.isFinite(Number(r.positionAmt)) || !Number.isFinite(Number(r.leverage)) || Number(r.leverage)<=0) throw new Error("CONFIG_ROW_INVALID:"+symbol);
   const margin=String(r.marginType || (r.isolated===false?"cross":r.isolated===true?"isolated":"")).toLowerCase();
   if (Number(r.leverage)===5 && ["cross","crossed"].includes(margin)) continue;
   if (rows.some(x=>Number(x.positionAmt)!==0) || orders.some(o=>o.symbol===symbol)) throw new Error("CONFIG_EXPOSURE_REQUIRES_OPERATOR:"+symbol);
   if (!["cross","crossed","isolated"].includes(margin)) throw new Error("CONFIG_MARGIN_UNKNOWN:"+symbol);
   if (!out.some(x=>x.symbol===symbol)) out.push({symbol,marginChange:!["cross","crossed"].includes(margin),leverageChange:Number(r.leverage)!==5});
  }
 }
 return out;
}

export function hasUnresolvedIntent(registry, states) {
 if (!registry || registry.schema!=="disdex-pending-exposure/v1" || registry.accountScope!=="ASTER_FUTURES" || !Array.isArray(registry.entries)) throw new Error("CONFIG_REGISTRY_INVALID");
 for(const entry of registry.entries) {
  if(!entry || !["RELEASED","PENDING","SUBMITTED","UNKNOWN"].includes(entry.status)) throw new Error("CONFIG_REGISTRY_INVALID");
  if(entry.status!=="RELEASED") return true;
 }
 function visit(d) {
  if(d===null || typeof d!=="object") return false;
  return Object.entries(d).some(([key,value])=>((/^pending(?:Order|Orders|Intent|Exposure)?$/.test(key)||key==="manualReview") && !!value && (!Array.isArray(value)||value.length>0)) || visit(value));
 }
 if(!Array.isArray(states) || states.some(d=>!d||typeof d!=="object"||Array.isArray(d))) throw new Error("CONFIG_STATE_INVALID");
 return states.some(visit);
}
