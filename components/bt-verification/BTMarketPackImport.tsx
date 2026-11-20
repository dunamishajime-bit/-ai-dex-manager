"use client";
import {useState,type ChangeEvent} from "react";
import {FileUp} from "lucide-react";
import {
 parseHistoricalPack,parseHistoricalPackManifest,
 type HistoricalPackManifest
} from "@/lib/bt-verification/historical-symbol-pack";
import type {BtcCandle} from "@/lib/bt-verification/replay";

export function BTMarketPackImport({onLoaded}:{
 onLoaded:(manifest:HistoricalPackManifest,candles:Record<string,BtcCandle[]>)=>void;
}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function load(event:ChangeEvent<HTMLInputElement>){
  const files=Array.from(event.currentTarget.files??[]);
  event.currentTarget.value="";
  if(!files.length||busy)return;
  setBusy(true);setError("");
  try{
   if(files.length>9||files.some(f=>f.size>24*1024*1024))
    throw new Error("市場データはマニフェストと最大8個の24MB以下のパックに分けてください。");
   const manifestFile=files.find(f=>f.name==="ASTER_H1_MANIFEST_UNCERTIFIED.json");
   if(!manifestFile)throw new Error("ASTER_H1_MANIFEST_UNCERTIFIED.jsonを一緒に選択してください。");
   const manifest=parseHistoricalPackManifest(JSON.parse(await manifestFile.text()));
   if(files.length!==manifest.packs.length+1)
    throw new Error("選択ファイル数が元データのSHA256マニフェストと一致しません。");
   const candles:Record<string,BtcCandle[]>={};
   for(const spec of manifest.packs){
    const file=files.find(f=>f.name===spec.file);
    if(!file||file.size!==spec.bytes)throw new Error(spec.file+" が不足、またはサイズ不一致です。");
    const bytes=await file.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
      .map(n=>n.toString(16).padStart(2,"0")).join("");
    if(hash!==spec.sha256)throw new Error(spec.file+" のSHA256が不一致です。");
    const decoded=JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const parsed=parseHistoricalPack(decoded,manifest,spec.symbols);
    Object.assign(candles,parsed);
   }
   if(Object.keys(candles).length!==manifest.found_symbols.length)
    throw new Error("実市場H1の通貨数が一致しません。");
   onLoaded(manifest,candles);
  }catch(err){setError(err instanceof Error?err.message:"市場データの取込に失敗しました。");}
  finally{setBusy(false);}
 }
 return <div className="mt-5 rounded-xl border border-[#365977] bg-[#0c2336] p-4">
  <h3 className="text-sm font-bold text-cyan-100">実市場データ・通貨別1時間足を追加</h3>
  <p className="mt-2 text-xs leading-6 text-[#a8c4d4]">PCのASTER_H1_MANIFEST_UNCERTIFIED.jsonと市場パック4件を同時に選択します。SHA256・価格足・欠損を照合し、実市場ローソク足を研究BTの通貨別チャートに追加します。実取引の認証ではありません。</p>
  <label className={"mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-600/50 bg-[#17485c] px-4 py-3 text-sm font-semibold text-white "+(busy?"opacity-50":"")}>
   <FileUp className="h-4 w-4"/>{busy?"実市場H1を照合中…":"過去実市場H1のデータセットを読込"}
   <input className="sr-only" type="file" multiple accept=".json,application/json"
     onChange={load} disabled={busy}/>
  </label>
  {error&&<p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
 </div>;
}