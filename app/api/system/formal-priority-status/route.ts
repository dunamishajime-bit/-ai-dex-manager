import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function jsonFile(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}
async function textFile(path: string) {
  try { return (await readFile(path, "utf8")).trim(); }
  catch { return ""; }
}
function authorized(req: NextRequest) {
  return requestHasSignedOwnerSession(req);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const current=await loadCurrentProductionRuntime().catch(()=>null);
  if(!current) return NextResponse.json({ok:false,error:"現行Runner情報を取得できません"},{status:503});
  const releaseSha=current.releaseSha;
  const [v12Raw,q102Raw]=await Promise.all([
    jsonFile("/var/lib/disdex/v12-v4/heartbeat.json"),
    jsonFile(process.env.DISDEX_Q102_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json"),
  ]);
  const matching=(row:any,sha:string)=>row && (row.runtimeCommitSha??row.runtimeSha??row.releaseSha)===sha ? row:null;
  const v12=matching(v12Raw,current.productionReleaseShas.v12);
  const q102=matching(q102Raw,current.productionReleaseShas.quality102);
  const evidence=current.runtimeLineage.units;
  const symbolLastExitTs = v12?.symbolLastExitTs && typeof v12.symbolLastExitTs === "object" ? v12.symbolLastExitTs : {};
  const symbolCooldownUntilTs = v12?.symbolCooldownUntilTs && typeof v12.symbolCooldownUntilTs === "object" ? v12.symbolCooldownUntilTs : {};

  return NextResponse.json({
    ok: true,
    releaseSha,
    formalContractHistorical: true,
    formalContract: {
      v12: {
        rank12Gross: 1.0,
        dogeLtcRank12Gross: 0.5,
        rank3Gross: 0.5,
        rank3ResidualOnly: true,
        cooldown: "actual_exit_timestamp_plus_2h",
      },
      q102: {
        handoffFamilies: ["PB", "REV", "HIGH_VOL"],
        noHandoffFamilies: ["MR", "BRK"],
        victimOrder: ["Rank3", "Rank2", "Rank1"],
      },
      formalBt: {
        model: "H1_CAUSAL_PRICE_MODEL_NOT_HISTORICAL_L2_VERIFIED",
        roundtripBps: 10,
        finalEquityJpy: 1229065462.0472791,
        profitFactor: 2.4887028036012624,
        maxDrawdownPct: -21.296368751349548,
        winRatePct: 65.17647058823529,
        trades: 1275,
        accounting: "PASS",
      },
    },
    live: {
      v12Mode: evidence.v12.monitorOnly ? "MONITOR_ONLY" : v12?.mode || null,
      v12RuntimeSha: evidence.v12.matchesCurrent ? evidence.v12.runtimeSha : null,
      activePositions: Array.isArray(v12?.activePositions) ? v12.activePositions : (v12?.active ? [v12.active] : []),
      symbolLastExitTs,
      symbolCooldownUntilTs,
      lastPriorityHandoff: v12?.lastPriorityHandoff || null,
      pending: v12?.pending || null,
      manualReview: v12?.manualReview || null,
      q102RuntimeSha: evidence.quality102.matchesCurrent ? evidence.quality102.runtimeSha : null,
      q102Pending: q102?.pending || null,
    },
    updatedAt: Date.now(),
  });
}
