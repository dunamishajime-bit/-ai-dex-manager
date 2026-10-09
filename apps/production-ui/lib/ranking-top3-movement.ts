import type { RankRow,RankingPcAlert } from "./realtime-ranking";

/**
 * Any change within the visible first three rows is noteworthy, even if
 * no score reaches 90. The ranking lists must already be ordered.
 * Never alert on first load or on a reference without three valid rows.
 */
export function top3MovementAlert(
 previous:readonly RankRow[], next:readonly RankRow[],
 kind:"暫定"|"正式",
):RankingPcAlert|null {
 const before=previous.filter(r=>kind==="正式"?r.score!==null:r.preview?.score!==undefined).map(r=>r.id);
 const after=next.filter(r=>kind==="正式"?r.score!==null:r.preview?.score!==undefined).map(r=>r.id);
 if(before.length<3||after.length<3) return null;
 const previousTop=before.slice(0,3),currentTop=after.slice(0,3);
 if(previousTop.every((id,i)=>id===currentTop[i]))return null;
 const changes=currentTop.flatMap((id,i)=>{
  if(previousTop[i]===id)return[];
  const old=before.indexOf(id);
  const r=next.find(x=>x.id===id);
  return r?[{label:r.symbol.replace(/USDT$/,"")+" / "+r.logic,from:old>=0?old+1:null,to:i+1}]:[];
 });
 if(!changes.length)return null;
 const entry=changes.filter(x=>x.from===null||x.from>3);
 const title=kind+"Top3順位が変動"+(entry.length?"（新規入り）":"");
 return {
  title,reason:"TOP3_MOVEMENT",
  body:changes.slice(0,3).map(x=>x.label+" "+(x.from===null?"圏外":x.from+"位")+"→"+x.to+"位").join("、")+"。",
 };
}
