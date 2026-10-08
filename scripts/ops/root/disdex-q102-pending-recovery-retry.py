"""Retry only transient read-only Q102 recovery contention; preserve every safety gate."""
import json,subprocess,sys,time,re
from pathlib import Path
def retryable(output):
 for line in output.splitlines():
  try:d=json.loads(line)
  except ValueError:continue
  if d.get('status')!='Q102_PENDING_RECOVERY_FAIL_CLOSED':continue
  msg=d.get('message','')
  if msg=='Q102_PENDING_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE' or msg.startswith('ASTER_GLOBAL_RATE_BUDGET_SATURATED:'):return True
 return False
def main():
 sha=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',sha)
 root=Path('/home/deploy/disdex-trading/current').resolve()
 assert root.name==sha and (root/'.disdex-release-sha').read_text().strip()==sha
 cmd=[str(root/'node_modules/.bin/tsx'),str(root/'scripts/disdex-quality102-pending-order-recovery.ts'),'--allow-no-pending','--apply','--sha',sha,'--ack','I_ACK_Q102_NO_EXPOSURE_PENDING_RECOVERY_AFTER_THREE_READONLY_ROUNDS']
 deadline=time.monotonic()+180
 for attempt in range(1,20):
  remaining=deadline-time.monotonic()
  if remaining<=0:return 1
  try:r=subprocess.run(cmd,cwd=root,capture_output=True,text=True,timeout=min(150,remaining))
  except subprocess.TimeoutExpired:
   print(json.dumps({'status':'Q102_RECOVERY_DEADLINE_EXCEEDED','ordersSent':0}),flush=True);return 1
  print(r.stdout,end='',flush=True);print(r.stderr,end='',file=sys.stderr,flush=True)
  if r.returncode==0:return 0
  if not retryable(r.stdout+'\n'+r.stderr) or time.monotonic()+10>=deadline:return r.returncode
  print(json.dumps({'status':'Q102_RECOVERY_TRANSIENT_RETRY','attempt':attempt,'ordersSent':0}),flush=True);time.sleep(10)
 return 1
if __name__=='__main__':raise SystemExit(main())
