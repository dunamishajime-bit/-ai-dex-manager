export type RedisApprovalCasClient = {
  get<T>(key: string): Promise<T | null>;
  eval<T>(script: string, keys: string[], args: unknown[]): Promise<T>;
};

type VersionedApproval = {
  id: string;
  storeRevision?: string;
};

export type RedisApprovalCasResult =
  | "SWAPPED"
  | "CONFLICT"
  | "INVALID_STORED_VALUE";

const REDIS_APPROVAL_TTL_SECONDS = 2 * 60 * 60;

export const REDIS_APPROVAL_CAS_SCRIPT = [
  'local raw = redis.call("GET", KEYS[1])',
  'local expectedExists = ARGV[1]',
  'if expectedExists == "0" then',
  '  if raw then return 0 end',
  'else',
  '  if not raw then return 0 end',
  '  local ok, current = pcall(cjson.decode, raw)',
  '  if not ok or type(current) ~= "table" then return -2 end',
  '  local revision = current["storeRevision"] or ""',
  '  if revision ~= ARGV[2] then return 0 end',
  'end',
  'local nextHistoryJson = nil',
  'if ARGV[7] == "1" then',
  '  local historyRaw = redis.call("GET", KEYS[3])',
  '  local history = {}',
  '  if historyRaw then',
  '    local okHistory, decodedHistory = pcall(cjson.decode, historyRaw)',
  '    if not okHistory or type(decodedHistory) ~= "table" then return -2 end',
  '    history = decodedHistory',
  '  end',
  '  local nextHistory = {}',
  '  for i = 1, #history do',
  '    if history[i] ~= ARGV[6] then table.insert(nextHistory, history[i]) end',
  '  end',
  '  table.insert(nextHistory, 1, ARGV[6])',
  '  while #nextHistory > 50 do table.remove(nextHistory) end',
  '  nextHistoryJson = cjson.encode(nextHistory)',
  'end',
  'redis.call("SET", KEYS[1], ARGV[3], "EX", ARGV[4])',
  'if ARGV[5] == "1" then',
  '  redis.call("SET", KEYS[2], cjson.encode(ARGV[6]), "EX", ARGV[4])',
  'end',
  'if ARGV[7] == "1" then',
  '  redis.call("SET", KEYS[3], nextHistoryJson, "EX", ARGV[4])',
  'end',
  'return 1',
].join("\\n");

export async function redisApprovalCompareAndSwap<T extends VersionedApproval>(
  redis: RedisApprovalCasClient,
  input: {
    recordKey: string;
    latestKey: string;
    current: T | null;
    next: T;
    touchLatest: boolean;
    historyKey?: string;
  },
): Promise<RedisApprovalCasResult> {
  const keys = [input.recordKey, input.latestKey];
  if (input.historyKey) keys.push(input.historyKey);
  const raw = await redis.eval<number>(
    REDIS_APPROVAL_CAS_SCRIPT,
    keys,
    [
      input.current ? "1" : "0",
      input.current?.storeRevision || "",
      JSON.stringify(input.next),
      String(REDIS_APPROVAL_TTL_SECONDS),
      input.touchLatest ? "1" : "0",
      input.next.id,
      input.historyKey ? "1" : "0",
    ],
  );
  const result = Number(raw);
  if (result === 1) return "SWAPPED";
  if (result === 0) return "CONFLICT";
  return "INVALID_STORED_VALUE";
}
