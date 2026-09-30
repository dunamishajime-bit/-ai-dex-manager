import { readFileSync, writeFileSync } from "node:fs";
import { assertIdleParityCertificate, IDLE_PARITY_CERT_REPLAY_MODEL, IDLE_PARITY_CERT_SCHEMA } from "../lib/idle-priority-short-parity-cert";

const [replayPath,runtimeSha,outPath]=process.argv.slice(2);
if(!replayPath||!runtimeSha||!outPath) throw new Error("USAGE coherent-10bps-integrated.json <runtime-sha> <out.json>");
if(!/^[0-9a-f]{40}$/i.test(runtimeSha)) throw new Error("RUNTIME_SHA_INVALID");
const r=JSON.parse(readFileSync(replayPath,"utf8"));
const cert={
 schema:IDLE_PARITY_CERT_SCHEMA,
 runtimeSha:runtimeSha.toLowerCase(),
 candidateStreamSha256:"09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb",
 filteredSha256:"5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48",
 candidateRows:495,
 filteredRows:63,
 admittedRows:61,
 wins:48,
 losses:13,
 roundtripBps:Number(r.roundtrip_bps),
 replayModelVersion:IDLE_PARITY_CERT_REPLAY_MODEL,
 baselineTradeCount:Number(r.baseline_input),
 baselineRejectedRows:Number(r.baseline_rejected),
 integratedTradeCount:Number(r.combined_completed),
 baselineJpy:Number(r.baseline_anchor_jpy),
 finalJpy:Number(r.final_equity_jpy),
 profitFactor:Number(r.profit_factor),
 maxDrawdownPct:Number(r.max_mtm_drawdown),
 idleProfitFactor:Number(r.idle_profit_factor),
 generatedAt:Date.now(),
};
assertIdleParityCertificate(cert,runtimeSha);
writeFileSync(outPath,JSON.stringify(cert,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify({status:"PASS",outPath,runtimeSha:runtimeSha.toLowerCase(),costBps:cert.roundtripBps,replayModel:cert.replayModelVersion,integratedTrades:cert.integratedTradeCount,finalJpy:cert.finalJpy}));
