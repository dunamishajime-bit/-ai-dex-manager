import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const IDLE_PARITY_CERT_SCHEMA = "disdex-idle-priority-parity-cert/v1" as const;
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
 baselineJpy: number;
 finalJpy: number;
 maxDrawdownPct: number;
 generatedAt: number;
};

export function assertIdleParityCertificate(raw: unknown, expectedRuntimeSha: string): IdleParityCertificate {
 if(!raw || typeof raw!=="object") throw new Error("IDLE_PARITY_CERT_MALFORMED");
 const c=raw as Partial<IdleParityCertificate>;
 if(c.schema!==IDLE_PARITY_CERT_SCHEMA) throw new Error("IDLE_PARITY_CERT_SCHEMA_MISMATCH");
 if(String(c.runtimeSha||"").toLowerCase()!==expectedRuntimeSha.toLowerCase()) throw new Error("IDLE_PARITY_CERT_RUNTIME_SHA_MISMATCH");
 if(c.candidateStreamSha256!=="09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb") throw new Error("IDLE_PARITY_CERT_STREAM_SHA_MISMATCH");
 if(c.filteredSha256!=="5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48") throw new Error("IDLE_PARITY_CERT_FILTERED_SHA_MISMATCH");
 if(c.candidateRows!==495 || c.filteredRows!==63 || c.admittedRows!==61 || c.wins!==48 || c.losses!==13) throw new Error("IDLE_PARITY_CERT_COUNTS_MISMATCH");
 if(!Number.isFinite(c.baselineJpy)||!Number.isFinite(c.finalJpy)||!Number.isFinite(c.maxDrawdownPct)) throw new Error("IDLE_PARITY_CERT_METRICS_INVALID");
 return c as IdleParityCertificate;
}
export function readIdleParityCertificate(path:string, expectedRuntimeSha:string){
 return assertIdleParityCertificate(JSON.parse(readFileSync(path,"utf8")), expectedRuntimeSha);
}
