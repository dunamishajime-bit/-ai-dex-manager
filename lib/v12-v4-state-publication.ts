/** Filesystem-only publication. Caller must hold the shared account lock and
 * keep the Runner stopped/read-only. This function grants no order authority. */
import {promises as fs,constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {V4ExecutionStore,type V4ExecutionDocument} from './v12-v4-execution-store';

async function syncDirectory(path:string){
 if(process.platform==='win32')return; // Linux Production always fsyncs directories.
 const handle=await fs.open(path,constants.O_RDONLY);
 try{await handle.sync();}finally{await handle.close();}
}
async function readRegular(path:string){
 const handle=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const metadata=await handle.stat();
  if(!metadata.isFile()||metadata.size>16*1024*1024)throw Error('V4_MIGRATION_UNSAFE_STATE_FILE');
  return {metadata,bytes:await handle.readFile()};
 }finally{await handle.close();}
}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

export async function publishV4MigratedState(input:{statePath:string;expectedOldBytes:Buffer;candidate:V4ExecutionDocument}){
 const before=await readRegular(input.statePath);
 if(!before.bytes.equals(input.expectedOldBytes))throw Error('V4_MIGRATION_STATE_CHANGED');
 const old=JSON.parse(before.bytes.toString('utf8')) as V4ExecutionDocument;
 const next=input.candidate;
 if(!/^[a-f0-9]{40}$/.test(next.releaseSha)||next.releaseSha===old.releaseSha||
    !next.legacyReleaseShas?.includes(old.releaseSha)||next.revision!==old.revision)
  throw Error('V4_MIGRATION_LINEAGE_INVALID');
 new V4ExecutionStore(input.statePath,old.releaseSha).read();
 const parent=dirname(input.statePath),backups=join(parent,'migrations');
 await fs.mkdir(backups,{recursive:true,mode:0o700});
 const info=await fs.lstat(backups);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('V4_MIGRATION_UNSAFE_BACKUP_DIRECTORY');
 await syncDirectory(parent);
 const token=randomUUID(),temporary=join(parent,`.v4-migration-${token}.tmp`);
 const backupPath=join(backups,`orders.${old.releaseSha}-to-${next.releaseSha}.${token}.json`);
 const payload=Buffer.from(JSON.stringify(next)+'\n');
 let temporaryCreated=false;
 try{
  const temporaryHandle=await fs.open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  temporaryCreated=true;
  try{
   await temporaryHandle.writeFile(payload);await temporaryHandle.chown(before.metadata.uid,before.metadata.gid);
   await temporaryHandle.chmod(before.metadata.mode&0o777);await temporaryHandle.sync();
  }finally{await temporaryHandle.close();}
  new V4ExecutionStore(temporary,next.releaseSha).read();
  const backup=await fs.open(backupPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await backup.writeFile(before.bytes);await backup.sync();}finally{await backup.close();}
  await syncDirectory(backups);
  const current=await readRegular(input.statePath);
  if(!current.bytes.equals(before.bytes)||current.metadata.ino!==before.metadata.ino||current.metadata.dev!==before.metadata.dev)
   throw Error('V4_MIGRATION_STATE_CHANGED');
  // Never rename the old state away first: a crash cannot leave orders.json absent.
  await fs.rename(temporary,input.statePath);
  await syncDirectory(parent);
  new V4ExecutionStore(input.statePath,next.releaseSha).read();
  return {backupPath,beforeSha256:hash(before.bytes),afterSha256:hash(payload)};
 }finally{
  if(temporaryCreated)await fs.unlink(temporary).catch(error=>{if(error?.code!=='ENOENT')throw error;});
 }
}
