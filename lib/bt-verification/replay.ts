/**
 * BT replay presentation contracts. Never used to place orders or make strategy decisions.
 * Source gross snapshots are authoritative; filters never alter exposure totals.
 */
export type Position = {
  id: string;
  logic: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number | null;
  entry: number;
  mark: number | null;
  gross: number | null;
  grossAtEntry?: number | null;
  notional?: number | null;
  openedAt: string;
};
export type GrossSnapshot = {
  totalX: number;
  cryptoX: number;
  stockX: number;
  source: "bt_equity_snapshot" | "canonical_engine";
};
export type BtcCandle = {
  time: string;
  closedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
};
export type ReplayFrame = {
  timestamp: string;
  btc: number | null;
  equity: number;
  realized: number;
  positions: Position[];
  events: string[];
  gross?: GrossSnapshot;
};
export type Replay = {
  schema: "disdex-bt-portfolio-v1";
  mode: "DEMO" | "EXTERNAL";
  engineSha: string;
  seed: number;
  frames: ReplayFrame[];
  btcCandles?: BtcCandle[];
  limits: { total: number; crypto: number; stock: number };
  source?: { kind: string; equitySha256?: string; fillsSha256?: string; summarySha256?: string; btcCandlesSha256?: string; grossCapEvidence?: string; note?: string };
};
export type GrossState = {
  total: number;
  crypto: number;
  stock: number;
  breakdownKnown: number;
  unallocated: number;
  inconsistent: boolean;
  hasAuthoritative: boolean;
};
export const STOCKS = new Set(["AMZN", "AAPL", "MSFT", "NVDA", "META", "TSLA", "GOOGL", "GOOG"]);
export function isStock(symbol: string): boolean {
  return STOCKS.has(symbol.toUpperCase().replace(/USDT$/, ""));
}
export function grossForFrame(frame: ReplayFrame): GrossState {
  const known = frame.positions.reduce((a, p) => a + (p.gross ?? 0), 0);
  const cryptoKnown = frame.positions.filter(p => !isStock(p.symbol)).reduce((a,p)=>a+(p.gross ?? 0),0);
  const stockKnown = known-cryptoKnown;
  const total = frame.gross ? frame.gross.totalX : known;
  const crypto = frame.gross ? frame.gross.cryptoX : cryptoKnown;
  const stock = frame.gross ? frame.gross.stockX : stockKnown;
  return {
    total, crypto, stock, breakdownKnown: known,
    unallocated: Math.max(0,total-known),
    inconsistent: Boolean(frame.gross && (Math.abs(total - crypto - stock) > 0.02 || known > total+0.02)),
    hasAuthoritative: Boolean(frame.gross)
  };
}
const isObj=(v:unknown):v is Record<string,unknown> => v!==null && typeof v==="object" && !Array.isArray(v);
const number=(v:unknown):v is number=>typeof v==="number" && Number.isFinite(v);
const nullableNumber=(v:unknown)=>v===null || number(v);
const date=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && Number.isFinite(Date.parse(v));
function validPosition(p:unknown):p is Position {
  if(!isObj(p)) return false;
  return typeof p.id==="string" && p.id.length>0 && p.id.length<160 &&
    typeof p.logic==="string" && p.logic.length<80 &&
    typeof p.symbol==="string" && p.symbol.length<80 &&
    (p.side==="LONG" || p.side==="SHORT") &&
    nullableNumber(p.quantity) && (p.quantity===null || p.quantity>=0) &&
    number(p.entry) && p.entry>=0 &&
    nullableNumber(p.mark) && (p.mark===null || p.mark>=0) &&
    nullableNumber(p.gross) && (p.gross===null || p.gross>=0) &&
    date(p.openedAt) &&
    (p.grossAtEntry===undefined || (nullableNumber(p.grossAtEntry) && (p.grossAtEntry===null || p.grossAtEntry>=0)));
}
function validGross(g:unknown):g is GrossSnapshot {
  return isObj(g) && number(g.totalX) && g.totalX>=0 && number(g.cryptoX) && g.cryptoX>=0 &&
    number(g.stockX) && g.stockX>=0 && (g.source==="bt_equity_snapshot" || g.source==="canonical_engine") &&
    Math.abs(g.totalX-g.cryptoX-g.stockX)<0.02;
}
export function validateReplay(value:unknown):value is Replay {
  if (!isObj(value) || value.schema!=="disdex-bt-portfolio-v1") return false;
  if(value.mode!=="DEMO" && value.mode!=="EXTERNAL")return false;
  if(typeof value.engineSha!=="string" || value.engineSha.length>140 || !number(value.seed))return false;
  const limits=value.limits;
  if(!isObj(limits))return false;
  if(!(["total","crypto","stock"] as const).every(k=>number(limits[k]) && (limits[k] as number)>0 && (limits[k] as number)<100))return false;
  if(!Array.isArray(value.frames) || value.frames.length<1 || value.frames.length>50000)return false;
  if(value.btcCandles!==undefined){
    if(!Array.isArray(value.btcCandles)||value.btcCandles.length>20000)return false;
    let previousClose="";
    for(const c of value.btcCandles){
      if(!isObj(c)||!date(c.time)||!date(c.closedAt)||c.closedAt<=c.time||c.time<=previousClose && previousClose!=="")return false;
      if(!number(c.open)||!number(c.high)||!number(c.low)||!number(c.close)||
         Math.min(c.open,c.high,c.low,c.close)<=0||
         c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))return false;
      previousClose=c.time;
    }
  }
  let last="";
  for(const frame of value.frames){
    if(!isObj(frame)||!date(frame.timestamp)||frame.timestamp<=last)return false;
    last=frame.timestamp;
    if(!nullableNumber(frame.btc) || (frame.btc!==null && frame.btc<0))return false;
    if(!number(frame.equity)||!number(frame.realized)||!Array.isArray(frame.positions)||frame.positions.length>300)return false;
    if(!Array.isArray(frame.events)||frame.events.length>500||frame.events.some((e:unknown)=>typeof e!=="string"||e.length>600))return false;
    if(frame.gross!==undefined && !validGross(frame.gross))return false;
    const ids=new Set<string>();
    for(const p of frame.positions){
      if(!validPosition(p)||ids.has(p.id))return false;
      ids.add(p.id);
    }
  }
  return value.source===undefined || (isObj(value.source) && typeof value.source.kind==="string" && value.source.kind.length<120);
}
export function serializeCsv(rows: (string|number|null|undefined)[][]):string {
  return rows.map(r=>r.map(v=>{
    const text=String(v??"");
    if(/[",\r\n]/.test(text))return '"'+text.replace(/"/g,'""')+'"';
    return text;
  }).join(",")).join("\r\n");
}
