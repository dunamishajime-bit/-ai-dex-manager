#!/usr/bin/env python3
"""Verify immutable older integrated anchors using manifest-defined LF byte hashing.

Windows Git CRLF materialization changes raw SHA256; canonical-LF hashing
avoids treating newline conversion as corrupt evidence. No original file writes.
"""
import hashlib, json, math
from pathlib import Path
from collections import Counter

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/"docs/research/results/trail020-idle-doge-avax-controlling-20261002"

def verify():
    m=json.loads((SRC/"manifest.json").read_text(encoding="utf-8"))
    for f in m["files"]:
        b=(SRC/f["path"]).read_bytes()
        canonical=b.replace(b"\r\n",b"\n")
        assert len(canonical)==f["bytes"],f["path"]+":size"
        assert hashlib.sha256(canonical).hexdigest()==f["sha256"],f["path"]+":sha256"
    out=[]
    for cost in [10,20,30]:
        case=SRC/(str(cost)+"bps")
        integ=json.loads((case/"integrated-result.json").read_text(encoding="utf-8"))
        metrics=json.loads((case/"metrics.json").read_text(encoding="utf-8"))
        rows=[json.loads(s) for s in (case/"portfolio-trades.jsonl").read_text(encoding="utf-8").splitlines() if s.strip()]
        assert len(rows)==integ["combined_completed"]==metrics["combined_completed"]
        pnl=[float(t["trade_pnl_settlement"]) for t in rows]
        wins=sum(p>0 for p in pnl)
        gl=-sum(v for v in pnl if v<0);gp=sum(v for v in pnl if v>0)
        pf=gp/gl if gl else math.inf
        assert abs(pf-metrics["profit_factor"])<1e-9
        assert abs(wins/len(rows)-metrics["win_rate"])<1e-12
        assert abs(integ["final_equity_jpy"]-metrics["final_equity_jpy"])<1e-6
        counts=dict(Counter(t["strategy"] for t in rows))
        assert counts==metrics["strategy_counts"]
        out.append({
           "bps":cost,"entries":len(rows),"wins":wins,"win_rate":round(100*wins/len(rows),4),
           "profit_factor":round(pf,6),"final_equity_jpy":round(metrics["final_equity_jpy"],2),
           "max_h1_mtm_dd_pct":round(metrics["max_mtm_drawdown"]*100,4),
           "note":"UNCHANGED_HISTORICAL_TRAIL020_IDLE_DOGE_AVAX_ONLY",
        })
    return {"status":"LF_CANONICAL_MANIFEST_AND_LEGACY_ANCHOR_PASS",
            "manifest_files_checked":len(m["files"]),"cases":out}

if __name__=="__main__":
    print(json.dumps(verify(),indent=2,ensure_ascii=False))
