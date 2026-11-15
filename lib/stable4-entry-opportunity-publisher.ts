import type { AccountLockDocument } from "./disdex-account-order-lock";
import { appendStable4EntryOpportunityRecord, type Stable4EntryOpportunityRecord, type Stable4EntryOpportunityStrategy } from "./stable4-entry-opportunity-book";
import { loadStable4OpportunityCorpus, mergeStable4OpportunityLabels, STABLE4_CORPUS_SEED_SHA256, STABLE4_OPPORTUNITY_MODEL_VERSION } from "./stable4-opportunity-corpus";
import { extractStable4StrategyEntryFeatures, isStable4StrategyEntryFeature, scoreStable4Opportunity, type Stable4OpportunityCandidate, type Stable4OpportunityLabel } from "./stable4-opportunity-model";
import type { Stable4EntryOpportunityStore } from "./stable4-entry-opportunity-store";

export interface Stable4EntryOpportunityCaptureInput {
  sourceGitSha: string;
  nativePositionId: string;
  strategy: Stable4EntryOpportunityStrategy;
  symbol: string;
  side: "LONG" | "SHORT";
  route: string;
  /** Immutable native signal reference, never an observation/update timestamp. */
  logicalEntryTs: number;
  gross: number;
  plannedHoldHours: number;
  entrySnapshot: unknown;
  capturedAt: number;
}
export interface Stable4CapturedEntryOpportunity {
  readonly sourceGitSha: string;
  readonly nativePositionId: string;
  readonly capturedAt: number;
  readonly candidate: Readonly<Omit<Stable4OpportunityCandidate, "strategy" | "features">> & {
    readonly strategy: Stable4EntryOpportunityStrategy;
    readonly features: Readonly<Record<string, number>>;
  };
}
export type Stable4EntryOpportunityPublisherCode = "CAPTURE_INVALID" | "CORPUS_INVALID" | "CONTINUATION_INVALID" | "SCORE_INVALID";
export class Stable4EntryOpportunityPublisherError extends Error {
  readonly name = "Stable4EntryOpportunityPublisherError";
  constructor(readonly code: Stable4EntryOpportunityPublisherCode) { super(`STABLE4_ENTRY_PUBLISHER_${code}`); }
}
export interface Stable4EntryOpportunityPublicationTarget {
  store: Pick<Stable4EntryOpportunityStore, "append">;
  lease: { document(): Promise<AccountLockDocument> };
}
export interface Stable4EntryOpportunityPublicationOptions extends Stable4EntryOpportunityPublicationTarget {
  corpusBytes: Uint8Array;
  continuationLabels?: readonly Stable4OpportunityLabel[];
}
const INPUT_KEYS = ["sourceGitSha", "nativePositionId", "strategy", "symbol", "side", "route", "logicalEntryTs", "gross", "plannedHoldHours", "entrySnapshot", "capturedAt"];
const CAPTURE_KEYS = ["sourceGitSha", "nativePositionId", "capturedAt", "candidate"];
const CANDIDATE_KEYS = ["strategy", "symbol", "side", "route", "entryTs", "gross", "expectedHoldHours", "features"];
function fail(code: Stable4EntryOpportunityPublisherCode): never { throw new Stable4EntryOpportunityPublisherError(code); }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => typeof key === "string" && keys.includes(key) && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value === value.trim(); }
function recordFromCapture(capture: Stable4CapturedEntryOpportunity, score: number | null): Stable4EntryOpportunityRecord {
  const c = capture.candidate;
  return { strategy: c.strategy, positionId: capture.nativePositionId, sourceSha: capture.sourceGitSha, symbol: c.symbol, side: c.side, entryTs: c.entryTs, modelVersion: STABLE4_OPPORTUNITY_MODEL_VERSION, score, capturedAt: capture.capturedAt };
}
function immutableRecord(record: Stable4EntryOpportunityRecord): Stable4EntryOpportunityRecord {
  return appendStable4EntryOpportunityRecord({ schemaVersion: 1, records: [] }, record).records[0];
}
function validateCapture(capture: Stable4CapturedEntryOpportunity): void {
  if (!exact(capture, CAPTURE_KEYS) || !exact(capture.candidate, CANDIDATE_KEYS)) fail("CAPTURE_INVALID");
  const c = capture.candidate;
  if (!text(c.route) || !finite(c.gross) || c.gross <= 0 || !finite(c.expectedHoldHours) || c.expectedHoldHours <= 0 || !plain(c.features)
    || Reflect.ownKeys(c.features).some(key => typeof key !== "string" || !isStable4StrategyEntryFeature(c.strategy, key) || !("value" in Object.getOwnPropertyDescriptor(c.features, key)!) || !finite(c.features[key]))) fail("CAPTURE_INVALID");
  try { immutableRecord(recordFromCapture(capture, null)); } catch { fail("CAPTURE_INVALID"); }
}

/** Synchronous capture retains only schema-approved causal features; raw snapshots/outcomes are not retained. */
export function captureStable4EntryOpportunityCandidate(input: Stable4EntryOpportunityCaptureInput): Stable4CapturedEntryOpportunity {
  if (!exact(input, INPUT_KEYS) || !plain(input.entrySnapshot)) fail("CAPTURE_INVALID");
  const strategy = input.strategy;
  const ancestors = new Set<object>();
  function inspect(value: Record<string, unknown>, prefix = "") {
    if (ancestors.has(value)) fail("CAPTURE_INVALID");
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail("CAPTURE_INVALID");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) fail("CAPTURE_INVALID");
      const path = prefix ? `${prefix}.${key}` : key, child: unknown = descriptor.value;
      if (isStable4StrategyEntryFeature(strategy, path) && !finite(child)) fail("CAPTURE_INVALID");
      if (plain(child)) inspect(child, path);
    }
    ancestors.delete(value);
  }
  inspect(input.entrySnapshot);
  let features: Record<string, number>;
  try { features = extractStable4StrategyEntryFeatures(strategy, input.entrySnapshot); } catch { return fail("CAPTURE_INVALID"); }
  const capture: Stable4CapturedEntryOpportunity = {
    sourceGitSha: input.sourceGitSha, nativePositionId: input.nativePositionId, capturedAt: input.capturedAt,
    candidate: Object.freeze({ strategy, symbol: input.symbol, side: input.side, route: input.route, entryTs: input.logicalEntryTs, gross: input.gross, expectedHoldHours: input.plannedHoldHours, features: Object.freeze({ ...features }) }),
  };
  validateCapture(capture);
  return Object.freeze(capture);
}

/** Pure scoring. Caller must persist this prepared record in native pending provenance before sending HTTP. */
export function prepareStable4EntryOpportunityRecord(capture: Stable4CapturedEntryOpportunity, corpusBytes: Uint8Array, continuationLabels: readonly Stable4OpportunityLabel[] = []): Stable4EntryOpportunityRecord {
  validateCapture(capture);
  let corpus: ReturnType<typeof loadStable4OpportunityCorpus>;
  try { corpus = loadStable4OpportunityCorpus(corpusBytes, STABLE4_CORPUS_SEED_SHA256); } catch { return fail("CORPUS_INVALID"); }
  let labels: Stable4OpportunityLabel[];
  try {
    if (!Array.isArray(continuationLabels)) fail("CONTINUATION_INVALID");
    labels = mergeStable4OpportunityLabels(corpus.rows, continuationLabels);
  } catch { return fail("CONTINUATION_INVALID"); }
  let score: number | null;
  try {
    score = scoreStable4Opportunity({ ...capture.candidate, features: { ...capture.candidate.features } }, labels).opportunityScore;
    if (score !== null && !finite(score)) fail("SCORE_INVALID");
  } catch { return fail("SCORE_INVALID"); }
  return immutableRecord(recordFromCapture(capture, score));
}

/** Exact retries publish the original durable prepared record, never a newly computed replacement score. */
export function publishPreparedStable4EntryOpportunityRecord(record: Stable4EntryOpportunityRecord, target: Stable4EntryOpportunityPublicationTarget): Promise<Stable4EntryOpportunityRecord> {
  // Freeze synchronously before any caller-controlled store/lease await.
  let prepared: Stable4EntryOpportunityRecord;
  try {
    prepared = immutableRecord(record);
    if (prepared.modelVersion !== STABLE4_OPPORTUNITY_MODEL_VERSION) fail("CAPTURE_INVALID");
  } catch (error) { return Promise.reject(error); }
  return target.store.append(prepared, target.lease).then(() => prepared);
}

/** Convenience for a first entry only. There is no environment switch and no order API in this publisher. */
export function publishStable4EntryOpportunity(input: Stable4EntryOpportunityCaptureInput, options: Stable4EntryOpportunityPublicationOptions): Promise<Stable4EntryOpportunityRecord> {
  try {
    const capture = captureStable4EntryOpportunityCandidate(input);
    const prepared = prepareStable4EntryOpportunityRecord(capture, options.corpusBytes, options.continuationLabels);
    return publishPreparedStable4EntryOpportunityRecord(prepared, options);
  } catch (error) { return Promise.reject(error); }
}
