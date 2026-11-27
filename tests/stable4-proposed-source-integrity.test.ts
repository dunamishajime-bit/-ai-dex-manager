import test from "node:test";
import assert from "node:assert/strict";
import {lstatSync,readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
const root=process.cwd(),file="docs/research/STABLE4_PROPOSED_SOURCE_INTEGRITY_20261127.json";
const m=JSON.parse(readFileSync(resolve(root,file),"utf8"));
const sha256=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const digest=(p:string)=>{
 const absolute=resolve(root,p);
 assert.ok(lstatSync(absolute).isFile(),"SHA-pinned source must be a regular file, never a symlink: "+p);
 return sha256(readFileSync(absolute)); // Exact file bytes: do not normalize CRLF or whitespace.
};
test("all 23 candidate source records exactly match checkout without certifying LIVE",()=>{
 assert.equal(m.schema,"stable4-proposed-source-integrity/v1");
 assert.equal(m.status,"REVIEW_ONLY_NO_CERTIFICATE");
 assert.equal(m.productionEligible,false);assert.equal(m.orderAuthority,false);
 assert.equal(m.rootCertificateIssued,false);assert.equal(m.ownerApprovalVerified,false);
 assert.equal(Object.keys(m.sourceSha256).length,23);
 for(const [p,sha] of Object.entries(m.sourceSha256) as [string,string][]) {
  assert.match(p,/^[A-Za-z0-9._/-]+$/);assert.ok(!p.includes("..")&&!p.startsWith("/"));
  assert.match(sha,/^[0-9a-f]{64}$/);
  assert.equal(digest(p),sha,"candidate source changed after review snapshot: "+p);
 }
});
test("historical manifest unchanged and exactly four intentional source diffs",()=>{
 const historical="docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json";
 assert.equal(digest(historical),m.historicalManifestSha256);
 const old=JSON.parse(readFileSync(resolve(root,historical),"utf8")).sourceSha256 as Record<string,string>;
 assert.deepEqual(Object.keys(old).sort(),Object.keys(m.sourceSha256).sort());
 const changed=Object.keys(old).filter(p=>old[p]!==m.sourceSha256[p]).sort();
 assert.deepEqual(changed,[
  "lib/aster-v3-client.ts","lib/pengu-dual-ls-v2-portfolio-runner.ts",
  "lib/v12-v4-runner-engine.ts","lib/v12-v4-shared-reservations.ts"]);
 assert.deepEqual(m.changedPaths.sort(),changed);
});

test("SHA-256 source pins reject byte-level changes, including line-ending substitutions",()=>{
 const path="lib/aster-v3-client.ts";
 const bytes=readFileSync(resolve(root,path));
 assert.equal(sha256(bytes),m.sourceSha256[path]);
 assert.notEqual(sha256(Buffer.concat([bytes,Buffer.from("\n")])),m.sourceSha256[path]);
 assert.notEqual(sha256(Buffer.from("line\r\n")),sha256(Buffer.from("line\n")));
});
