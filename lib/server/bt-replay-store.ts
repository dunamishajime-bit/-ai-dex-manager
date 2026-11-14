import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Replay } from "@/lib/bt-verification/replay";
import { validateReplay } from "@/lib/bt-verification/replay";

export const MAX_REPLAY_BYTES = 30 * 1024 * 1024;
export const MAX_RUNS_PER_OWNER = 40;
export const MAX_BYTES_PER_OWNER = 300 * 1024 * 1024;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredReplayMeta = {
  id: string;
  name: string;
  createdAt: string;
  frames: number;
  mode: "DEMO" | "EXTERNAL";
  bytes: number;
  sha256: string;
  sourceKind: string;
};

function getArchiveRoot(): string {
  const value = process.env.DISDEX_BT_ARCHIVE_DIR?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("BT_ARCHIVE_DIR_NOT_CONFIGURED");
  // Explicitly configured independent archive, never .next or public/ and never LIVE runtime directories.
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root || /[\\/]public$|[\\/]\.next$/i.test(resolved)) {
    throw new Error("BT_ARCHIVE_DIR_UNSAFE");
  }
  return resolved;
}
export function isReplayStoreConfigured(): boolean {
  try { getArchiveRoot(); return true; } catch { return false; }
}
function ownerNamespace(subject: string): string {
  if (!subject || subject.length > 512) throw new Error("BT_SUBJECT_INVALID");
  return crypto.createHash("sha256").update("disdex-bt-store-v1:"+subject).digest("hex");
}
async function ownerDir(subject: string): Promise<string> {
  const dir = path.join(getArchiveRoot(),ownerNamespace(subject));
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  return dir;
}
function paths(dir: string,id: string) {
  if (!RUN_ID.test(id)) throw new Error("BT_RUN_ID_INVALID");
  return {data:path.join(dir,id+".json"),meta:path.join(dir,id+".meta.json")};
}
async function atomicWrite(destination: string,payload: string) {
  const tmp=destination+"."+crypto.randomBytes(7).toString("hex")+".tmp";
  try {
    await fs.writeFile(tmp,payload,{flag:"wx",mode:0o600,encoding:"utf-8"});
    await fs.rename(tmp,destination);
  } finally {
    await fs.unlink(tmp).catch(()=>undefined);
  }
}
export async function listOwnerRuns(subject:string):Promise<StoredReplayMeta[]> {
  const dir=await ownerDir(subject);
  const entries=await fs.readdir(dir);
  const valid=entries.filter(name=>RUN_ID.test(name.replace(/\.meta\.json$/,""))&&name.endsWith(".meta.json"));
  const rows=await Promise.all(valid.map(async filename=>{
    try {
      const json=JSON.parse(await fs.readFile(path.join(dir,filename),"utf-8")) as StoredReplayMeta;
      if(!RUN_ID.test(json.id)||filename!==json.id+".meta.json")return null;
      if(!Number.isFinite(json.bytes)||json.bytes<0||json.bytes>MAX_REPLAY_BYTES)return null;
      await fs.access(paths(dir,json.id).data);
      return json;
    } catch {return null}
  }));
  return rows.filter((x):x is StoredReplayMeta=>x!==null).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function saveOwnerRun(subject:string,name:string,rawReplay:unknown):Promise<StoredReplayMeta> {
  if(!validateReplay(rawReplay)) throw new Error("BT_REPLAY_INVALID");
  const payload=JSON.stringify(rawReplay);
  const bytes=Buffer.byteLength(payload,"utf-8");
  if(bytes<1||bytes>MAX_REPLAY_BYTES) throw new Error("BT_REPLAY_TOO_LARGE");
  const ownerRuns=await listOwnerRuns(subject);
  if(ownerRuns.length>=MAX_RUNS_PER_OWNER||
    ownerRuns.reduce((n,x)=>n+x.bytes,0)+bytes>MAX_BYTES_PER_OWNER) {
    throw new Error("BT_OWNER_QUOTA_EXCEEDED");
  }
  const id=crypto.randomUUID();
  const dir=await ownerDir(subject);
  const dest=paths(dir,id);
  const meta:StoredReplayMeta={
    id,name:name.trim().slice(0,120)||"BT replay",createdAt:new Date().toISOString(),
    frames:(rawReplay as Replay).frames.length,
    mode:(rawReplay as Replay).mode,
    bytes,sha256:crypto.createHash("sha256").update(payload).digest("hex"),
    sourceKind:(rawReplay as Replay).source?.kind??"UNKNOWN",
  };
  await atomicWrite(dest.data,payload);
  try {await atomicWrite(dest.meta,JSON.stringify(meta))}
  catch(e){await fs.unlink(dest.data).catch(()=>undefined);throw e}
  return meta;
}
export async function readOwnerRun(subject:string,id:string):Promise<{meta:StoredReplayMeta;data:Replay}|null>{
  const dest=paths(await ownerDir(subject),id);
  try {
    const [metaRaw,content]=await Promise.all([fs.readFile(dest.meta,"utf-8"),fs.readFile(dest.data,"utf-8")]);
    const meta=JSON.parse(metaRaw) as StoredReplayMeta;
    if(meta.id!==id||Buffer.byteLength(content,"utf-8")!==meta.bytes||
      crypto.createHash("sha256").update(content).digest("hex")!==meta.sha256){
      throw new Error("BT_REPLAY_HASH_MISMATCH");
    }
    const data:unknown=JSON.parse(content);
    if(!validateReplay(data))throw new Error("BT_REPLAY_INTEGRITY_INVALID");
    return {meta,data};
  }catch(e){
    if((e as NodeJS.ErrnoException)?.code==="ENOENT")return null;
    throw e;
  }
}
export async function deleteOwnerRun(subject:string,id:string):Promise<boolean>{
  const dest=paths(await ownerDir(subject),id);
  // Validate signed owner's exact target before deletion; never recursive and no arbitrary paths.
  try {await fs.access(dest.meta)}
  catch(e){if((e as NodeJS.ErrnoException)?.code==="ENOENT")return false;throw e}
  await fs.unlink(dest.meta);
  await fs.unlink(dest.data).catch((e:NodeJS.ErrnoException)=>{if(e.code!=="ENOENT")throw e});
  return true;
}
