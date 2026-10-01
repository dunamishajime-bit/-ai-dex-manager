import { lstat, readFile } from "node:fs/promises";

export const IDLE_RESIDUAL_LONG_CERT_SCHEMA = "disdex-idle-residual-long-parity-cert/v1" as const;

export type IdleResidualLongParityCert = {
  schema: typeof IDLE_RESIDUAL_LONG_CERT_SCHEMA;
  runtimeSha: string;
  generatedAt: string;
  priority: ["FORMAL_EXISTING","IDLE_PRIORITY_SHORT","DOGE_REL_VOL","AVAX_REL_LONG"];
  trailAtr: 0.20;
  stopAtr: 2.477;
  takeProfitAtr: 3.1995;
  roundtripBps: 10;
  finalJpy: number;
  integratedTradeCount: number;
  idleTrades: 61;
  dogeTrades: 11;
  avaxTrades: 16;
  profitFactor: number;
  maxMtmDrawdown: number;
  contractSha256: string;
};

export function assertIdleResidualLongParityCert(raw: unknown, expectedSha: string): IdleResidualLongParityCert {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_RESIDUAL_CERT_MALFORMED");
  const value = raw as Partial<IdleResidualLongParityCert>;
  if (value.schema !== IDLE_RESIDUAL_LONG_CERT_SCHEMA) throw new Error("IDLE_RESIDUAL_CERT_SCHEMA_MISMATCH");
  if (String(value.runtimeSha || "").toLowerCase() !== expectedSha.toLowerCase()) throw new Error("IDLE_RESIDUAL_CERT_RUNTIME_SHA_MISMATCH");
  if (JSON.stringify(value.priority) !== JSON.stringify(["FORMAL_EXISTING","IDLE_PRIORITY_SHORT","DOGE_REL_VOL","AVAX_REL_LONG"])) throw new Error("IDLE_RESIDUAL_CERT_PRIORITY_MISMATCH");
  if (value.trailAtr !== 0.20 || value.stopAtr !== 2.477 || value.takeProfitAtr !== 3.1995) throw new Error("IDLE_RESIDUAL_CERT_V12_CONTRACT_MISMATCH");
  if (value.roundtripBps !== 10 || value.idleTrades !== 61 || value.dogeTrades !== 11 || value.avaxTrades !== 16 || value.integratedTradeCount !== 1390) throw new Error("IDLE_RESIDUAL_CERT_TRADE_CONTRACT_MISMATCH");
  if (!Number.isFinite(Number(value.finalJpy)) || Math.abs(Number(value.finalJpy) - 1319918378.8124561) > 1) throw new Error("IDLE_RESIDUAL_CERT_FINAL_JPY_MISMATCH");
  if (!Number.isFinite(Number(value.profitFactor)) || Math.abs(Number(value.profitFactor) - 2.332297694545306) > 1e-9) throw new Error("IDLE_RESIDUAL_CERT_PF_MISMATCH");
  if (!Number.isFinite(Number(value.maxMtmDrawdown)) || Math.abs(Number(value.maxMtmDrawdown) - (-0.21359613575534397)) > 1e-12) throw new Error("IDLE_RESIDUAL_CERT_DD_MISMATCH");
  if (!/^[0-9a-f]{64}$/i.test(String(value.contractSha256 || ""))) throw new Error("IDLE_RESIDUAL_CERT_CONTRACT_HASH_INVALID");
  return value as IdleResidualLongParityCert;
}

export async function readAndAssertIdleResidualLongParityCert(path: string, expectedSha: string) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("IDLE_RESIDUAL_CERT_NOT_REGULAR_FILE");
  if (typeof stats.uid === "number" && (stats.uid !== 0 || stats.gid !== 0)) throw new Error("IDLE_RESIDUAL_CERT_NOT_ROOT_OWNED");
  if ((stats.mode & 0o022) !== 0) throw new Error("IDLE_RESIDUAL_CERT_WRITABLE_BY_NON_ROOT");
  return assertIdleResidualLongParityCert(JSON.parse(await readFile(path, "utf8")), expectedSha);
}
