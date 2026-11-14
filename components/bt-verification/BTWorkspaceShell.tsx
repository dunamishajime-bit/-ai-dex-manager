"use client";

import type {ReactNode} from "react";
import {ArrowLeft,BarChart3,FileText,FlaskConical,Layers3,Play,Database,ShieldCheck,Activity} from "lucide-react";

export type BTWorkspaceTab="config"|"playback"|"results"|"report"|"library";
export const BT_WORKSPACE_TABS:{id:BTWorkspaceTab;label:string;short:string;hint:string;Icon:typeof FlaskConical}[]=[
  {id:"config",label:"条件設定",short:"条件",hint:"BTの検証条件",Icon:FlaskConical},
  {id:"playback",label:"検証実行",short:"再生",hint:"時点同期リプレイ",Icon:Play},
  {id:"results",label:"検証結果",short:"結果",hint:"損益・Gross集計",Icon:BarChart3},
  {id:"report",label:"レポート",short:"分析",hint:"GPT・Codex連携",Icon:FileText},
  {id:"library",label:"保存データ",short:"保存",hint:"再読込・ダウンロード",Icon:Database},
];
const entry="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-medium transition-colors";
export function BTWorkspaceShell({
  activeTab,onTabChange,children,sourceStatus,
}:{
  activeTab:BTWorkspaceTab;
  onTabChange:(tab:BTWorkspaceTab)=>void;
  children:ReactNode;
  sourceStatus:string;
}){
  return <div className="flex min-h-dvh w-full bg-[radial-gradient(ellipse_at_75%_-6%,#123044_0%,#081321_44%,#07111e_100%)] text-[#dae8f5] selection:bg-cyan-400/30">
    <aside className="sticky top-0 hidden h-dvh w-[218px] shrink-0 flex-col border-r border-[#213346] bg-[linear-gradient(180deg,#101d30_0%,#0c192b_53%,#081525_100%)] md:flex">
      <div className="flex h-[70px] items-center gap-3 border-b border-[#223348] px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10"><Activity className="h-5 w-5 text-cyan-300"/></span>
        <div><div className="text-sm font-semibold tracking-tight text-white">DisDex Manager</div><div className="text-[10px] uppercase tracking-[.18em] text-[#6689a6]">BT ANALYTICS</div></div>
      </div>
      <div className="px-3 pt-6">
        <p className="mb-3 pl-3 text-[10px] font-semibold uppercase tracking-[.19em] text-[#69819b]">BT専用メニュー</p>
        <nav className="space-y-1" aria-label="BT検証専用メニュー">
          {BT_WORKSPACE_TABS.map(({id,label,hint,Icon})=>
            <button key={id} type="button" aria-current={activeTab===id?"page":undefined}
              onClick={()=>onTabChange(id)}
              className={entry+(activeTab===id?
                " border border-cyan-500/35 bg-[linear-gradient(90deg,rgba(0,183,213,.22),rgba(37,88,143,.23))] text-white shadow-[inset_3px_0_0_#22d3ee,0_4px_18px_rgba(5,12,32,.2)]":
                " border border-transparent text-[#9bb0c7] hover:bg-[#1c3046] hover:text-white")}>
              <Icon className={"h-[17px] w-[17px] shrink-0 "+(activeTab===id?"text-cyan-300":"text-[#8097b1]")}/>
              <span className="min-w-0"><span className="block font-semibold">{label}</span><span className="mt-[2px] block text-[10px] text-[#7590a8]">{hint}</span></span>
            </button>)}
        </nav>
      </div>
      <div className="mx-4 mt-6 rounded-xl border border-[#2c4b60] bg-[linear-gradient(160deg,rgba(20,50,72,.85),rgba(8,24,40,.88))] p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-200"><ShieldCheck className="h-4 w-4"/> BT表示専用</div>
        <p className="text-[11px] leading-5 text-[#9ab0c6]">過去データと模擬データの可視化です。LIVEの注文・保有建玉には接続しません。</p>
      </div>
      <a href="https://professional-dismanager.net/" className="mx-3 mb-5 mt-auto flex items-center gap-3 rounded-xl border border-[#365873] bg-[#14283b] px-3 py-3 text-[13px] font-semibold text-cyan-100 transition-colors hover:border-cyan-500 hover:bg-[#1a354a]">
        <ArrowLeft className="h-[17px] w-[17px]"/>通常HPへ戻る
      </a>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex h-[58px] items-center justify-between gap-3 border-b border-[#23384e] bg-[#0d192b]/95 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Layers3 className="h-5 w-5 shrink-0 text-cyan-300"/>
          <span className="truncate text-sm font-semibold text-white">BT検証ワークスペース</span>
          <span className="hidden rounded-full border border-cyan-600/40 bg-cyan-500/10 px-2 py-[3px] text-[10px] font-semibold text-cyan-200 sm:inline-flex">READ ONLY</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="max-w-44 truncate text-[11px] text-[#91a9c1] sm:max-w-none">{sourceStatus}</span>
          <span className="hidden h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-[#1a3044] text-xs font-semibold text-slate-200 sm:flex">BT</span>
        </div>
      </header>
      <main className="min-w-0 pb-24 md:pb-10">
        <div className="mx-auto w-full max-w-[1720px] px-3 pb-4 pt-5 sm:px-5 xl:px-7">
          <div className="mb-5">
            <div className="mb-1 flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-[27px]"><FlaskConical className="mr-2 inline h-6 w-6 align-[-4px] text-cyan-300"/>BT検証ページ</h1>
              <span className="rounded-full border border-cyan-400/50 bg-[#0d403f]/35 px-3 py-1 text-[10px] font-semibold text-cyan-200">{sourceStatus}</span>
            </div>
            <p className="pl-0 text-xs leading-5 text-[#91a7bd] sm:pl-9">ロジックと資金の動きを時系列で検証する専用ワークスペース。デモは模擬値で、最新ロジックによる新規BT実行ではありません。</p>
          </div>
          <nav className="mb-5 flex min-w-0 gap-1 overflow-x-auto border-b border-[#2b455a] pb-px [scrollbar-width:none]" aria-label="BT画面タブ">
            {BT_WORKSPACE_TABS.map(({id,label,short,Icon})=>
              <button key={id} type="button" onClick={()=>onTabChange(id)}
                aria-current={activeTab===id?"page":undefined}
                className={"flex shrink-0 items-center gap-2 rounded-t-lg border-b-[3px] px-4 py-3 text-[12px] font-semibold transition-all sm:px-6 sm:text-sm "+(activeTab===id?"border-cyan-400 bg-[#123449] text-cyan-100":"border-transparent bg-[#132235]/65 text-[#829ab2] hover:bg-[#19324a] hover:text-slate-100")}>
                <Icon className="h-[15px] w-[15px]"/><span className="hidden sm:inline">{label}</span><span className="sm:hidden">{short}</span>
              </button>)}
          </nav>
          {children}
        </div>
      </main>
    </div>
    <div className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-between border-t border-[#2b4a5f] bg-[#101e30]/98 px-2 py-2 shadow-[0_-10px_28px_#050b1e] backdrop-blur md:hidden" aria-label="モバイルBT専用メニュー">
      <a href="https://professional-dismanager.net/" className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-cyan-200"><ArrowLeft className="h-[19px] w-[19px]"/>HPへ戻る</a>
      {BT_WORKSPACE_TABS.map(({id,short,Icon})=><button key={id} type="button" onClick={()=>onTabChange(id)}
        className={"flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[10px] "+(activeTab===id?"bg-[#1c4562] font-semibold text-cyan-100":"text-[#8097ac]")}>
        <Icon className="h-[19px] w-[19px]"/>{short}
      </button>)}
    </div>
  </div>;
}
