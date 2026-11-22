#!/usr/bin/env python3
"""P92: ISOLATED (no live code) paired chronological all-runner *research*
portfolio replay based on older 2026-11-09 STRICT_V2 pinned engine.
Source ORIGINAL engine copied, not overwritten. Three isolated outputs:
  PARITY30M      original code sampling and all original caps, must match archive
  BASE5M_CAPS   same native inputs as original, 5-minute time grid,
                Crypto3/Stock1.5/Total3.5 cap for research-only comparison
  BIN5M_CAPS    same as base5m but replace only 40 PENGU native SHORT V20
                entries by P91 Binance Native V20+ASTER 5min accepted4.
Cannot reproduce 2026-11-22 latest DD21% V4 hold or actual live V52 sizing.
Never claim it re-admits exactly 673 DD-blocked intents.
"""
from pathlib import Path
import hashlib,json,datetime
SOURCE=Path(r"C:\tmp\disdex-bt-20251001-20261001\dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py")
NATIVE=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results\PRISM7_P91_REAL_1Y_BINANCE_TO_ASTER_5M_ACCEPTED_NATIVE_V20_20261122.jsonl")
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\P92_PAIRED_PORTFOLIO_REPLAY")
ROOT.mkdir(exist_ok=True,parents=True)
source=SOURCE.read_text(encoding="utf-8")
assert NATIVE.exists()
assert len(NATIVE.read_text(encoding="utf-8").splitlines())==4
assert "STEP=1800000" in source
assert 'O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)' in source
assert source.count("STOCK_CAP=4.0")==2
assert source.count("gross=2.0,v=z,")==1
patch_marker='v52path=R/"V52_FULLPERIOD_PRICE_MODEL_20261109"/"v52_10bps_trades.jsonl"'
assert patch_marker in source and source.count(patch_marker)==1
insert=str(
 ' original_v20=[c for c in raw if c["s"]=="PENGU" and c["route"]=="SHORT_V20"]\n'
 ' assert len(original_v20)==40,("P92_ORIGINAL_PIN_SHORT_COUNT_NOT_40",len(original_v20))\n'
 ' raw=[c for c in raw if not (c["s"]=="PENGU" and c["route"]=="SHORT_V20")]\n'
 ' adopted_path=pathlib.Path(r"'+str(NATIVE)+'")\n'
 ' adopted_rows=list(jlines(adopted_path))\n'
 ' assert len(adopted_rows)==4 and all(z["route"]=="SHORT_V20" for z in adopted_rows)\n'
 ' assert len({int(z["entryTs"]) for z in adopted_rows})==4\n'
 ' for ix,z in enumerate(adopted_rows,1):\n'
 '  m=z["modelEntryExit"];t=int(z["entryTs"]);gross=float(z["requestedGross"])\n'
 '  assert t==int(m["entryTs"]) and t%300000==0 and 1759276800000<=t<int(m["exitTs"])<=1790812800000\n'
 '  assert gross in (0.5,0.75) and z["route"]=="SHORT_V20" and z["side"]=="SHORT"\n'
 '  assert str(z["sourceSignalPolicy"]).startswith("BINANCE_NATIVE_V20_ONLY")\n'
 '  raw.append(dict(id="PENGU_BIN5_"+str(ix).zfill(5),s="PENGU",t=t,symbol="PENGUUSDT",\n'
 '      side="SHORT",route="SHORT_V20",gross=gross,v=z,\n'
 '      model=m,src=str(adopted_path),\n'
 '      funding=funding("PENGUUSDT",t,int(m["exitTs"]),float(m["entryPrice"]),"SHORT")))\n'
 ' print("P92_NATIVE_SOURCE_INJECTION","original_short",len(original_v20),\n'
 '  "new_confirmed_binance_short",len(adopted_rows),\n'
 '  "untouched_long_recovery",len([c for c in raw if c["s"]=="PENGU" and c["route"]!="SHORT_V20"]),flush=True)\n'
)
insert="\n".join(line[1:] if line.startswith(" ") else line for line in insert.split("\n"))
def sha(s):return hashlib.sha256(s.encode("utf-8")).hexdigest()
paths={}
for mode in ("PARITY30M","BASE5M_CAPS","BIN5M_CAPS"):
 txt=source
 output=ROOT/mode
 txt=txt.replace('O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)',
     'O=pathlib.Path(r"'+str(output)+'");O.mkdir(exist_ok=True)')
 if mode!="PARITY30M":
  txt=txt.replace("STEP=1800000","STEP=300000")
  txt=txt.replace("STOCK_CAP=4.0","STOCK_CAP=1.5")
  # V52 source quote model default gross2.0 exceeds owner cap stock1.5;
  # explicitly scale only its notional, NOT its signal times or exits. Both
  # comparison sides use the same capped model. Not real production parity.
  txt=txt.replace("gross=2.0,v=z,","gross=1.5,v=z,")
  txt=txt.replace("EQUITY_30MIN.csv","EQUITY_5MIN.csv")
 if mode=="BIN5M_CAPS":
  txt=txt.replace(patch_marker,insert+patch_marker)
  assert "P92_NATIVE_SOURCE_INJECTION" in txt
 if mode!="PARITY30M":assert "STEP=300000" in txt and txt.count("STOCK_CAP=1.5")==2
 path=ROOT/("P92_PORTFOLIO_"+mode+"_REPLAY_20261122.py")
 if path.exists():raise RuntimeError("P92_MODE_SCRIPT_EXISTS "+str(path))
 path.write_text(txt,encoding="utf8")
 paths[mode]={"scriptPath":str(path),"scriptSHA256":sha(txt),"outputPath":str(output),
    "stockCap":4.0 if mode=="PARITY30M" else 1.5,
    "totalCap":3.5,"cryptoCap":3.0,
    "modelV52Gross":2.0 if mode=="PARITY30M" else 1.5,
    "timeStepMins":30 if mode=="PARITY30M" else 5}
meta={"schema":"prism7-p92-canonical-historical-source-replay-reference-isolation-v1",
 "originalHistoricalEnginePath":str(SOURCE),"originalEngineSHA256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
 "newOnlyPENGUSHORTBinance5mTapeSHA256":hashlib.sha256(NATIVE.read_bytes()).hexdigest(),
 "modes":paths,
 "noProductionMutation":True,"originalPENGULongAndRecoveryUnchanged":True,
 "researchOnlyNot20261122Stable4":True,
 "majorLimitation":"The 2026-11-09 strict engine does NOT implement the 2026-11-22 V4 DD21% hold or Stable4/Q102 fully. Do not infer the 673 V4 DD21-blocked candidate count from this result.",
 "baseline30MOriginalProof":"Must compare with original archived RUN_MANIFEST before use.",
 "pair5MInvariant":"Compare BASE5M_CAPS vs BIN5M_CAPS only; 5-minute sampling and cap model identical. Baseline30M cannot be compared to5M for economic difference."
}
m=ROOT/"P92_ISOLATED_REPLAY_MANIFEST_20261122.json"
m.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("P92_REPLAY_ENGINE_SCRIPTS_SAFELY_CREATED",json.dumps(meta,ensure_ascii=False)[:5500],flush=True)
