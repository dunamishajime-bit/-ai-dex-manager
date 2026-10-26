#!/usr/bin/env python3
"""Read-only, in-memory RENDER #4427 normal lock release TOCTOU audit.

No filesystem writes, no trading, no runtime imports. All checks explicit, including -O/-OO.
"""
import base64
import hashlib
import json
import subprocess
import sys
import urllib.request

SOURCE_COMMIT = "939b59da49ce7960485a2004b0068dc63417ae82"
SOURCE_PATH = "lib/disdex-account-order-lock.ts"
SOURCE_SHA256 = "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b"
SOURCE_URL = (
    "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/"
    + SOURCE_COMMIT + "/" + SOURCE_PATH
)
NODE_AUDIT = r"""
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const source = Buffer.from(process.argv[1], 'base64').toString('utf8');
const start = source.indexOf('release: () => enqueue(async () => {');
const end = source.indexOf('\n                };', start);
if (start < 0 || end < 0) throw Error('SOURCE_RELEASE_EXTRACT_FAILED');
const expression = source.slice(start, end).trim().replace(/,\s*$/, '');
const compiled = stripTypeScriptTypes('({' + expression + '})');
async function exercise(mode) {
  let state = {ownerId:'ownerA:100', leaseId:'leaseA'};
  let released = false, unlinked = false, reads = 0;
  if (mode === 'pre_owner_mismatch') state = {ownerId:'ownerB:200', leaseId:'leaseB'};
  if (mode === 'pre_lease_mismatch') state = {ownerId:'ownerA:100', leaseId:'leaseB'};
  if (mode === 'missing_before_read') state = null;
  const context = {
    ownerId:'ownerA:100', leaseId:'leaseA',
    errorCode:(error)=>error.code || '',
    enqueue:(fn)=>fn(),
    get released() { return released; },
    set released(value) { released = value; },
    read:async()=>{
      reads++;
      if (!state) throw Object.assign(Error('missing'), {code:'ENOENT'});
      const snapshot = {...state};
      // Deterministic interleaving: after old read, before awaited unlink.
      if (mode === 'swap_owner') state = {ownerId:'ownerB:200', leaseId:'leaseB'};
      if (mode === 'swap_lease') state = {ownerId:'ownerA:100', leaseId:'leaseB'};
      if (mode === 'disappear') state = null;
      return snapshot;
    },
    unlink:async()=>{
      if (mode === 'unlink_eacces') throw Object.assign(Error('permission denied'), {code:'EACCES'});
      if (!state) throw Object.assign(Error('missing'), {code:'ENOENT'});
      state = null;
      unlinked = true;
    },
  };
  const obj = vm.runInNewContext(compiled, context);
  let error = null;
  try { await obj.release(); } catch (e) { error = String(e.message); }
  return {
    mode,
    remaining:state ? state.ownerId + '|' + state.leaseId : null,
    unlinked,
    released,
    reads,
    error,
  };
}
(async()=>{
  const modes = [
    'normal', 'pre_owner_mismatch', 'pre_lease_mismatch',
    'swap_owner', 'swap_lease', 'disappear',
    'missing_before_read', 'unlink_eacces'
  ];
  const results = [];
  for (const mode of modes) results.push(await exercise(mode));
  console.log(JSON.stringify(results));
})().catch(e=>{ console.error(e.stack); process.exit(1); });
"""
EXPECTED = {
    "normal": (None, True, True, None),
    "pre_owner_mismatch": ("ownerB:200|leaseB", False, True, None),
    "pre_lease_mismatch": ("ownerA:100|leaseB", False, True, None),
    "swap_owner": (None, True, True, None),
    "swap_lease": (None, True, True, None),
    "disappear": (None, False, True, None),
    "missing_before_read": (None, False, True, None),
    "unlink_eacces": ("ownerA:100|leaseA", False, False, "permission denied"),
}

def main():
    with urllib.request.urlopen(SOURCE_URL, timeout=20) as response:
        raw = response.read()
    actual_sha = hashlib.sha256(raw).hexdigest()
    if actual_sha != SOURCE_SHA256:
        raise RuntimeError("SOURCE_SHA256_MISMATCH:" + actual_sha)
    run = subprocess.run(
        ["node", "--no-warnings", "-e", NODE_AUDIT, base64.b64encode(raw).decode("ascii")],
        capture_output=True, text=True, timeout=25, check=False
    )
    if run.returncode != 0:
        raise RuntimeError("NODE_FAILED:" + run.stderr[:1500])
    rows = json.loads(run.stdout)
    if len(rows) != len(EXPECTED):
        raise RuntimeError("CASE_COUNT_MISMATCH")
    for row in rows:
        expected = EXPECTED.get(row["mode"])
        observed = (row["remaining"], row["unlinked"], row["released"], row["error"])
        if expected is None or observed != expected or row["reads"] != 1:
            raise RuntimeError("CASE_MISMATCH:" + json.dumps(row, sort_keys=True))
    payload = {
        "source_commit": SOURCE_COMMIT,
        "source_path": SOURCE_PATH,
        "source_sha256": actual_sha,
        "case_count": len(rows),
        "results": rows,
        "research_only": True,
        "order_authorized": False,
        "decision": "NEED_NATIVE_ALLOCATOR",
        "evidence_scope": "original TS release expression with in-memory mocked read/unlink",
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    print(json.dumps({
        "canonical_sha256": hashlib.sha256(canonical).hexdigest(),
        "cases": len(rows),
        "source_sha256": actual_sha,
        "results": rows,
        "decision": "NEED_NATIVE_ALLOCATOR",
        "order_authorized": False,
    }, ensure_ascii=False, sort_keys=True))

if __name__ == "__main__":
    main()
