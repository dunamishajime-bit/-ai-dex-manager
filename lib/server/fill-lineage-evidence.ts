import { readFile } from "node:fs/promises";

const DEFAULT_PATH = "/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl";
const MAX_BYTES = 4 * 1024 * 1024;

export type FillLineageEvidence = {
  strategyId?: string;
  eventType?: "ENTRY_FILL" | "EXIT_FILL" | string;
  symbol?: string;
  side?: string;
  reduceOnly?: boolean;
  orderId?: string;
  clientOrderId?: string;
  requestId?: string;
  executedAt?: string;
  reason?: string;
  entryVersion?: string;
  routeLabel?: string;
  family?: string;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseFillLineageEvidenceLine(line: string): FillLineageEvidence | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return null;
    const orderId = raw.orderId === undefined || raw.orderId === null ? undefined : String(raw.orderId);
    const strategyId = text(raw.strategyId);
    const symbol = text(raw.symbol)?.toUpperCase();
    if (!orderId && !strategyId && !symbol) return null;
    return {
      strategyId,
      eventType: text(raw.eventType),
      symbol,
      side: text(raw.side)?.toUpperCase(),
      reduceOnly: typeof raw.reduceOnly === "boolean" ? raw.reduceOnly : undefined,
      orderId,
      clientOrderId: text(raw.clientOrderId),
      requestId: text(raw.requestId),
      executedAt: text(raw.executedAt),
      reason: text(raw.reason),
      entryVersion: text(raw.entryVersion),
      routeLabel: text(raw.routeLabel),
      family: text(raw.family),
    };
  } catch {
    return null;
  }
}

export function routeFromFillEvidence(evidence?: FillLineageEvidence) {
  if (!evidence) return undefined;
  const joined = [
    evidence.entryVersion,
    evidence.routeLabel,
    evidence.family,
    evidence.reason,
    evidence.clientOrderId,
    evidence.requestId,
  ].filter(Boolean).join(" ").toUpperCase();

  if (/RECOVERY[_ ]?V8|RECV8-/.test(joined)) return "Recovery V8";
  if (/SHORT[_ ]?V20/.test(joined)) return "Short V20";
  if (/V64.*DYNAMIC|DYNAMIC.*V64/.test(joined)) return "V64 Dynamic Long";
  if (/LONG[_ ]?V2[_ ]?FINAL/.test(joined)) return "Long V2 Final";

  if (/HIGH[_ ]?VOL/.test(joined)) return "HIGH_VOL";
  if (/\bBRK\b/.test(joined)) return "BRK";
  if (/\bMR\b/.test(joined)) return "MR";
  if (/\bPB\b/.test(joined)) return "PB";
  if (/\bREV\b/.test(joined)) return "REV";

  if (/STRONG.*QUALITY|QUALITY.*STRONG/.test(joined)) return "Strong Quality";
  if (/RELAXED.*MOM|MOM.*ATR/.test(joined)) return "Relaxed Momentum+ATR";
  if (/DYNAMIC.*RESIDUAL/.test(joined)) return "Dynamic Residual";
  if (/NORMAL.*SCORE/.test(joined)) return "Normal Score";

  if (/V11[_ ]?EQ/.test(joined)) return "V11_EQ";
  if (/V50/.test(joined)) return "V50";
  return undefined;
}

export function forcedExitCauseFromEvidence(evidence?: FillLineageEvidence) {
  if (!evidence || evidence.eventType !== "EXIT_FILL") return undefined;
  const joined = [evidence.reason, evidence.clientOrderId, evidence.requestId].filter(Boolean).join(" ").toUpperCase();
  if (/KILL[_ ]?SWITCH|FLATTEN_MANAGED|SHARED_RISK_FLATTEN|FORCED[_ -]?FLATTEN/.test(joined)) return "KILL_SWITCH" as const;
  if (/PROTECTED[_ ]?HOLD.*EXPIRE|HOLD_PROTECTED.*EXPIRE/.test(joined)) return "RECOVERY_TIMEOUT" as const;
  if (/DAILY[-_ ]?RISK|DAY_MISMATCH/.test(joined) && evidence.reduceOnly) return "RISK_FORCED_EXIT" as const;
  return undefined;
}

export async function loadFillLineageEvidence(pathValue = process.env.DISDEX_TRADE_FILL_NOTIFICATION_INBOX || DEFAULT_PATH) {
  try {
    const body = await readFile(pathValue, "utf8");
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) return new Map<string, FillLineageEvidence>();
    const byOrderId = new Map<string, FillLineageEvidence>();
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parseFillLineageEvidenceLine(line);
      if (parsed?.orderId) byOrderId.set(parsed.orderId, parsed);
    }
    return byOrderId;
  } catch {
    return new Map<string, FillLineageEvidence>();
  }
}
