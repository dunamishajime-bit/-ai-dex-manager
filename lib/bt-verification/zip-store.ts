/** Minimal uncompressed ZIP writer for client-side BT evidence exports. No external dependencies. */
export type ZipEntry = {name:string;content:string};
function crc32(bytes:Uint8Array):number {
 let c=0xffffffff;
 for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}
 return (c^0xffffffff)>>>0;
}
const put16=(v:DataView,i:number,n:number)=>v.setUint16(i,n,true);
const put32=(v:DataView,i:number,n:number)=>v.setUint32(i,n>>>0,true);
export function makeZip(entries:ZipEntry[]):Uint8Array {
 if(entries.length>65535)throw Error("ZIP file count exceeds format limit");
 const encoder=new TextEncoder();const locals:Uint8Array[]=[];const centrals:Uint8Array[]=[];
 let offset=0;
 const used=new Set<string>();
 for(const entry of entries){
  if(!entry.name||entry.name.startsWith("/")||entry.name.includes("..")||entry.name.includes("\\")||used.has(entry.name))throw Error("Unsafe or duplicate ZIP filename");
  used.add(entry.name);
  const name=encoder.encode(entry.name),data=encoder.encode(entry.content);
  if(name.length>65535||data.length>0xffffffff)throw Error("ZIP entry too large");
  const crc=crc32(data);
  const local=new Uint8Array(30+name.length+data.length),lv=new DataView(local.buffer);
  put32(lv,0,0x04034b50);put16(lv,4,20);put16(lv,6,0x0800);put16(lv,8,0);
  put32(lv,14,crc);put32(lv,18,data.length);put32(lv,22,data.length);put16(lv,26,name.length);put16(lv,28,0);
  local.set(name,30);local.set(data,30+name.length);locals.push(local);
  const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
  put32(cv,0,0x02014b50);put16(cv,4,20);put16(cv,6,20);put16(cv,8,0x0800);
  put32(cv,16,crc);put32(cv,20,data.length);put32(cv,24,data.length);put16(cv,28,name.length);
  put32(cv,42,offset);central.set(name,46);centrals.push(central);
  offset+=local.length;
 }
 const centralLength=centrals.reduce((n,e)=>n+e.length,0);
 if(offset+centralLength>0xffffffff)throw Error("ZIP archive too large");
 const end=new Uint8Array(22),v=new DataView(end.buffer);
 put32(v,0,0x06054b50);put16(v,8,entries.length);put16(v,10,entries.length);
 put32(v,12,centralLength);put32(v,16,offset);
 const archive=new Uint8Array(offset+centralLength+end.length);
 let at=0;for(const chunk of [...locals,...centrals,end]){archive.set(chunk,at);at+=chunk.length}
 return archive;
}
