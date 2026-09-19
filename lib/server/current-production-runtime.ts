import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CURRENT_MARKER = "/home/deploy/disdex-trading/current/.disdex-release-sha";
const CURRENT_RELEASE_ROOT = "/home/deploy/disdex-trading/current";
const RUNTIME_ENV_ROOT = "/etc/disdex/current-runtime";
const SHA_RE = /^[0-9a-f]{40}$/i;

type EnvMap = Record<string, string>;

export type CurrentProductionRuntime = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  checkedAt: string;
  source: "VPS_CURRENT_RUNTIME";
  releaseSha: string;
  productionReleaseShas: {
    v12: string;
    pengu: string;
    quality102: string;
    v52: string;
  };
  caps: {
    v12BaseGross: number;
    v12DynamicGross: number;
    v12PerPositionGross: number;
    penguGross: number;
    quality102Gross: number;
    cryptoGross: number;
    stockGross: number;
    totalGross: number;
    v52V11Gross: number;
    v52V50Gross: number;
    sharedCryptoDailyLossPct: number;
    stockDailyLossPct: number;
  };
  quality102: {
    selectorMode: string;
    familyGross: {
      HIGH_VOL: number;
      MR: number;
      BRK: number;
      REV: number;
      PB: number;
    };
  };
  v52: {
    minimumEntryBasisBps: number;
    convergenceBps: number;
    basisStopMultiple: number;
    minimumNetEdgeBps: number;
    maximumRoundTripCostBps: number;
    maximumSpreadBps: number;
    slotGross: number;
    stockAggregateGross: number;
    windowsNy: string[];
  };
};

function parseEnv(text: string): EnvMap {
  const result: EnvMap = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function requiredNumber(env: EnvMap, name: string): number {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) throw new Error(`CURRENT_RUNTIME_ENV_INVALID_NUMBER:${name}:${env[name] ?? "MISSING"}`);
  return value;
}

function requiredText(env: EnvMap, name: string): string {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`CURRENT_RUNTIME_ENV_MISSING:${name}`);
  return value;
}

function extractObjectNumber(source: string, key: string): number {
  const pattern = new RegExp(`\\b${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const match = source.match(pattern);
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`CURRENT_RUNTIME_SOURCE_VALUE_MISSING:${key}`);
  return value;
}

function v52Number(value: unknown, key: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`CURRENT_V52_RUNTIME_INVALID:${key}`);
  return parsed;
}

export async function loadCurrentProductionRuntime(): Promise<CurrentProductionRuntime> {
  const checkedAt = new Date().toISOString();
  const releaseSha = (await readFile(CURRENT_MARKER, "utf8")).trim();
  if (!SHA_RE.test(releaseSha)) throw new Error(`CURRENT_RUNTIME_SHA_INVALID:${releaseSha || "EMPTY"}`);

  const envPath = join(RUNTIME_ENV_ROOT, `${releaseSha}.env`);
  const env = parseEnv(await readFile(envPath, "utf8"));
  const envRelease = requiredText(env, "DISDEX_RELEASE_SHA");
  const runtimeCommit = requiredText(env, "DISDEX_RUNTIME_COMMIT_SHA");
  if (envRelease !== releaseSha || runtimeCommit !== releaseSha) {
    throw new Error(`CURRENT_RUNTIME_SHA_MISMATCH:MARKER_${releaseSha}:ENV_${envRelease}:RUNTIME_${runtimeCommit}`);
  }

  const q102Source = await readFile(join(CURRENT_RELEASE_ROOT, "config", "integratedProductionRiskPolicy.ts"), "utf8");
  const v52Raw = JSON.parse(await readFile(join(CURRENT_RELEASE_ROOT, "config", "v52V50Runtime.json"), "utf8")) as Record<string, unknown>;
  const windowsNy = Array.isArray(v52Raw.windowsNy)
    ? v52Raw.windowsNy.map((value) => String(value)).filter(Boolean)
    : [];
  if (!windowsNy.length) throw new Error("CURRENT_V52_RUNTIME_WINDOWS_MISSING");

  const stockDailyLossPct = extractObjectNumber(q102Source, "stockDailyLossPct");
  const v12PerPositionGross = extractObjectNumber(q102Source, "v12PerPositionGrossCap");

  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    checkedAt,
    source: "VPS_CURRENT_RUNTIME",
    releaseSha,
    productionReleaseShas: {
      v12: releaseSha,
      pengu: releaseSha,
      quality102: releaseSha,
      v52: releaseSha,
    },
    caps: {
      v12BaseGross: requiredNumber(env, "V12_BASE_GROSS_CAP"),
      v12DynamicGross: requiredNumber(env, "V12_DYNAMIC_GROSS_CAP"),
      v12PerPositionGross,
      penguGross: requiredNumber(env, "PENGU_GROSS_CAP"),
      quality102Gross: requiredNumber(env, "QUALITY102_CAUSAL_V1_MAX_GROSS"),
      cryptoGross: requiredNumber(env, "CRYPTO_GROSS_CAP"),
      stockGross: requiredNumber(env, "STOCK_GROSS_CAP"),
      totalGross: requiredNumber(env, "TOTAL_GROSS_CAP"),
      v52V11Gross: requiredNumber(env, "DISDEX_V52_V11_GROSS_CAP"),
      v52V50Gross: requiredNumber(env, "DISDEX_V52_V50_GROSS_CAP"),
      sharedCryptoDailyLossPct: requiredNumber(env, "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT"),
      stockDailyLossPct,
    },
    quality102: {
      selectorMode: requiredText(env, "QUALITY102_CAUSAL_V1_SELECTOR_MODE"),
      familyGross: {
        HIGH_VOL: extractObjectNumber(q102Source, "HIGH_VOL"),
        MR: extractObjectNumber(q102Source, "MR"),
        BRK: extractObjectNumber(q102Source, "BRK"),
        REV: extractObjectNumber(q102Source, "REV"),
        PB: extractObjectNumber(q102Source, "PB"),
      },
    },
    v52: {
      minimumEntryBasisBps: v52Number(v52Raw.minimumEntryBasisBps, "minimumEntryBasisBps"),
      convergenceBps: v52Number(v52Raw.convergenceBps, "convergenceBps"),
      basisStopMultiple: v52Number(v52Raw.basisStopMultiple, "basisStopMultiple"),
      minimumNetEdgeBps: v52Number(v52Raw.minimumNetEdgeBps, "minimumNetEdgeBps"),
      maximumRoundTripCostBps: v52Number(v52Raw.maximumRoundTripCostBps, "maximumRoundTripCostBps"),
      maximumSpreadBps: v52Number(v52Raw.maximumSpreadBps, "maximumSpreadBps"),
      slotGross: v52Number(v52Raw.slotGross, "slotGross"),
      stockAggregateGross: v52Number(v52Raw.stockAggregateGross, "stockAggregateGross"),
      windowsNy,
    },
  };
}
