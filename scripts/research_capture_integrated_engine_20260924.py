from __future__ import annotations
import argparse, pathlib, re
import research_quality102_gross_cap_sweep as q102
import research_quality102_mtm_50_v2 as mtm

def replace_float_assignment(source: str, name: str, value: float) -> str:
    pattern=re.compile(rf"^(\s*{re.escape(name)}\s*=\s*)(-?\d+(?:\.\d+)?)\s*$",re.M)
    out,count=pattern.subn(rf"\g<1>{value:g}",source,count=1)
    if count!=1: raise RuntimeError(f"assignment missing {name}:{count}")
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--stock-cache-dir",required=True)
    ap.add_argument("--v12-ledger",required=True)
    ap.add_argument("--pengu-ledger",required=True)
    ap.add_argument("--output",required=True)
    args=ap.parse_args()
    base_args=["--stock-cache-dir",args.stock_cache_dir,"--v12-ledger",args.v12_ledger,"--pengu-ledger",args.pengu_ledger,"--output-dir",".research-state/capture/_run"]
    source=q102.capture_grosssafe_generated(base_args)
    source=q102.patch_supplement_cap(source,1.5)
    source=mtm.patch_mtm_engine(source)
    for name,value in (("PENGU_MAX_GROSS",0.85),("CRYPTO_GROSS_CAP",3.0),("TOTAL_GROSS_CAP",3.5),("CRYPTO_DAILY_LOSS_LIMIT",-0.075)):
        source=replace_float_assignment(source,name,value)
    out=pathlib.Path(args.output); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(source,encoding="utf-8")
    print("CAPTURED_INTEGRATED_ENGINE",len(source),out)
if __name__=="__main__": main()
