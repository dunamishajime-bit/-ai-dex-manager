import { readFileSync } from "node:fs";

export const IDLE_PARITY_CERT_SCHEMA = "disdex-idle-priority-parity-cert/v2" as const;
export const IDLE_PARITY_REPLAY_MODEL = "FIXED_BASELINE_ACCEPTED_INTENTS_DYNAMIC_GROSS_V1" as const;

export type IdleParityCertificate = {
 schema: typeof IDLE_PARITY_CERT_SCHEMA;
 runtimeSha: string;
 candidateStreamSha256: string;
 filteredSha256: string;
 candidateRows: 495;
 filteredRows: 63;
 admittedRows: 61;
 wins: 48;
 losses: 13;
 roundtripBps: 10;
 replayModelVersion: typeof IDLE_PARITY_REPLAY_MODEL;
 baselineTradeCount: 1284;
 baselineRejectedRows: 6;
 integratedTradeCount: 1339;
 baselineJpy: number;
 finalJpy: number;
 profitFactor: number;
 maxDrawdownPct: number;
 idleProfitFactor: number;
 generatedAt: number;
};

const EXPECTED = {
 baselineJpy: 141845207.7243423,
 finalJpy: 214775230.26444945,
 profitFactor: 2.046425970772986,
 maxDrawdownPct: -0.22840597480157931,
 idleProfitFactor: 6.582814623608791,
} as const;

function near(actual: unknown, expected: number, tolerance: number, code: string) {
 const value = Number(actual);
 if (!Number.isFinite(value) || Math.abs(value - expected) > tolerance) {
  throw new Error(code);
 }
}

export function assertIdleParityCertificate(raw: unknown, expectedRuntimeSha: string): IdleParityCertificate {
 if(!raw || typeof raw!=="object") throw new Error("IDLE_PARITY_CERT_MALFORMED");
 const c=raw as Partial<IdleParityCertificate>;
 if(c.schema!==IDLE_PARITY_CERT_SCHEMA) throw new Error("IDLE_PARITY_CERT_SCHEMA_MISMATCH");
 if(String(c.runtimeSha||"").toLowerCase()!==expectedRuntimeSha.toLowerCase()) throw new Error("IDLE_PARITY_CERT_RUNTIME_SHA_MISMATCH");
 if(c.candidateStreamSha256!=="09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb") throw new Error("IDLE_PARITY_CERT_STREAM_SHA_MISMATCH");
 if(c.filteredSha256!=="5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48") throw new Error("IDLE_PARITY_CERT_FILTERED_SHA_MISMATCH");
 if(c.candidateRows!==495 || c.filteredRows!==63 || c.admittedRows!==61 || c.wins!==48 || c.losses!==13) throw new Error("IDLE_PARITY_CERT_COUNTS_MISMATCH");
 if(c.roundtripBps!==10) throw new Error("IDLE_PARITY_CERT_COST_CASE_MISMATCH");
 if(c.replayModelVersion!==IDLE_PARITY_REPLAY_MODEL) throw new Error("IDLE_PARITY_CERT_REPLAY_MODEL_MISMATCH");
 if(c.baselineTradeCount!==1284 || c.baselineRejectedRows!==6 || c.integratedTradeCount!==1339) throw new Error("IDLE_PARITY_CERT_TRADE_COUNTS_MISMATCH");

 // Deterministic CI reference from workflow run 36664690807.
 // Tolerances are intentionally tight enough to reject the historical mixed
 // JPY268M bundle while allowing harmless floating-point serialization noise.
 near(c.baselineJpy, EXPECTED.baselineJpy, 1.0, "IDLE_PARITY_CERT_BASELINE_JPY_MISMATCH");
 near(c.finalJpy, EXPECTED.finalJpy, 1.0, "IDLE_PARITY_CERT_FINAL_JPY_MISMATCH");
 near(c.profitFactor, EXPECTED.profitFactor, 1e-9, "IDLE_PARITY_CERT_PF_MISMATCH");
 near(c.maxDrawdownPct, EXPECTED.maxDrawdownPct, 1e-9, "IDLE_PARITY_CERT_DD_MISMATCH");
 near(c.idleProfitFactor, EXPECTED.idleProfitFactor, 1e-9, "IDLE_PARITY_CERT_IDLE_PF_MISMATCH");
 if(!Number.isFinite(c.generatedAt)) throw new Error("IDLE_PARITY_CERT_GENERATED_AT_INVALID");
 return c as IdleParityCertificate;
}

export function readIdleParityCertificate(path:string, expectedRuntimeSha:string){
 return assertIdleParityCertificate(JSON.parse(readFileSync(path,"utf8")), expectedRuntimeSha);
}
