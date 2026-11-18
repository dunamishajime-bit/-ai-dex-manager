/** Source-preserving classification for BT replay events. No event type proves actual venue execution. */
export type BTEventKind="CANDIDATE"|"RISK_REJECTED"|"RESEARCH_ENTRY"|"RESEARCH_EXIT"|
 "DEMO_ENTRY"|"DEMO_EXIT"|"PARTIAL"|"EXTERNAL_DEPOSIT"|"FUNDING"|"RISK"|"NOTICE";
export type BTEventClassification={kind:BTEventKind;label:string;severity:"neutral"|"risk"|"entry"|"exit"|"cash"};
export function classifyBTEvent(event:string):BTEventClassification{
 const e=event.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\s+/,"");
 const result=(kind:BTEventKind,label:string,severity:BTEventClassification["severity"]):BTEventClassification=>
  ({kind,label,severity});
 if(/^BLOCK\b/.test(e))return result("RISK_REJECTED","リスク拒否","risk");
 if(/^CANDIDATE\b/.test(e))return result("CANDIDATE","発火候補（未約定）","neutral");
 if(/^MODEL ENTRY\b/.test(e))return result("RESEARCH_ENTRY","研究モデル入口（非実約定）","entry");
 if(/^MODEL EXIT\b/.test(e))return result("RESEARCH_EXIT","研究モデル決済（非実約定）","exit");
 if(/^EXTERNAL DEPOSIT\b/.test(e))return result("EXTERNAL_DEPOSIT","積立・外部入金","cash");
 if(/^RISK\b/.test(e))return result("RISK","リスク管理イベント","risk");
 if(/^FUNDING\b/.test(e))return result("FUNDING","Funding","neutral");
 if(/\bPARTIAL\b|部分決済/.test(e))return result("PARTIAL","部分決済（モデル）","exit");
 if(/\bENTRY\b|発火|エントリー/.test(e))return result("DEMO_ENTRY","模擬・入口表示","entry");
 if(/\bEXIT\b|決済|利確|損切/.test(e))return result("DEMO_EXIT","模擬・決済表示","exit");
 return result("NOTICE","その他の記録","neutral");
}