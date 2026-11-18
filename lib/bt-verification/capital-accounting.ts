/** Research-only cash-flow and sizing rules; not a live trading risk engine. */
export type CapitalMode="SIMPLE"|"COMPOUND";
export type CapitalEvent={date:string;kind:"DEPOSIT"|"REALIZED_PNL";amountJpy:number};
export type CapitalSnapshot={date:string;equityJpy:number;netDepositsJpy:number;tradingPnlJpy:number;sizingBaseJpy:number};
export function calculateCapital(initialJpy:number,mode:CapitalMode,events:CapitalEvent[]):CapitalSnapshot[]{
  if(!Number.isFinite(initialJpy)||initialJpy<=0)throw new Error("INVALID_INITIAL_CAPITAL");
  if(mode!=="SIMPLE"&&mode!=="COMPOUND")throw new Error("INVALID_MODE");
  let deposits=0,pnl=0;
  const ordered=events.map((event,index)=>({...event,index})).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);
  return ordered.map(event=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!Number.isFinite(event.amountJpy))throw new Error("INVALID_EVENT");
    if(event.kind==="DEPOSIT"){
      if(event.amountJpy<=0)throw new Error("INVALID_DEPOSIT");
      deposits+=event.amountJpy;
    }else if(event.kind==="REALIZED_PNL"){pnl+=event.amountJpy;}
    else throw new Error("INVALID_EVENT_KIND");
    const equity=initialJpy+deposits+pnl;
    // A simple-mode profit never increases the sizing base, but available equity still caps it.
    const base=mode==="COMPOUND"?equity:Math.min(equity,initialJpy+deposits);
    return {date:event.date,equityJpy:equity,netDepositsJpy:deposits,tradingPnlJpy:pnl,sizingBaseJpy:Math.max(0,base)};
  });
}
export function contributionEvents(startDate:string,endDate:string,amountJpy:number,frequency:"MONTHLY"|"WEEKLY",day:number):CapitalEvent[]{
  if(!Number.isFinite(amountJpy)||amountJpy<=0)throw new Error("INVALID_DEPOSIT");
  const start=Date.parse(startDate+"T00:00:00Z"),end=Date.parse(endDate+"T00:00:00Z");
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)throw new Error("INVALID_PERIOD");
  if(frequency==="MONTHLY"&&(!Number.isInteger(day)||day<1||day>28))throw new Error("INVALID_DAY");
  if(frequency==="WEEKLY"&&(!Number.isInteger(day)||day<1||day>7))throw new Error("INVALID_DAY");
  const result:CapitalEvent[]=[];
  for(let ms=start;ms<=end;ms+=86400000){
    const date=new Date(ms);
    const due=frequency==="MONTHLY"?date.getUTCDate()===day:((date.getUTCDay()+6)%7)+1===day;
    if(due)result.push({date:date.toISOString().slice(0,10),kind:"DEPOSIT",amountJpy});
  }
  return result;
}