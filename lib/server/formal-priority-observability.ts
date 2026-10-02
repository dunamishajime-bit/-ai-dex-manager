import { readFile } from "node:fs/promises";
import { join } from "node:path";

function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function text(value: unknown): string | undefined { return typeof value === "string" ? value.slice(0, 300) : undefined; }
function numericMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(obj(value)).filter(([key, val]) => /^[A-Z0-9]{2,24}$/.test(key) && numeric(val) !== undefined));
}

// Explicit allow-list: never return an arbitrary durable state, env, or credential.
export function sanitizeFormalPriority(target: unknown, v12: unknown, q102: unknown, releaseSha: string, now = Date.now()) {
  const policy = obj(obj(obj(target).strategy).v12);
  const state = obj(v12), q = obj(q102), handoff = obj(state.lastPriorityHandoff);
  const cooldowns = numericMap(state.symbolCooldownUntilTs), exits = numericMap(state.symbolLastExitTs);
  const formal = obj(obj(target).formalBacktest), normal = obj(formal.NORMAL);
  const families = Array.isArray(policy.q102PriorityHandoffFamilies) ? policy.q102PriorityHandoffFamilies.filter((f: unknown) => typeof f === "string") : [];
  return {
    ok: true, readOnly: true, tradingMutation: 0, releaseSha,
    contractAvailable: policy.sameSymbolCooldown === "ACTUAL_VENUE_EXIT_FILL_TIMESTAMP_PLUS_2H",
    policy: { rank12Gross: numeric(policy.rank12DefaultGross), reducedGross: numeric(policy.rank12ReducedGross),
      reducedSymbols: Array.isArray(policy.rank12ReducedSymbols) ? policy.rank12ReducedSymbols.filter((s: unknown) => typeof s === "string") : [],
      rank3Gross: numeric(policy.rank3GrossCap), residualOnly: policy.rank3ResidualOnly === true,
      cooldown: text(policy.sameSymbolCooldown), handoffFamilies: families,
      rankOrder: Array.isArray(policy.q102PriorityHandoffRankOrder) ? policy.q102PriorityHandoffRankOrder.filter((n: unknown) => numeric(n) !== undefined) : [] },
    stateSha: text(state.runtimeCommitSha), stateUpdatedAt: numeric(state.updatedAt),
    cooldowns: Object.keys({ ...cooldowns, ...exits }).map(symbol => ({ symbol, actualExitTs: exits[symbol],
      cooldownUntil: cooldowns[symbol], active: (cooldowns[symbol] || 0) > now })),
    handoff: { family: text(handoff.family), symbol: text(handoff.symbol), victimRank: numeric(handoff.victimRank),
      freedGross: numeric(handoff.freedGross), actualExitTs: numeric(handoff.actualExitTs), reason: text(handoff.reason) },
    q102: { stateSha: text(q.runtimeCommitSha), family: text(obj(q.pending).family),
      requestedGross: numeric(obj(q.pending).gross ?? obj(q.pending).requestedGross),
      handoffEligible: families.includes(obj(q.pending).family), manualReview: text(q.manualReview) },
    formalBacktest: formal.selectedCase === "formal_priority_cooldown_20261003"
      ? { model: text(formal.model), roundtripBps: numeric(normal.roundtripBps), endingAssetJpy: numeric(normal.endingAssetJpy),
        profitFactor: numeric(normal.profitFactor), maxDrawdownPct: numeric(normal.maxDrawdownPct),
        winRatePct: numeric(normal.winRatePct), trades: numeric(normal.trades) }
      : null,
  };
}

async function json(path: string) {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 512 * 1024) throw new Error("FORMAL_PRIORITY_STATE_TOO_LARGE");
  return JSON.parse(raw);
}
export async function loadFormalPriorityObservability() {
  const root = "/home/deploy/disdex-trading/current";
  const sha = (await readFile(join(root, ".disdex-release-sha"), "utf8")).trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("FORMAL_PRIORITY_RELEASE_SHA_INVALID");
  const [target, v12, q102] = await Promise.all([json(join(root, "docs/production/current-live-target.json")),
    json("/var/lib/disdex/v12-x1-all/runner.json"), json("/var/lib/disdex/quality102-causal-v1/state.json")]);
  return sanitizeFormalPriority(target, v12, q102, sha);
}
