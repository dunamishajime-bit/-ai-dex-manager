import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {verifyRequestSession} from "@/lib/server/owner-session";
import {isReplayStoreConfigured, listOwnerRuns, saveOwnerRun, MAX_REPLAY_BYTES} from "@/lib/server/bt-replay-store";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0"};
function authenticate(request:NextRequest) {
  try{return verifyRequestSession(request,["USER","ADMIN"]).subject}
  catch{return null}
}
function validOrigin(request:NextRequest) {
  const origin=request.headers.get("origin");
  if(!origin)return false;
  const expected=process.env.DISDEX_BT_ORIGIN?.trim()||request.nextUrl.origin;
  try{
    const sent=new URL(origin),allowed=new URL(expected);
    return sent.origin===allowed.origin && (sent.protocol==="https:"||sent.hostname==="localhost");
  }catch{return false}
}
async function readBounded(request:NextRequest):Promise<unknown> {
  const length=Number(request.headers.get("content-length")??0);
  if(!Number.isFinite(length)||length<0||length>MAX_REPLAY_BYTES+1024*1024)throw Error("BT_BODY_TOO_LARGE");
  if(!request.body)throw Error("BT_BODY_EMPTY");
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let bytes=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.length;
      if(bytes>MAX_REPLAY_BYTES+1024*1024)throw Error("BT_BODY_TOO_LARGE");
      chunks.push(value);
    }
  }finally{reader.releaseLock()}
  const parsed:unknown=JSON.parse(Buffer.concat(chunks.map(x=>Buffer.from(x)),bytes).toString("utf8"));
  return parsed;
}
export async function GET(request:NextRequest){
  const subject=authenticate(request);
  if(!subject)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  if(!isReplayStoreConfigured())return NextResponse.json({error:"BT_SERVER_ARCHIVE_NOT_CONFIGURED"},{status:503,headers});
  try{return NextResponse.json({items:await listOwnerRuns(subject)},{headers})}
  catch{return NextResponse.json({error:"BT_SERVER_ARCHIVE_UNAVAILABLE"},{status:503,headers})}
}
export async function POST(request:NextRequest){
  const subject=authenticate(request);
  if(!subject)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  if(!validOrigin(request))return NextResponse.json({error:"ORIGIN_NOT_ALLOWED"},{status:403,headers});
  if(!isReplayStoreConfigured())return NextResponse.json({error:"BT_SERVER_ARCHIVE_NOT_CONFIGURED"},{status:503,headers});
  if(!(request.headers.get("content-type")??"").toLowerCase().includes("application/json")){
    return NextResponse.json({error:"JSON_REQUIRED"},{status:415,headers});
  }
  let parsed:unknown;
  try{parsed=await readBounded(request)}
  catch{return NextResponse.json({error:"BT_BODY_INVALID_OR_OVERSIZE"},{status:413,headers})}
  if(!parsed||typeof parsed!=="object")return NextResponse.json({error:"BT_BODY_INVALID"},{status:400,headers});
  const payload=parsed as Record<string,unknown>;
  if(typeof payload.name!=="string"||payload.name.length>160)return NextResponse.json({error:"BT_NAME_INVALID"},{status:400,headers});
  try{const item=await saveOwnerRun(subject,payload.name,payload.replay);
      return NextResponse.json({item},{status:201,headers})}
  catch(e){
    const code=e instanceof Error?e.message:"BT_STORE_FAILURE";
    const status=code==="BT_REPLAY_INVALID"?400:code==="BT_REPLAY_TOO_LARGE"?413:code==="BT_OWNER_QUOTA_EXCEEDED"?409:503;
    return NextResponse.json({error:status===503?"BT_STORE_FAILURE":code},{status,headers});
  }
}
