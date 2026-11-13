import json,csv,collections
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001");D=R/"DIRECTION_RESEARCH_20261109"
scores={x["id"]:x for x in [json.loads(l) for l in (D/"three_layer_layer2_online_ensemble_20261114.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]}
base=R/"S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114"
dp=next(base.glob("*_30BPS_DECISIONS.csv"))
with open(dp,newline="",encoding="utf-8-sig") as f:dec=list(csv.DictReader(f))
bytime=collections.defaultdict(list)
for z in dec:bytime[z["utc"]].append(z)
conflict={"RUNNER_SLOT_BUSY","SYMBOL_BUSY","CRYPTO_GROSS_CAP","TOTAL_GROSS_CAP","STOCK_GROSS_CAP"}
cases=[]
for z in dec:
 if z["decision"]!="BLOCK" or z["reason"] not in conflict:continue
 sc=scores.get(z["signal_id"])
 if not sc or not sc.get("layer2Promote") or not isinstance(sc.get("opportunityScore"),(int,float)):continue
 enters=[]
 for q in bytime[z["utc"]]:
  if q["decision"]!="MODEL_ENTER":continue
  sq=scores.get(q["signal_id"])
  if sq and isinstance(sq.get("opportunityScore"),(int,float)):
   enters.append((q,sq))
 if not enters:continue
 lower=[(q,sq) for q,sq in enters if sq["opportunityScore"]<sc["opportunityScore"]]
 if lower:
  best=max(lower,key=lambda p:sc["opportunityScore"]-p[1]["opportunityScore"])
  cases.append({"blocked":z,"blockedScore":sc,"admitted":best[0],"admittedScore":best[1]})
print("POTENTIAL_SWAP_CASES",len(cases))
for c in cases[:100]:
 b=c["blockedScore"];a=c["admittedScore"]
 print(c["blocked"]["utc"],
  "BLOCK",c["blocked"]["signal_id"],c["blocked"]["strategy"],c["blocked"]["reason"],round(b["opportunityScore"],5),"real",round(b["realizedNet30"],4),
  "vs ENTER",c["admitted"]["signal_id"],c["admitted"]["strategy"],round(a["opportunityScore"],5),"real",round(a["realizedNet30"],4),
  "ratio",round(b["opportunityScore"]/a["opportunityScore"],2) if a["opportunityScore"]>0 else None)