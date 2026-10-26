#!/usr/bin/env python3
"""Research-only: test archive/read/rename identity race using pinned original TS in memory."""
import hashlib
import json
import subprocess
import urllib.request

SOURCE_REF = "939b59da49ce7960485a2004b0068dc63417ae82"
SOURCE_PATH = "lib/disdex-expired-account-lock-recovery.ts"
SOURCE_SHA256 = "a16dd16a0aeaaf7cd8c1873ad0c9dbe994560ebbf87f7933d29a9f7cf4a65395"
SOURCE_URL = ("https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/"
              + SOURCE_REF + "/" + SOURCE_PATH)
NODE = r'''
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const path = require("node:path");
const tsModule = require("node:module");
const raw = fs.readFileSync(0, "utf8");
const strippedImports = raw.replace(/^import[^\n]*\n/gm, "").replace(/\bexport\s+/g, "");
const code = tsModule.stripTypeScriptTypes(strippedImports, {mode:"strip"});
const old = {schema:"disdex-account-lock/v1", ownerId:"RUNNER:101", expiresAt:900, reservations:[]};
const newer = {schema:"disdex-account-lock/v1", ownerId:"RUNNER:202", expiresAt:2000, reservations:[]};
const lockPath = path.resolve("/research/account-order.lock");
const archiveDir = path.resolve("/research/archive");
const cases = [
  "baseline", "replace_active", "unlink_reacquire", "unlink_only",
  "reserved_old", "not_expired", "wrong_owner", "owner_alive"
];
async function runCase(mode) {
  const initial = {...old};
  if (mode === "reserved_old") initial.reservations = [{reservationId:"R",status:"RESERVED"}];
  if (mode === "not_expired") initial.expiresAt = 2000;
  if (mode === "wrong_owner") initial.ownerId = "OTHER:101";
  const store = new Map([[lockPath, Buffer.from(JSON.stringify(initial))]]);
  const lstat = async p => {
    if (!store.has(p)) throw Object.assign(new Error("ENOENT"), {code:"ENOENT"});
    return {isFile:()=>true, isSymbolicLink:()=>false};
  };
  const readFile = async p => {
    if (!store.has(p)) throw Object.assign(new Error("ENOENT"), {code:"ENOENT"});
    return Buffer.from(store.get(p));
  };
  const rename = async (from,to) => {
    if (mode === "replace_active" || mode === "unlink_reacquire") {
      if (mode === "unlink_reacquire") store.delete(lockPath);
      store.set(lockPath, Buffer.from(JSON.stringify(newer)));
    }
    if (mode === "unlink_only") store.delete(lockPath);
    if (!store.has(from)) throw Object.assign(new Error("ENOENT"), {code:"ENOENT"});
    store.set(to,store.get(from));
    store.delete(from);
  };
  const context = {
    createHash:crypto.createHash, randomUUID:crypto.randomUUID, resolve:path.resolve,
    dirname:path.dirname, lstat, readFile, rename,
    mkdir:async()=>{}, chmod:async()=>{}, Buffer, console
  };
  vm.runInNewContext(code + "\nglobalThis.auditArchive=archiveExpiredAccountOrderLock;", context);
  let outcome;
  try {
    const r = await context.auditArchive({
      lockPath, archiveDir, requestId:"audit", now:1000,
      expectedOwnerId:"RUNNER:101", ownerAlive:mode==="owner_alive"
    });
    outcome = r.status;
  } catch(e) {outcome = String(e.message);}
  const archived = [...store.entries()].filter(([p])=>p !== lockPath);
  const archivedOwner = archived.length ? JSON.parse(archived[0][1].toString("utf8")).ownerId : null;
  return {case:mode, outcome, lock_exists:store.has(lockPath),
          archived_count:archived.length, archived_owner:archivedOwner};
}
(async()=>{
 const rows=[];
 for (const c of cases) rows.push(await runCase(c));
 process.stdout.write(JSON.stringify({rows}));
})().catch(e=>{console.error(e.stack);process.exit(1);});
'''

def main():
    source = urllib.request.urlopen(SOURCE_URL, timeout=20).read()
    source_sha = hashlib.sha256(source).hexdigest()
    if source_sha != SOURCE_SHA256:
        raise RuntimeError("SOURCE_SHA256_MISMATCH: " + source_sha)
    proc = subprocess.run(["node", "-e", NODE], input=source.decode("utf8"),
                          text=True, capture_output=True, timeout=35, check=True)
    data = json.loads(proc.stdout)
    by_case = {r["case"]: r for r in data["rows"]}
    expected = {
        "baseline": ("EXPIRED_ACCOUNT_LOCK_ARCHIVED", False, 1, "RUNNER:101"),
        "replace_active": ("ACCOUNT_LOCK_ARCHIVE_BYTES_MISMATCH", False, 1, "RUNNER:202"),
        "unlink_reacquire": ("ACCOUNT_LOCK_ARCHIVE_BYTES_MISMATCH", False, 1, "RUNNER:202"),
        "unlink_only": ("ENOENT", False, 0, None),
        "reserved_old": ("ACCOUNT_LOCK_RESERVATIONS_PRESENT", True, 0, None),
        "not_expired": ("ACCOUNT_LOCK_NOT_EXPIRED", True, 0, None),
        "wrong_owner": ("ACCOUNT_LOCK_OWNER_MISMATCH", True, 0, None),
        "owner_alive": ("ACCOUNT_LOCK_OWNER_STILL_ALIVE", True, 0, None),
    }
    for key, exp in expected.items():
        got = by_case[key]
        actual = (got["outcome"], got["lock_exists"],
                  got["archived_count"], got["archived_owner"])
        if actual != exp:
            raise RuntimeError("CASE_MISMATCH " + key + " " + repr(actual))
    output = {"source_ref": SOURCE_REF, "source_path": SOURCE_PATH,
              "source_sha256": source_sha, "case_count":len(expected),
              "cases":data["rows"], "research_only":True,
              "native8_certified":False, "live_order_authorized":False}
    canonical = json.dumps(output, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    print(json.dumps({"canonical_sha256":hashlib.sha256(canonical.encode()).hexdigest(),
                      "audit":output}, sort_keys=True, separators=(",", ":")))

if __name__ == "__main__":
    main()
