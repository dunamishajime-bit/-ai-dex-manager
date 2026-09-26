import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import readline from "node:readline";

const root = path.resolve(process.env.SEVEN_BT_SOURCE_ROOT ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "seven_source"));
const snapshot = path.resolve(root, "snapshot");
const manifest = JSON.parse(readFileSync(path.join(root, "source-manifest.json"), "utf8"));
const FROZEN = "cde62b3909a86e4791a19e78862eeaa37653e03a";
const BASE = "a09ea45ca3cbd72100f9eb0eaae499039c40b6a0";
if (manifest.seven_research_source_sha !== FROZEN ||
    manifest.source_commit_parent_sha !== BASE ||
    manifest.live_five_runtime_sha !== BASE ||
    manifest.actual_vps_seven_live_verified !== false)
  throw new Error("SEVEN_BT_PRODUCTION_PROVENANCE_MISMATCH");
for (const rec of manifest.files) {
  if (!rec.materialized_for_bridge) continue;
  const fp = path.resolve(snapshot, rec.path);
  if (!fp.startsWith(snapshot + path.sep) || !existsSync(fp) || !statSync(fp).isFile())
    throw new Error("SEVEN_BT_MISSING_AUDITED_SOURCE:" + rec.path);
  if (createHash("sha256").update(readFileSync(fp)).digest("hex") !== rec.sha256)
    throw new Error("SEVEN_BT_SOURCE_HASH_MISMATCH:" + rec.path);
}
registerHooks({
  resolve(specifier, ctx, next) {
    let target;
    if (specifier.startsWith("@/")) target = path.join(snapshot, specifier.slice(2));
    else if (specifier.startsWith("./") || specifier.startsWith("../"))
      target = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), specifier);
    else return next(specifier, ctx);
    for (const candidate of [target, target + ".ts", target + ".js", target + ".json"]) {
      if (candidate.startsWith(snapshot + path.sep) &&
          existsSync(candidate) && statSync(candidate).isFile())
        return {url:pathToFileURL(candidate).href, shortCircuit:true};
    }
    throw new Error("SEVEN_BT_IMPORT_OUTSIDE_HASHED_SOURCE:" + specifier + ":" + String(ctx.parentURL).split("/").slice(-3).join("/"));
  },
  load(url, ctx, next) {
    const fp = fileURLToPath(url);
    if (url.endsWith(".ts"))
      return {format:"module", source:stripTypeScriptTypes(readFileSync(fp,"utf8")),
        shortCircuit:true};
    if (url.endsWith(".json"))
      return {format:"module", source:"export default " +
        JSON.stringify(JSON.parse(readFileSync(fp,"utf8"))) + ";", shortCircuit:true};
    return next(url,ctx);
  }
});
const sleeves = await import(pathToFileURL(path.join(snapshot,"lib/hype-zec-long-sleeves.ts")).href);
const policy = await import(pathToFileURL(path.join(snapshot,"config/hypeZecLongPolicy.ts")).href);
const preemption = await import(pathToFileURL(path.join(snapshot,"lib/hype-zec-preemption.ts")).href);
const safe = v => JSON.parse(JSON.stringify(v,(_,x) => Number.isNaN(x)?null:x));
function answer(q) {
  if (q.op==="audit") return {sourceSha:FROZEN,liveBaseSha:BASE,
    researchOnly:true,policy:safe(policy.HYPE_ZEC_LONG_POLICY),
    exports:Object.keys(sleeves).sort()};
  if (q.op==="evaluate") {
    if (q.strategy!=="HYPE"&&q.strategy!=="ZEC")
      throw new Error("SEVEN_BT_UNKNOWN_SLEEVE");
    const result=(q.strategy==="HYPE"?sleeves.evaluateHypeLongSignal:
      sleeves.evaluateZecLongSignal)(q.input);
    return safe(result);
  }
  if (q.op==="quantity")return safe(sleeves.calculateHypeZecQuantity(q.input));
  if (q.op==="preemption")return safe(preemption.planHypeZecPreemption(q.input));
  throw new Error("SEVEN_BT_UNKNOWN_OP");
}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of rl) {
  try {const data=JSON.parse(line);process.stdout.write(JSON.stringify({ok:true,result:answer(data)})+"\n");}
  catch(e){process.stdout.write(JSON.stringify({ok:false,error:e instanceof Error?e.message:"UNKNOWN_ERROR"})+"\n");}
}
