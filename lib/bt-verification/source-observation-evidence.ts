import saved from "@/reports/bt-verification/BT_PR481_H2_7_FAMILY_CAUSAL_OBSERVATIONS_20261116_V1.manifest.json";

/**
 * Deliberately read-only, preverified H2 evidence.
 * This is a FIXED synthetic research snapshot and must never be presented
 * as the currently selected live simulation, actual fills, or PnL.
 * Full compressed observations are saved alongside this manifest in Git.
 */
export const SOURCE_FAMILIES=["V4","Q102","PENGU","FET","IDLE","V52","HYPE"] as const;
export type SourceEvidenceFamily=typeof SOURCE_FAMILIES[number];

export function verifySavedSevenFamilySourceEvidence(){
 const families=saved.sourceObservationCounts;
 const stages=saved.stageCounts;
 const expected=new Set<string>(SOURCE_FAMILIES);
 if(saved.schema!=="disdex-bt-pr481-h2-source-evidence-manifest-v1"||
    saved.taskId!=="BT-481-H2"||
    saved.artificialMarket.seed!==20261115||
    saved.artificialMarket.scenario!=="rotation"||
    saved.artificialMarket.version!=="v4"||
    saved.artificialMarket.realExchangeData!==false||
    saved.liveParityVerified!==false||
    saved.sourceEntryAdmitted!==false||
    saved.actualOrders!==0||saved.actualFills!==0||
    saved.observedPnL!==null||saved.observedPortfolioGross!==null||
    stages.ENTRY_VERIFIED!==0||
    stages.RESEARCH_RULE_SELECTED!==0||
    !/^[0-9a-f]{64}$/.test(saved.sourceLedgerSha256)||
    !/^[0-9a-f]{64}$/.test(saved.archiveSha256)||
    Object.keys(families).length!==expected.size||
    Object.keys(families).some(x=>!expected.has(x)))
    throw Error("BT481_H2_SAVED_SOURCE_EVIDENCE_INVALID");
 const familyTotal=SOURCE_FAMILIES.reduce((sum,f)=>sum+families[f],0);
 const stageTotal=stages.FEATURE_ONLY+stages.SOURCE_CANDIDATE+
   stages.RESEARCH_RULE_SELECTED+stages.ENTRY_VERIFIED;
 if(familyTotal!==stageTotal||familyTotal!==8260||
    stages.SOURCE_CANDIDATE!==54||
    saved.nativeProbeCounters.q102S34Gated!==0||
    saved.v52NativeCandidateWindows!==families.V52)
    throw Error("BT481_H2_SOURCE_EVIDENCE_COUNTS_MISMATCH");
 return {
   label:"保存済みの人工市場・7系統判定観測",
   total:familyTotal,
   candidates:stages.SOURCE_CANDIDATE,
   featureOnly:stages.FEATURE_ONLY,
   entryVerified:stages.ENTRY_VERIFIED,
   orders:saved.actualOrders,fills:saved.actualFills,
   familyCounts:SOURCE_FAMILIES.map(family=>({
     family,observations:families[family]
   })),
   seed:saved.artificialMarket.seed,
   scenario:saved.artificialMarket.scenario,
   version:saved.artificialMarket.version,
   sourceLedgerSha256:saved.sourceLedgerSha256,
   archiveSha256:saved.archiveSha256,
   from:saved.artificialMarket.start,
   endExclusive:saved.artificialMarket.endExclusive,
   archiveRelativePath:saved.archiveRelativePath,
   note:"2025年10月の22日間・33銘柄・固定シード研究記録。画面で現在選択中の市場設定、過去のSTABLE4統合BT、現在のLIVEには連動しません。V4はFAILED_BREAKのみ、HYPEは研究H48、Q102 S1/S2は未学習。候補は約定や利益ではありません。"
 } as const;
}
