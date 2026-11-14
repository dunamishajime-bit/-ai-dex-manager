/** Immutable entry-time evidence only. This module never grants order permission or reads a corpus. */
export type Stable4EntryOpportunityStrategy = "V4" | "PENGU" | "FET" | "Q102" | "IDLE" | "V52" | "HYPE";
export interface Stable4EntryOpportunityRecord {
  strategy: Stable4EntryOpportunityStrategy;
  positionId: string;
  sourceSha: string;
  symbol: string;
  side: "LONG" | "SHORT";
  /** Immutable logical candidate reference time, never a position observation/update timestamp. */
  entryTs: number;
  modelVersion: string;
  score: number | null;
  /** Capture and append before submitting the entry; actual submission ordering is enforced by the caller. */
  capturedAt: number;
}
export interface Stable4EntryOpportunityBook { schemaVersion: 1; records: readonly Stable4EntryOpportunityRecord[] }
export type Stable4EntryScoreRecord = Stable4EntryOpportunityRecord;
export interface Stable4ActiveEntryOwner {
  strategy: Stable4EntryOpportunityStrategy; positionId: string; symbol: string; side: "LONG" | "SHORT";
  /** Recovered from native entry provenance, never DirectPosition.updatedAt. */
  entryTs: number; quantity: number;
}
export interface Stable4SignedEntryPosition { symbol: string; side: "LONG" | "SHORT"; quantity: number }
export interface Stable4EntryScoreComparisonInput {
  now: number; maxAgeMs?: number; book: Stable4EntryOpportunityBook; candidate: Stable4EntryOpportunityRecord;
  owners: { complete: boolean; observedAt: number; positions: Stable4ActiveEntryOwner[] };
  signed: { complete: boolean; observedAt: number; positions: Stable4SignedEntryPosition[] };
}
export type Stable4EntryScoreComparisonReason = "INVALID_INPUT" | "INVALID_BOOK" | "INVALID_CANDIDATE"
  | "OWNERS_INCOMPLETE" | "SIGNED_INCOMPLETE" | "OWNERS_STALE" | "SIGNED_STALE" | "INVALID_OWNERS" | "INVALID_SIGNED"
  | "ACCOUNT_OWNER_MISMATCH" | "ACTIVE_SCORE_MISSING" | "ACTIVE_SCORE_UNKNOWN" | "ACTIVE_RECORD_CONFLICT"
  | "MODEL_VERSION_MISMATCH" | "CANDIDATE_SCORE_UNKNOWN" | "CANDIDATE_NOT_STRICTLY_BETTER" | "STRICTLY_BETTER" | "VERIFIED_EMPTY";
export interface Stable4EntryScoreComparison {
  allowed: boolean; reason: Stable4EntryScoreComparisonReason; activeCount: number; maxActiveScore: number | null;
}
export class Stable4EntryScoreBookError extends Error {
  readonly name = "Stable4EntryScoreBookError";
  constructor(readonly code: "INVALID_BOOK" | "INVALID_RECORD" | "RECORD_CONFLICT", detail?: string) { super(`STABLE4_ENTRY_BOOK_${code}${detail ? `:${detail}` : ""}`); }
}
const STRATEGIES = new Set(["V4", "PENGU", "FET", "Q102", "IDLE", "V52", "HYPE"]);
const RECORD_FIELDS = ["strategy", "positionId", "sourceSha", "symbol", "side", "entryTs", "modelVersion", "score", "capturedAt"] as const;
const OWNER_FIELDS = ["strategy", "positionId", "symbol", "side", "entryTs", "quantity"];
function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  const own = Reflect.ownKeys(value);
  return (proto === Object.prototype || proto === null) && own.length === keys.length
    && own.every(key => typeof key === "string" && keys.includes(key) && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value === value.trim(); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function timestamp(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value > 0; }
function symbol(value: unknown): value is string { return typeof value === "string" && /^[A-Z0-9]+USDT$/.test(value); }
function side(value: unknown): value is "LONG" | "SHORT" { return value === "LONG" || value === "SHORT"; }
function identity(value: { strategy: string; positionId: string }): string { return JSON.stringify([value.strategy, value.positionId]); }
function exposureIdentity(value: { symbol: string; side: string }): string { return JSON.stringify([value.symbol, value.side]); }
function validOwner(value: unknown): value is Stable4ActiveEntryOwner {
  return exactObject(value, OWNER_FIELDS) && STRATEGIES.has(value.strategy as string) && text(value.positionId)
    && symbol(value.symbol) && side(value.side) && timestamp(value.entryTs) && finite(value.quantity) && value.quantity > 0;
}
function validRecord(value: unknown): value is Stable4EntryOpportunityRecord {
  return exactObject(value, RECORD_FIELDS) && STRATEGIES.has(value.strategy as string) && text(value.positionId)
    && symbol(value.symbol) && side(value.side) && timestamp(value.entryTs) && timestamp(value.capturedAt) && value.capturedAt >= value.entryTs
    && text(value.sourceSha) && /^[a-f0-9]{40}$/.test(value.sourceSha)
    && text(value.modelVersion) && (value.score === null || finite(value.score));
}
/** Validates persisted schema without coercion and returns an independent frozen snapshot. */
export function validateStable4EntryOpportunityBook(value: unknown): Stable4EntryOpportunityBook {
  if (!exactObject(value, ["schemaVersion", "records"]) || value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Stable4EntryScoreBookError("INVALID_BOOK");
  const ids = new Set<string>();
  const records = Array.from(value.records).map(row => {
    if (!validRecord(row)) throw new Stable4EntryScoreBookError("INVALID_RECORD");
    const key = identity(row);
    if (ids.has(key)) throw new Stable4EntryScoreBookError("INVALID_BOOK", "duplicate owner identity");
    ids.add(key);
    return Object.freeze({ ...row });
  });
  return Object.freeze({ schemaVersion: 1, records: Object.freeze(records) });
}
/** Caller appends before HTTP submission. An exact retry is idempotent; scores can never be replaced. */
export function appendStable4EntryOpportunityRecord(book: Stable4EntryOpportunityBook, record: Stable4EntryOpportunityRecord): Stable4EntryOpportunityBook {
  const validated = validateStable4EntryOpportunityBook(book);
  if (!validRecord(record)) throw new Stable4EntryScoreBookError("INVALID_RECORD");
  const previous = validated.records.find(row => identity(row) === identity(record));
  if (previous) {
    if (!RECORD_FIELDS.every(key => previous[key] === record[key])) throw new Stable4EntryScoreBookError("RECORD_CONFLICT");
    return validated;
  }
  return validateStable4EntryOpportunityBook({ schemaVersion: 1, records: [...validated.records, record] });
}
export const appendStable4EntryScore = appendStable4EntryOpportunityRecord;

/** Compares against actual owner membership reconciled with a complete, fresh signed account snapshot. */
export function compareStable4UniEntryScore(input: Stable4EntryScoreComparisonInput): Stable4EntryScoreComparison {
  const result = (reason: Stable4EntryScoreComparisonReason, count = 0, max: number | null = null): Stable4EntryScoreComparison => ({ allowed: reason === "STRICTLY_BETTER" || reason === "VERIFIED_EMPTY", reason, activeCount: count, maxActiveScore: max });
  if (!input || !exactObject(input, ["now", "book", "candidate", "owners", "signed", ...(Object.prototype.hasOwnProperty.call(input, "maxAgeMs") ? ["maxAgeMs"] : [])])
    || !timestamp(input.now) || (input.maxAgeMs !== undefined && (!finite(input.maxAgeMs) || input.maxAgeMs < 0))) return result("INVALID_INPUT");
  const maxAge = input.maxAgeMs ?? 120_000;
  let book: Stable4EntryOpportunityBook;
  try { book = validateStable4EntryOpportunityBook(input.book); } catch { return result("INVALID_BOOK"); }
  if (book.records.some(row => row.capturedAt > input.now)) return result("INVALID_BOOK");
  const candidate = input.candidate;
  if (!validRecord(candidate) || candidate.strategy !== "Q102" || candidate.symbol !== "UNIUSDT" || candidate.side !== "SHORT" || candidate.capturedAt > input.now) return result("INVALID_CANDIDATE");
  if (candidate.score === null) return result("CANDIDATE_SCORE_UNKNOWN");
  if (!input.owners || input.owners.complete !== true) return result("OWNERS_INCOMPLETE");
  if (!input.signed || input.signed.complete !== true) return result("SIGNED_INCOMPLETE");
  const fresh = (at: unknown) => timestamp(at) && at <= input.now && input.now - at <= maxAge;
  if (!fresh(input.owners.observedAt)) return result("OWNERS_STALE");
  if (!fresh(input.signed.observedAt)) return result("SIGNED_STALE");
  if (!exactObject(input.owners, ["complete", "observedAt", "positions"]) || !Array.isArray(input.owners.positions)) return result("INVALID_OWNERS");
  if (!exactObject(input.signed, ["complete", "observedAt", "positions"]) || !Array.isArray(input.signed.positions)) return result("INVALID_SIGNED");
  const ownerIds = new Set<string>(), owned = new Map<string, number>(), venue = new Map<string, number>();
  for (const owner of input.owners.positions) {
    if (!validOwner(owner) || owner.entryTs > input.now || ownerIds.has(identity(owner))) return result("INVALID_OWNERS");
    ownerIds.add(identity(owner));
    const key = exposureIdentity(owner), sum = (owned.get(key) ?? 0) + owner.quantity;
    if (!finite(sum)) return result("INVALID_OWNERS");
    owned.set(key, sum);
  }
  for (const position of input.signed.positions) {
    if (!exactObject(position, ["symbol", "side", "quantity"]) || !symbol(position.symbol) || !side(position.side) || !finite(position.quantity) || position.quantity <= 0) return result("INVALID_SIGNED");
    const key = exposureIdentity(position);
    if (venue.has(key)) return result("INVALID_SIGNED");
    venue.set(key, position.quantity);
  }
  // Only IEEE-754 summation noise is tolerated; this is not a partial-fill or quantity risk allowance.
  if (owned.size !== venue.size || [...owned].some(([key, qty]) => {
    const actual = venue.get(key);
    return actual === undefined || Math.abs(qty - actual) > Number.EPSILON * Math.max(Math.abs(qty), Math.abs(actual)) * 8;
  })) return result("ACCOUNT_OWNER_MISMATCH");
  const count = input.owners.positions.length;
  const byId = new Map(book.records.map(row => [identity(row), row]));
  let max: number | null = null;
  for (const owner of input.owners.positions) {
    const record = byId.get(identity(owner));
    if (!record) return result("ACTIVE_SCORE_MISSING", count);
    if (record.symbol !== owner.symbol || record.side !== owner.side || record.entryTs !== owner.entryTs || record.capturedAt > input.owners.observedAt) return result("ACTIVE_RECORD_CONFLICT", count);
    if (record.score === null) return result("ACTIVE_SCORE_UNKNOWN", count);
    if (record.modelVersion !== candidate.modelVersion) return result("MODEL_VERSION_MISMATCH", count);
    max = max === null ? record.score : Math.max(max, record.score);
  }
  if (max === null) return result("VERIFIED_EMPTY");
  return result(candidate.score > max ? "STRICTLY_BETTER" : "CANDIDATE_NOT_STRICTLY_BETTER", count, max);
}
