"""Read-only research audit of a pinned pending registry; all concurrent I/O is in memory."""
import hashlib,json,os,subprocess,urllib.request
REF="939b59da49ce7960485a2004b0068dc63417ae82"
SHA="09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100"
URL="https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/"+REF+"/lib/disdex-pending-exposure-registry.ts"
JS=r"""
const fs=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const src=JSON.parse(fs.readFileSync(0,'utf8')).src;
const extract=n=>{
 const m=new RegExp('^(?:export )?(?:async )?function '+n+'\\(','m').exec(src);
 if(!m)throw Error('SOURCE_MISSING:'+n);
 const end=src.indexOf('\\n}',m.index);
 if(end<0)throw Error('END_MISSING:'+n);
 return stripTypeScriptTypes(src.slice(m.index,end+2).replace(/^export /,''),{mode:'strip'});
};
if(!src.includes('const ACTIVE_STATUSES = new Set<PendingExposureStatus>(["PENDING", "SUBMITTED", "UNKNOWN"]);'))throw Error('STATUS_DRIFT');
const names=['finiteNonNegative','finitePositive','expectedSleeve','normalizeEntry','normalizePendingExposureRegistry','emptyPendingExposureRegistry','upsertPendingExposure','releasePendingExposure','aggregatePendingExposure'];
const body='const PENDING_EXPOSURE_SCHEMA="disdex-pending-exposure/v1";\\nconst ACTIVE_STATUSES=new Set(["PENDING","SUBMITTED","UNKNOWN"]);\\nconst pendingExposurePath=()=> "MEMORY_ONLY";\\nconst readPendingExposureRegistry=mock.read;\\nconst atomicWrite=mock.write;\\n'+names.map(extract).join('\\n')+'\\nreturn {upsertPendingExposure,releasePendingExposure,aggregatePendingExposure};';
const make=new Function('mock',body);
const clone=x=>JSON.parse(JSON.stringify(x));
const entry=id=>({reservationId:id,strategyId:'IDLE_PRIORITY_SHORT',sleeve:'CRYPTO',symbol:'RENDER',side:'SHORT',gross:0.25,notionalUsd:250,createdAt:1000});
const empty=()=>({schema:'disdex-pending-exposure/v1',accountScope:'ASTER_FUTURES',updatedAt:1000,entries:[]});
async function scenario(mode,reverse=false){
 let store=empty(),reads=0,wait=[],writes=[];
 const read=async()=>{
  const snapshot=clone(store);
  if(mode==='sequential')return snapshot;
  reads++;if(reads===2)wait.forEach(x=>x());else await new Promise(r=>wait.push(r));
  return snapshot;
 };
 const write=async(path,doc)=>{
  if(mode==='sequential'){store=clone(doc);return;}
  await new Promise(resolve=>{
   writes.push({doc:clone(doc),resolve});
   if(writes.length===2){
    const ordered=reverse?[...writes].reverse():writes;
    for(const x of ordered){store=clone(x.doc);x.resolve();}
   }
  });
 };
 const api=make({read,write});
 if(mode==='sequential'){
  await api.upsertPendingExposure(entry('A'),'MEMORY_ONLY');
  await api.upsertPendingExposure(entry('B'),'MEMORY_ONLY');
 }else if(mode==='upserts'){
  await Promise.all([api.upsertPendingExposure(entry('A'),'MEMORY_ONLY'),api.upsertPendingExposure(entry('B'),'MEMORY_ONLY')]);
 }else{
  store.entries=[{...entry('A'),status:'PENDING',updatedAt:1000}];
  await Promise.all([api.releasePendingExposure('A','MEMORY_ONLY'),api.upsertPendingExposure(entry('B'),'MEMORY_ONLY')]);
 }
 return {rows:store.entries.map(x=>[x.reservationId,x.status]).sort((a,b)=>a[0].localeCompare(b[0])),gross:api.aggregatePendingExposure(store).cryptoGross};
}
(async()=>{
 const cases={sequential:await scenario('sequential'),upserts_ab:await scenario('upserts'),upserts_ba:await scenario('upserts',true),release_upsert:await scenario('release'),upsert_release:await scenario('release',true)};
 if(cases.sequential.rows.length!==2||cases.sequential.gross!==0.5)throw Error('SEQUENTIAL');
 if(cases.upserts_ab.rows.length!==1||cases.upserts_ba.rows.length!==1)throw Error('LOST_UPDATE');
 if(cases.release_upsert.rows.length!==2||cases.release_upsert.rows[0][1]!=='PENDING')throw Error('RESURRECTION');
 if(cases.upsert_release.rows.length!==1||cases.upsert_release.rows[0][1]!=='RELEASED')throw Error('DROPPED_ENTRY');
 process.stdout.write(JSON.stringify(cases));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
"""
def main():
    if not os.getcwd().lower().replace("\\","/").startswith("c:/users/dis/render4427-research-only"):
        raise RuntimeError("FAIL_CLOSED_RESEARCH_CWD")
    src=urllib.request.urlopen(URL,timeout=30).read()
    if hashlib.sha256(src).hexdigest()!=SHA:raise RuntimeError("FAIL_CLOSED_SOURCE_SHA")
    p=subprocess.run(["node","-e",JS],input=json.dumps({"src":src.decode("utf-8")}),text=True,capture_output=True,timeout=40)
    if p.returncode:raise RuntimeError("FAIL_CLOSED_NODE:"+p.stderr[-2000:])
    result={"audit":"pending_concurrent_read_modify_write","source_sha256":SHA,"cases":json.loads(p.stdout),"native8_attested":False,"order_authorized":False,"economic_bt":False}
    raw=json.dumps(result,sort_keys=True,separators=(",",":")).encode()
    print(json.dumps({"canonical_sha256":hashlib.sha256(raw).hexdigest(),"result":result},sort_keys=True))
if __name__=="__main__":main()
