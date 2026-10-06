import { loadFormalBtAnchor } from "@/lib/server/formal-bt-anchor";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

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
  return req.cookies.get("disdex_auth")?.value === "1";
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const releaseShaPath = process.env.DISDEX_RELEASE_SHA_PATH || "/home/deploy/disdex-trading/current/.disdex-release-sha";
  const v12StatePath = process.env.DISDEX_V12_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json";
  const q102StatePath = process.env.DISDEX_Q102_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json";
  const [releaseSha, v12, q102] = await Promise.all([
    textFile(releaseShaPath),
    jsonFile(v12StatePath),
    jsonFile(q102StatePath),
  ]);

  const symbolLastExitTs = v12?.symbolLastExitTs && typeof v12.symbolLastExitTs === "object" ? v12.symbolLastExitTs : {};
  const symbolCooldownUntilTs = v12?.symbolCooldownUntilTs && typeof v12.symbolCooldownUntilTs === "object" ? v12.symbolCooldownUntilTs : {};

  return NextResponse.json({
    ok: true,
    releaseSha,
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
      formalBt: await loadFormalBtAnchor(),
    },
    live: {
      v12Mode: v12?.mode || null,
      v12RuntimeSha: v12?.runtimeCommitSha || v12?.runtimeSha || null,
      activePositions: Array.isArray(v12?.activePositions) ? v12.activePositions : (v12?.active ? [v12.active] : []),
      symbolLastExitTs,
      symbolCooldownUntilTs,
      lastPriorityHandoff: v12?.lastPriorityHandoff || null,
      pending: v12?.pending || null,
      manualReview: v12?.manualReview || null,
      q102RuntimeSha: q102?.runtimeCommitSha || q102?.runtimeSha || null,
      q102Pending: q102?.pending || null,
    },
    updatedAt: Date.now(),
  });
}
