/** Public Aster futures daily close validation. No credentials, no trading endpoints. */
export type VerifiedDailyClose={symbol:string;utcDate:string;close:number;barCloseMs:number};
export function priorJstCalendarDay(now:Date):string{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const field=(key:string)=>parts.find(v=>v.type===key)?.value??"";
  const ms=Date.UTC(Number(field("year")),Number(field("month"))-1,Number(field("day")))-86400000;
  return new Date(ms).toISOString().slice(0,10);
}
export function parseVerifiedAsterDailyClose(symbol:string,day:string,payload:unknown,now:Date):VerifiedDailyClose{
  if(!/^[A-Z0-9]{3,18}USDT$/.test(symbol))throw new Error("INVALID_SYMBOL");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day!==priorJstCalendarDay(now))throw new Error("INVALID_ANCHOR_DAY");
  const expectedOpen=Date.parse(day+"T00:00:00Z");
  const expectedClose=expectedOpen+86400000-1;
  if(now.getTime()<=expectedClose)throw new Error("ANCHOR_DAY_NOT_CLOSED");
  if(!Array.isArray(payload))throw new Error("INVALID_KLINE_RESPONSE");
  const rows=payload.filter(row=>Array.isArray(row)&&row[0]===expectedOpen&&row[6]===expectedClose);
  if(rows.length!==1)throw new Error("ANCHOR_KLINE_MISSING_OR_DUPLICATE");
  const close=Number(rows[0][4]);
  if(!Number.isFinite(close)||close<=0)throw new Error("INVALID_ANCHOR_CLOSE");
  return {symbol,utcDate:day,close,barCloseMs:expectedClose};
}