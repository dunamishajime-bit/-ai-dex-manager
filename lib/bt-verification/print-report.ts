import {grossForFrame,validateReplay,type Replay} from "./replay";

export type PrintableResearchSource={
  sourceCase:string;bps:number;sha256:string;sourceStatus:string;
};
const esc=(x:unknown)=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const jpy=(n:number)=>Math.round(n).toLocaleString("ja-JP")+" 円";
const num=(n:number)=>n.toLocaleString("ja-JP",{maximumFractionDigits:4});
const percent=(n:number)=>n.toFixed(2)+"%";
export function buildPrintableBtReport(
 replay:Replay,reportName:string,displaySource:string,source?:PrintableResearchSource|null
):string{
 if(!validateReplay(replay))throw Error("Invalid BT replay");
 const first=replay.frames[0],last=replay.frames.at(-1)!;
 const initial=replay.researchSummary?.initialJpy??first.equity;
 const final=replay.researchSummary?.finalEquityJpy??last.equity;
 let peak=-Infinity,dd=0;
 for(const f of replay.frames){peak=Math.max(peak,f.equity);if(peak>0)dd=Math.min(dd,100*(f.equity/peak-1))}
 const maxDd=replay.researchSummary?.maxDdPct??dd;
 const g=grossForFrame(last);
 const rows=(replay.strategyStats??[]).slice(0,120).map(x=>
  "<tr><td>"+esc(x.logic)+"</td><td>"+esc(x.symbol)+"</td><td>"+num(x.tradeCount)+"</td><td>"+num(x.wins)+"/"+num(x.closedCount)+"</td><td>"+(x.winRatePct===null?"不明":percent(x.winRatePct))+"</td><td>"+jpy(x.netPnlJpy)+"</td></tr>"
 ).join("");
 const account="<table class='metrics'><tr><th>初期資金</th><td>"+jpy(initial)+
  "</td><th>最終資金</th><td>"+jpy(final)+"</td></tr><tr><th>研究モデル純損益</th><td>"+jpy(final-initial)+
  "</td><th>最大DD</th><td>"+percent(maxDd)+"</td></tr><tr><th>最終 Total Gross</th><td>"+num(g.total)+"x</td><th>Crypto / Stock</th><td>"+num(g.crypto)+"x / "+num(g.stock)+"x</td></tr></table>";
 const identity=source?("<p>研究ケース："+esc(source.sourceCase)+
   " / "+num(source.bps)+"bps</p><p class='mono'>元ファイル SHA256: "+esc(source.sha256)+
   "</p><p>元研究のstatus: "+esc(source.sourceStatus)+"</p>"):
   "<p>元ファイル SHA256: オーナー認証済みライブラリからの照合なし</p>";
 const positions=last.positions.map(p=>
   "<tr><td>"+esc(p.logic)+"</td><td>"+esc(p.symbol)+"</td><td>"+esc(p.side)+"</td><td>"+num(p.entry)+"</td><td>"+(p.mark===null?"未記録":num(p.mark))+"</td><td>"+(p.gross===null?"未記録":num(p.gross)+"x")+"</td></tr>"
 ).join("");
 const notes=replay.mode==="DEMO"?
  "これは人工市場のモデル結果です。LIVEの注文・保護STOP・過去市場データの実績ではありません。H48研究モードでも他RunnerとLayer2/3は含みません。":
  "これは読み取り専用の研究BTモデルです。元データのSHA照合だけでは現行Runner・実約定・本番経済一致を証明しません。";
 return "<!doctype html><html lang='ja'><head><meta charset='utf-8'><title>"+esc(reportName)+
  "</title><style>@page{size:A4;margin:17mm}body{font:11px/1.6 system-ui,'Yu Gothic',sans-serif;color:#172438;background:#fff}"+
  "h1{font-size:22px;margin:0 0 5px}h2{font-size:14px;margin-top:22px;border-bottom:1px solid #d5dfed;padding-bottom:5px}"+
  "p{margin:5px 0}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #d6deea;padding:6px;text-align:left;overflow-wrap:anywhere}"+
  "th{background:#eef3f9}.metrics th{width:22%}.metrics td{width:28%;font-weight:600}.mono{font:9px/1.5 monospace;overflow-wrap:anywhere}"+
  ".note{padding:9px;border:1px solid #e2b76f;background:#fff8e8;margin:14px 0}.muted{color:#586b7d}.page-break{break-before:page}"+
  "button{display:none}@media screen{body{max-width:920px;margin:24px auto;padding:16px}}</style></head><body>"+
  "<h1>"+esc(reportName||"DisDex BT 研究レポート")+"</h1>"+
  "<p class='muted'>生成画面: DisDex BT検証 / "+esc(displaySource)+"</p>"+
  "<div class='note'>"+esc(notes)+"</div>"+
  "<h2>モデル損益・Gross</h2>"+account+
  "<h2>期間・出所・照合</h2><p>元再生の開始："+esc(first.timestamp)+" / 終了："+esc(last.timestamp)+
  " / スナップショット数："+num(replay.frames.length)+"</p>"+
  "<p>モデルエンジン参照："+esc(replay.engineSha)+"</p>"+
  "<p>記録時の上限：Total "+num(replay.limits.total)+"x / Crypto "+num(replay.limits.crypto)+"x / Stock "+num(replay.limits.stock)+"x</p>"+
  identity+
  "<h2>期間末のモデル建玉 ("+num(last.positions.length)+"件)</h2><table><thead><tr><th>ロジック</th><th>銘柄</th><th>方向</th><th>Entry</th><th>Mark</th><th>現在Gross</th></tr></thead><tbody>"+(positions||"<tr><td colspan='6'>建玉なし、または元データに未収録</td></tr>")+"</tbody></table>"+
  "<h2>ロジック×通貨別モデル成績</h2><table><thead><tr><th>ロジック</th><th>銘柄</th><th>モデル取引</th><th>勝/決済</th><th>勝率</th><th>モデル純損益</th></tr></thead><tbody>"+
  (rows||"<tr><td colspan='6'>内訳データがありません。推測で作成しません</td></tr>")+"</tbody></table>"+
  "<p class='muted'>本レポートはブラウザーで印刷／PDFに保存します。取引所の実行証拠ではありません。</p></body></html>";
}
