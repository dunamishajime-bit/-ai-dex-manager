"""Prepare reviewable Stable4 root source bytes; never install or authorize.

Inputs are public captured root source files and a fresh, non-secret pin map.
Output must be a new directory outside system/live/release trees. This command
does not create plans, certificates, receipts, a HOLD, or order permissions.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
from disdex_stable4_flat_peer_cutover import build_stable4_flat_peer_sources, ROLES
from disdex_stable4_h48_root_patch import HYPE_BASE_SHA256,GATE_BASE_SHA256
from disdex_stable4_composite_root_bridge import BASE_HASH,build_composite_venue_witness
from disdex_pending_composite_upgrade import build_upgrade_dispatch

def digest(value):return hashlib.sha256(value).hexdigest()
def prepare(captured,old_by_role,old_hype):
 if not isinstance(old_by_role,dict) or set(old_by_role)!=set(ROLES):raise ValueError('EXACT_ROLE_BASELINES_REQUIRED')
 if not all(isinstance(v,str) and re.fullmatch('[a-f0-9]{40}',v) for v in [*old_by_role.values(),old_hype]):raise ValueError('SOURCE_SHA_INVALID')
 required={'disdex_hype_scoped_root_cutover.py':HYPE_BASE_SHA256,'disdex_unified_root_gate.py':GATE_BASE_SHA256,'disdex_v4_venue_witness.py':BASE_HASH}
 for name,expected in required.items():
  if name not in captured or digest(captured[name])!=expected:raise ValueError('CAPTURED_ROOT_PREIMAGE_CHANGED:'+name)
 result=build_stable4_flat_peer_sources(captured['disdex_hype_scoped_root_cutover.py'],captured['disdex_unified_root_gate.py'],old_by_role=old_by_role,h48_old_sha=old_hype)
 combined=result['disdex_unified_root_gate.py']
 result['disdex_unified_root_gate.py']=build_upgrade_dispatch(combined,expected_sha256=digest(combined))
 result['disdex_v4_venue_witness.py']=build_composite_venue_witness(captured['disdex_v4_venue_witness.py'])
 for name in ['disdex_stable4_flat_peer_cutover.py','disdex_stable4_h48_root_patch.py','disdex_stable4_h48_policy.py','disdex_composite_owner_witness.py','disdex_stable4_composite_root_bridge.py','disdex_pending_composite_upgrade.py','disdex_pending_composite_recover.py','disdex_stable4_q102_bootstrap_seal.py']:
  result[name]=Path(__file__).resolve().with_name(name).read_bytes()
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--captured-root',required=True);p.add_argument('--pins-json',required=True);p.add_argument('--output-dir',required=True);args=p.parse_args()
 captured_root=Path(args.captured_root).resolve();output=Path(args.output_dir).resolve()
 if output.exists() or any(output==Path(x) or Path(x) in output.parents for x in ['/etc','/usr/local/libexec','/var/lib/disdex','/home/deploy/disdex-trading/releases']):raise ValueError('OUTPUT_MUST_BE_NEW_NONLIVE_DIRECTORY')
 pins=json.loads(Path(args.pins_json).read_text(encoding='utf8'))
 rows=pins.get('runners',{});olds={role:rows[role]['sha'] for role in ROLES};old_hype=rows['HYPE_TREND_LONG']['sha']
 names=['disdex_hype_scoped_root_cutover.py','disdex_unified_root_gate.py','disdex_v4_venue_witness.py'];captured={name:(captured_root/name).read_bytes() for name in names}
 result=prepare(captured,olds,old_hype)
 output.mkdir(parents=True,exist_ok=False)
 for name,raw in result.items():(output/name).write_bytes(raw)
 print(json.dumps({'status':'REVIEW_SOURCE_PREPARED_ONLY','sourceHashes':{name:digest(raw) for name,raw in sorted(result.items())},'oldByRole':olds,'oldHype':old_hype,'plansCreated':False,'approvalIssued':False,'ordersEnabled':False,'installed':False},sort_keys=True))
if __name__=='__main__':main()
